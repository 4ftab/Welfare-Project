// Thin SMTP mailer. Without SMTP settings, development prints the message to the server console instead.
const nodemailer = require("nodemailer");

const production = process.env.NODE_ENV === "production";

let transporter = null;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587;

    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15000
    });
  }

  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) {
    if (production) {
      throw new Error("SMTP is not configured.");
    }

    console.log(`[mail] SMTP not configured, printing instead.\n  To: ${to}\n  Subject: ${subject}\n  ${text}`);
    return;
  }

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });
}

// Emails the one-time code that confirms a new account's email address.
function sendOtpEmail(to, name, code, minutes) {
  const safeName = String(name).replace(/[<>&"]/g, "");

  return sendMail({
    to,
    subject: `${code} is your Nojawan Itehad Welfare verification code`,
    text: `Assalam o Alaikum ${name},\n\nYour verification code is ${code}. It expires in ${minutes} minutes.\n\nIf you did not create an account, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;color:#173b3e">
  <h2 style="margin:0 0 12px">Nojawan Itehad Welfare</h2>
  <p>Assalam o Alaikum ${safeName},</p>
  <p>Use this code to verify your email address and finish creating your account:</p>
  <p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:18px 0">${code}</p>
  <p>The code expires in ${minutes} minutes.</p>
  <p style="color:#70848a;font-size:12px">If you did not create an account, you can ignore this email.</p>
</div>`
  });
}

module.exports = { isConfigured, sendOtpEmail };
