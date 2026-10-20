// CORS policy: an explicit allowlist, never a wildcard and never "reflect whatever origin asked".
//
// Allowed origins are the union of:
//   - the deployed site (FRONTEND_URL and the Vercel address below)
//   - the Vite dev server on port 5173 (localhost and 127.0.0.1)
//   - the Vite preview server on port 4173 (`npm run preview`), outside production only
//   - anything listed in CORS_ORIGINS (comma separated), for other ports or domains you really use
//
// A request from any other origin gets a controlled 403 JSON answer (logged once per origin), instead of an
// exception that ends up in the "Unhandled error" handler.
const cors = require("cors");

const DEPLOYED = ["https://nojawan-itehad-welfare-chi.vercel.app"];
const DEV_PORT = 5173;
const PREVIEW_PORT = 4173;

// "HTTP://Example.com:80/path/" -> "http://example.com". Returns null for anything that is not an http(s) origin.
function normalizeOrigin(value) {
  const text = String(value || "").trim().replace(/^["']|["']$/g, "").trim();
  if (!text || text === "*" || text === "null") return null;

  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

function localOrigins(port) {
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

// Builds the allowlist from an environment object so it can be tested without touching process.env.
function buildAllowlist(env = process.env, log = console) {
  const production = env.NODE_ENV === "production";
  const raw = [...DEPLOYED, ...localOrigins(DEV_PORT)];

  if (!production) raw.push(...localOrigins(PREVIEW_PORT));

  raw.push(env.FRONTEND_URL);
  raw.push(...String(env.CORS_ORIGINS || "").split(","));

  const allowed = new Set();

  for (const entry of raw) {
    if (!String(entry || "").trim()) continue;
    const origin = normalizeOrigin(entry);
    if (origin) allowed.add(origin);
    else log.warn(`CORS: ignoring invalid origin "${String(entry).trim()}" (wildcards and "null" are never allowed).`);
  }

  return allowed;
}

function createCors({ allowlist = buildAllowlist(), log = console } = {}) {
  const reported = new Set();

  // 1. Reject unknown origins up front, once, with a clear JSON body.
  function gate(req, res, next) {
    const origin = req.headers.origin;
    if (!origin) return next(); // curl, server-to-server, same-origin navigations

    const normalized = normalizeOrigin(origin);
    if (normalized && allowlist.has(normalized)) return next();

    if (!reported.has(origin)) {
      reported.add(origin);
      log.warn(
        `CORS: blocked origin ${origin}. If this is a frontend you intend to use, add it to CORS_ORIGINS in backend/.env.`
      );
    }

    res.set("Vary", "Origin");
    return res.status(403).json({ message: "This origin is not allowed to use the API." });
  }

  // 2. The origin is vetted, so the cors package can safely echo it back (it also adds Vary: Origin).
  const headers = cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 600, // browsers reuse a successful preflight for 10 minutes
    optionsSuccessStatus: 204
  });

  return [gate, headers];
}

module.exports = { createCors, buildAllowlist, normalizeOrigin };
