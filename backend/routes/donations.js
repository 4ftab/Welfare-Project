const express = require("express");
const db = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const safepay = require("../services/safepay");
const { reconcileDonation, closeDonation } = require("../services/payments");

const router = express.Router();

const FRONTEND = () =>
  String(process.env.FRONTEND_URL || "http://localhost:5173").trim().replace(/\/+$/, "");

const MIN_AMOUNT = 10;
const MAX_AMOUNT = 1000000;

// A second identical request within this window reuses the first pledge (double-clicks, retries).
const DUPLICATE_WINDOW_MINUTES = 10;

const UNAVAILABLE = "Online payment is temporarily unavailable. Please try again later.";

function checkoutFor(donationId, tracker) {
  return safepay.checkoutUrl({
    tracker,
    orderId: `NIW-${donationId}`,
    redirectUrl: `${FRONTEND()}/?payment=return&donation=${donationId}#/dashboard`,
    cancelUrl: `${FRONTEND()}/?payment=cancel&donation=${donationId}#/dashboard`
  });
}

// Reuses the donation's open Safepay tracker, or opens a new one, and returns the hosted checkout URL.
async function resumeCheckout(donationId, amount) {
  const [existing] = await db.execute(
    `SELECT provider_transaction_id FROM payments
     WHERE donation_id = ? AND provider = 'safepay' AND status = 'pending'
     ORDER BY id DESC LIMIT 1`,
    [donationId]
  );

  let tracker = existing[0]?.provider_transaction_id;

  if (!tracker) {
    tracker = await safepay.createTracker(amount);

    await db.execute(
      `INSERT INTO payments (donation_id, provider, provider_transaction_id, amount, status)
       VALUES (?, 'safepay', ?, ?, 'pending')`,
      [donationId, tracker, amount]
    );
  }

  return checkoutFor(donationId, tracker);
}

