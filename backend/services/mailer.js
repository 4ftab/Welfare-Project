// Transactional email through Brevo's HTTPS API (port 443). Render blocks or throttles
// outbound SMTP, so the API is used instead of Nodemailer/SMTP.
const https = require("https");

const DEFAULT_SENDER = "nojawan.itehad.welfare@gmail.com";
const SENDER_NAME = "Nojawan Itehad Welfare";

// Values pasted into dashboards often carry quotes, spaces or a trailing newline.
function clean(value) {
  return String(value || "").trim().replace(/^["']|["']$/g, "").trim();
}

function apiKey() {
  return clean(process.env.BREVO_API_KEY);
}

// MAIL_FROM may be a bare address or `Name <address>`; Brevo needs them separately.
function sender() {
  const raw = clean(process.env.MAIL_FROM) || DEFAULT_SENDER;
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  const email = clean(match ? match[2] : raw).toLowerCase();
  const name = clean(match ? match[1] : "") || SENDER_NAME;

  return { name, email };
}

// Safe to log: never more than the first characters of the key.
function describeKey(key) {
  return key ? `${key.slice(0, 8)}… (${key.length} chars)` : "missing";
}

// Problems that can be detected without calling Brevo.
function configProblems() {
  const key = apiKey();
  const problems = [];

  if (!key) {
    problems.push("BREVO_API_KEY is not set.");
  } else if (key.startsWith("xsmtpsib-")) {
    problems.push(
      "BREVO_API_KEY is an SMTP key (starts with xsmtpsib-). The HTTPS API needs an API key " +
      "(starts with xkeysib-) from Brevo > SMTP & API > API Keys."
    );
  } else if (/\s/.test(key)) {
    problems.push("BREVO_API_KEY contains spaces or line breaks. Paste it again as one line.");
  }

  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender().email)) {
    problems.push("MAIL_FROM is not a valid email address.");
  }

  return problems;
}

function brevoRequest(method, path, body) {
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.brevo.com",
        path: `/v3${path}`,
        method,
        headers: {
          "api-key": apiKey(),
          accept: "application/json",
          ...(payload
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {})
        },
        timeout: 15000
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => {
          let data = {};
          try { data = JSON.parse(text); } catch { /* non-JSON body */ }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            return resolve(data);
          }

          const error = new Error(
            `Brevo API error (${res.statusCode}): ${data.message || text.slice(0, 200)}`
          );
          error.status = res.statusCode;
          error.hint = explain(res.statusCode, data.message || "");
          reject(error);
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("Brevo API connection timed out.")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Turns Brevo's error into the dashboard setting that needs fixing.
function explain(status, message) {
  const m = message.toLowerCase();

  if (status === 401 && m.includes("key not found")) {
    return "Brevo does not recognise BREVO_API_KEY. Create a new API key (xkeysib-...) under " +
      "SMTP & API > API Keys, paste the whole value into Render, and redeploy.";
  }
  if (status === 401 && m.includes("ip")) {
    return "Brevo blocked the request by IP. Disable 'Authorised IPs' under Security in Brevo, " +
      "because Render's outgoing IP addresses change.";
  }
  if (status === 401 || status === 403) {
    return "Brevo refused the account or key. Check that the account is activated for " +
      "transactional email and that the key belongs to that account.";
  }
  if (status === 400 && m.includes("sender")) {
    return `The sender ${sender().email} is not verified in Brevo (Senders, Domains & Dedicated IPs > Senders).`;
  }
  return "";
}

let warned = false;

async function sendMail({ to, subject, text, html }) {
  const problems = configProblems();

  if (problems.length) {
    throw new Error(`Email is not configured: ${problems.join(" ")}`);
  }

  try {
    await brevoRequest("POST", "/smtp/email", {
      sender: sender(),
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html
    });
  } catch (error) {
    if (error.hint && !warned) {
      console.error(`Email hint: ${error.hint} (key ${describeKey(apiKey())})`);
      warned = true;
    }
    throw error;
  }
}

// Called at startup: confirms the key works without sending anything, and logs what to fix.
async function checkConfig() {
  const problems = configProblems();

  if (problems.length) {
    problems.forEach((p) => console.error(`Email config: ${p}`));
    return false;
  }

  if (!apiKey().startsWith("xkeysib-")) {
    console.warn("Email config: BREVO_API_KEY does not start with xkeysib-, which Brevo API keys normally do.");
  }

  try {
    const account = await brevoRequest("GET", "/account");
    console.log(
      `Email: Brevo API key accepted (account ${account.email || "unknown"}); sending as ${sender().email}.`
    );
    return true;
  } catch (error) {
    console.error(`Email config: ${error.message}. ${error.hint || ""} (key ${describeKey(apiKey())})`);
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function sendOtpEmail(to, name, code, minutes) {
  // Local development only: print the code instead of emailing it. Never active in production.
  if (process.env.MAIL_DEV_LOG_OTP === "true" && process.env.NODE_ENV !== "production") {
    console.log(`[dev] OTP for ${to}: ${code}`);
    return;
  }

  const safeName = escapeHtml(name);

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
  return configProblems().length === 0;
}

module.exports = { isConfigured, checkConfig, sendMail, sendOtpEmail, sender };
