
require("dotenv").config();

const readline = require("readline");
const db = require("../config/db");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("Enter the registered user's email: ", async (email) => {
  try {
    const normalizedEmail = email.trim().toLowerCase();

    const [users] = await db.execute(
      "SELECT id, full_name, email, role FROM users WHERE email = ?",
      [normalizedEmail]
    );

    if (!users.length) {
      console.log("No account found. Register the user first.");
      return;
    }

    if (users[0].role === "admin") {
      console.log("This account is already an admin.");
      return;
    }

    await db.execute(
      "UPDATE users SET role = 'admin' WHERE id = ?",
      [users[0].id]
    );

    console.log(`${users[0].full_name} is now an admin.`);
    console.log("Log out and log in again to obtain a new token.");
  } catch (error) {
    console.error("Could not make admin:", error.message);
  } finally {
    rl.close();
    await db.end();
  }
});