router.post("/", authenticateToken, async (req, res) => {
  try {
    const amount = Number(req.body.amount);

    if (!Number.isInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      return res.status(400).json({
        message: `Enter a whole amount between PKR ${MIN_AMOUNT} and PKR ${MAX_AMOUNT.toLocaleString("en-PK")}.`
      });
    }

    if (req.body.payment_method !== "safepay") {
      return res.status(400).json({
        message: "Online donations must use Safepay."
      });
    }

    const paymentMode = safepay.mode();

    if (paymentMode === "invalid") {
      console.error("Safepay configuration:", safepay.configProblems().join(" "));
      return res.status(503).json({ message: UNAVAILABLE });
    }

    let projectId = null;

    if (req.body.project_id) {
      projectId = Number(req.body.project_id);

      const [projects] = await db.execute(
        "SELECT id FROM projects WHERE id = ? AND status IN ('planned', 'ongoing')",
        [projectId]
      );

      if (!projects.length) {
        return res.status(400).json({
          message: "That project is not currently accepting donations."
        });
      }
    }

    const note = req.body.note ? String(req.body.note).trim().slice(0, 255) : null;

    const channels = safepay.enabledChannels();
    const channel = String(req.body.payment_channel || "card").toLowerCase();

    if (!channels.includes(channel)) {
      return res.status(400).json({
        message: "That payment method is not available."
      });
    }

    // The same pledge submitted twice in a short time continues the first one.
    const [recent] = await db.execute(
      `SELECT id FROM donations
       WHERE user_id = ? AND payment_method = 'safepay' AND payment_status = 'pending'
         AND amount = ? AND project_id <=> ?
         AND created_at > NOW() - INTERVAL ${DUPLICATE_WINDOW_MINUTES} MINUTE
       ORDER BY id DESC LIMIT 1`,
      [req.user.id, amount, projectId]
    );

    if (paymentMode === "off") {
      if (recent.length) {
        return res.status(200).json({
          message: "You already have this pledge pending.",
          donation_id: recent[0].id,
          amount,
          payment_status: "pending",
          checkout_url: null
        });
      }

      const [result] = await db.execute(
        `INSERT INTO donations
         (user_id, project_id, amount, payment_method, payment_status, note, payment_channel)
         VALUES (?, ?, ?, 'safepay', 'pending', ?, ?)`,
        [req.user.id, projectId, amount, note, channel]
      );

      return res.status(201).json({
        message: "Pledge recorded. Payment has not yet been taken.",
        donation_id: result.insertId,
        amount,
        payment_status: "pending",
        checkout_url: null
      });
    }

    if (recent.length) {
      const checkoutUrl = await resumeCheckout(recent[0].id, amount);

      return res.status(200).json({
        message: "Continue to Safepay to complete your payment.",
        donation_id: recent[0].id,
        amount,
        payment_status: "pending",
        checkout_url: checkoutUrl
      });
    }

    // Open the Safepay tracker first, so a Safepay outage leaves no orphaned pledge behind.
    let tracker;

    try {
      tracker = await safepay.createTracker(amount);
    } catch (error) {
      console.error("Safepay tracker error:", error.message);
      return res.status(502).json({
        message: "Could not reach Safepay. No donation was recorded; please try again shortly."
      });
    }

    const connection = await db.getConnection();
    let donationId;

    try {
      await connection.beginTransaction();

      const [result] = await connection.execute(
        `INSERT INTO donations
         (user_id, project_id, amount, payment_method, payment_status, note, payment_channel)
         VALUES (?, ?, ?, 'safepay', 'pending', ?, ?)`,
        [req.user.id, projectId, amount, note, channel]
      );

      donationId = result.insertId;

      await connection.execute(
        `INSERT INTO payments (donation_id, provider, provider_transaction_id, amount, status)
         VALUES (?, 'safepay', ?, ?, 'pending')`,
        [donationId, tracker, amount]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.status(201).json({
      message: "Continue to Safepay to complete your payment.",
      donation_id: donationId,
      amount,
      payment_status: "pending",
      checkout_url: checkoutFor(donationId, tracker)
    });
  } catch (error) {
    console.error("Create donation error:", error.message);

    res.status(500).json({
      message: "Could not create donation."
    });
  }
});

async function ownDonation(id, userId) {
  const [rows] = await db.execute(
    `SELECT id, amount, payment_method, payment_status FROM donations
     WHERE id = ? AND user_id = ?`,
    [id, userId]
  );

  return rows[0];
}

const STATUS_MESSAGES = {
  completed: "Payment confirmed. Thank you!",
  pending: "Safepay has not confirmed this payment yet. If you have just paid, check again in a minute.",
  cancelled: "This donation was cancelled.",
  expired: "This donation expired before it was paid.",
  failed: "This payment failed.",
  refunded: "This payment was refunded."
};

// Open (or resume) Safepay checkout for a pending donation of the signed-in donor.
router.post("/:id/pay", authenticateToken, async (req, res) => {
  try {
    if (!safepay.isConfigured()) {
      return res.status(503).json({ message: UNAVAILABLE });
    }

    const donation = await ownDonation(Number(req.params.id), req.user.id);

    if (!donation || donation.payment_method !== "safepay" || donation.payment_status !== "pending") {
      return res.status(404).json({ message: "No pending donation found." });
    }

    // If Safepay already took the money, do not send the donor to pay again.
    const { status } = await reconcileDonation(donation.id);

    if (status === "completed") {
      return res.status(409).json({
        payment_status: "completed",
        message: "This donation is already paid. Thank you!"
      });
    }

    res.json({ checkout_url: await resumeCheckout(donation.id, donation.amount) });
  } catch (error) {
    console.error("Resume checkout error:", error.message);
    res.status(502).json({ message: "Could not reach Safepay. Please try again shortly." });
  }
});

// Called after the donor returns from Safepay and by "Check status": asks Safepay, never the URL.
router.post("/:id/verify", authenticateToken, async (req, res) => {
  try {
    const donation = await ownDonation(Number(req.params.id), req.user.id);

    if (!donation) {
      return res.status(404).json({ message: "Donation not found." });
    }

    if (donation.payment_method !== "safepay" || !safepay.isConfigured()) {
      return res.json({
        payment_status: donation.payment_status,
        message: STATUS_MESSAGES[donation.payment_status]
      });
    }

    const { status } = await reconcileDonation(donation.id);

    res.json({ payment_status: status, message: STATUS_MESSAGES[status] });
  } catch (error) {
    console.error("Verify payment error:", error.message);
    res.status(502).json({ message: "Could not verify the payment with Safepay. Please try again shortly." });
  }
});

// A donor may withdraw their own pledge while it is still pending. The record is kept as "cancelled".
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const donation = await ownDonation(Number(req.params.id), req.user.id);

    if (!donation || donation.payment_status !== "pending") {
      return res.status(404).json({
        message: "No pending donation found to cancel."
      });
    }

    // Never cancel a payment that Safepay already received.
    if (donation.payment_method === "safepay" && safepay.isConfigured()) {
      try {
        const { status } = await reconcileDonation(donation.id);

        if (status === "completed") {
          return res.status(409).json({
            message: "This payment was already completed, so it can't be cancelled."
          });
        }
      } catch (error) {
        console.error("Cancel pre-check error:", error.message);

        return res.status(502).json({
          message: "Could not confirm the payment status with Safepay. Please try again."
        });
      }
    }

    await closeDonation(donation.id, "cancelled");

    res.json({ message: "Pending donation cancelled." });
  } catch (error) {
    console.error("Cancel donation error:", error.message);
    res.status(500).json({ message: "Could not cancel donation." });
  }
});

