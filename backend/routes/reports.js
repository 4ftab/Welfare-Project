
const express = require("express");
const db = require("../config/db");

const router = express.Router();

router.get("/monthly", async (req, res) => {
  try {
    const month = req.query.month;

    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        message: "Provide a month in YYYY-MM format, for example 2026-10."
      });
    }

    const monthStart = `${month}-01`;

    // The four totals are independent, so they are fetched together.
    const [[previousDonations], [previousExpenses], [monthlyDonations], [monthlyExpenses]] = await Promise.all([
    db.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM donations
       WHERE payment_status = 'completed'
         AND COALESCE(donated_at, created_at) < ?`,
      [monthStart]
    ),
    db.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE expense_date < ?`,
      [monthStart]
    ),
    db.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total,
              COUNT(*) AS count
       FROM donations
       WHERE payment_status = 'completed'
         AND COALESCE(donated_at, created_at) >= ?
         AND COALESCE(donated_at, created_at) < DATE_ADD(?, INTERVAL 1 MONTH)`,
      [monthStart, monthStart]
    ),
    db.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total,
              COUNT(*) AS count
       FROM expenses
       WHERE expense_date >= ?
         AND expense_date < DATE_ADD(?, INTERVAL 1 MONTH)`,
      [monthStart, monthStart]
    )
    ]);

    const openingBalance =
      Number(previousDonations[0].total) -
      Number(previousExpenses[0].total);

    const donationsReceived = Number(monthlyDonations[0].total);
    const expensesPaid = Number(monthlyExpenses[0].total);

    res.json({
      month,
      currency: "PKR",
      opening_balance: openingBalance,
      donations_received: donationsReceived,
      donation_count: monthlyDonations[0].count,
      expenses_paid: expensesPaid,
      expense_count: monthlyExpenses[0].count,
      closing_balance:
        openingBalance + donationsReceived - expensesPaid
    });
  } catch (error) {
    console.error("Monthly report error:", error.message);

    res.status(500).json({
      message: "Could not calculate monthly report."
    });
  }
});

module.exports = router;
