// Single place where Safepay payments are confirmed. Every path (donor return, "Check status",
// webhook, admin action, background job) calls reconcileDonation, which asks Safepay directly
// and changes the database only on Safepay's server-side answer. Safe to run any number of times.
const db = require("../config/db");
const safepay = require("./safepay");

// A donation can still turn out to be paid from these states (e.g. paid after it expired).
const OPEN_STATES = ["pending", "failed", "cancelled", "expired"];

async function confirmPayment(donationId, payment, result) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Lock the donation so a webhook and a redirect arriving together cannot both record it.
    const [[donation]] = await connection.execute(
      "SELECT id, user_id, amount, payment_status FROM donations WHERE id = ? FOR UPDATE",
      [donationId]
    );

    await connection.execute(
      `UPDATE payments
       SET status = 'completed', provider_state = ?, provider_reference = ?, checked_at = NOW()
       WHERE id = ?`,
      [result.state, result.transactionId, payment.id]
    );

    let changed = false;

    if (donation && OPEN_STATES.includes(donation.payment_status)) {
      await connection.execute(
        `UPDATE donations
         SET payment_status = 'completed',
             transaction_reference = COALESCE(transaction_reference, ?),
             payment_channel = COALESCE(?, payment_channel),
             donated_at = COALESCE(donated_at, NOW())
         WHERE id = ?`,
        [payment.provider_transaction_id, result.method, donationId]
      );

      await connection.execute(
        "INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)",
        [
          donation.user_id,
          "SAFEPAY_PAYMENT_CONFIRMED",
          `Donation ID ${donationId}; amount ${donation.amount}; tracker ${payment.provider_transaction_id}; ` +
            `transaction ${result.transactionId}; previous status ${donation.payment_status}`
        ]
      );

      changed = true;
    } else if (donation && payment.status !== "completed") {
      // Money arrived on a second tracker for an already-settled donation: flag it for a refund.
      await connection.execute(
        "INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)",
        [
          donation.user_id,
          "SAFEPAY_DUPLICATE_PAYMENT",
          `Donation ID ${donationId} is ${donation.payment_status}; extra payment on tracker ` +
            `${payment.provider_transaction_id} (transaction ${result.transactionId}) needs review`
        ]
      );
    }

    await connection.commit();
    return changed;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Returns { status, state, changed } where status is the donation's payment_status afterwards.
async function reconcileDonation(donationId) {
  const [[donation]] = await db.execute(
    "SELECT id, user_id, payment_method, payment_status FROM donations WHERE id = ?",
    [donationId]
  );

  if (!donation) throw new Error(`Donation ${donationId} not found.`);

  if (donation.payment_method !== "safepay" || !OPEN_STATES.includes(donation.payment_status)) {
    return { status: donation.payment_status, state: null, changed: false };
  }

  const [payments] = await db.execute(
    `SELECT id, provider_transaction_id, amount, status FROM payments
     WHERE donation_id = ? AND provider = 'safepay' AND provider_transaction_id IS NOT NULL
     ORDER BY id DESC`,
    [donationId]
  );

  let lastState = null;
  let failures = 0;

  for (const payment of payments) {
    let result;

    try {
      result = await safepay.getTrackerState(payment.provider_transaction_id, payment.amount);
    } catch (error) {
      failures += 1;
      console.error(`Safepay lookup failed for donation ${donationId}:`, error.message);
      continue;
    }

    lastState = lastState || result.state;

    if (result.paid) {
      const changed = await confirmPayment(donationId, payment, result);
      return { status: "completed", state: result.state, changed };
    }

    if (result.state === "TRACKER_ENDED" && result.problems.length) {
      // Paid, but not for what this server asked: never count it automatically.
      console.error(
        `Safepay tracker for donation ${donationId} ended but failed checks: ${result.problems.join(", ")}`
      );
      await db.execute(
        "INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)",
        [
          donation.user_id,
          "SAFEPAY_PAYMENT_MISMATCH",
          `Donation ID ${donationId}; tracker ${payment.provider_transaction_id}; ${result.problems.join(", ")}`
        ]
      );
    }

    await db.execute(
      "UPDATE payments SET provider_state = ?, checked_at = NOW() WHERE id = ?",
      [result.state, payment.id]
    );
  }

  if (payments.length && failures === payments.length) {
    throw new Error("Could not reach Safepay to confirm this payment.");
  }

  return { status: donation.payment_status, state: lastState, changed: false };
}

// Marks a still-unpaid donation and its open trackers with a final status (cancelled / expired).
async function closeDonation(donationId, status) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.execute(
      "UPDATE donations SET payment_status = ? WHERE id = ? AND payment_status = 'pending'",
      [status, donationId]
    );

    await connection.execute(
      "UPDATE payments SET status = ? WHERE donation_id = ? AND status = 'pending'",
      [status, donationId]
    );

    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const EXPIRY_HOURS = () => Math.max(1, Number(process.env.SAFEPAY_PENDING_EXPIRY_HOURS) || 24);
const BATCH_SIZE = 20;

// Background safety net: confirms payments whose donor never came back to the site
// and whose webhook never arrived, then expires pledges that stayed unpaid too long.
async function reconcilePending() {
  if (!safepay.isConfigured()) return;

  const [rows] = await db.query(
    `SELECT d.id, d.created_at < NOW() - INTERVAL ? HOUR AS overdue
     FROM donations d
     WHERE d.payment_method = 'safepay' AND d.payment_status = 'pending'
     ORDER BY (SELECT MAX(p.checked_at) FROM payments p WHERE p.donation_id = d.id) IS NOT NULL,
              (SELECT MAX(p.checked_at) FROM payments p WHERE p.donation_id = d.id),
              d.id
     LIMIT ${BATCH_SIZE}`,
    [EXPIRY_HOURS()]
  );

  for (const row of rows) {
    try {
      const { status } = await reconcileDonation(row.id);

      if (status === "pending" && row.overdue) {
        await closeDonation(row.id, "expired");
        console.log(`Donation ${row.id} expired after ${EXPIRY_HOURS()} hours without payment.`);
      } else if (status === "completed") {
        console.log(`Donation ${row.id} confirmed by background check.`);
      }
    } catch (error) {
      console.error(`Background payment check failed for donation ${row.id}:`, error.message);
    }
  }
}

function startReconciler() {
  const minutes = Math.max(1, Number(process.env.SAFEPAY_RECONCILE_MINUTES) || 5);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await reconcilePending();
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 30 * 1000).unref();
  setInterval(tick, minutes * 60 * 1000).unref();
}

module.exports = { reconcileDonation, closeDonation, reconcilePending, startReconciler };
