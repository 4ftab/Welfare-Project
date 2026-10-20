const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { buildAllowlist, normalizeOrigin, createCors } = require("../config/cors");

const silent = () => {
  const lines = [];
  return { warn: (m) => lines.push(m), lines };
};

test("normalizeOrigin canonicalises and rejects wildcards, null and non-http origins", () => {
  assert.equal(normalizeOrigin("HTTP://LocalHost:5173/"), "http://localhost:5173");
  assert.equal(normalizeOrigin(" https://Example.com:443/path "), "https://example.com");
  assert.equal(normalizeOrigin('"http://localhost:5173"'), "http://localhost:5173");
  for (const bad of ["*", "null", "", "ftp://x.com", "localhost:5173", "javascript:alert(1)", undefined]) {
    assert.equal(normalizeOrigin(bad), null, `should reject ${bad}`);
  }
});

test("development allowlist: dev server and preview server, localhost and 127.0.0.1, nothing else", () => {
  const list = buildAllowlist({ NODE_ENV: "development" }, silent());
  for (const origin of [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:4173", "http://127.0.0.1:4173",
    "https://nojawan-itehad-welfare-chi.vercel.app"
  ]) assert.ok(list.has(origin), origin);

  assert.ok(!list.has("http://localhost:4174"));
  assert.ok(!list.has("http://localhost:3000"));
});

test("production allowlist excludes the preview port and includes FRONTEND_URL", () => {
  const list = buildAllowlist({ NODE_ENV: "production", FRONTEND_URL: "https://www.example.org/" }, silent());
  assert.ok(list.has("https://www.example.org"));
  assert.ok(!list.has("http://localhost:4173"));
});

test("CORS_ORIGINS adds origins, is deduplicated, and invalid entries are ignored with a warning", () => {
  const log = silent();
  const list = buildAllowlist(
    { NODE_ENV: "development", CORS_ORIGINS: "http://localhost:4174, http://LOCALHOST:4174/ ,*,null,not a url", FRONTEND_URL: "http://localhost:5173/" },
    log
  );

  assert.ok(list.has("http://localhost:4174"));
  assert.equal([...list].filter((o) => o === "http://localhost:4174").length, 1);
  assert.equal([...list].filter((o) => o === "http://localhost:5173").length, 1);
  assert.ok(![...list].some((o) => o === "*" || o === "null"));
  assert.equal(log.lines.length, 3);
});

async function withServer(allowlist, log, run) {
  const app = express();
  app.use(createCors({ allowlist, log }));
  app.get("/ping", (req, res) => res.json({ ok: true }));
  app.use((error, req, res, next) => { res.status(500).json({ unhandled: error.message }); }); // must never be reached

  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("allowed origin: preflight 204 with the right headers, actual request echoes the origin", async () => {
  const allowlist = buildAllowlist({ NODE_ENV: "development" }, silent());

  await withServer(allowlist, silent(), async (base) => {
    const pre = await fetch(`${base}/ping`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,content-type"
      }
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(pre.headers.get("access-control-allow-credentials"), "true");
    assert.match(pre.headers.get("access-control-allow-headers"), /Authorization/);
    assert.equal(pre.headers.get("access-control-max-age"), "600");
    assert.match(pre.headers.get("vary"), /Origin/);

    const res = await fetch(`${base}/ping`, { headers: { Origin: "http://127.0.0.1:4173" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "http://127.0.0.1:4173");
  });
});

test("rejected origin: controlled 403 JSON for preflight and request, no CORS headers, logged once per origin", async () => {
  const allowlist = buildAllowlist({ NODE_ENV: "development" }, silent());
  const log = silent();

  await withServer(allowlist, log, async (base) => {
    for (let i = 0; i < 3; i += 1) {
      const pre = await fetch(`${base}/ping`, {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:4174", "Access-Control-Request-Method": "GET" }
      });
      assert.equal(pre.status, 403);
      assert.equal(pre.headers.get("access-control-allow-origin"), null);
      assert.deepEqual(await pre.json(), { message: "This origin is not allowed to use the API." });

      const res = await fetch(`${base}/ping`, { headers: { Origin: "http://localhost:4174" } });
      assert.equal(res.status, 403);
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    }

    await fetch(`${base}/ping`, { headers: { Origin: "https://evil.example" } });
    await fetch(`${base}/ping`, { headers: { Origin: "null" } });
  });

  // 3 distinct bad origins, 8 rejected requests: one log line each, and never an "Unhandled error".
  assert.equal(log.lines.length, 3);
  assert.ok(log.lines.every((line) => line.startsWith("CORS: blocked origin")));
});

test("requests without an Origin header (curl, server-to-server) are not blocked", async () => {
  await withServer(buildAllowlist({ NODE_ENV: "development" }, silent()), silent(), async (base) => {
    const res = await fetch(`${base}/ping`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});
