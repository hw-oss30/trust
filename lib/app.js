"use strict";
// Trustreels Personal – Anwendungskern ohne externe Abhängigkeiten.
// Läuft lokal über server.js und auf Vercel über api/index.js.
// Daten liegen als ein Dokument im Speicher aus lib/store.js (Datei oder Redis),
// Passwörter als scrypt-Hash, Sitzungen als HttpOnly-Cookie.
// Alle Rechte werden hier serverseitig geprüft; das Frontend blendet nur aus.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { createStore } = require("./store");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const SESSION_HOURS = 12;
const COOKIE = "tr_session";

// ---------- Rechte ----------
const PERMISSIONS = [
  { key: "times.book", label: "Eigene Stunden buchen", group: "Eigene Daten" },
  { key: "absences.request", label: "Eigene Abwesenheiten beantragen & Krankheit melden", group: "Eigene Daten" },
  { key: "employees.view", label: "Mitarbeiterliste mit Kontaktdaten einsehen", group: "Team" },
  { key: "absences.view_all", label: "Kalender: Abwesenheiten, Urlaub & Krankheit aller einsehen", group: "Team" },
  { key: "absences.manage", label: "Abwesenheiten aller eintragen, genehmigen & bearbeiten", group: "Team" },
  { key: "times.view_all", label: "Stunden aller Mitarbeiter einsehen", group: "Team" },
  { key: "times.manage", label: "Stunden für alle erfassen & bearbeiten", group: "Team" },
  { key: "projects.view", label: "Projektübersicht & Projektstand einsehen", group: "Projekte" },
  { key: "projects.manage", label: "Projekte anlegen & bearbeiten (Positionen, Stunden)", group: "Projekte" },
];
const PERM_KEYS = PERMISSIONS.map(p => p.key);
// Wer verwalten darf, darf auch sehen.
const IMPLIES = { "absences.manage": ["absences.view_all"], "times.manage": ["times.view_all"], "projects.manage": ["projects.view"] };

const ABS_TYPES = ["urlaub", "krank", "fortbildung", "dreh", "personalgespraech", "homeoffice", "sonstiges"];
const ABS_STATUS = ["beantragt", "genehmigt", "abgelehnt"];

// Erst-Admins (nur Hashes, keine Klartext-Passwörter im Code). Werden nur angelegt, wenn noch keine Benutzer existieren.
const SEED_ADMINS = [
  { username: "hendrikwendker", vorname: "Hendrik", nachname: "Wendker", passwordHash: "scrypt$16384$8$1$GKJqSWnp6/2RZg3WzrxRVQ==$+o3Kf4E5ZWfHSQTQN0nJf5RRVdEWXAcwPBSrPUWRtSX++y/INKp3Onxn0vgDZ86EAlzGJZ5/wWtwfdFfTxLN7Q==" },
  { username: "tomgerlitz", vorname: "Tom", nachname: "Gerlitz", passwordHash: "scrypt$16384$8$1$/6PfabvKfSB2S809xkXIng==$/Wpuqjen/UyiQPkD4K6sL52m84hwLt4pyneC5XkIeMb1ZomKai3JKt/qKUV9Yk3MDtykcAT4tmTvVpUHeIcMUA==" },
];

// ---------- Hilfen ----------
const uid = () => crypto.randomBytes(9).toString("base64url");
const nowIso = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}
function verifyPassword(pw, stored) {
  try {
    const [algo, N, r, p, salt, hash] = String(stored).split("$");
    if (algo !== "scrypt") return false;
    const expected = Buffer.from(hash, "base64");
    const got = crypto.scryptSync(String(pw), Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(expected, got);
  } catch { return false; }
}
// Gleiche Laufzeit auch bei unbekanntem Benutzernamen
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString("hex"));

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

const str = (v, max = 200) => (v == null ? "" : String(v)).trim().slice(0, max);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const optDate = (v, label) => { const s = str(v, 10); if (!s) return ""; if (!isDate(s)) fail(400, `${label}: ungültiges Datum.`); return s; };
const isTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
function num(v, { min = 0, max = 1e6, label = "Wert", allowEmpty = true } = {}) {
  if (v === "" || v == null) { if (allowEmpty) return null; fail(400, `${label} fehlt.`); }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) fail(400, `${label} muss zwischen ${min} und ${max} liegen.`);
  return Math.round(n * 100) / 100;
}

