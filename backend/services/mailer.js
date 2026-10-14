
const https = require("https");

const SENDER_EMAIL =
  process.env.MAIL_FROM || "nojawan.itehad.welfare@gmail.com";

async function sendMail({ to, subject, text, html }) {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not configured.");
  }

  const payload = JSON.stringify({
    sender: {
      name: "Nojawan Itehad Welfare",
      email: SENDER_EMAIL
    },
    to: [{ email: to }],
    subject,
    textContent: text,
    htmlContent: html
  });

  await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.brevo.com",
        path: "/v3/smtp/email",
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        },
        timeout: 15000
      },
      (res) => {
        let responseBody = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(
              new Error(
                `Brevo API error (${res.statusCode}): ${responseBody}`
              )
            );
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("Brevo API connection timed out."));
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function sendOtpEmail(to, name, code, minutes) {
  const safeName = String(name).replace(/[<>&"]/g, "");

  return sendMail({
    to,
    subject: `${code} is your Nojawan Itehad Welfare verification code`,
    text:
      `Assalam o Alaikum ${name},\n\n` +
      `Your verification code is ${code}. ` +
      `It expires in ${minutes} minutes.\n\n` +
      "If you did not create an account, you can ignore this email.",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;color:#173b3e">
        <h2>Nojawan Itehad Welfare</h2>
        <p>Assalam o Alaikum ${safeName},</p>
        <p>Use this code to verify your email address:</p>
        <p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p>
        <p>The code expires in ${minutes} minutes.</p>
        <p style="color:#70848a;font-size:12px">
          If you did not create an account, you can ignore this email.
        </p>
      </div>`
  });
}

function isConfigured() {
  return Boolean(process.env.BREVO_API_KEY);
}

module.exports = { isConfigured, sendOtpEmail };
