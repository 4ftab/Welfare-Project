
const express = require("express");
const db = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const safepay = require("../services/safepay");

const router = express.Router();

const FRONTEND = () => process.env.FRONTEND_URL || "http://localhost:5173";

// Creates (or reuses) a Safepay tracker for a pending donation and returns the hosted checkout URL.
async function startCheckout(donationId, amount) {
  const [existing] = await db.execute(
    `SELECT provider_transaction_id FROM payments
     WHERE donation_id = ? AND status = 'pending'
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

  return safepay.checkoutUrl({
    tracker,
    orderId: `NIW-${donationId}`,
    redirectUrl: `${FRONTEND()}/?payment=return&donation=${donationId}#/dashboard`,
    cancelUrl: `${FRONTEND()}/?payment=cancel&donation=${donationId}#/dashboard`
  });
}

// Asks Safepay for the real tracker state and completes the donation if it was paid.
async function reconcile(donationId) {
  const [payments] = await db.execute(
    `SELECT id, provider_transaction_id, amount FROM payments
     WHERE donation_id = ? ORDER BY id DESC`,
    [donationId]
  );

  for (const payment of payments) {
    const { state, paid } = await safepay.getTrackerState(
      payment.provider_transaction_id,
      payment.amount
    );

    if (!paid) continue;

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      await connection.execute(
        "UPDATE payments SET status = 'completed' WHERE id = ?",
        [payment.id]
      );

      const [updated] = await connection.execute(
        `UPDATE donations
         SET payment_status = 'completed',
             transaction_reference = COALESCE(transaction_reference, ?),
             donated_at = COALESCE(donated_at, NOW())
         WHERE id = ? AND payment_status = 'pending'`,
        [payment.provider_transaction_id, donationId]
      );

      if (updated.affectedRows) {
        const [[donation]] = await connection.execute(
          "SELECT user_id, amount FROM donations WHERE id = ?",
          [donationId]
        );

        await connection.execute(
          "INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)",
          [
            donation.user_id,
            "SAFEPAY_PAYMENT_CONFIRMED",
            `Donation ID ${donationId}; amount ${donation.amount}; tracker ${payment.provider_transaction_id}`
          ]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return { paid: true, state };
  }

  return { paid: false, state: "TRACKER_STARTED" };
}

router.post("/", authenticateToken, async (req, res) => {
  try {
    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        message: "Amount must be greater than zero."
      });
    }

    if (req.body.payment_method !== "safepay") {
      return res.status(400).json({
        message: "Online donations must use Safepay."
      });
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

    const [result] = await db.execute(
      `INSERT INTO donations
       (user_id, project_id, amount, payment_method, payment_status, note, payment_channel)
       VALUES (?, ?, ?, 'safepay', 'pending', ?, ?)`,
      [req.user.id, projectId, amount, note, channel]
    );

    const donationId = result.insertId;

    if (!safepay.isConfigured()) {
      return res.status(201).json({
        message: "Pledge recorded. Payment has not yet been taken.",
        donation_id: donationId,
        amount,
        payment_status: "pending",
        checkout_url: null
      });
    }

    try {
      const checkoutUrl = await startCheckout(donationId, amount);

      res.status(201).json({
        message: "Pledge recorded. Continue to Safepay to complete your payment.",
        donation_id: donationId,
        amount,
        payment_status: "pending",
        checkout_url: checkoutUrl
      });
    } catch (error) {
      console.error("Safepay tracker error:", error.message);

      // The pledge still exists, so the donor can retry from their dashboard.
      res.status(201).json({
        message: "Pledge recorded, but online checkout is unavailable right now. You can retry from your dashboard.",
        donation_id: donationId,
        amount,
        payment_status: "pending",
        checkout_url: null
      });
    }
  } catch (error) {
    console.error("Create donation error:", error.message);

    res.status(500).json({
      message: "Could not create donation."
    });
  }
});

async function ownPendingDonation(id, userId) {
  const [rows] = await db.execute(
    `SELECT id, amount FROM donations
     WHERE id = ? AND user_id = ? AND payment_status = 'pending'`,
    [id, userId]
  );

  return rows[0];
}

// Open (or resume) Safepay checkout for a pending donation of the signed-in donor.
router.post("/:id/pay", authenticateToken, async (req, res) => {
  try {
    if (!safepay.isConfigured()) {
      return res.status(503).json({ message: "Online payment is not available." });
    }

    const donation = await ownPendingDonation(Number(req.params.id), req.user.id);

    if (!donation) {
      return res.status(404).json({ message: "No pending donation found." });
    }

    res.json({ checkout_url: await startCheckout(donation.id, donation.amount) });
  } catch (error) {
    console.error("Resume checkout error:", error.message);
    res.status(502).json({ message: "Could not reach Safepay. Please try again shortly." });
  }
});

// Called after the donor returns from Safepay: confirm with Safepay, then complete the donation.
router.post("/:id/verify", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [rows] = await db.execute(
      "SELECT payment_status FROM donations WHERE id = ? AND user_id = ?",
      [id, req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Donation not found." });
    }

    if (rows[0].payment_status === "completed") {
      return res.json({ payment_status: "completed", message: "Payment confirmed." });
    }

    if (!safepay.isConfigured()) {
      return res.status(503).json({ message: "Online payment is not available." });
    }

    const result = await reconcile(id);

    res.json({
      payment_status: result.paid ? "completed" : "pending",
      message: result.paid
        ? "Payment confirmed. Thank you!"
        : "Safepay has not confirmed this payment yet."
    });
  } catch (error) {
    console.error("Verify payment error:", error.message);
    res.status(502).json({ message: "Could not verify the payment with Safepay." });
  }
});

// A donor may withdraw their own pledge while it is still pending.
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const donation = await ownPendingDonation(id, req.user.id);

    if (!donation) {
      return res.status(404).json({
        message: "No pending donation found to cancel."
      });
    }

    // Never discard a payment that Safepay already received.
    if (safepay.isConfigured()) {
      try {
        const { paid } = await reconcile(id);

        if (paid) {
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

    await db.execute("DELETE FROM payments WHERE donation_id = ?", [id]);
    await db.execute("DELETE FROM donations WHERE id = ? AND payment_status = 'pending'", [id]);

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
