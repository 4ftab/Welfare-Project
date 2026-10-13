
const express = require("express");
const db = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const router = express.Router();

router.use(authenticateToken, requireAdmin);

async function audit(userId, action, details) {
  await db.execute(
    "INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)",
    [userId, action, details]
  );
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

router.get("/donors", async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active,
              u.created_at,
              COALESCE(SUM(CASE WHEN d.payment_status = 'completed'
                                THEN d.amount END), 0) AS total_donated,
              COUNT(d.id) AS donation_count
       FROM users u
       LEFT JOIN donations d ON d.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );

    res.json({ total_users: users.length, users });
  } catch (error) {
    console.error("Donors error:", error.message);

    res.status(500).json({
      message: "Could not retrieve donors."
    });
  }
});

router.patch("/users/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { is_active, role } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid user id." });
    }

    if (id === req.user.id) {
      return res.status(400).json({
        message: "You cannot change your own role or active status."
      });
    }

    const fields = [];
    const params = [];

    if (is_active !== undefined) {
      fields.push("is_active = ?");
      params.push(is_active ? 1 : 0);
    }

    if (role !== undefined) {
      if (!["donor", "admin"].includes(role)) {
        return res.status(400).json({ message: "Invalid role." });
      }
      fields.push("role = ?");
      params.push(role);
    }

    if (!fields.length) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    const [result] = await db.execute(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      [...params, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "User not found." });
    }

    await audit(
      req.user.id,
      "USER_UPDATED",
      `User ID ${id}; ${fields.map((f, i) => `${f.split(" ")[0]}=${params[i]}`).join(", ")}`
    );

    res.json({ message: "User updated." });
  } catch (error) {
    console.error("Update user error:", error.message);
    res.status(500).json({ message: "Could not update user." });
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
             d.transaction_reference, d.project_id,
             p.title AS project_title,
             COALESCE(d.donated_at, d.created_at) AS donation_date
      FROM donations d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN projects p ON p.id = d.project_id
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

// Confirm or reject a donation (e.g. a pending online pledge).
router.patch("/donations/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, transaction_reference } = req.body;

    if (!["pending", "completed", "failed", "refunded"].includes(status)) {
      return res.status(400).json({ message: "Invalid donation status." });
    }

    const [result] = await db.execute(
      `UPDATE donations
       SET payment_status = ?,
           transaction_reference = COALESCE(?, transaction_reference),
           donated_at = CASE WHEN ? = 'completed' AND donated_at IS NULL
                             THEN NOW() ELSE donated_at END
       WHERE id = ?`,
      [status, transaction_reference || null, status, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Donation not found." });
    }

    await audit(
      req.user.id,
      "DONATION_STATUS_CHANGED",
      `Donation ID ${id}; status ${status}`
    );

    res.json({ message: "Donation status updated." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This transaction reference already exists."
      });
    }

    console.error("Donation status error:", error.message);
    res.status(500).json({ message: "Could not update donation." });
  }
});

router.get("/export/donations.csv", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT d.id, u.full_name, u.email, d.amount, d.payment_method,
              d.payment_status, d.transaction_reference,
              p.title AS project,
              COALESCE(d.donated_at, d.created_at) AS donation_date
       FROM donations d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN projects p ON p.id = d.project_id
       ORDER BY donation_date DESC`
    );

    const header = [
      "ID", "Donor", "Email", "Amount (PKR)", "Method",
      "Status", "Reference", "Project", "Date"
    ];

    const lines = [header.map(csvCell).join(",")];

    for (const r of rows) {
      lines.push(
        [
          r.id, r.full_name, r.email, r.amount, r.payment_method,
          r.payment_status, r.transaction_reference, r.project,
          r.donation_date ? new Date(r.donation_date).toISOString() : ""
        ].map(csvCell).join(",")
      );
    }

    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="donations.csv"'
    });

    res.send("﻿" + lines.join("\r\n"));
  } catch (error) {
    console.error("Export donations error:", error.message);
    res.status(500).json({ message: "Could not export donations." });
  }
});

router.get("/export/expenses.csv", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT e.id, e.expense_date, e.title, e.category, e.amount,
              e.receipt_reference, p.title AS project,
              u.full_name AS recorded_by
       FROM expenses e
       JOIN users u ON u.id = e.recorded_by
       LEFT JOIN projects p ON p.id = e.project_id
       ORDER BY e.expense_date DESC, e.id DESC`
    );

    const header = [
      "ID", "Date", "Title", "Category", "Amount (PKR)",
      "Receipt", "Project", "Recorded by"
    ];

    const lines = [header.map(csvCell).join(",")];

    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.expense_date ? new Date(r.expense_date).toLocaleDateString("en-CA") : "",
          r.title, r.category, r.amount, r.receipt_reference,
          r.project, r.recorded_by
        ].map(csvCell).join(",")
      );
    }

    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="expenses.csv"'
    });

    res.send("﻿" + lines.join("\r\n"));
  } catch (error) {
    console.error("Export expenses error:", error.message);
    res.status(500).json({ message: "Could not export expenses." });
  }
});

