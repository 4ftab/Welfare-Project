
const express = require("express");
const db = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const router = express.Router();

// Public visitors can view welfare projects.
router.get("/", async (req, res) => {
  try {
    const [projects] = await db.execute(
      `SELECT id, title, description, location, budget, status,
              start_date, end_date, created_at
       FROM projects
       ORDER BY created_at DESC`
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
    const statuses = ["planned", "ongoing", "completed", "cancelled"];

    if (!title || !Number.isFinite(numericBudget) || numericBudget < 0) {
      return res.status(400).json({
        message: "A title and valid non-negative budget are required."
      });
    }

    if (!statuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid project status."
      });
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

router.patch("/:id/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const allowed = ["planned", "ongoing", "completed", "cancelled"];
    const { status } = req.body;

    if (!allowed.includes(status)) {
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

    res.json({ message: "Project status updated." });
  } catch (error) {
    console.error("Project status error:", error.message);

    res.status(500).json({
      message: "Could not update project."
    });
  }
});

module.exports = router;

