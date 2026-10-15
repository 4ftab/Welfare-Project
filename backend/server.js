require("dotenv").config();

const express = require("express");
const cors = require("cors");
const compression = require("compression");
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

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://nojawan-itehad-welfare-chi.vercel.app",
  String(process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "")
].filter(Boolean);

app.disable("x-powered-by");

// Smaller JSON responses matter on slow mobile connections.
app.use(compression());

// Render sits behind one proxy; without this every visitor shares the proxy's IP for rate limiting.
app.set("trust proxy", 1);

// CORS configuration
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without an Origin header, such as server-to-server calls.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn("CORS blocked origin:", origin);
      return callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204
  })
);

// Logs how long each API request took (method, path without query string, status, ms). Nothing from the
// request body, headers or query is logged, so tokens, passwords and codes can never end up here.
app.use((req, res, next) => {
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const path = req.originalUrl.split("?")[0].replace(/\/\d+/g, "/:id");
    if (req.method !== "OPTIONS" && path !== "/") console.log(`[req] ${req.method} ${path} ${res.statusCode} ${ms}ms`);
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

app.use((error, req, res, next) => {
  console.error("Unhandled error:", error.message);

  res.status(500).json({
    message: "An unexpected server error occurred."
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    const bootStarted = Date.now();

    // The first query pays for the TLS handshake with the database.
    await db.query("SELECT 1");
    console.log(`[boot] first database connection took ${Date.now() - bootStarted}ms`);

    // Start answering requests now; the idempotent schema check and extra connections finish in parallel.
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log("MySQL connected successfully.");
      console.log("Allowed frontend origins:", allowedOrigins);
    });

    db.warmUp()
      .then(() => console.log(`[boot] connection pool warmed in ${Date.now() - bootStarted}ms`))
      .catch((error) => console.warn("Pool warm-up failed:", error.message));
    db.keepWarm();

    await migrate();
    console.log(`[boot] schema check done at ${Date.now() - bootStarted}ms`);

    const paymentMode = safepay.mode();
    if (paymentMode === "ready") {
      console.log(`Safepay: ${safepay.environment()} mode; webhook secret ${safepay.webhookConfigured() ? "set" : "NOT set"}.`);
      startReconciler();
    } else if (paymentMode === "invalid") {
      safepay.configProblems().forEach((p) => console.error(`Safepay config: ${p}`));
    } else {
      console.log("Safepay: no keys configured; donations are recorded as pledges.");
    }

    // Reports a wrong or missing Brevo key in the logs right away, without sending email.
    mailer.checkConfig().catch(() => {});
  } catch (error) {
    console.error("Could not connect to MySQL:", error.message);
    process.exit(1);
  }
}

startServer();