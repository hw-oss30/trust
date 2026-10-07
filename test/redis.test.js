"use strict";
// Prüft den Redis-Speicher (wie auf Vercel) gegen einen nachgebauten Upstash-REST-Server
// und ruft die App so auf, wie Vercel es tut (Body schon gelesen, Pfad über __path).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const kv = new Map();
let mock, app, base;

function upstash(req, res) {
  let raw = "";
  req.on("data", c => raw += c);
  req.on("end", () => {
    if (req.headers.authorization !== "Bearer test-token") { res.writeHead(401); return res.end(JSON.stringify({ error: "unauthorized" })); }
    const [cmd, script, , k1, k2, ...args] = JSON.parse(raw);
    let result;
    if (cmd === "EVAL" && script.startsWith("return")) result = [kv.get(k1) ?? null, kv.get(k2) ?? null];
    else if (cmd === "EVAL") {
      if ((kv.get(k2) ?? "0") === args[0]) { kv.set(k1, args[1]); kv.set(k2, args[2]); result = 1; } else result = 0;
    } else { res.writeHead(400); return res.end(JSON.stringify({ error: "unknown" })); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ result }));
  });
}

before(async () => {
  mock = http.createServer(upstash);
  await new Promise(r => mock.listen(0, r));
  process.env.VERCEL = "1";
  process.env.KV_REST_API_URL = `http://localhost:${mock.address().port}`;
  process.env.KV_REST_API_TOKEN = "test-token";
  const { handle } = require("../lib/app");
  // Nachbau des Vercel-Aufrufs: Rewrite auf /api/index?__path=… und vorab gelesener Body
  app = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      if (u.pathname.startsWith("/api/")) req.url = `/api/index?__path=${encodeURIComponent(u.pathname.slice(5))}`;
      req.body = raw ? JSON.parse(raw) : undefined;
      handle(req, res);
    });
  });
  await new Promise(r => app.listen(0, r));
  base = `http://localhost:${app.address().port}`;
});
after(() => { app.close(); mock.close(); });

function client() {
  let cookie = "";
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json", "X-Requested-With": "trustreels", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}

test("Login und Anlegen funktionieren mit Redis-Speicher im Vercel-Aufruf", async () => {
  const c = client();
  assert.equal((await c("POST", "/api/login", { username: "tomgerlitz", password: "Trustreels291?" })).status, 200);
  const p = await c("POST", "/api/projects", { name: "Reel", positions: [{ name: "Editor", stunden: 10 }] });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const saved = JSON.parse(kv.get("trustreels:db"));
  assert.equal(saved.projects[0].name, "Reel");
  assert.ok(saved.users.every(u => !("password" in u)) && saved.users[0].passwordHash.startsWith("scrypt$"));
  const b = await c("GET", "/api/bootstrap");
  assert.equal(b.body.projects[0].positions[0].name, "Editor");
});

test("Fehlversuche beim Login werden instanzübergreifend gezählt", async () => {
  for (let i = 0; i < 8; i++) await client()("POST", "/api/login", { username: "hendrikwendker", password: "falsch" });
  const r = await client()("POST", "/api/login", { username: "hendrikwendker", password: "Trustreels273$" });
  assert.equal(r.status, 429);
});

test("Veralteter Stand wird nicht gespeichert (gleichzeitige Änderungen)", async () => {
  const { redisStore } = require("../lib/store");
  const s = redisStore(process.env.KV_REST_API_URL, "test-token", "konflikt");
  const first = await s.load();
  assert.equal(await s.save({ a: 1 }, first.rev), true);
  assert.equal(await s.save({ a: 2 }, first.rev), false, "zweiter Schreiber mit altem Stand muss abgewiesen werden");
  assert.deepEqual((await s.load()).data, { a: 1 });
});
