// Thin Safepay client. Amounts are whole-rupee numbers (Safepay shows PKR 2500 as Rs.2,500.00).
const production = process.env.SAFEPAY_ENV === "production";
const API = production
  ? "https://api.getsafepay.com"
  : "https://sandbox.api.getsafepay.com";

function isConfigured() {
  return Boolean(process.env.SAFEPAY_PUBLIC_KEY && process.env.SAFEPAY_SECRET_KEY);
}

async function request(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`Safepay responded with ${response.status}`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Creates a payment tracker for an amount and returns its token.
async function createTracker(amount) {
  const data = await request(`${API}/order/v1/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client: process.env.SAFEPAY_PUBLIC_KEY,
      amount,
      currency: "PKR",
      environment: production ? "production" : "sandbox"
    })
  });

  const token = data?.data?.token;

  if (!token) throw new Error("Safepay did not return a tracker.");

  return token;
}

function checkoutUrl({ tracker, orderId, redirectUrl, cancelUrl }) {
  const params = new URLSearchParams({
    env: production ? "production" : "sandbox",
    beacon: tracker,
    source: "custom",
    order_id: String(orderId),
    redirect_url: redirectUrl,
    cancel_url: cancelUrl
  });

  return `${API}/checkout/pay?${params.toString()}`;
}

// Server-side truth about a tracker. Never trust the browser redirect alone.
// A payment only counts when Safepay says the tracker ended AND the amount
// and currency match what this server asked for.
async function getTrackerState(tracker, expectedAmount) {
  const data = await request(
    `${API}/order/v1/${encodeURIComponent(tracker)}`,
    { headers: { "X-SFPY-MERCHANT-SECRET": process.env.SAFEPAY_SECRET_KEY } }
  );

  const order = data?.data || {};
  const state = order.state || "UNKNOWN";

  const matches =
    order.token === tracker &&
    order.currency === "PKR" &&
    Number(order.amount) === Number(expectedAmount);

  return { state, paid: state === "TRACKER_ENDED" && matches };
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
  isConfigured,
  createTracker,
  checkoutUrl,
  getTrackerState,
  enabledChannels
};
