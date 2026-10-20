const { checkEnv, isProduction } = require("./config/env"); // loads .env exactly once, before anything else

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const { createCors, buildAllowlist } = require("./config/cors");
const db = require("./config/db");
const migrate = require("./scripts/migrate");
const mailer = require("./services/mailer");
const safepay = require("./services/safepay");
const { startReconciler } = require("./services/payments");

const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const adminRoutes = require("./routes/admin");
const donationsRoutes = require("./routes/donations");
const expensesRoutes = require("./routes/expenses");
const projectsRoutes = require("./routes/projects");
const announcementsRoutes = require("./routes/announcements");
const reportsRoutes = require("./routes/reports");
const publicRoutes = require("./routes/public");
const paymentsRoutes = require("./routes/payments");

const app = express();

const allowedOrigins = buildAllowlist();

app.disable("x-powered-by");

// Smaller JSON responses matter on slow mobile connections.
app.use(compression());

// Render sits behind one proxy; without this every visitor shares the proxy's IP for rate limiting.
app.set("trust proxy", 1);

// CORS: explicit allowlist (see config/cors.js). Unknown origins get a controlled 403, not an exception.
app.use(createCors({ allowlist: allowedOrigins }));

// Logs how long each API request took (method, path without query string, status, ms). Nothing from the
// request body, headers or query is logged, so tokens, passwords and codes can never end up here.
app.use((req, res, next) => {
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const path = req.originalUrl.split("?")[0].replace(/\/\d+/g, "/:id");
    if (req.method !== "OPTIONS" && path !== "/") {
      console.log(`[req] ${req.method} ${path} ${res.statusCode} ${ms}ms${ms > 1500 ? " SLOW" : ""}`);
    }
  });

  next();
});

app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });
  next();
});

// Responses that depend on who is signed in must never be stored by a shared cache. "private, no-cache" still
// lets the browser revalidate (so a 304 is fine); sign-in/registration responses carry tokens: no-store.
const privateData = (req, res, next) => {
  res.set({ "Cache-Control": "private, no-cache", Vary: "Authorization" });
  next();
};
app.use("/api/auth", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(["/api/dashboard", "/api/admin", "/api/expenses", "/api/donations", "/api/announcements/all"], privateData);

// Keep the exact bytes of webhook bodies for signature verification.
app.use(express.json({
  limit: "1mb",
  verify: (req, res, buf) => {
    if (req.originalUrl.startsWith("/api/payments/")) req.rawBody = buf.toString("utf8");
  }
}));

app.get("/", (req, res) => {
  res.json({
    message: "Nojawan Itehad Welfare API is running."
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");

    res.json({
      server: "running",
      database: "connected"
    });
  } catch (error) {
    console.error("Health check error:", error.message);

    res.status(500).json({
      server: "running",
      database: "disconnected"
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/donations", donationsRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/announcements", announcementsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/payments", paymentsRoutes);

app.use((req, res) => {
  res.status(404).json({
    message: "API endpoint not found."
  });
});

// Error handler. Client mistakes (bad JSON, oversized body) are answered as 4xx; everything else is a 500 whose
// details stay in the server log, never in the response.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ message: "The request body is not valid JSON." });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({ message: "The request body is too large." });
  }

  const status = Number(error.status || error.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ message: "The request could not be processed." });
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl.split("?")[0]}:`, error.message);

  res.status(500).json({
    message: "An unexpected server error occurred."
  });
});

const PORT = process.env.PORT || 5000;

function describeSafepay() {
  const paymentMode = safepay.mode();

  if (paymentMode === "ready") {
    const hook = safepay.webhookConfigured();
    console.log(`Safepay: ${safepay.environment()} mode; webhook secret ${hook ? "set" : "NOT set"}.`);

    if (!hook) {
      console.warn(
        isProduction() || safepay.environment() === "production"
          ? "Safepay: SAFEPAY_WEBHOOK_SECRET is required in production. Without it webhooks are rejected and payments are only confirmed by the donor's return and the background check (every few minutes)."
          : "Safepay: fine for local sandbox testing. Payments are still confirmed server-side by the return check and the background job; set SAFEPAY_WEBHOOK_SECRET to receive instant webhooks."
      );
    }

    startReconciler();
  } else if (paymentMode === "invalid") {
    safepay.configProblems().forEach((p) => console.error(`Safepay config: ${p}`));
  } else {
    console.log("Safepay: no keys configured; donations are recorded as pledges.");
  }
}

function describeMail() {
  if (!mailer.isConfigured()) {
    console.warn(
      "Email: not configured, so verification codes cannot be emailed (sign-up and first login of unverified accounts will answer 502)." +
        (isProduction() ? "" : " For local development set MAIL_DEV_LOG_OTP=true to print codes in this console instead.")
    );
  }

  // Reports a wrong or missing Brevo key in the logs right away, without sending email.
  return mailer.checkConfig().catch((error) => console.warn("Email check failed:", error.message));
}

let server = null;

async function startServer() {
  const { errors, warnings } = checkEnv();
  warnings.forEach((w) => console.warn(`Config: ${w}`));

  if (errors.length) {
    errors.forEach((e) => console.error(`Config error: ${e}`));
    console.error("Fix backend/.env (see backend/.env.example) and start again.");
    process.exit(1);
  }

  const bootStarted = Date.now();

  // Answer requests immediately; the first query then pays the database's TLS handshake while the
  // frontend already gets proper JSON answers instead of "connection refused".
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log("Allowed frontend origins:", [...allowedOrigins]);
  });

  server.on("error", (error) => {
    console.error(error.code === "EADDRINUSE" ? `Port ${PORT} is already in use. Stop the other backend first.` : `Server error: ${error.message}`);
    process.exit(1);
  });

  // Stalled clients must not hold sockets forever (Safepay calls are capped at 15s, so 60s is generous).
  server.requestTimeout = 60 * 1000;
  server.headersTimeout = 30 * 1000;

  try {
    await db.query("SELECT 1");
    console.log(`MySQL connected successfully. (first connection ${Date.now() - bootStarted}ms)`);

    db.warmUp()
      .then(() => console.log(`[boot] connection pool warmed in ${Date.now() - bootStarted}ms`))
      .catch((error) => console.warn("Pool warm-up failed:", error.message));
    db.keepWarm();

    await migrate();
    console.log(`[boot] schema check done at ${Date.now() - bootStarted}ms`);

    describeSafepay();
    await describeMail();
  } catch (error) {
    console.error("Could not connect to MySQL:", error.message);
    process.exit(1);
  }
}

// Finish in-flight requests and release database connections on Ctrl+C / platform restarts.
function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();

  const closeDb = () => db.end().catch(() => {}).finally(() => process.exit(0));
  if (server) server.close(closeDb);
  else closeDb();
}

function installProcessGuards() {
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason instanceof Error ? reason.message : reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error.message);
    process.exit(1);
  });
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Exported for tests; the server only starts when this file is run directly (npm start / npm run dev).
if (require.main === module) {
  installProcessGuards();
  startServer();
}

module.exports = app;
