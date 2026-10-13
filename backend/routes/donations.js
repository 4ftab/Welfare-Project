
const express = require("express");
const db = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const router = express.Router();

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

    const [result] = await db.execute(
      `INSERT INTO donations
       (user_id, amount, payment_method, payment_status)
       VALUES (?, ?, 'safepay', 'pending')`,
      [req.user.id, amount]
    );

    res.status(201).json({
      message: "Pending donation created. Payment has not yet been taken.",
      donation_id: result.insertId,
      amount,
      payment_status: "pending",
      next_step: "Safepay checkout integration is required to accept payment."
    });
  } catch (error) {
    console.error("Create donation error:", error.message);

    res.status(500).json({
      message: "Could not create donation."
    });
  }
});

router.post("/offline", authenticateToken, requireAdmin, async (req, res) => {
  const {
    user_id,
    amount,
    payment_method,
    transaction_reference,
    donated_at
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
       (user_id, amount, payment_method, payment_status,
        transaction_reference, donated_at)
       VALUES (?, ?, ?, 'completed', ?, ?)`,
      [
        Number(user_id),
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
