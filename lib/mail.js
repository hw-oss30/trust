"use strict";
// Schlanker SMTP-Versand ohne Abhängigkeiten (z. B. Strato: smtp.strato.de, Port 465 mit SSL).
// Port 465 = direkt verschlüsselt, sonst STARTTLS. Unverschlüsselt nur gegen localhost (Tests).

const net = require("node:net");
const tls = require("node:tls");
const crypto = require("node:crypto");

const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64");
const encWord = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const wrap = (s) => s.replace(/.{1,76}/g, "$&\r\n");
const cleanAddr = (a) => String(a || "").replace(/[\r\n<>]/g, "").trim();

function buildMessage({ from, fromName, to, subject, text }) {
  const domain = (from.split("@")[1] || "localhost").replace(/[^a-z0-9.-]/gi, "");
  const headers = [
    `From: ${fromName ? `${encWord(fromName)} ` : ""}<${from}>`,
    `To: <${to}>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + wrap(b64(text));
}

// Liest SMTP-Antworten (auch mehrzeilige "250-..."), auch nach dem Wechsel auf TLS.
class Conn {
  constructor(socket) { this.buf = ""; this.waiting = null; this.lines = []; this.attach(socket); }
  attach(socket) {
    if (this.socket) this.socket.removeAllListeners("data");
    this.socket = socket;
    socket.on("data", (d) => { this.buf += d.toString("utf8"); this.pump(); });
    socket.on("error", (e) => { if (this.waiting) { const w = this.waiting; this.waiting = null; w.reject(e); } this.error = e; });
  }
  pump() {
    let i;
    while ((i = this.buf.indexOf("\r\n")) >= 0) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2);
      this.lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const all = this.lines; this.lines = [];
        if (this.waiting) { const w = this.waiting; this.waiting = null; w.resolve({ code: Number(line.slice(0, 3)), text: all.join("\n") }); }
        else this.pending = { code: Number(line.slice(0, 3)), text: all.join("\n") };
      }
    }
  }
  read() {
    if (this.error) return Promise.reject(this.error);
    if (this.pending) { const p = this.pending; this.pending = null; return Promise.resolve(p); }
    return new Promise((resolve, reject) => { this.waiting = { resolve, reject }; });
  }
  async cmd(line, ok) {
    if (line !== null) this.socket.write(line + "\r\n");
    const r = await this.read();
    const codes = Array.isArray(ok) ? ok : [ok];
    if (!codes.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text.replace(/^\d{3}[ -]/gm, "").slice(0, 200)}`);
    return r;
  }
}

function connect(cfg) {
  return new Promise((resolve, reject) => {
    const port = Number(cfg.port) || 465;
    const opts = { host: cfg.host, port, servername: cfg.host };
    const s = port === 465 ? tls.connect(opts, () => resolve(s)) : net.connect(opts, () => resolve(s));
    s.once("error", reject);
  });
}

async function sendMail(cfg, msg, timeoutMs = 12000) {
  if (!cfg || !cfg.host || !cfg.from) throw new Error("E-Mail-Versand ist nicht eingerichtet.");
  const to = cleanAddr(msg.to), from = cleanAddr(cfg.from);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error(`Ungültige Empfängeradresse: ${to}`);
  const socket = await connect(cfg);
  const timer = setTimeout(() => socket.destroy(new Error("Zeitüberschreitung beim Mailserver.")), timeoutMs);
  try {
    const c = new Conn(socket);
    let secure = Number(cfg.port) === 465;
    await c.cmd(null, 220);
    let ehlo = await c.cmd("EHLO trustreels-personal", 250);
    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      await c.cmd("STARTTLS", 220);
      const tlsSock = await new Promise((resolve, reject) => { const t = tls.connect({ socket, servername: cfg.host }, () => resolve(t)); t.once("error", reject); });
      c.attach(tlsSock); secure = true;
      ehlo = await c.cmd("EHLO trustreels-personal", 250);
    }
    const local = ["localhost", "127.0.0.1", "::1"].includes(cfg.host);
    if (!secure && !local) throw new Error("Der Mailserver bietet keine Verschlüsselung an. Bitte Port 465 oder 587 verwenden.");
    if (cfg.user) await c.cmd("AUTH PLAIN " + b64(`\u0000${cfg.user}\u0000${cfg.pass || ""}`), 235);
    await c.cmd(`MAIL FROM:<${from}>`, 250);
    await c.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await c.cmd("DATA", 354);
    const body = buildMessage({ from, fromName: cfg.fromName || "Trustreels Personal", to, subject: msg.subject, text: msg.text });
    await c.cmd(body.replace(/\r\n\./g, "\r\n..") + "\r\n.", 250);
    c.socket.write("QUIT\r\n");
  } finally {
    clearTimeout(timer);
    setTimeout(() => socket.destroy(), 200).unref();
  }
}

module.exports = { sendMail, buildMessage };
