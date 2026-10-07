"use strict";
// Vercel-Funktion: alle /api/...-Aufrufe landen hier (siehe vercel.json).
const { handle } = require("../lib/app");

module.exports = (req, res) => handle(req, res);
