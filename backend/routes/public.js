const express = require("express");
const db = require("../config/db");
const rateLimit = require("../middleware/rateLimit");
const safepay = require("../services/safepay");

const router = express.Router();

// Public transparency numbers for the landing page.
router.get("/stats", async (req, res) => {
  try {
    const [[raised]] = await db.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total,
              COUNT(*) AS count,
              COUNT(DISTINCT user_id) AS donors
       FROM donations WHERE payment_status = 'completed'`
    );

    const [[spent]] = await db.execute(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses"
    );

    const [[projects]] = await db.execute(
      `SELECT COUNT(*) AS total,
              SUM(status = 'ongoing') AS ongoing,
              SUM(status = 'completed') AS completed
       FROM projects`
    );

    const [categories] = await db.execute(
      `SELECT category, SUM(amount) AS total
       FROM expenses GROUP BY category ORDER BY total DESC LIMIT 6`
    );

    res.json({
      total_raised: raised.total,
      donation_count: raised.count,
      donor_count: raised.donors,
      total_spent: spent.total,
      balance: raised.total - spent.total,
      projects_total: projects.total,
      projects_ongoing: Number(projects.ongoing || 0),
      projects_completed: Number(projects.completed || 0),
      expense_categories: categories
    });
  } catch (error) {
    console.error("Public stats error:", error.message);
    res.status(500).json({ message: "Could not load statistics." });
  }
});

router.get("/config", (req, res) => {
  res.json({
    online_payments: safepay.isConfigured(),
    payment_provider: "safepay",
    sandbox: process.env.SAFEPAY_ENV !== "production"
  });
});

// Anonymised recent gifts for the landing-page ticker: no names, no emails.
router.get("/recent", async (req, res) => {
  try {
    const [gifts] = await db.execute(
      `SELECT d.amount, p.title AS project,
              COALESCE(d.donated_at, d.created_at) AS donated_at
       FROM donations d
       LEFT JOIN projects p ON p.id = d.project_id
       WHERE d.payment_status = 'completed'
       ORDER BY donated_at DESC, d.id DESC
       LIMIT 8`
    );

    res.json({ gifts });
  } catch (error) {
    console.error("Recent gifts error:", error.message);
    res.status(500).json({ message: "Could not load recent gifts." });
  }
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "You have sent several messages recently. Please try again later."
});

router.post("/contact", contactLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const message = String(req.body.message || "").trim();

    if (!name || !email || !message) {
      return res.status(400).json({
        message: "Name, email and message are required."
      });
    }

    if (name.length > 100 || message.length > 3000) {
      return res.status(400).json({
        message: "Your name or message is too long."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }

    await db.execute(
      "INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)",
      [name, email, message]
    );

    res.status(201).json({
      message: "Thank you! Your message has been received."
    });
  } catch (error) {
    console.error("Contact error:", error.message);
    res.status(500).json({ message: "Could not send your message." });
  }
});

module.exports = router;
