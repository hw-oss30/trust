"use strict";
// Tests für E-Mail-Benachrichtigungen (gegen einen nachgebauten SMTP-Server), Stoppuhr,
// Einstellungen, Stundensätze/Kosten und Arbeitszeit-Änderungen.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "trustreels-feat-"));
const { start } = require("../server.js");

// Minimaler SMTP-Server: nimmt Mails an und merkt sich Empfänger und Inhalt
const inbox = [];
let smtp, smtpPort;
function fakeSmtp() {
  return net.createServer(sock => {
    let mode = "cmd", data = "", mail = { to: [] };
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", chunk => {
      for (const line of chunk.toString().split("\r\n").slice(0, -1)) {
        if (mode === "data") {
          if (line === ".") { mode = "cmd"; mail.raw = data; inbox.push(mail); mail = { to: [] }; data = ""; sock.write("250 OK\r\n"); }
          else data += line + "\r\n";
          continue;
        }
        if (/^EHLO/.test(line)) sock.write("250-fake\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN/.test(line)) { mail.auth = Buffer.from(line.slice(11), "base64").toString(); sock.write("235 OK\r\n"); }
        else if (/^MAIL FROM/.test(line)) { mail.from = line; sock.write("250 OK\r\n"); }
        else if (/^RCPT TO:<(.+)>/.test(line)) { mail.to.push(line.match(/<(.+)>/)[1]); sock.write("250 OK\r\n"); }
        else if (line === "DATA") { mode = "data"; sock.write("354 go\r\n"); }
        else if (line === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 OK\r\n");
      }
    });
  });
}
const subjectOf = (m) => { const h = m.raw.match(/^Subject: (.*)$/m)[1]; const enc = h.match(/=\?UTF-8\?B\?(.+)\?=/); return enc ? Buffer.from(enc[1], "base64").toString() : h; };

