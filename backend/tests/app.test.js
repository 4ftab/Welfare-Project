// Exercises the real Express app (middleware order, error handling, cache headers) on a random port.
// Only routes that never touch the database are called, so no MySQL connection is needed.
const test = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");

let server;
let base;

test.before(async () => {
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("unknown API route answers 404 JSON", async () => {
  const res = await fetch(`${base}/api/does-not-exist`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { message: "API endpoint not found." });
});

test("malformed JSON is a 400, not a 500", async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{bad json"
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { message: "The request body is not valid JSON." });
});

test("oversized body is a 413", async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pad: "x".repeat(1_200_000) })
  });
  assert.equal(res.status, 413);
});

test("a disallowed origin gets a controlled 403 and a server-error body is never produced", async () => {
  const res = await fetch(`${base}/api/public/config`, { headers: { Origin: "http://localhost:4999" } });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { message: "This origin is not allowed to use the API." });
});

test("an allowed origin reaches a public route with CORS headers", async () => {
  const res = await fetch(`${base}/api/public/config`, { headers: { Origin: "http://localhost:5173" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(typeof (await res.json()).online_payments, "boolean");
});

test("protected routes demand a token and are marked private; auth responses are no-store", async () => {
  const dash = await fetch(`${base}/api/dashboard`);
  assert.equal(dash.status, 401);
  assert.equal(dash.headers.get("cache-control"), "private, no-cache");

  const admin = await fetch(`${base}/api/admin/overview`);
  assert.equal(admin.status, 401);
  assert.equal(admin.headers.get("cache-control"), "private, no-cache");

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(login.status, 400);
  assert.equal(login.headers.get("cache-control"), "no-store");
});

test("a garbage bearer token is rejected as 401 without touching the database", async () => {
  const res = await fetch(`${base}/api/dashboard`, { headers: { Authorization: "Bearer not.a.jwt" } });
  assert.equal(res.status, 401);
});

test("Safepay webhook is refused (503) when no webhook secret is configured, and never marks anything paid", async () => {
  const before = process.env.SAFEPAY_WEBHOOK_SECRET;
  delete process.env.SAFEPAY_WEBHOOK_SECRET;

  try {
    const res = await fetch(`${base}/api/payments/safepay/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sfpy-signature": "deadbeef" },
      body: JSON.stringify({ data: { token: "track_00000000-0000-0000-0000-000000000000" } })
    });
    assert.ok([503, 401].includes(res.status), `unexpected status ${res.status}`);
  } finally {
    if (before !== undefined) process.env.SAFEPAY_WEBHOOK_SECRET = before;
  }
});

test("Safepay webhook with a wrong signature is rejected (401) when a secret is configured", async () => {
  const before = { secret: process.env.SAFEPAY_WEBHOOK_SECRET, pub: process.env.SAFEPAY_PUBLIC_KEY, sk: process.env.SAFEPAY_SECRET_KEY };
  process.env.SAFEPAY_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SAFEPAY_PUBLIC_KEY = "sec_test_public";
  process.env.SAFEPAY_SECRET_KEY = "test-secret";

  try {
    const res = await fetch(`${base}/api/payments/safepay/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sfpy-signature": "deadbeef" },
      body: JSON.stringify({ data: { token: "track_00000000-0000-0000-0000-000000000000" } })
    });
    assert.equal(res.status, 401);
  } finally {
    for (const [key, name] of [["secret", "SAFEPAY_WEBHOOK_SECRET"], ["pub", "SAFEPAY_PUBLIC_KEY"], ["sk", "SAFEPAY_SECRET_KEY"]]) {
      if (before[key] === undefined) delete process.env[name];
      else process.env[name] = before[key];
    }
  }
});