router.post("/offline", authenticateToken, requireAdmin, async (req, res) => {
  const {
    user_id,
    amount,
    payment_method,
    transaction_reference,
    donated_at,
    project_id
  } = req.body;

  const numericAmount = Number(amount);
  const allowedMethods = ["cash", "bank_transfer", "other"];

  if (!Number.isInteger(Number(user_id)) || Number(user_id) <= 0) {
    return res.status(400).json({
      message: "A valid donor user_id is required."
    });
  }

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({
      message: "Amount must be greater than zero."
    });
  }

  if (!allowedMethods.includes(payment_method)) {
    return res.status(400).json({
      message: "Invalid offline payment method."
    });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [users] = await connection.execute(
      "SELECT id FROM users WHERE id = ? AND is_active = TRUE",
      [Number(user_id)]
    );

    if (!users.length) {
      await connection.rollback();

      return res.status(404).json({
        message: "Active donor account not found."
      });
    }

    const [result] = await connection.execute(
      `INSERT INTO donations
       (user_id, project_id, amount, payment_method, payment_status,
        transaction_reference, donated_at)
       VALUES (?, ?, ?, ?, 'completed', ?, ?)`,
      [
        Number(user_id),
        project_id ? Number(project_id) : null,
        numericAmount,
        payment_method,
        transaction_reference || null,
        donated_at || new Date().toISOString().slice(0, 19).replace("T", " ")
      ]
    );

    await connection.execute(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES (?, ?, ?)`,
      [
        req.user.id,
        "OFFLINE_DONATION_RECORDED",
        `Donation ID ${result.insertId}; amount ${numericAmount}; method ${payment_method}`
      ]
    );

    await connection.commit();

    res.status(201).json({
      message: "Verified offline donation recorded.",
      donation_id: result.insertId,
      payment_status: "completed"
    });
  } catch (error) {
    await connection.rollback();

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This transaction reference already exists."
      });
    }

    console.error("Offline donation error:", error.message);

    res.status(500).json({
      message: "Could not record offline donation."
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
