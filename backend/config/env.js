// The one place .env is read. Every module that needs configuration requires this file first, and Node's
// module cache guarantees it runs once per process (so dotenv no longer logs "injected env" repeatedly).
// The path is resolved from this file, not from the working directory, so `npm run dev` works from anywhere.
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
  quiet: true
});

const isProduction = () => process.env.NODE_ENV === "production";

const clean = (value) => String(value || "").trim().replace(/^["']|["']$/g, "").trim();

// Returns { errors, warnings }. Errors stop the server (it could not work); warnings are logged once.
// Values themselves are never included in the messages.
function checkEnv() {
  const errors = [];
  const warnings = [];

  for (const name of ["DB_HOST", "DB_USER", "DB_NAME"]) {
    if (!clean(process.env[name])) errors.push(`${name} is not set (MySQL connection).`);
  }

  const secret = clean(process.env.JWT_SECRET);
  if (!secret) {
    errors.push("JWT_SECRET is not set. Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  } else if (secret.length < 32) {
    warnings.push("JWT_SECRET is shorter than 32 characters; use a long random value.");
  }

  const port = process.env.PORT;
  if (port && !(Number(port) > 0 && Number(port) < 65536)) errors.push(`PORT "${port}" is not a valid port number.`);

  if (isProduction()) {
    if (!clean(process.env.DB_PASSWORD)) errors.push("DB_PASSWORD is not set (required in production).");
    if (!clean(process.env.FRONTEND_URL).startsWith("https://")) {
      errors.push("FRONTEND_URL must be the https:// address of the website in production.");
    }
  } else if (!clean(process.env.FRONTEND_URL)) {
    warnings.push("FRONTEND_URL is not set; payment return links will default to http://localhost:5173.");
  }

  return { errors, warnings };
}

module.exports = { checkEnv, isProduction };