let server, base;
before(async () => {
  smtp = fakeSmtp(); await new Promise(r => smtp.listen(0, r)); smtpPort = smtp.address().port;
  server = await start(0); base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); smtp.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

function client() {
  let cookie = "";
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json", "X-Requested-With": "trustreels", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}
async function login(u, p) { const c = client(); assert.equal((await c("POST", "/api/login", { username: u, password: p })).status, 200); return c; }

let admin, emp, empId, projId, posId;

test("Einstellungen: Standardwerte, nur Admin darf ändern, Passwort wird nie ausgeliefert", async () => {
  admin = await login("hendrikwendker", "Trustreels273$");
  const s = (await admin("GET", "/api/bootstrap")).body.settings;
  assert.equal(s.mail.empfaenger, "info@trustreels.de");
  assert.equal(s.urlaub.stichtag, "03-31");
  const r = await admin("PUT", "/api/settings", { mail: { aktiv: true, empfaenger: "chef@example.com", host: "localhost", port: smtpPort, user: "info@trustreels.de", pass: "geheim", from: "info@trustreels.de", antrag: true, krank: true, entscheidung: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = (await admin("GET", "/api/bootstrap")).body.settings.mail;
  assert.equal(after.pass, undefined);
  assert.equal(after.passGesetzt, true);
  const u = await admin("POST", "/api/users", { username: "lena", password: "geheim123", vorname: "Lena", email: "lena@example.com", roleId: "role_mitarbeiter" });
  empId = u.body.id;
  emp = await login("lena", "geheim123");
  assert.equal((await emp("PUT", "/api/settings", { kosten: { aktiv: true } })).status, 403);
  assert.equal((await emp("GET", "/api/bootstrap")).body.settings.mail, undefined, "Mail-Einstellungen nur für Admins");
});

test("Testmail kommt beim Mailserver an (mit Anmeldung)", async () => {
  const r = await admin("POST", "/api/settings/testmail");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = inbox.pop();
  assert.deepEqual(m.to, ["chef@example.com"]);
  assert.equal(m.auth, "\u0000info@trustreels.de\u0000geheim");
  assert.equal(subjectOf(m), "Testmail von Trustreels Personal");
});

test("Urlaubsantrag und Krankmeldung benachrichtigen die Admin-Adresse, Entscheidung den Mitarbeiter", async () => {
  inbox.length = 0;
  const a = await emp("POST", "/api/absences", { art: "urlaub", von: "2026-11-02", bis: "2026-11-06" });
  assert.equal(a.status, 200);
  assert.equal(inbox.length, 1);
  assert.deepEqual(inbox[0].to, ["chef@example.com"]);
  assert.match(subjectOf(inbox[0]), /Antrag: Urlaub von Lena \(02\.11\.2026 – 06\.11\.2026\)/);
  await emp("POST", "/api/absences", { art: "krank", von: "2026-10-07", bis: "2026-10-07" });
  assert.match(subjectOf(inbox[1]), /^Krankmeldung von Lena/);
  const abs = (await admin("GET", "/api/bootstrap")).body.absences.find(x => x.id === a.body.id);
  await admin("PUT", `/api/absences/${abs.id}`, { ...abs, status: "genehmigt" });
  assert.deepEqual(inbox[2].to, ["lena@example.com"]);
  assert.match(subjectOf(inbox[2]), /genehmigt/);
});

test("Stoppuhr: starten, stoppen, fortsetzen, verwerfen", async () => {
  const p = await admin("POST", "/api/projects", { name: "Reel", nummer: "TR-1", positions: [{ name: "Editor", stunden: 10, satz: 95 }] });
  projId = p.body.id;
  posId = (await admin("GET", "/api/bootstrap")).body.projects[0].positions[0].id;
  assert.equal((await emp("POST", "/api/me/timer", { action: "stop" })).status, 400);
  const s = await emp("POST", "/api/me/timer", { action: "start", projektId: projId, positionId: posId, beschreibung: "Schnitt" });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal((await emp("POST", "/api/me/timer", { action: "start", projektId: projId, positionId: posId })).status, 400, "läuft schon");
  assert.ok((await emp("GET", "/api/bootstrap")).body.me.timer.start);
  const stop = await emp("POST", "/api/me/timer", { action: "stop" });
  assert.ok(stop.body.timer.end);
  assert.ok(!(await emp("POST", "/api/me/timer", { action: "resume" })).body.timer.end);
  await emp("POST", "/api/me/timer", { action: "discard" });
  assert.equal((await emp("GET", "/api/bootstrap")).body.me.timer, null);
});

test("Stundensätze und Kosten nur bei aktivierter Option und nur für Projektverwaltung", async () => {
  const lena = (await admin("GET", "/api/bootstrap")).body.users.find(u => u.id === empId);
  await admin("PUT", `/api/users/${empId}`, { ...lena, kostensatz: 40 });
  await emp("POST", "/api/times", { projektId: projId, positionId: posId, datum: "2026-10-06", stunden: 2 });
  let p = (await admin("GET", "/api/bootstrap")).body.projects[0];
  assert.equal(p.wertIst, undefined, "ohne Option keine Euro-Werte");
  assert.equal(p.positions[0].satz, undefined);
  await admin("PUT", "/api/settings", { kosten: { aktiv: true } });
  p = (await admin("GET", "/api/bootstrap")).body.projects[0];
  assert.equal(p.positions[0].satz, 95);
  assert.equal(p.wertPlan, 950);
  assert.equal(p.wertIst, 190);
  assert.equal(p.kosten, 80);
  const pe = (await emp("GET", "/api/bootstrap")).body.projects[0];
  assert.equal(pe.positions[0].satz, undefined, "Mitarbeiter sehen keine Sätze");
  assert.equal((await emp("GET", "/api/bootstrap")).body.users[0].kostensatz, undefined);
  // Projekt bearbeiten ohne Satz-Feld behält den Satz
  await admin("PUT", `/api/projects/${projId}`, { name: "Reel", positions: [{ id: posId, name: "Editor", stunden: 12 }] });
  assert.equal((await admin("GET", "/api/bootstrap")).body.projects[0].positions[0].satz, 95);
});

test("Arbeitszeit-Änderungen und manueller Urlaubsübertrag werden gespeichert und geprüft", async () => {
  const lena = (await admin("GET", "/api/bootstrap")).body.users.find(u => u.id === empId);
  const bad = await admin("PUT", `/api/users/${empId}`, { ...lena, arbeitszeiten: [{ ab: "2026-13-01", stunden: 20, tage: [1, 2] }] });
  assert.equal(bad.status, 400);
  const ok = await admin("PUT", `/api/users/${empId}`, { ...lena, arbeitszeiten: [{ ab: "2026-11-01", stunden: 20, tage: [1, 2, 3] }], urlaubUebertragJahr: 2026, urlaubUebertragWert: 4.5 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const own = (await emp("GET", "/api/bootstrap")).body.users[0];
  assert.deepEqual(own.arbeitszeiten, [{ ab: "2026-11-01", stunden: 20, tage: [1, 2, 3] }]);
  assert.deepEqual(own.urlaubUebertrag, { 2026: 4.5 });
  const s = await admin("PUT", "/api/settings", { urlaub: { uebertrag: true, stichtag: "03-31", max: 10 } });
  assert.equal(s.status, 200);
  assert.equal((await admin("PUT", "/api/settings", { urlaub: { uebertrag: true, stichtag: "31.03" } })).status, 400);
});
