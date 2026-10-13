
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { full_name, email, phone, password } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({
        message: "Name, email and password are required."
      });
    }

    if (String(full_name).trim().length > 100) {
      return res.status(400).json({
        message: "Name must be 100 characters or fewer."
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        message: "Enter a valid email address."
      });
    }

    if (String(password).length < 8) {
      return res.status(400).json({
        message: "Password must contain at least 8 characters."
      });
    }

    const [existing] = await db.execute(
      "SELECT id FROM users WHERE email = ?",
      [normalizedEmail]
    );

    if (existing.length) {
      return res.status(409).json({
        message: "This email is already registered."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [result] = await db.execute(
      `INSERT INTO users
       (full_name, email, phone, password_hash, role)
       VALUES (?, ?, ?, ?, 'donor')`,
      [
        String(full_name).trim(),
        normalizedEmail,
        phone ? String(phone).trim() : null,
        passwordHash
      ]
    );

    res.status(201).json({
      message: "Registration successful. You can now log in.",
      user_id: result.insertId
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This email is already registered."
      });
    }

    console.error("Registration error:", error.message);

    res.status(500).json({
      message: "Registration failed."
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required."
      });
    }

    const [users] = await db.execute(
      `SELECT id, full_name, email, password_hash, role, is_active
       FROM users WHERE email = ?`,
      [String(email).trim().toLowerCase()]
    );

    if (!users.length) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({
        message: "Your account is inactive."
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);

    res.status(500).json({
      message: "Login failed."
    });
  }
});

router.get("/me", authenticateToken, async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT id, full_name, email, phone, role, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (!users.length) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    res.json({ user: users[0] });
  } catch (error) {
    console.error("Profile error:", error.message);

    res.status(500).json({
      message: "Could not retrieve your profile."
    });
  }
});

module.exports = router;
