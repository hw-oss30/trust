"use strict";
// Lokaler Start: node server.js → http://localhost:3000 (Daten in data/db.json oder Redis, falls konfiguriert)
const http = require("node:http");
const { handle } = require("./lib/app");

function start(port = Number(process.env.PORT) || 3000) {
  const server = http.createServer((req, res) => { handle(req, res); });
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

if (require.main === module) {
  start().then(s => console.log(`Trustreels Personal läuft auf http://localhost:${s.address().port}`));
}
module.exports = { start };
