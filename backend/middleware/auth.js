
const jwt = require("jsonwebtoken");
const db = require("../config/db");

async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authentication token is required."
    });
  }

  try {
    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Read the user's current role from the database.
    // This prevents a stale token from retaining old admin permissions.
    const [users] = await db.execute(
      "SELECT id, role, is_active, email_verified FROM users WHERE id = ?",
      [decoded.id]
    );

    if (!users.length || !users[0].is_active) {
      return res.status(401).json({
        message: "Account not found or inactive."
      });
    }

    if (!users[0].email_verified) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email address first."
      });
    }

    req.user = {
      id: users[0].id,
      role: users[0].role
    };

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" ||
        error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Invalid or expired token."
      });
    }

    console.error("Authentication error:", error.message);

    return res.status(500).json({
      message: "Authentication could not be completed."
    });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      message: "Administrator permission is required."
    });
  }

  next();
}

module.exports = { authenticateToken, requireAdmin };
