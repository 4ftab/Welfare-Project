
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

const app = express();

app.use(cors({
  origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
}));

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
    });
  } catch (error) {
    console.error("Could not connect to MySQL:", error.message);
    process.exit(1);
  }
}

startServer();
