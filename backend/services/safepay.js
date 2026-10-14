// Safepay client. Endpoints and signature schemes follow Safepay's official Node SDK
// (@sfpy/node-sdk): trackers via /order/v1/init, hosted checkout at /checkout/pay,
// webhook signature HMAC-SHA512 in X-SFPY-SIGNATURE.
// Amounts are whole-rupee numbers (Safepay shows PKR 2500 as Rs.2,500.00).
const crypto = require("crypto");

const HOSTS = {
  sandbox: {
    api: "https://sandbox.api.getsafepay.com",
    checkout: "https://sandbox.api.getsafepay.com/checkout/pay"
  },
  production: {
    api: "https://api.getsafepay.com",
    checkout: "https://getsafepay.com/checkout/pay"
  }
};

function clean(value) {
  return String(value || "").trim().replace(/^["']|["']$/g, "").trim();
}

function settings() {
  return {
    env: clean(process.env.SAFEPAY_ENV).toLowerCase() || "sandbox",
    // SAFEPAY_API_KEY is accepted as another name for the public key.
    publicKey: clean(process.env.SAFEPAY_PUBLIC_KEY || process.env.SAFEPAY_API_KEY),
    secretKey: clean(process.env.SAFEPAY_SECRET_KEY),
    webhookSecret: clean(process.env.SAFEPAY_WEBHOOK_SECRET)
  };
}

// Returns a list of problems. An unknown SAFEPAY_ENV is an error, never a silent sandbox fallback.
function configProblems() {
  const s = settings();
  const problems = [];

  if (!HOSTS[s.env]) {
    problems.push(`SAFEPAY_ENV must be "sandbox" or "production" (got "${s.env}").`);
  }
  if (!s.publicKey) problems.push("SAFEPAY_PUBLIC_KEY is not set.");
  else if (!s.publicKey.startsWith("sec_")) {
    problems.push("SAFEPAY_PUBLIC_KEY should be the public API key that starts with sec_.");
  }
  if (!s.secretKey) problems.push("SAFEPAY_SECRET_KEY is not set.");

  if (s.env === "production") {
    const frontend = clean(process.env.FRONTEND_URL);
    if (!frontend.startsWith("https://")) {
      problems.push("FRONTEND_URL must be an https:// address in production.");
    }
  }

  return problems;
}

function isConfigured() {
  return configProblems().length === 0;
}

// "off": no Safepay keys at all (plain pledges); "ready"; "invalid": keys present but misconfigured,
// in which case online payment is refused rather than quietly using another environment.
function mode() {
  const s = settings();
  if (!s.publicKey && !s.secretKey) return "off";
  return isConfigured() ? "ready" : "invalid";
}

function environment() {
  return settings().env;
}

function hosts() {
  const env = settings().env;
  if (!HOSTS[env]) throw new Error("Safepay is not configured correctly.");
  return HOSTS[env];
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${hosts().api}${path}`, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const reason = data?.status?.errors?.join("; ") || data?.message || "";
      const error = new Error(`Safepay responded with ${response.status}${reason ? `: ${reason}` : ""}`);
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Safepay did not respond in time.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Creates a payment tracker for an amount and returns its token (track_...).
async function createTracker(amount) {
  const s = settings();
  const data = await request("/order/v1/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client: s.publicKey,
      amount,
      currency: "PKR",
      environment: s.env
    })
  });

  const token = data?.data?.token;
  if (!token) throw new Error("Safepay did not return a tracker.");

  return token;
}

function checkoutUrl({ tracker, orderId, redirectUrl, cancelUrl }) {
  const params = new URLSearchParams({
    beacon: tracker,
    cancel_url: cancelUrl,
    env: settings().env,
    order_id: String(orderId),
    redirect_url: redirectUrl,
    source: "custom",
    webhooks: "true"
  });

  return `${hosts().checkout}?${params.toString()}`;
}

// Maps Safepay's processor ("intent") to the donor-facing payment method.
function methodFromIntent(intent) {
  const value = String(intent || "").toUpperCase();
  if (value.includes("EASYPAISA")) return "easypaisa";
  if (value.includes("JAZZ")) return "jazzcash";
  if (["CYBERSOURCE", "MPGS", "PAYFAC", "CARD"].some((x) => value.includes(x))) return "card";
  return null;
}

// Server-side truth about a tracker, read with the merchant secret. A payment only counts when
// Safepay says the tracker ended with a transaction, for this merchant, and for the exact amount
// and currency this server asked for. The browser redirect alone is never trusted.
async function getTrackerState(tracker, expectedAmount) {
  const s = settings();
  const data = await request(`/order/v1/${encodeURIComponent(tracker)}`, {
    headers: { "X-SFPY-MERCHANT-SECRET": s.secretKey }
  });

  const order = data?.data || {};
  const transaction = order.transaction || null;
  const state = order.state || "UNKNOWN";

  const problems = [];
  if (order.token !== tracker) problems.push("tracker mismatch");
  if (order.client && order.client !== s.publicKey) problems.push("merchant mismatch");
  if (order.currency !== "PKR") problems.push(`currency ${order.currency}`);
  if (Number(order.amount) !== Number(expectedAmount)) {
    problems.push(`amount ${order.amount} != ${expectedAmount}`);
  }

  const ended = state === "TRACKER_ENDED" && Boolean(transaction?.token);

  return {
    state,
    paid: ended && problems.length === 0,
    problems,
    method: methodFromIntent(order.intent),
    transactionId: transaction?.token || null
  };
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Webhook signature: HMAC-SHA512 with the webhook secret, sent in X-SFPY-SIGNATURE. The official SDK
// signs JSON.stringify(body.data); the raw body is also accepted in case Safepay signs the whole payload.
function verifyWebhookSignature({ signature, body, rawBody }) {
  const secret = settings().webhookSecret;
  if (!secret || !signature) return false;

  const candidates = [];
  if (body && body.data !== undefined) candidates.push(JSON.stringify(body.data));
  if (rawBody) candidates.push(rawBody);

  return candidates.some((content) =>
    safeEqualHex(crypto.createHmac("sha512", secret).update(content).digest("hex"), signature)
  );
}

function webhookConfigured() {
  return Boolean(settings().webhookSecret);
}

// Finds the tracker token in a webhook payload, wherever this payload version keeps it.
function trackerFromWebhook(body) {
  const seen = new Set();
  const stack = [body];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);

    for (const value of Object.values(node)) {
      if (typeof value === "string" && /^track_[0-9a-f-]{36}$/i.test(value)) return value;
      if (value && typeof value === "object") stack.push(value);
    }
  }

  return null;
}

// Payment methods offered to donors. Safepay's hosted checkout decides what it
// actually renders: wallets only appear once Safepay enables them on the
// merchant account, so list "easypaisa" / "jazzcash" here only after that.
const KNOWN_CHANNELS = ["card", "easypaisa", "jazzcash"];

function enabledChannels() {
  const wanted = String(process.env.SAFEPAY_CHANNELS || "card")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => KNOWN_CHANNELS.includes(c));

  return wanted.length ? [...new Set(wanted)] : ["card"];
}

module.exports = {
  configProblems,
  isConfigured,
  mode,
  environment,
  createTracker,
  checkoutUrl,
  getTrackerState,
  verifyWebhookSignature,
  webhookConfigured,
  trackerFromWebhook,
  enabledChannels
};
