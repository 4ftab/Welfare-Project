// Checks the Brevo configuration and sends one test email:  npm run test-email -- you@example.com
require("dotenv").config();

const { checkConfig, sendMail, sender } = require("../services/mailer");

async function run() {
  const to = process.argv[2];

  if (!to) {
    console.error("Usage: npm run test-email -- you@example.com");
    process.exitCode = 1;
    return;
  }

  if (!(await checkConfig())) {
    process.exitCode = 1;
    return;
  }

  await sendMail({
    to,
    subject: "Nojawan Itehad Welfare test email",
    text: `This is a test email sent from ${sender().email} through Brevo.`,
    html: `<p>This is a test email sent from <strong>${sender().email}</strong> through Brevo.</p>`
  });

  console.log(`Test email accepted by Brevo for ${to}. Check the inbox and the spam folder.`);
}

run().catch((error) => {
  console.error("Test email failed:", error.message);
  process.exitCode = 1;
});