// ---------- Datenbank ----------
// Jede Anfrage lädt das Dokument frisch, arbeitet darauf und speichert es nur bei Änderungen (saveDb markiert das).
let db, dirty = false, store;
function emptyDb() { return { version: 1, users: [], roles: [], projects: [], times: [], absences: [], sessions: [], loginAttempts: {} }; }
function saveDb() { dirty = true; }

// Anfragen innerhalb einer Instanz nacheinander abarbeiten
let queue = Promise.resolve();
function exclusive(fn) { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; }

async function withDb(fn) {
  if (store === undefined) store = createStore();
  if (!store) fail(500, "Keine Datenbank verbunden. Bitte in Vercel Upstash Redis verbinden (siehe README).");
  // Hat eine andere Instanz zwischendurch gespeichert, wird die Anfrage mit frischen Daten wiederholt.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, rev } = await store.load();
    db = { ...emptyDb(), ...(data || {}) };
    dirty = false;
    seed();
    let result, error;
    try { result = await fn(); } catch (e) { error = e; }
    if (dirty && !(await store.save(db, rev))) continue;
    if (error) throw error;
    return result;
  }
  fail(503, "Gerade wird viel gleichzeitig gespeichert. Bitte erneut versuchen.");
}

function seed() {
  if (!db.roles.length) {
    dirty = true;
    db.roles.push(
      { id: "role_admin", name: "Administrator", isAdmin: true, permissions: [...PERM_KEYS] },
      { id: "role_mitarbeiter", name: "Mitarbeiter", isAdmin: false, permissions: ["times.book", "absences.request"] },
      { id: "role_projektleitung", name: "Projektleitung", isAdmin: false, permissions: ["times.book", "absences.request", "employees.view", "projects.view", "times.view_all", "absences.view_all"] },
    );
  }
  if (!db.users.length) {
    dirty = true;
    for (const a of SEED_ADMINS) {
      db.users.push({ id: uid(), username: a.username, passwordHash: a.passwordHash, roleId: "role_admin", isAdmin: false, permissions: [],
        vorname: a.vorname, nachname: a.nachname, position: "Geschäftsführung", abteilung: "Geschäftsführung", email: "", telefon: "",
        eintritt: "", austritt: "", stunden: 40, urlaub: 30, tage: [1, 2, 3, 4, 5], status: "aktiv", notiz: "", createdAt: nowIso() });
    }
  }
}

// ---------- Rechte auswerten ----------
const roleById = (id) => db.roles.find(r => r.id === id);
function effective(user) {
  const role = user.roleId ? roleById(user.roleId) : null;
  const isAdmin = role ? !!role.isAdmin : !!user.isAdmin;
  if (isAdmin) return { isAdmin: true, perms: new Set(PERM_KEYS) };
  const perms = new Set((role ? role.permissions : user.permissions || []).filter(k => PERM_KEYS.includes(k)));
  for (const [k, more] of Object.entries(IMPLIES)) if (perms.has(k)) more.forEach(m => perms.add(m));
  return { isAdmin: false, perms };
}
const activeAdminCount = () => db.users.filter(u => u.status !== "inaktiv" && effective(u).isAdmin).length;
const cleanPerms = (list) => [...new Set((Array.isArray(list) ? list : []).filter(k => PERM_KEYS.includes(k)))];

// Änderung ausführen; wenn danach kein aktiver Admin mehr existiert, alles zurückrollen.
function guardedMutation(fn) {
  const snapshot = JSON.stringify(db);
  const result = fn();
  if (activeAdminCount() === 0) { db = JSON.parse(snapshot); fail(400, "Es muss mindestens ein aktiver Administrator bestehen bleiben."); }
  return result;
}

