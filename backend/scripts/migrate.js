// Idempotent, additive migration. Safe to run more than once:  npm run migrate
require("dotenv").config();

const db = require("../config/db");

async function columnExists(table, column) {
  const [rows] = await db.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function run() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL,
      message TEXT NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("contact_messages: ok");

  if (!(await columnExists("donations", "project_id"))) {
    await db.query(`
      ALTER TABLE donations
        ADD COLUMN project_id INT NULL AFTER user_id,
        ADD CONSTRAINT donations_project_fk
          FOREIGN KEY (project_id) REFERENCES projects (id)
    `);
    console.log("donations.project_id: added");
  } else {
    console.log("donations.project_id: ok");
  }

  if (!(await columnExists("donations", "note"))) {
    await db.query("ALTER TABLE donations ADD COLUMN note VARCHAR(255) NULL");
    console.log("donations.note: added");
  } else {
    console.log("donations.note: ok");
  }

  if (!(await columnExists("donations", "payment_channel"))) {
    await db.query("ALTER TABLE donations ADD COLUMN payment_channel VARCHAR(30) NULL");
    console.log("donations.payment_channel: added");
  } else {
    console.log("donations.payment_channel: ok");
  }

  if (!(await columnExists("users", "email_verified"))) {
    await db.query(`
      ALTER TABLE users
        ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN otp_hash CHAR(64) NULL,
        ADD COLUMN otp_expires_at DATETIME NULL,
        ADD COLUMN otp_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN otp_sent_at DATETIME NULL
    `);
    // Accounts created before email verification existed keep working.
    await db.query("UPDATE users SET email_verified = 1");
    console.log("users.email_verified + otp columns: added");
  } else {
    console.log("users.email_verified: ok");
  }

  console.log("Migration complete.");
}

run()
  .catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
