
const express = require("express");
const db = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.post("/", async (req, res) => {
  const {
    project_id,
    title,
    description,
    category,
    amount,
    expense_date,
    receipt_reference
  } = req.body;

  const numericAmount = Number(amount);

  if (!title || !category || !expense_date) {
    return res.status(400).json({
      message: "Title, category and expense date are required."
    });
  }

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({
      message: "Expense amount must be greater than zero."
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(expense_date) ||
      Number.isNaN(Date.parse(`${expense_date}T00:00:00Z`))) {
    return res.status(400).json({
      message: "Expense date must use YYYY-MM-DD format."
    });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    if (project_id !== undefined && project_id !== null && project_id !== "") {
      const [projects] = await connection.execute(
        "SELECT id FROM projects WHERE id = ?",
        [Number(project_id)]
      );

      if (!projects.length) {
        await connection.rollback();

        return res.status(404).json({
          message: "Project not found."
        });
      }
    }

    const [result] = await connection.execute(
      `INSERT INTO expenses
       (project_id, recorded_by, title, description, category,
        amount, expense_date, receipt_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project_id ? Number(project_id) : null,
        req.user.id,
        String(title).trim(),
        description || null,
        String(category).trim(),
        numericAmount,
        expense_date,
        receipt_reference || null
      ]
    );

    await connection.execute(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES (?, ?, ?)`,
      [
        req.user.id,
        "EXPENSE_RECORDED",
        `Expense ID ${result.insertId}; amount ${numericAmount}; title ${title}`
      ]
    );

    await connection.commit();

    res.status(201).json({
      message: "Expense recorded successfully.",
      expense_id: result.insertId
    });
  } catch (error) {
    await connection.rollback();

    console.error("Expense error:", error.message);

    res.status(500).json({
      message: "Could not record expense."
    });
  } finally {
    connection.release();
  }
});

router.get("/", async (req, res) => {
  try {
    const { month } = req.query;

    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        message: "Month must use YYYY-MM format."
      });
    }

    let sql = `
      SELECT e.id, e.project_id, e.title, e.description, e.category,
             e.amount, e.expense_date, e.receipt_reference,
             p.title AS project_title,
             u.full_name AS recorded_by_name
      FROM expenses e
      JOIN users u ON u.id = e.recorded_by
      LEFT JOIN projects p ON p.id = e.project_id
    `;

    const params = [];

    if (month) {
      sql += " WHERE e.expense_date >= ? AND e.expense_date < DATE_ADD(?, INTERVAL 1 MONTH)";
      params.push(`${month}-01`, `${month}-01`);
    }

    sql += " ORDER BY e.expense_date DESC, e.id DESC";

    const [expenses] = await db.execute(sql, params);

    res.json({
      total_records: expenses.length,
      expenses
    });
  } catch (error) {
    console.error("Retrieve expenses error:", error.message);

    res.status(500).json({
      message: "Could not retrieve expenses."
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [result] = await db.execute("DELETE FROM expenses WHERE id = ?", [id]);

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Expense not found." });
    }

    await db.execute(
      "INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)",
      [req.user.id, "EXPENSE_DELETED", `Expense ID ${id}`]
    );

    res.json({ message: "Expense deleted." });
  } catch (error) {
    console.error("Delete expense error:", error.message);
    res.status(500).json({ message: "Could not delete expense." });
  }
});

module.exports = router;
