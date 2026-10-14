require("dotenv").config();

const express = require("express");
const cors = require("cors");
const db = require("./config/db");

const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const adminRoutes = require("./routes/admin");
const donationsRoutes = require("./routes/donations");
const expensesRoutes = require("./routes/expenses");
const projectsRoutes = require("./routes/projects");
const announcementsRoutes = require("./routes/announcements");
const reportsRoutes = require("./routes/reports");
const publicRoutes = require("./routes/public");

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://nojawan-itehad-welfare-chi.vercel.app",
  process.env.FRONTEND_URL
].filter(Boolean);

app.disable("x-powered-by");

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

app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });
  next();
});

app.use(express.json({ limit: "1mb" }));

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
    await db.query("SELECT 1");

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log("MySQL connected successfully.");
      console.log("Allowed frontend origins:", allowedOrigins);
    });
  } catch (error) {
    console.error("Could not connect to MySQL:", error.message);
    process.exit(1);
  }
}

startServer();