// ---------- Sitzungen ----------
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(part => { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); });
  return out;
}
function isSecure(req) { return process.env.COOKIE_SECURE === "1" || req.headers["x-forwarded-proto"] === "https"; }
function setSessionCookie(req, res, token, maxAge) {
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isSecure(req) ? "; Secure" : ""}`);
}
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const h = sha256(token);
  const s = db.sessions.find(x => x.tokenHash === h);
  if (!s || s.expires < Date.now()) return null;
  const u = db.users.find(x => x.id === s.userId);
  if (!u || u.status === "inaktiv") return null;
  return { user: u, session: s, ...effective(u) };
}
function pruneSessions() { const n = Date.now(); db.sessions = db.sessions.filter(s => s.expires > n && db.users.some(u => u.id === s.userId && u.status !== "inaktiv")); }

// Bremse gegen Passwort-Raten: je IP+Benutzer und je Benutzer insgesamt, gespeichert in der Datenbank (gilt über alle Instanzen)
const WINDOW = 15 * 60e3;
function clientIp(req) {
  const fwd = process.env.VERCEL || process.env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return fwd || (req.socket && req.socket.remoteAddress) || "?";
}
function pruneAttempts() { const n = Date.now(); for (const [k, a] of Object.entries(db.loginAttempts)) if (n - a.first > WINDOW) delete db.loginAttempts[k]; }
function loginBlocked(keys) { return keys.some(([k, max]) => { const a = db.loginAttempts[k]; return a && a.count >= max && Date.now() - a.first < WINDOW; }); }
function loginFailed(keys) {
  for (const [k] of keys) { const a = db.loginAttempts[k]; if (!a || Date.now() - a.first > WINDOW) db.loginAttempts[k] = { count: 1, first: Date.now() }; else a.count++; }
  saveDb();
}

// ---------- Sichtbarkeit ----------
const PUBLIC_FIELDS = ["id", "vorname", "nachname", "position", "abteilung", "email", "telefon", "eintritt", "austritt", "stunden", "urlaub", "tage", "status"];
function userView(u, ctx) {
  const self = u.id === ctx.user.id;
  if (ctx.isAdmin) {
    const { passwordHash, ...rest } = u; const e = effective(u);
    return { ...rest, effectiveAdmin: e.isAdmin, effectivePermissions: [...e.perms] };
  }
  const out = {}; PUBLIC_FIELDS.forEach(k => out[k] = u[k]);
  if (self) { out.username = u.username; out.roleId = u.roleId; }
  else if (!ctx.perms.has("employees.view")) { delete out.email; delete out.telefon; delete out.eintritt; delete out.austritt; }
  return out;
}
function visibleUsers(ctx) {
  const seesOthers = ctx.isAdmin || ["employees.view", "absences.view_all", "times.view_all", "projects.view"].some(k => ctx.perms.has(k));
  return db.users.filter(u => seesOthers || u.id === ctx.user.id).map(u => userView(u, ctx));
}
function projectView(p, ctx) {
  const out = { ...p, positions: (p.positions || []).map(x => ({ ...x })) };
  if (ctx.perms.has("projects.view")) {
    out.positions.forEach(pos => { pos.gebucht = sum(db.times.filter(t => t.projektId === p.id && t.positionId === pos.id)); });
    out.gebucht = sum(db.times.filter(t => t.projektId === p.id));
  } else { delete out.notiz; }
  return out;
}
const sum = (arr) => Math.round(arr.reduce((s, t) => s + (Number(t.stunden) || 0), 0) * 100) / 100;

function bootstrap(ctx) {
  const me = ctx.user;
  const times = db.times.filter(t => ctx.perms.has("times.view_all") || t.mitarbeiterId === me.id);
  return {
    me: { ...userView(me, { ...ctx, isAdmin: false, perms: new Set() }), username: me.username, roleId: me.roleId, isAdmin: ctx.isAdmin, permissions: [...ctx.perms],
      roleName: me.roleId && roleById(me.roleId) ? roleById(me.roleId).name : "Individuell" },
    catalog: PERMISSIONS,
    users: visibleUsers(ctx),
    roles: ctx.isAdmin ? db.roles : [],
    projects: db.projects.filter(p => ctx.perms.has("projects.view") || p.status !== "abgeschlossen" || times.some(t => t.projektId === p.id)).map(p => projectView(p, ctx)),
    times,
    absences: db.absences.filter(a => ctx.perms.has("absences.view_all") || a.mitarbeiterId === me.id),
  };
}

// ---------- Validierung der Fachobjekte ----------
function readUserFields(b, existing) {
  const username = str(b.username, 60).toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(username)) fail(400, "Benutzername: 3–60 Zeichen, nur Buchstaben, Zahlen, Punkt, Minus, Unterstrich.");
  if (db.users.some(u => u.username === username && (!existing || u.id !== existing.id))) fail(400, "Dieser Benutzername ist schon vergeben.");
  const roleId = b.roleId ? str(b.roleId, 40) : null;
  if (roleId && !roleById(roleId)) fail(400, "Die gewählte Rolle existiert nicht.");
  const tage = (Array.isArray(b.tage) ? b.tage : [1, 2, 3, 4, 5]).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  if (!tage.length) fail(400, "Bitte mindestens einen Diensttag wählen.");
  const vorname = str(b.vorname, 80), nachname = str(b.nachname, 80);
  if (!vorname && !nachname) fail(400, "Bitte mindestens Vor- oder Nachnamen eintragen.");
  const eintritt = optDate(b.eintritt, "Eintritt"), austritt = optDate(b.austritt, "Austritt");
  if (eintritt && austritt && austritt < eintritt) fail(400, "Das Austrittsdatum liegt vor dem Eintrittsdatum.");
  return {
    username, roleId, isAdmin: roleId ? false : !!b.isAdmin, permissions: roleId ? [] : cleanPerms(b.permissions),
    vorname, nachname, position: str(b.position, 80), abteilung: str(b.abteilung, 80), email: str(b.email, 120), telefon: str(b.telefon, 60),
    eintritt, austritt, stunden: num(b.stunden, { max: 80, label: "Wochenstunden" }), urlaub: num(b.urlaub, { max: 80, label: "Urlaubstage" }) ?? 0,
    tage: [...new Set(tage)].sort(), status: b.status === "inaktiv" ? "inaktiv" : "aktiv", notiz: str(b.notiz, 2000),
  };
}
function checkPassword(pw) {
  if (typeof pw !== "string" || pw.length < 8) fail(400, "Das Passwort muss mindestens 8 Zeichen lang sein.");
  if (pw.length > 200) fail(400, "Das Passwort ist zu lang.");
  return pw;
}
function readRole(b, existing) {
  const name = str(b.name, 60);
  if (!name) fail(400, "Bitte einen Rollennamen eintragen.");
  if (db.roles.some(r => r.name.toLowerCase() === name.toLowerCase() && (!existing || r.id !== existing.id))) fail(400, "Eine Rolle mit diesem Namen gibt es schon.");
  return { name, isAdmin: !!b.isAdmin, permissions: b.isAdmin ? [...PERM_KEYS] : cleanPerms(b.permissions) };
}
function readProject(b, existing) {
  const name = str(b.name, 120);
  if (!name) fail(400, "Bitte einen Projektnamen eintragen.");
  const start = optDate(b.start, "Start"), ende = optDate(b.ende, "Ende");
  if (start && ende && ende < start) fail(400, "Das Ende liegt vor dem Start.");
  const raw = Array.isArray(b.positions) ? b.positions : [];
  if (raw.length > 50) fail(400, "Zu viele Positionen.");
  const positions = raw.map(x => ({ id: x.id && typeof x.id === "string" ? str(x.id, 40) : uid(), name: str(x.name, 60), stunden: num(x.stunden, { max: 100000, label: "Stunden je Position" }) ?? 0 }));
  if (positions.some(x => !x.name)) fail(400, "Jede Position braucht einen Namen.");
  const names = positions.map(x => x.name.toLowerCase());
  if (new Set(names).size !== names.length) fail(400, "Jede Position darf nur einmal vorkommen.");
  if (existing) {
    const keep = new Set(positions.map(x => x.id));
    const removed = (existing.positions || []).filter(x => !keep.has(x.id) && db.times.some(t => t.projektId === existing.id && t.positionId === x.id));
    if (removed.length) fail(400, `Auf ${removed.map(x => `„${x.name}“`).join(", ")} sind schon Stunden gebucht. Diese Position kann nicht entfernt werden.`);
  }
  return { name, kunde: str(b.kunde, 120), nummer: str(b.nummer, 60), status: b.status === "abgeschlossen" ? "abgeschlossen" : "aktiv",
    start, ende, farbe: Number.isInteger(b.farbe) && b.farbe >= 0 && b.farbe < 8 ? b.farbe : 0, notiz: str(b.notiz, 2000), positions };
}
function readTime(b, ctx, existing) {
  const mitarbeiterId = ctx.perms.has("times.manage") ? str(b.mitarbeiterId, 40) : ctx.user.id;
  if (!db.users.some(u => u.id === mitarbeiterId)) fail(400, "Mitarbeiter nicht gefunden.");
  const p = db.projects.find(x => x.id === b.projektId);
  if (!p) fail(400, "Projekt nicht gefunden.");
  if (p.status === "abgeschlossen" && (!existing || existing.projektId !== p.id)) fail(400, "Auf abgeschlossene Projekte kann nicht gebucht werden.");
  const pos = (p.positions || []).find(x => x.id === b.positionId);
  if (!pos) fail(400, "Bitte eine Position des Projekts wählen.");
  if (!isDate(b.datum)) fail(400, "Bitte ein gültiges Datum eintragen.");
  const von = isTime(b.von) ? b.von : "", bis = isTime(b.bis) ? b.bis : "";
  return { mitarbeiterId, projektId: p.id, positionId: pos.id, datum: b.datum, von, bis, pause: num(b.pause, { max: 1440, label: "Pause" }),
    stunden: num(b.stunden, { min: 0.01, max: 24, label: "Stunden", allowEmpty: false }), beschreibung: str(b.beschreibung, 500) };
}
function readAbsence(b, ctx) {
  const manage = ctx.perms.has("absences.manage");
  const mitarbeiterId = manage ? str(b.mitarbeiterId, 40) : ctx.user.id;
  if (!db.users.some(u => u.id === mitarbeiterId)) fail(400, "Mitarbeiter nicht gefunden.");
  const art = ABS_TYPES.includes(b.art) ? b.art : "sonstiges";
  if (!isDate(b.von) || !isDate(b.bis)) fail(400, "Bitte Von- und Bis-Datum eintragen.");
  if (b.bis < b.von) fail(400, "Das Bis-Datum liegt vor dem Von-Datum.");
  // Wer nicht verwaltet, beantragt. Krankmeldungen gelten direkt.
  const status = manage ? (ABS_STATUS.includes(b.status) ? b.status : "beantragt") : (art === "krank" ? "genehmigt" : "beantragt");
  return { mitarbeiterId, art, von: b.von, bis: b.bis, halberTag: !!b.halberTag, status, notiz: str(b.notiz, 500) };
}

// ---------- Routen ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), handler, opts });
const need = (ctx, perm) => { if (!ctx.isAdmin && !ctx.perms.has(perm)) fail(403, "Dafür fehlt dir die Berechtigung."); };
const needAdmin = (ctx) => { if (!ctx.isAdmin) fail(403, "Nur Administratoren dürfen das."); };
const findOr404 = (list, id, what) => { const x = list.find(e => e.id === id); if (!x) fail(404, `${what} nicht gefunden.`); return x; };

route("POST", "/api/login", (req, res, { body }) => {
  const username = str(body.username, 60).toLowerCase(), password = String(body.password ?? "");
  pruneAttempts();
  const keys = [[`ip|${clientIp(req)}|${username}`, 8], [`user|${username}`, 25]];
  if (loginBlocked(keys)) fail(429, "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.");
  const u = db.users.find(x => x.username === username);
  const ok = verifyPassword(password, u ? u.passwordHash : DUMMY_HASH) && u && u.status !== "inaktiv";
  if (!ok) { loginFailed(keys); fail(401, "Benutzername oder Passwort ist falsch."); }
  keys.forEach(([k]) => delete db.loginAttempts[k]);
  pruneSessions();
  const token = crypto.randomBytes(32).toString("base64url");
  db.sessions.push({ tokenHash: sha256(token), userId: u.id, expires: Date.now() + SESSION_HOURS * 3600e3 });
  u.lastLogin = nowIso();
  saveDb();
  setSessionCookie(req, res, token, SESSION_HOURS * 3600);
  return { ok: true };
}, { public: true });

route("POST", "/api/logout", (req, res, { ctx }) => {
  if (ctx) { db.sessions = db.sessions.filter(s => s !== ctx.session); saveDb(); }
  setSessionCookie(req, res, "", 0);
  return { ok: true };
}, { public: true });

route("GET", "/api/bootstrap", (req, res, { ctx }) => bootstrap(ctx));

route("POST", "/api/me/password", (req, res, { ctx, body }) => {
  if (!verifyPassword(String(body.current ?? ""), ctx.user.passwordHash)) fail(400, "Das aktuelle Passwort stimmt nicht.");
  ctx.user.passwordHash = hashPassword(checkPassword(body.next));
  // Andere Sitzungen dieses Benutzers beenden
  db.sessions = db.sessions.filter(s => s.userId !== ctx.user.id || s === ctx.session);
  saveDb();
  return { ok: true };
});

// Benutzer (nur Admin)
route("POST", "/api/users", (req, res, { ctx, body }) => {
  needAdmin(ctx);
  const fields = readUserFields(body, null);
  const u = { id: uid(), ...fields, passwordHash: hashPassword(checkPassword(body.password)), createdAt: nowIso() };
  db.users.push(u); saveDb();
  return { id: u.id };
});
route("PUT", "/api/users/:id", (req, res, { ctx, body, params }) => {
  needAdmin(ctx);
  const u = findOr404(db.users, params.id, "Benutzer");
  const fields = readUserFields(body, u);
  const newPw = body.password ? hashPassword(checkPassword(body.password)) : null;
  guardedMutation(() => {
    const target = db.users.find(x => x.id === u.id);
    Object.assign(target, fields);
    if (newPw) target.passwordHash = newPw;
  });
  // Bei Passwortwechsel oder Deaktivierung werden fremde Sitzungen beendet.
  if (newPw || fields.status === "inaktiv") db.sessions = db.sessions.filter(s => s.userId !== u.id || s === ctx.session);
  saveDb();
  return { ok: true };
});
route("DELETE", "/api/users/:id", (req, res, { ctx, params }) => {
  needAdmin(ctx);
  findOr404(db.users, params.id, "Benutzer");
  if (params.id === ctx.user.id) fail(400, "Du kannst dich nicht selbst löschen.");
  guardedMutation(() => {
    db.users = db.users.filter(u => u.id !== params.id);
    db.times = db.times.filter(t => t.mitarbeiterId !== params.id);
    db.absences = db.absences.filter(a => a.mitarbeiterId !== params.id);
    db.sessions = db.sessions.filter(s => s.userId !== params.id);
  });
  saveDb();
  return { ok: true };
});

// Rollen (nur Admin)
route("POST", "/api/roles", (req, res, { ctx, body }) => {
  needAdmin(ctx);
  const r = { id: "role_" + uid(), ...readRole(body, null) };
  db.roles.push(r); saveDb();
  return { id: r.id };
});
route("PUT", "/api/roles/:id", (req, res, { ctx, body, params }) => {
  needAdmin(ctx);
  const r = findOr404(db.roles, params.id, "Rolle");
  const fields = readRole(body, r);
  guardedMutation(() => Object.assign(db.roles.find(x => x.id === r.id), fields));
  saveDb();
  return { ok: true };
});
route("DELETE", "/api/roles/:id", (req, res, { ctx, params }) => {
  needAdmin(ctx);
  findOr404(db.roles, params.id, "Rolle");
  const n = db.users.filter(u => u.roleId === params.id).length;
  if (n) fail(400, `Die Rolle ist noch ${n} Benutzer${n > 1 ? "n" : ""} zugewiesen. Bitte zuerst eine andere Rolle zuweisen.`);
  db.roles = db.roles.filter(r => r.id !== params.id); saveDb();
  return { ok: true };
});

// Projekte
route("POST", "/api/projects", (req, res, { ctx, body }) => {
  need(ctx, "projects.manage");
  const p = { id: uid(), ...readProject(body, null), createdAt: nowIso() };
  db.projects.push(p); saveDb();
  return { id: p.id };
});
route("PUT", "/api/projects/:id", (req, res, { ctx, body, params }) => {
  need(ctx, "projects.manage");
  const p = findOr404(db.projects, params.id, "Projekt");
  Object.assign(p, readProject(body, p)); saveDb();
  return { ok: true };
});
route("DELETE", "/api/projects/:id", (req, res, { ctx, params }) => {
  need(ctx, "projects.manage");
  findOr404(db.projects, params.id, "Projekt");
  db.projects = db.projects.filter(p => p.id !== params.id);
  db.times = db.times.filter(t => t.projektId !== params.id);
  saveDb();
  return { ok: true };
});

// Zeiten
const mayEditTime = (ctx, t) => ctx.perms.has("times.manage") || (ctx.perms.has("times.book") && t.mitarbeiterId === ctx.user.id);
route("POST", "/api/times", (req, res, { ctx, body }) => {
  if (!ctx.perms.has("times.book") && !ctx.perms.has("times.manage")) fail(403, "Dafür fehlt dir die Berechtigung.");
  const t = { id: uid(), ...readTime(body, ctx, null), createdAt: nowIso() };
  db.times.push(t); saveDb();
  return { id: t.id };
});
route("PUT", "/api/times/:id", (req, res, { ctx, body, params }) => {
  const t = findOr404(db.times, params.id, "Eintrag");
  if (!mayEditTime(ctx, t)) fail(403, "Diesen Eintrag darfst du nicht ändern.");
  Object.assign(t, readTime(body, ctx, t)); saveDb();
  return { ok: true };
});
route("DELETE", "/api/times/:id", (req, res, { ctx, params }) => {
  const t = findOr404(db.times, params.id, "Eintrag");
  if (!mayEditTime(ctx, t)) fail(403, "Diesen Eintrag darfst du nicht löschen.");
  db.times = db.times.filter(x => x.id !== t.id); saveDb();
  return { ok: true };
});

// Abwesenheiten
const mayEditAbs = (ctx, a) => ctx.perms.has("absences.manage") || (ctx.perms.has("absences.request") && a.mitarbeiterId === ctx.user.id && a.status === "beantragt");
route("POST", "/api/absences", (req, res, { ctx, body }) => {
  if (!ctx.perms.has("absences.request") && !ctx.perms.has("absences.manage")) fail(403, "Dafür fehlt dir die Berechtigung.");
  const a = { id: uid(), ...readAbsence(body, ctx), createdAt: nowIso() };
  db.absences.push(a); saveDb();
  return { id: a.id };
});
route("PUT", "/api/absences/:id", (req, res, { ctx, body, params }) => {
  const a = findOr404(db.absences, params.id, "Eintrag");
  if (!mayEditAbs(ctx, a)) fail(403, "Diesen Eintrag darfst du nicht mehr ändern.");
  Object.assign(a, readAbsence(body, ctx)); saveDb();
  return { ok: true };
});
route("DELETE", "/api/absences/:id", (req, res, { ctx, params }) => {
  const a = findOr404(db.absences, params.id, "Eintrag");
  if (!mayEditAbs(ctx, a)) fail(403, "Diesen Eintrag darfst du nicht löschen.");
  db.absences = db.absences.filter(x => x.id !== a.id); saveDb();
  return { ok: true };
});

// ---------- HTTP ----------
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req) {
  // Vercel hat den Body ggf. schon gelesen und als req.body bereitgestellt
  if (req.body !== undefined) {
    const b = req.body;
    if (b && typeof b === "object" && !Buffer.isBuffer(b)) return Promise.resolve(b);
    try { const v = b ? JSON.parse(String(b)) : {}; return Promise.resolve(v && typeof v === "object" ? v : {}); }
    catch { return Promise.reject(new HttpError(400, "Ungültige Anfrage.")); }
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > 1e6) { reject(new HttpError(413, "Anfrage zu groß.")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8")); resolve(v && typeof v === "object" ? v : {}); }
      catch { reject(new HttpError(400, "Ungültige Anfrage.")); }
    });
    req.on("error", reject);
  });
}
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || !path.extname(rel)) rel = "/index.html";
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403, SECURITY_HEADERS); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" }); return res.end("Nicht gefunden"); }
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  let { pathname } = url;
  // Auf Vercel leitet vercel.json alle /api/...-Aufrufe an eine Funktion weiter und gibt den Pfad als __path mit.
  if (url.searchParams.has("__path")) pathname = "/api/" + url.searchParams.get("__path").replace(/^\/+/, "");
  if (!pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
    return serveStatic(req, res, pathname);
  }
  try {
    const r = routes.find(x => x.method === req.method && x.re.test(pathname));
    if (!r) fail(404, "Nicht gefunden.");
    // CSRF-Schutz: schreibende Anfragen nur mit eigenem Header (zusätzlich zu SameSite=Strict)
    if (req.method !== "GET" && req.headers["x-requested-with"] !== "trustreels") fail(403, "Ungültige Anfrage.");
    const body = req.method === "GET" ? {} : await readBody(req);
    const params = pathname.match(r.re).groups || {};
    const out = await exclusive(() => withDb(() => {
      const ctx = currentUser(req);
      if (!ctx && !r.opts.public) fail(401, "Bitte melde dich an.");
      return r.handler(req, res, { ctx, body, params });
    }));
    send(res, 200, out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: "Interner Fehler. Bitte erneut versuchen." });
  }
}

module.exports = { handle, hashPassword, verifyPassword };
