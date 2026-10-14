// Safe timing logs for the OTP email pipeline.
//
// Each request gets a short trace id and prints single-line JSON like:
//   [otp] {"t":"2026-10-14T10:00:00.000Z","trace":"a1b2c3","action":"register","to":"ab***@gmail.com","phase":"mail_accepted","step_ms":412,"total_ms":2310,...}
//
// What is NEVER logged: the OTP code, passwords, API keys, tokens or hashes. Email addresses are masked.
// Extra fields are passed in by the caller, and any field whose name looks sensitive is dropped as a second line of defence.
const crypto = require("crypto");

const BLOCKED_FIELDS = /^(code|otp|password|pass|passwd|api_?key|token|secret|hash|authorization|auth)$/i;

const elapsed = (from, to = process.hrtime.bigint()) => Math.round(Number(to - from) / 1e6);

function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!domain) return "unknown";
  return `${local.slice(0, 2)}***@${domain}`;
}

// opts.since lets a handler that already did work (e.g. checked a password) start the clock earlier.
function createTrace(action, email, opts = {}) {
  const started = opts.since || process.hrtime.bigint();
  const base = { trace: crypto.randomBytes(3).toString("hex"), action, to: maskEmail(email) };
  let last = started;

  function mark(phase, extra = {}) {
    const now = process.hrtime.bigint();
    const entry = {
      t: new Date().toISOString(),
      ...base,
      phase,
      step_ms: elapsed(last, now),
      total_ms: elapsed(started, now)
    };

    last = now;

    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || BLOCKED_FIELDS.test(key)) continue;
      entry[key] = typeof value === "string" ? value.slice(0, 200) : value;
    }

    console.log(`[otp] ${JSON.stringify(entry)}`);
  }

  // A server that booted a moment ago was probably asleep (Render free instances spin down when idle).
  const uptime = process.uptime();
  mark("request_start", { uptime_s: Math.round(uptime), fresh_boot: uptime < 120 });

  return { mark };
}

// Starts a trace for an Express request and logs the final status when the response is sent.
function traceRequest(req, res, action) {
  const trace = createTrace(action, req.body && req.body.email);
  res.on("finish", () => trace.mark("response_sent", { status: res.statusCode }));
  return trace;
}

module.exports = { createTrace, traceRequest, maskEmail };