// Dashboard numbers + 6-month trend + top donors.
router.get("/overview", async (req, res) => {
  try {
    const [[totals]] = await db.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN amount END), 0) AS raised,
         SUM(payment_status = 'pending') AS pending_count,
         COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN amount END), 0) AS pending_amount
       FROM donations`
    );

    const [[spent]] = await db.execute(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses"
    );

    const [[users]] = await db.execute(
      `SELECT COUNT(*) AS total, SUM(is_active = 1) AS active
       FROM users WHERE role = 'donor'`
    );

    const [[unread]] = await db.execute(
      "SELECT COUNT(*) AS n FROM contact_messages WHERE is_read = 0"
    );

    const [donationSeries] = await db.execute(
      `SELECT DATE_FORMAT(COALESCE(donated_at, created_at), '%Y-%m') AS month,
              SUM(amount) AS total
       FROM donations
       WHERE payment_status = 'completed'
         AND COALESCE(donated_at, created_at) >=
             DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 5 MONTH)
       GROUP BY month`
    );

    const [expenseSeries] = await db.execute(
      `SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month, SUM(amount) AS total
       FROM expenses
       WHERE expense_date >=
             DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 5 MONTH)
       GROUP BY month`
    );

    const [topDonors] = await db.execute(
      `SELECT u.id, u.full_name, SUM(d.amount) AS total
       FROM donations d JOIN users u ON u.id = d.user_id
       WHERE d.payment_status = 'completed'
       GROUP BY u.id ORDER BY total DESC LIMIT 5`
    );

    const months = [];
    const now = new Date();

    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      );
    }

    const lookup = (rows, month) =>
      Number(rows.find((r) => r.month === month)?.total || 0);

    res.json({
      raised: totals.raised,
      spent: spent.total,
      balance: totals.raised - spent.total,
      pending_count: Number(totals.pending_count || 0),
      pending_amount: totals.pending_amount,
      donor_total: users.total,
      donor_active: Number(users.active || 0),
      unread_messages: unread.n,
      series: months.map((month) => ({
        month,
        donations: lookup(donationSeries, month),
        expenses: lookup(expenseSeries, month)
      })),
      top_donors: topDonors
    });
  } catch (error) {
    console.error("Overview error:", error.message);
    res.status(500).json({ message: "Could not load overview." });
  }
});

router.get("/audit-logs", async (req, res) => {
  try {
    const [logs] = await db.execute(
      `SELECT a.id, a.action, a.details, a.created_at, u.full_name
       FROM audit_logs a
       JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC
       LIMIT 200`
    );

    res.json({ logs });
  } catch (error) {
    console.error("Audit log error:", error.message);
    res.status(500).json({ message: "Could not load activity log." });
  }
});

router.get("/messages", async (req, res) => {
  try {
    const [messages] = await db.execute(
      `SELECT id, name, email, message, is_read, created_at
       FROM contact_messages ORDER BY created_at DESC, id DESC LIMIT 200`
    );

    res.json({ messages });
  } catch (error) {
    console.error("Messages error:", error.message);
    res.status(500).json({ message: "Could not load messages." });
  }
});

router.patch("/messages/:id", async (req, res) => {
  try {
    await db.execute(
      "UPDATE contact_messages SET is_read = ? WHERE id = ?",
      [req.body.is_read === false ? 0 : 1, Number(req.params.id)]
    );

    res.json({ message: "Message updated." });
  } catch (error) {
    console.error("Update message error:", error.message);
    res.status(500).json({ message: "Could not update message." });
  }
});

router.delete("/messages/:id", async (req, res) => {
  try {
    await db.execute("DELETE FROM contact_messages WHERE id = ?", [
      Number(req.params.id)
    ]);

    res.json({ message: "Message deleted." });
  } catch (error) {
    console.error("Delete message error:", error.message);
    res.status(500).json({ message: "Could not delete message." });
  }
});

module.exports = router;
