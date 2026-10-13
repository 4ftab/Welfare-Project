
const express = require("express");
const db = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const router = express.Router();

const STATUSES = ["planned", "ongoing", "completed", "cancelled"];

function validDate(value) {
  return !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

async function audit(userId, action, details) {
  await db.execute(
    "INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)",
    [userId, action, details]
  );
}

// Public visitors can view welfare projects, with funding progress.
router.get("/", async (req, res) => {
  try {
    const [projects] = await db.execute(
      `SELECT p.id, p.title, p.description, p.location, p.budget, p.status,
              p.start_date, p.end_date, p.created_at,
              COALESCE((SELECT SUM(d.amount) FROM donations d
                        WHERE d.project_id = p.id
                          AND d.payment_status = 'completed'), 0) AS raised,
              COALESCE((SELECT SUM(e.amount) FROM expenses e
                        WHERE e.project_id = p.id), 0) AS spent
       FROM projects p
       ORDER BY p.created_at DESC, p.id DESC`
    );

    res.json({ projects });
  } catch (error) {
    console.error("Projects error:", error.message);

    res.status(500).json({
      message: "Could not retrieve projects."
    });
  }
});

// Only admins can create projects.
router.post("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      title,
      description,
      location,
      budget = 0,
      status = "planned",
      start_date,
      end_date
    } = req.body;

    const numericBudget = Number(budget);

    if (!title || !Number.isFinite(numericBudget) || numericBudget < 0) {
      return res.status(400).json({
        message: "A title and valid non-negative budget are required."
      });
    }

    if (!STATUSES.includes(status)) {
      return res.status(400).json({
        message: "Invalid project status."
      });
    }

    if (!validDate(start_date) || !validDate(end_date)) {
      return res.status(400).json({ message: "Dates must use YYYY-MM-DD." });
    }

    const [result] = await db.execute(
      `INSERT INTO projects
       (title, description, location, budget, status, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(title).trim(),
        description || null,
        location || null,
        numericBudget,
        status,
        start_date || null,
        end_date || null
      ]
    );

    await audit(req.user.id, "PROJECT_CREATED", `Project ID ${result.insertId}; ${title}`);

    res.status(201).json({
      message: "Project created successfully.",
      project_id: result.insertId
    });
  } catch (error) {
    console.error("Create project error:", error.message);

    res.status(500).json({
      message: "Could not create project."
    });
  }
});

router.put("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { title, description, location, budget = 0, status,
            start_date, end_date } = req.body;
    const numericBudget = Number(budget);

    if (!title || !Number.isFinite(numericBudget) || numericBudget < 0) {
      return res.status(400).json({
        message: "A title and valid non-negative budget are required."
      });
    }

    if (!STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid project status." });
    }

    if (!validDate(start_date) || !validDate(end_date)) {
      return res.status(400).json({ message: "Dates must use YYYY-MM-DD." });
    }

    const [result] = await db.execute(
      `UPDATE projects
       SET title = ?, description = ?, location = ?, budget = ?,
           status = ?, start_date = ?, end_date = ?
       WHERE id = ?`,
      [
        String(title).trim(), description || null, location || null,
        numericBudget, status, start_date || null, end_date || null, id
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Project not found." });
    }

    await audit(req.user.id, "PROJECT_UPDATED", `Project ID ${id}`);

    res.json({ message: "Project updated." });
  } catch (error) {
    console.error("Update project error:", error.message);
    res.status(500).json({ message: "Could not update project." });
  }
});

router.patch("/:id/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;

    if (!STATUSES.includes(status)) {
      return res.status(400).json({
        message: "Invalid project status."
      });
    }

    const [result] = await db.execute(
      "UPDATE projects SET status = ? WHERE id = ?",
      [status, Number(req.params.id)]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "Project not found."
      });
    }

    await audit(
      req.user.id,
      "PROJECT_STATUS_CHANGED",
      `Project ID ${Number(req.params.id)}; status ${status}`
    );

    res.json({ message: "Project status updated." });
  } catch (error) {
    console.error("Project status error:", error.message);

    res.status(500).json({
      message: "Could not update project."
    });
  }
});

// Projects with donations or expenses attached cannot be deleted; they
// should be marked cancelled so the financial history stays intact.
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [[usage]] = await db.execute(
      `SELECT
         (SELECT COUNT(*) FROM donations WHERE project_id = ?) AS donations,
         (SELECT COUNT(*) FROM expenses WHERE project_id = ?) AS expenses`,
      [id, id]
    );

    if (usage.donations || usage.expenses) {
      return res.status(409).json({
        message:
          "This project has donations or expenses recorded. Mark it as cancelled instead of deleting it."
      });
    }

    const [result] = await db.execute("DELETE FROM projects WHERE id = ?", [id]);

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Project not found." });
    }

    await audit(req.user.id, "PROJECT_DELETED", `Project ID ${id}`);

    res.json({ message: "Project deleted." });
  } catch (error) {
    console.error("Delete project error:", error.message);
    res.status(500).json({ message: "Could not delete project." });
  }
});

module.exports = router;
