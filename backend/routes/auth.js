
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { authenticateToken } = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const crypto = require("crypto");
const { sendOtpEmail } = require("../services/mailer");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many attempts. Please wait a few minutes and try again."
});

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;

const router = express.Router();

function hashOtp(code) {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(String(code))
    .digest("hex");
}

// Stores a fresh 6-digit code for the user and emails it. Any earlier code stops working.
async function issueOtp(user) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");

  await db.execute(
    `UPDATE users
     SET otp_hash = ?,
         otp_expires_at = DATE_ADD(NOW(), INTERVAL ${OTP_TTL_MINUTES} MINUTE),
         otp_attempts = 0,
         otp_sent_at = NOW()
     WHERE id = ?`,
    [hashOtp(code), user.id]
  );

  try {
    await sendOtpEmail(user.email, user.full_name, code, OTP_TTL_MINUTES);
  } catch (error) {
    // Let the user ask again straight away if the email never left.
    await db.execute("UPDATE users SET otp_sent_at = NULL WHERE id = ?", [user.id]);
    throw error;
  }
}

function sessionFor(user) {
  const token = jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );

  return {
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role
    }
  };
}

const MAIL_FAILED = "We could not send the verification email. Please try again in a moment.";

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
      "SELECT id, email_verified FROM users WHERE email = ?",
      [normalizedEmail]
    );

    if (existing.length && existing[0].email_verified) {
      return res.status(409).json({
        message: "This email is already registered."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const name = String(full_name).trim();
    const phoneValue = phone ? String(phone).trim() : null;
    let userId;

    if (existing.length) {
      // A registration that was never verified is replaced by this one.
      userId = existing[0].id;

      await db.execute(
        "UPDATE users SET full_name = ?, phone = ?, password_hash = ? WHERE id = ?",
        [name, phoneValue, passwordHash, userId]
      );
    } else {
      const [result] = await db.execute(
        `INSERT INTO users
         (full_name, email, phone, password_hash, role)
         VALUES (?, ?, ?, ?, 'donor')`,
        [name, normalizedEmail, phoneValue, passwordHash]
      );

      userId = result.insertId;
    }

    try {
      await issueOtp({ id: userId, email: normalizedEmail, full_name: name });
    } catch (error) {
      console.error("Verification email error:", error.message);
      return res.status(502).json({ message: MAIL_FAILED });
    }

    res.status(201).json({
      message: "We emailed you a 6-digit verification code.",
      verification_required: true,
      email: normalizedEmail
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
      `SELECT id, full_name, email, password_hash, role, is_active, email_verified,
              TIMESTAMPDIFF(SECOND, otp_sent_at, NOW()) AS otp_age
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

    if (!user.email_verified) {
      // Send a fresh code unless one went out moments ago.
      if (user.otp_age === null || user.otp_age >= OTP_RESEND_SECONDS) {
        try {
          await issueOtp(user);
        } catch (error) {
          console.error("Verification email error:", error.message);
          return res.status(502).json({ message: MAIL_FAILED });
        }
      }

      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email. We emailed you a 6-digit code.",
        email: user.email
      });
    }

    res.json({
      message: "Login successful.",
      ...sessionFor(user)
    });
  } catch (error) {
    console.error("Login error:", error.message);

    res.status(500).json({
      message: "Login failed."
    });
  }
});

// Looks up an account that is still waiting for its code. The password is required so
// only the person who registered can verify it or ask for another code.
async function findPendingUser(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ message: "Email and password are required." });
    return null;
  }

  const [users] = await db.execute(
    `SELECT id, full_name, email, password_hash, role, is_active, email_verified,
            otp_hash, otp_attempts,
            (otp_expires_at IS NOT NULL AND otp_expires_at > NOW()) AS otp_live,
            TIMESTAMPDIFF(SECOND, otp_sent_at, NOW()) AS otp_age
     FROM users WHERE email = ?`,
    [String(email).trim().toLowerCase()]
  );

  const user = users[0];

  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    res.status(401).json({ message: "Invalid email or password." });
    return null;
  }

  if (!user.is_active) {
    res.status(403).json({ message: "Your account is inactive." });
    return null;
  }

  if (user.email_verified) {
    res.status(409).json({ message: "This email is already verified. Please sign in." });
    return null;
  }

  return user;
}

router.post("/verify-otp", loginLimiter, async (req, res) => {
  try {
    const user = await findPendingUser(req, res);
    if (!user) return;

    const otp = String(req.body.otp || "").trim();

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: "Enter the 6-digit code from your email." });
    }

    if (!user.otp_hash || !user.otp_live) {
      return res.status(400).json({
        message: "This code has expired. Please request a new one."
      });
    }

    if (user.otp_attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({
        message: "Too many incorrect codes. Please request a new one."
      });
    }

    const matches = crypto.timingSafeEqual(
      Buffer.from(hashOtp(otp)),
      Buffer.from(user.otp_hash)
    );

    if (!matches) {
      await db.execute(
        "UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?",
        [user.id]
      );

      return res.status(400).json({ message: "That code is not correct." });
    }

    await db.execute(
      `UPDATE users
       SET email_verified = 1, otp_hash = NULL, otp_expires_at = NULL,
           otp_attempts = 0, otp_sent_at = NULL
       WHERE id = ?`,
      [user.id]
    );

    res.json({
      message: "Email verified.",
      ...sessionFor(user)
    });
  } catch (error) {
    console.error("Verify code error:", error.message);
    res.status(500).json({ message: "Verification failed." });
  }
});

router.post("/resend-otp", loginLimiter, async (req, res) => {
  try {
    const user = await findPendingUser(req, res);
    if (!user) return;

    if (user.otp_age !== null && user.otp_age < OTP_RESEND_SECONDS) {
      const wait = OTP_RESEND_SECONDS - user.otp_age;

      res.set("Retry-After", String(wait));
      return res.status(429).json({
        message: `Please wait ${wait} seconds before requesting another code.`
      });
    }

    try {
      await issueOtp(user);
    } catch (error) {
      console.error("Verification email error:", error.message);
      return res.status(502).json({ message: MAIL_FAILED });
    }

    res.json({ message: "A new code is on its way to your email." });
  } catch (error) {
    console.error("Resend code error:", error.message);
    res.status(500).json({ message: "Could not send a new code." });
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
