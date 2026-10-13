
const express = require("express");
const db = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const router = express.Router();

async function audit(userId, action, details) {
  await db.execute(
    "INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)",
    [userId, action, details]
  );
}

router.get("/", async (req, res) => {
  try {
    const [announcements] = await db.execute(
      `SELECT id, title, body, created_at
       FROM announcements
       WHERE is_published = TRUE
       ORDER BY created_at DESC, id DESC`
    );

    res.json({ announcements });
  } catch (error) {
    console.error("Announcements error:", error.message);

    res.status(500).json({
      message: "Could not retrieve announcements."
    });
  }
});

// Admin view includes drafts / hidden announcements.
router.get("/all", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [announcements] = await db.execute(
      `SELECT id, title, body, is_published, created_at
       FROM announcements
       ORDER BY created_at DESC, id DESC`
    );

    res.json({ announcements });
  } catch (error) {
    console.error("All announcements error:", error.message);
    res.status(500).json({ message: "Could not retrieve announcements." });
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

    await audit(req.user.id, "ANNOUNCEMENT_PUBLISHED", `Announcement ID ${result.insertId}`);

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

router.put("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, body, is_published } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        message: "Announcement title and body are required."
      });
    }

    const [result] = await db.execute(
      `UPDATE announcements SET title = ?, body = ?, is_published = ?
       WHERE id = ?`,
      [
        String(title).trim(),
        String(body).trim(),
        is_published === false ? 0 : 1,
        Number(req.params.id)
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Announcement not found." });
    }

    await audit(req.user.id, "ANNOUNCEMENT_UPDATED", `Announcement ID ${Number(req.params.id)}`);

    res.json({ message: "Announcement updated." });
  } catch (error) {
    console.error("Update announcement error:", error.message);
    res.status(500).json({ message: "Could not update announcement." });
  }
});

router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [result] = await db.execute(
      "DELETE FROM announcements WHERE id = ?",
      [Number(req.params.id)]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Announcement not found." });
    }

    await audit(req.user.id, "ANNOUNCEMENT_DELETED", `Announcement ID ${Number(req.params.id)}`);

    res.json({ message: "Announcement deleted." });
  } catch (error) {
    console.error("Delete announcement error:", error.message);
    res.status(500).json({ message: "Could not delete announcement." });
  }
});

module.exports = router;
