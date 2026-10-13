
const express = require("express");
const db = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get("/donors", async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT id, full_name, email, phone, role, is_active, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    res.json({ total_users: users.length, users });
  } catch (error) {
    console.error("Donors error:", error.message);

    res.status(500).json({
      message: "Could not retrieve donors."
    });
  }
});

router.get("/donations", async (req, res) => {
  try {
    const { month } = req.query;

    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        message: "Month must use YYYY-MM format."
      });
    }

    let sql = `
      SELECT d.id AS donation_id, u.id AS user_id,
             u.full_name, u.email, d.amount,
             d.payment_method, d.payment_status,
             d.transaction_reference,
             COALESCE(d.donated_at, d.created_at) AS donation_date
      FROM donations d
      JOIN users u ON u.id = d.user_id
    `;

    const params = [];

    if (month) {
      sql += `
        WHERE COALESCE(d.donated_at, d.created_at) >= ?
          AND COALESCE(d.donated_at, d.created_at) < DATE_ADD(?, INTERVAL 1 MONTH)
      `;

      params.push(`${month}-01`, `${month}-01`);
    }

    sql += " ORDER BY donation_date DESC";

    const [donations] = await db.execute(sql, params);

    res.json({
      total_records: donations.length,
      donations
    });
  } catch (error) {
    console.error("Admin donations error:", error.message);

    res.status(500).json({
      message: "Could not retrieve donation records."
    });
  }
});

module.exports = router;
