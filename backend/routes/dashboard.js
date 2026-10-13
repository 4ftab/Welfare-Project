
const express = require("express");
const db = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticateToken, async (req, res) => {
  try {
    const [totals] = await db.execute(
      `SELECT
         COUNT(*) AS total_donations,
         COALESCE(
           SUM(CASE WHEN payment_status = 'completed'
                    THEN amount ELSE 0 END), 0
         ) AS total_amount
       FROM donations
       WHERE user_id = ?`,
      [req.user.id]
    );

    const [donations] = await db.execute(
      `SELECT d.id, d.amount, d.payment_method, d.payment_status,
              d.transaction_reference, d.project_id, d.payment_channel,
              p.title AS project_title,
              COALESCE(d.donated_at, d.created_at) AS donation_date
       FROM donations d
       LEFT JOIN projects p ON p.id = d.project_id
       WHERE d.user_id = ?
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json({
      summary: totals[0],
      recent_donations: donations
    });
  } catch (error) {
    console.error("Dashboard error:", error.message);

    res.status(500).json({
      message: "Could not load your dashboard."
    });
  }
});

module.exports = router;
