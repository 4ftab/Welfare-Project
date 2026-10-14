// Transactional email through Brevo's HTTPS API (port 443). Render blocks or throttles
// outbound SMTP, so the API is used instead of Nodemailer/SMTP.
const http = require("http");
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

// Brevo's API lives at api.brevo.com. BREVO_API_URL exists only so tests can point at a local fake;
// it is ignored in production.
function endpoint() {
  const override = clean(process.env.BREVO_API_URL);

  if (override && process.env.NODE_ENV !== "production") {
    const url = new URL(override);
    return {
      mod: url.protocol === "http:" ? http : https,
      hostname: url.hostname,
      port: url.port || undefined,
      base: url.pathname.replace(/\/+$/, "")
    };
  }

  return { mod: https, hostname: "api.brevo.com", port: undefined, base: "/v3" };
}

const REQUEST_TIMEOUT_MS = () => Number(process.env.BREVO_TIMEOUT_MS) || 15000;

// Resolves { status, data, ms, timing } or rejects with an error carrying status / ms / timing.
// timing is cumulative milliseconds since the request began, which shows where the time went:
//   dns_ms -> connect_ms -> tls_ms -> first_byte_ms (Brevo's answer) -> ms (everything read).
function brevoRequest(method, path, body) {
  const payload = body ? JSON.stringify(body) : null;
  const target = endpoint();
  const started = process.hrtime.bigint();
  const since = () => Math.round(Number(process.hrtime.bigint() - started) / 1e6);
  const timing = {};

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      error.ms = since();
      error.timing = timing;
      reject(error);
    };

    const req = target.mod.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.base}${path}`,
        method,
        headers: {
          "api-key": apiKey(),
          accept: "application/json",
          ...(payload
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {})
        },
        timeout: REQUEST_TIMEOUT_MS()
      },
      (res) => {
        timing.first_byte_ms = since();

        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => {
          let data = {};
          try { data = JSON.parse(text); } catch { /* non-JSON body */ }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            return resolve({ status: res.statusCode, data, ms: since(), timing });
          }

          const error = new Error(
            `Brevo API error (${res.statusCode}): ${data.message || text.slice(0, 200)}`
          );
          error.status = res.statusCode;
          error.providerCode = data.code;
          error.hint = explain(res.statusCode, data.message || "");
          fail(error);
        });
      }
    );

    req.on("socket", (socket) => {
      if (!socket.connecting) {
        timing.reused_connection = true;
        return;
      }
      socket.once("lookup", () => { timing.dns_ms = since(); });
      socket.once("connect", () => { timing.connect_ms = since(); });
      socket.once("secureConnect", () => { timing.tls_ms = since(); });
    });

    req.on("timeout", () => {
      const error = new Error("Brevo API connection timed out.");
      error.code = "BREVO_TIMEOUT";
      req.destroy(error);
    });

    req.on("error", fail);
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

// Sends one email. The optional trace records when the request started, whether Brevo accepted it,
// Brevo's message id (use it to look the email up later) and how long each stage took.
async function sendMail({ to, subject, text, html }, trace) {
  const problems = configProblems();

  if (problems.length) {
    throw new Error(`Email is not configured: ${problems.join(" ")}`);
  }

  trace?.mark("mail_request_start");

  try {
    const result = await brevoRequest("POST", "/smtp/email", {
      sender: sender(),
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html
    });

    const messageId = result.data.messageId;

    trace?.mark("mail_accepted", {
      status: result.status,
      provider_ms: result.ms,
      ...result.timing,
      messageId,
      accepted_at: new Date().toISOString()
    });

    return { messageId };
  } catch (error) {
    // Only status codes and timings are logged, never Brevo's free-text message or the key.
    trace?.mark("mail_failed", {
      status: error.status,
      provider_code: error.providerCode,
      error_code: error.code,
      provider_ms: error.ms,
      ...error.timing
    });

    if (error.hint && !warned) {
      console.error(`Email hint: ${error.hint} (key ${describeKey(apiKey())})`);
      warned = true;
    }
    throw error;
  }
}

// Brevo's own record of what happened to an email after it accepted it (requests, deferred, delivered, ...).
// Filter by the messageId from the "mail_accepted" log line, or by recipient address.
async function getEmailEvents({ messageId, email, days = 2 }) {
  const query = new URLSearchParams({ days: String(days), sort: "asc" });
  if (messageId) query.set("messageId", messageId);
  if (email) query.set("email", email);

  const { data } = await brevoRequest("GET", `/smtp/statistics/events?${query}`);
  return data.events || [];
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
    const { data: account } = await brevoRequest("GET", "/account");
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

async function sendOtpEmail(to, name, code, minutes, trace) {
  // Local development only: print the code instead of emailing it. Never active in production.
  if (process.env.MAIL_DEV_LOG_OTP === "true" && process.env.NODE_ENV !== "production") {
    console.log(`[dev] OTP for ${to}: ${code}`);
    trace?.mark("dev_mode_no_email_sent");
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
  }, trace);
}

function isConfigured() {
  return configProblems().length === 0;
}

module.exports = { isConfigured, checkConfig, sendMail, sendOtpEmail, sender, getEmailEvents };
