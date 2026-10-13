
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { authenticateToken } = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many attempts. Please wait a few minutes and try again."
});

const router = express.Router();

router.post("/register", loginLimiter, async (req, res) => {
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

router.post("/login", loginLimiter, async (req, res) => {
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

router.patch("/me", authenticateToken, async (req, res) => {
  try {
    const full_name = String(req.body.full_name || "").trim();
    const phone = req.body.phone ? String(req.body.phone).trim() : null;

    if (!full_name || full_name.length > 100) {
      return res.status(400).json({
        message: "Name is required and must be 100 characters or fewer."
      });
    }

    if (phone && phone.length > 25) {
      return res.status(400).json({ message: "Phone number is too long." });
    }

    await db.execute(
      "UPDATE users SET full_name = ?, phone = ? WHERE id = ?",
      [full_name, phone, req.user.id]
    );

    res.json({ message: "Profile updated." });
  } catch (error) {
    console.error("Update profile error:", error.message);
    res.status(500).json({ message: "Could not update your profile." });
  }
});

router.post("/change-password", authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        message: "Current and new password are required."
      });
    }

    if (String(new_password).length < 8) {
      return res.status(400).json({
        message: "New password must contain at least 8 characters."
      });
    }

    const [users] = await db.execute(
      "SELECT password_hash FROM users WHERE id = ?",
      [req.user.id]
    );

    const valid = await bcrypt.compare(
      String(current_password),
      users[0].password_hash
    );

    if (!valid) {
      return res.status(401).json({
        message: "Your current password is incorrect."
      });
    }

    const hash = await bcrypt.hash(String(new_password), 12);

    await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", [
      hash,
      req.user.id
    ]);

    res.json({ message: "Password changed successfully." });
  } catch (error) {
    console.error("Change password error:", error.message);
    res.status(500).json({ message: "Could not change your password." });
  }
});

module.exports = router;
