require("./env");

const mysql = require("mysql2/promise");

const POOL_SIZE = 10;
const WARM_CONNECTIONS = 6;

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  waitForConnections: true,
  connectionLimit: POOL_SIZE,
  maxIdle: POOL_SIZE,
  idleTimeout: 10 * 60 * 1000,
  connectTimeout: 15000,
  decimalNumbers: true,

  // Keep the TCP connections alive so the remote database does not drop idle ones.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,

  // Enable encrypted connections for Aiven
  ssl: process.env.DB_HOST?.includes("aivencloud.com")
    ? { rejectUnauthorized: false }
    : undefined
});

// A new connection to a remote, TLS-protected database costs seconds. Open several at start-up so the
// first login and the admin dashboard (which sends many requests at once) do not each pay that price.
db.warmUp = async function warmUp() {
  const connections = await Promise.all(
    Array.from({ length: WARM_CONNECTIONS }, () => db.getConnection())
  );
  connections.forEach((connection) => connection.release());
};

// A cheap query every few minutes keeps the warm connections from timing out.
db.keepWarm = function keepWarm() {
  const timer = setInterval(() => {
    db.query("SELECT 1").catch((error) => console.warn("DB keep-alive failed:", error.message));
  }, 4 * 60 * 1000);

  timer.unref();
};

module.exports = db;
