"use strict";
// API-Tests: Anmeldung, Rechte und Sichtbarkeit werden serverseitig geprüft.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "trustreels-test-"));
const { start } = require("../server.js");

let server, base;
before(async () => { server = await start(0); base = `http://localhost:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

function client() {
  let cookie = "";
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json", "X-Requested-With": "trustreels", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}
async function login(username, password) { const c = client(); const r = await c("POST", "/api/login", { username, password }); assert.equal(r.status, 200, JSON.stringify(r.body)); return c; }

let admin, admin2, emp, empId, projId, editorPos;

test("Erst-Admins können sich anmelden, falsche Passwörter nicht", async () => {
  admin = await login("hendrikwendker", "Trustreels273$");
  admin2 = await login("tomgerlitz", "Trustreels291?");
  const bad = await client()("POST", "/api/login", { username: "hendrikwendker", password: "falsch" });
  assert.equal(bad.status, 401);
  const me = (await admin("GET", "/api/bootstrap")).body.me;
  assert.equal(me.isAdmin, true);
  assert.equal((await client()("GET", "/api/bootstrap")).status, 401);
});

test("Ohne eigenen Header werden schreibende Anfragen abgelehnt", async () => {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "tomgerlitz", password: "Trustreels291?" }) });
  assert.equal(r.status, 403);
});

test("Admin legt Rolle und Mitarbeiter an", async () => {
  const role = await admin("POST", "/api/roles", { name: "Editor", permissions: ["times.book", "absences.request"] });
  assert.equal(role.status, 200);
  const u = await admin("POST", "/api/users", { username: "max", password: "geheim123", vorname: "Max", nachname: "Muster", position: "Editor", roleId: role.body.id, stunden: 40, urlaub: 28 });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  empId = u.body.id;
  const short = await admin("POST", "/api/users", { username: "kurz", password: "123", vorname: "K" });
  assert.equal(short.status, 400);
  const dupe = await admin("POST", "/api/users", { username: "max", password: "geheim123", vorname: "M" });
  assert.equal(dupe.status, 400);
  emp = await login("max", "geheim123");
});

test("Mitarbeiter darf keine Benutzer, Rollen oder Projekte anlegen", async () => {
  assert.equal((await emp("POST", "/api/users", { username: "x1", password: "geheim123", vorname: "X" })).status, 403);
  assert.equal((await emp("POST", "/api/roles", { name: "Hack", isAdmin: true })).status, 403);
  assert.equal((await emp("POST", "/api/projects", { name: "P" })).status, 403);
});

test("Admin legt Projekt mit Positionen an, Mitarbeiter bucht auf eine Position", async () => {
  const p = await admin("POST", "/api/projects", { name: "Imagefilm", kunde: "Stadtwerke", positions: [{ name: "Kameramann", stunden: 20 }, { name: "Editor", stunden: 40 }] });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  projId = p.body.id;
  const proj = (await admin("GET", "/api/bootstrap")).body.projects.find(x => x.id === projId);
  editorPos = proj.positions.find(x => x.name === "Editor").id;
  const t = await emp("POST", "/api/times", { projektId: projId, positionId: editorPos, datum: "2026-10-05", stunden: 8, mitarbeiterId: "irgendwer" });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const after = (await admin("GET", "/api/bootstrap")).body;
  const pos = after.projects.find(x => x.id === projId).positions.find(x => x.id === editorPos);
  assert.equal(pos.gebucht, 8);
  // Mitarbeiter kann nicht für andere buchen – die Buchung landet bei ihm selbst
  assert.equal(after.times[0].mitarbeiterId, empId);
});

test("Position mit gebuchten Stunden kann nicht entfernt werden", async () => {
  const r = await admin("PUT", `/api/projects/${projId}`, { name: "Imagefilm", positions: [{ name: "Kameramann", stunden: 20 }] });
  assert.equal(r.status, 400);
});

test("Mitarbeiter sieht nur eigene Abwesenheiten und Stunden, keinen Projektstand", async () => {
  const meId = (await admin("GET", "/api/bootstrap")).body.me.id;
  await admin("POST", "/api/absences", { mitarbeiterId: meId, art: "urlaub", von: "2026-12-01", bis: "2026-12-05", status: "genehmigt" });
  await admin("POST", "/api/times", { mitarbeiterId: meId, projektId: projId, positionId: editorPos, datum: "2026-10-06", stunden: 3 });
  const own = await emp("POST", "/api/absences", { art: "urlaub", von: "2026-11-02", bis: "2026-11-06", status: "genehmigt" });
  assert.equal(own.status, 200);
  const b = (await emp("GET", "/api/bootstrap")).body;
  assert.ok(b.absences.every(a => a.mitarbeiterId === empId));
  assert.equal(b.absences[0].status, "beantragt", "Mitarbeiter kann sich Urlaub nicht selbst genehmigen");
  assert.ok(b.times.every(t => t.mitarbeiterId === empId));
  assert.equal(b.projects[0].gebucht, undefined);
  assert.deepEqual(b.users.map(u => u.id), [empId]);
  assert.equal(b.users[0].passwordHash, undefined);
});

test("Rechte erweitern: Kalender aller einsehen", async () => {
  const users = (await admin("GET", "/api/bootstrap")).body.users;
  const u = users.find(x => x.id === empId);
  const r = await admin("PUT", `/api/users/${empId}`, { ...u, roleId: null, permissions: ["times.book", "absences.request", "absences.view_all"] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = (await emp("GET", "/api/bootstrap")).body;
  assert.ok(b.absences.some(a => a.mitarbeiterId !== empId));
  assert.ok(b.times.every(t => t.mitarbeiterId === empId), "Stunden anderer bleiben verborgen");
  assert.equal(b.users.find(x => x.id !== empId).email, undefined, "Kontaktdaten nur mit employees.view");
});

test("Passwort ändern: eigenes mit altem Passwort, Admin setzt fremdes", async () => {
  assert.equal((await emp("POST", "/api/me/password", { current: "falsch", next: "neuesPasswort1" })).status, 400);
  assert.equal((await emp("POST", "/api/me/password", { current: "geheim123", next: "neuesPasswort1" })).status, 200);
  await login("max", "neuesPasswort1");
  const u = (await admin("GET", "/api/bootstrap")).body.users.find(x => x.id === empId);
  assert.equal((await admin("PUT", `/api/users/${empId}`, { ...u, password: "vomAdmin123" })).status, 200);
  await login("max", "vomAdmin123");
});

test("Der letzte aktive Admin kann nicht entfernt werden", async () => {
  const b = (await admin("GET", "/api/bootstrap")).body;
  const tom = b.users.find(x => x.username === "tomgerlitz");
  const hendrik = b.users.find(x => x.username === "hendrikwendker");
  assert.equal((await admin("PUT", `/api/users/${tom.id}`, { ...tom, status: "inaktiv" })).status, 200);
  const r = await admin("PUT", `/api/users/${hendrik.id}`, { ...hendrik, roleId: "role_mitarbeiter" });
  assert.equal(r.status, 400);
  const r2 = await admin("PUT", "/api/roles/role_admin", { name: "Administrator", isAdmin: false, permissions: [] });
  assert.equal(r2.status, 400);
  // Deaktivierter Admin ist abgemeldet und kann sich nicht anmelden
  assert.equal((await admin2("GET", "/api/bootstrap")).status, 401);
  assert.equal((await client()("POST", "/api/login", { username: "tomgerlitz", password: "Trustreels291?" })).status, 401);
  assert.equal((await admin("PUT", `/api/users/${tom.id}`, { ...tom, status: "aktiv" })).status, 200);
});

test("Statische Dateien werden ausgeliefert, Pfade außerhalb nicht", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Trustreels/);
  const bad = await fetch(base + "/..%2fserver.js");
  assert.notEqual(bad.status, 200);
});
