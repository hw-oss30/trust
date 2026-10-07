"use strict";
// Speicher für das Datenbank-Dokument.
// Lokal: JSON-Datei. Auf Vercel: Upstash Redis über die REST-API (keine Abhängigkeiten nötig).
// Beide liefern { data, rev } und speichern nur, wenn rev noch aktuell ist (Schutz vor gleichzeitigen Änderungen).

const fs = require("node:fs");
const path = require("node:path");

function fileStore(dir) {
  const file = path.join(dir, "db.json");
  let cache = null, rev = 0;
  return {
    kind: "file",
    async load() {
      if (cache === null) {
        fs.mkdirSync(dir, { recursive: true });
        cache = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      }
      return { data: cache ? JSON.parse(cache) : null, rev };
    },
    async save(data, expected) {
      if (expected !== rev) return false;
      const text = JSON.stringify(data, null, 1);
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, file);
      cache = text; rev++;
      return true;
    },
  };
}

const LOAD = "return {redis.call('GET', KEYS[1]), redis.call('GET', KEYS[2])}";
const SAVE = "if (redis.call('GET', KEYS[2]) or '0') == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]); redis.call('SET', KEYS[2], ARGV[3]); return 1 else return 0 end";

function redisStore(url, token, prefix = "trustreels") {
  const keys = [`${prefix}:db`, `${prefix}:rev`];
  async function cmd(args) {
    const res = await fetch(url.replace(/\/$/, ""), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) throw new Error(`Redis: ${out.error || res.status}`);
    return out.result;
  }
  return {
    kind: "redis",
    async load() {
      const [text, rev] = await cmd(["EVAL", LOAD, "2", ...keys]);
      return { data: text ? JSON.parse(text) : null, rev: rev || "0" };
    },
    async save(data, expected) {
      const next = String(Number(expected) + 1);
      return Number(await cmd(["EVAL", SAVE, "2", ...keys, String(expected), JSON.stringify(data), next])) === 1;
    },
  };
}

function createStore() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore(url, token, process.env.REDIS_PREFIX || "trustreels");
  // Auf Vercel ist das Dateisystem nicht dauerhaft – ohne Redis lieber klar abbrechen.
  if (process.env.VERCEL) return null;
  return fileStore(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
}

module.exports = { createStore, fileStore, redisStore };
