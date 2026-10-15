
const jwt = require("jsonwebtoken");
const db = require("../config/db");

// The database is the source of truth for role and active status, but asking it on every single request
// costs a network round trip each time. Results are remembered for a few seconds, and are dropped at
// once whenever an administrator changes a user, so a deactivated or demoted account loses access at
// most AUTH_CACHE_MS later even in the worst case.
const AUTH_CACHE_MS = 15 * 1000;
const authCache = new Map();

function invalidateAuthCache(userId) {
  if (userId === undefined) authCache.clear();
  else authCache.delete(Number(userId));
}

async function currentAccount(id) {
  const cached = authCache.get(id);

  if (cached && cached.expires > Date.now()) return cached.account;

  const [users] = await db.execute(
    "SELECT id, role, is_active, email_verified FROM users WHERE id = ?",
    [id]
  );

  const account = users[0] || null;
  authCache.set(id, { account, expires: Date.now() + AUTH_CACHE_MS });

  if (authCache.size > 500) {
    const now = Date.now();
    for (const [key, entry] of authCache) if (entry.expires <= now) authCache.delete(key);
  }

  return account;
}

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

    // Read the user's current role from the database (briefly cached, see above).
    // This prevents a stale token from retaining old admin permissions.
    const account = await currentAccount(decoded.id);

    if (!account || !account.is_active) {
      return res.status(401).json({
        message: "Account not found or inactive."
      });
    }

    if (!account.email_verified) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email address first."
      });
    }

    req.user = {
      id: account.id,
      role: account.role
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

module.exports = { authenticateToken, requireAdmin, invalidateAuthCache };
