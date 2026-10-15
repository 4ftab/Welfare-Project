export const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

// The free Render server can take ~30-50 s to wake up, so requests get a generous but finite timeout.
const TIMEOUT_MS = 45000;

// GET requests that are already on their way are shared, so two components asking for the same
// data at once cause one network call. Keyed by token + path so users never share data.
const inFlight = new Map();

async function send(path, { token, timeout = TIMEOUT_MS, ...options }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${API}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || "Request failed");
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("The server is taking too long to respond. It may be waking up; please try again in a moment.", { cause: e });
    }
    if (e instanceof TypeError) {
      throw new Error("Could not reach the server. Please check your internet connection and try again.", { cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET") return send(path, options);

  const key = `${options.token || ""} ${path}`;
  if (!inFlight.has(key)) {
    inFlight.set(key, send(path, options).finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

// Download an authenticated file (e.g. CSV export).
export async function downloadFile(path, filename, token) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Download failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function money(value) {
  return `PKR ${Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 2,
  })}`;
}

export function compactMoney(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function monthLabel(ym, long = false) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: long ? "long" : "short",
    year: long ? "numeric" : undefined,
  });
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export const pct = (part, whole) =>
  whole > 0 ? Math.max(0, Math.min(100, (Number(part) / Number(whole)) * 100)) : 0;

const CHANNEL_NAMES = { card: "Card", easypaisa: "Easypaisa", jazzcash: "JazzCash" };

// "safepay · Easypaisa" style label for a donation row.
export function methodLabel(method, channel) {
  const raw = String(method || "").replace("_", " ");
  const base = raw.charAt(0).toUpperCase() + raw.slice(1);
  return method === "safepay" && channel ? `${base} · ${CHANNEL_NAMES[channel] || channel}` : base;
}

export { CHANNEL_NAMES };
