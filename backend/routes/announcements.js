
const express = require("express");
const db = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const [announcements] = await db.execute(
      `SELECT id, title, body, created_at
       FROM announcements
       WHERE is_published = TRUE
       ORDER BY created_at DESC`
    );

    res.json({ announcements });
  } catch (error) {
    console.error("Announcements error:", error.message);

    res.status(500).json({
      message: "Could not retrieve announcements."
    });
  }
});

router.post("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, body } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        message: "Announcement title and body are required."
      });
    }

    const [result] = await db.execute(
      `INSERT INTO announcements (title, body, created_by, is_published)
       VALUES (?, ?, ?, TRUE)`,
      [String(title).trim(), String(body).trim(), req.user.id]
    );

    res.status(201).json({
      message: "Announcement published.",
      announcement_id: result.insertId
    });
  } catch (error) {
    console.error("Publish announcement error:", error.message);

    res.status(500).json({
      message: "Could not publish announcement."
    });
  }
});

module.exports = router;
