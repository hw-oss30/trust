"use strict";
// Trustreels Personal – Oberfläche. Aufbau und Optik nach der Teamkartei-Vorlage.
// Daten kommen vom Server (/api/bootstrap) und enthalten nur, was der angemeldete Benutzer sehen darf.
(() => {
  // ---------- Grundlagen ----------
  const TYPES = {
    urlaub: { label: "Urlaub", color: "var(--t-urlaub)" },
    krank: { label: "Krankheit", color: "var(--t-krank)" },
    fortbildung: { label: "Fortbildung", color: "var(--t-fort)" },
    dreh: { label: "Dreh", color: "var(--t-dreh)" },
    personalgespraech: { label: "Personalgespräch", color: "var(--t-gespr)" },
    homeoffice: { label: "Homeoffice", color: "var(--t-ho)" },
    sonstiges: { label: "Sonstiges", color: "var(--t-sonst)" },
  };
  const STATUS = {
    beantragt: { label: "Beantragt", cls: "warn" },
    genehmigt: { label: "Genehmigt", cls: "ok" },
    abgelehnt: { label: "Abgelehnt", cls: "bad" },
  };
  const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  const WD = ["So","Mo","Di","Mi","Do","Fr","Sa"];
  const PCOL = ["#0a84ff", "#ff9f0a", "#30b0c7", "#af52de", "#34c759", "#ff375f", "#5e5ce6", "#a2845e"];
  const PCOL_NAMES = ["Blau", "Orange", "Türkis", "Lila", "Grün", "Pink", "Indigo", "Braun"];
  const POS_SUGGEST = ["Kameramann", "Editor", "Cutter", "Regie", "Producer", "Projektleitung", "Motion Designer", "Colorist", "Tonmeister", "Drohnenpilot", "Kamera-Assistenz", "Sprecher"];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const de = (s) => { if (!s) return "–"; const d = parse(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const deShort = (s) => { const d = parse(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
  const fmtDays = (n) => (Math.round(n * 2) / 2).toLocaleString("de-DE");
  const fmtH = (n) => (Math.round(n * 100) / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });
  const todayIso = () => iso(new Date());
  const sumH = (arr) => arr.reduce((s, x) => s + (Number(x.stunden) || 0), 0);
  const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

  // Gesetzliche Feiertage NRW
  const holCache = {};
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mo - 1, da);
  }
  function holidays(y) {
    if (holCache[y]) return holCache[y];
    const e = easter(y), add = (n) => { const d = new Date(e); d.setDate(d.getDate() + n); return iso(d); };
    return (holCache[y] = {
      [`${y}-01-01`]: "Neujahr", [add(-2)]: "Karfreitag", [add(1)]: "Ostermontag", [`${y}-05-01`]: "Tag der Arbeit",
      [add(39)]: "Christi Himmelfahrt", [add(50)]: "Pfingstmontag", [add(60)]: "Fronleichnam",
      [`${y}-10-03`]: "Tag der Deutschen Einheit", [`${y}-11-01`]: "Allerheiligen",
      [`${y}-12-25`]: "1. Weihnachtstag", [`${y}-12-26`]: "2. Weihnachtstag",
    });
  }
  const holidayName = (s) => holidays(parse(s).getFullYear())[s];
  const isWorkday = (d) => { const w = d.getDay(); return w !== 0 && w !== 6 && !holidayName(iso(d)); };
  const ALL_WD = [1, 2, 3, 4, 5];
  const empDays = (e) => Array.isArray(e && e.tage) && e.tage.length ? e.tage.map(Number) : ALL_WD;

  function workdays(a, year) {
    if (!a.von || !a.bis) return 0;
    let d = parse(a.von); const end = parse(a.bis); let n = 0;
    const days = empDays(empById(a.mitarbeiterId));
    while (d <= end) {
      if ((year == null || d.getFullYear() === year) && isWorkday(d) && days.includes(d.getDay())) n++;
      d.setDate(d.getDate() + 1);
    }
    if (a.halberTag && n > 0) n -= 0.5;
    return n;
  }

  // ---------- Zustand ----------
  let data = null;
  const ui = {
    tab: store.get("tr-tab") || "overview", unit: store.get("tr-unit") === "h" ? "h" : "pct", calMode: store.get("tr-calmode") === "time" ? "time" : "abs",
    calProj: "", projSel: null, year: new Date().getFullYear(), calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  };

  const me = () => data.me;
  const isAdmin = () => !!data.me.isAdmin;
  const can = (p) => isAdmin() || data.me.permissions.includes(p);
  const empById = (id) => data.users.find(e => e.id === id) || (data.me.id === id ? data.me : null);
  const projById = (id) => data.projects.find(p => p.id === id);
  const posById = (p, id) => p && (p.positions || []).find(x => x.id === id);
  const roleById = (id) => data.roles.find(r => r.id === id);
  const fullName = (e) => e ? `${e.vorname || ""} ${e.nachname || ""}`.trim() || e.username || "Ohne Namen" : "Gelöschter Eintrag";
  const initials = (e) => ((e.vorname || "")[0] || "") + ((e.nachname || "")[0] || "") || (e.username || "?")[0];
  const sortEmp = (a, b) => (a.nachname || "").localeCompare(b.nachname || "", "de") || (a.vorname || "").localeCompare(b.vorname || "", "de");
  const activeEmps = () => data.users.filter(e => e.status !== "inaktiv").sort(sortEmp);
  const typePill = (art) => { const t = TYPES[art] || TYPES.sonstiges; return `<span class="type"><span class="dot" style="background:${t.color}"></span>${t.label}</span>`; };
  const statusPill = (s) => { const t = STATUS[s] || STATUS.beantragt; return `<span class="pill ${t.cls}">${t.label}</span>`; };
  const range = (a) => a.von === a.bis ? de(a.von) : `${de(a.von)} – ${de(a.bis)}`;
  const overlapsYear = (a, y) => a.von <= `${y}-12-31` && a.bis >= `${y}-01-01`;
  const projColor = (p) => p ? PCOL[(Number.isInteger(p.farbe) ? p.farbe : 0) % PCOL.length] : "var(--muted)";
  const sortedProjects = (all) => data.projects.filter(p => all || p.status !== "abgeschlossen")
    .sort((a, b) => (a.status === "abgeschlossen") - (b.status === "abgeschlossen") || (a.name || "").localeCompare(b.name || "", "de"));
  const budgetOf = (p) => (p.positions || []).reduce((s, x) => s + (Number(x.stunden) || 0), 0);
  const mayEditTime = (t) => can("times.manage") || (can("times.book") && t.mitarbeiterId === me().id);
  const mayEditAbs = (a) => can("absences.manage") || (can("absences.request") && a.mitarbeiterId === me().id && a.status === "beantragt");

  // Fortschritt: grün bis 79 %, gelb ab 80 %, rot über 100 %
  function progCls(booked, budget) { if (!budget) return booked ? "bad" : "none"; const r = booked / budget; return r > 1 ? "bad" : r >= 0.8 ? "warn" : "ok"; }
  function progText(booked, budget, unit = ui.unit) {
    if (unit === "h") return `${fmtH(booked)} / ${fmtH(budget)} h`;
    return budget ? `${Math.round(booked / budget * 100)} %` : "–";
  }
  const progTitle = (booked, budget) => `${fmtH(booked)} h von ${fmtH(budget)} h gebucht` + (budget ? ` (${Math.round(booked / budget * 100)} %)` : "");
  const progBar = (booked, budget, cls) => `<div class="bar" title="${esc(progTitle(booked, budget))}"><span class="${cls || progCls(booked, budget)}" style="width:${budget ? Math.min(booked / budget, 1) * 100 : booked ? 100 : 0}%"></span></div>`;

  // ---------- Server ----------
  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Requested-With": "trustreels" }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new Error("Keine Verbindung zum Server."); }
    let out = {}; try { out = await res.json(); } catch (e) {}
    if (res.status === 401 && url !== "/api/login") { if (data) showLogin("Deine Sitzung ist abgelaufen. Bitte melde dich erneut an."); throw new Error(out.error || "Bitte melde dich an."); }
    if (!res.ok) throw new Error(out.error || "Das hat nicht geklappt. Bitte erneut versuchen.");
    return out;
  }
  async function refresh() { data = await api("GET", "/api/bootstrap"); render(); }

  function toast(msg) {
    const root = $("#toast-root");
    root.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
    clearTimeout(toast.t); toast.t = setTimeout(() => root.innerHTML = "", 2600);
  }

  // ---------- Login ----------
  function showLogin(msg) {
    data = null; closeDrawer();
    $("#app").hidden = true; $("#login").hidden = false;
    const err = $("#l-err"); err.hidden = !msg; err.textContent = msg || "";
    $("#l-pass").value = "";
    setTimeout(() => ($("#l-user").value ? $("#l-pass") : $("#l-user")).focus(), 0);
  }
  $("#f-login").onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $("#l-err"), btn = ev.submitter; err.hidden = true;
    const username = $("#l-user").value.trim(), password = $("#l-pass").value;
    if (!username || !password) { err.textContent = "Bitte Benutzername und Passwort eingeben."; err.hidden = false; return; }
    if (btn) btn.disabled = true;
    try { await api("POST", "/api/login", { username, password }); await enterApp(); }
    catch (e) { err.textContent = e.message; err.hidden = false; $("#l-pass").select(); }
    finally { if (btn) btn.disabled = false; }
  };
  async function enterApp() {
    await refresh();
    $("#login").hidden = true; $("#app").hidden = false;
  }
  $("#btn-logout").onclick = async () => { try { await api("POST", "/api/logout"); } catch (e) {} showLogin(); };

  // ---------- Navigation ----------
  function tabs() {
    return [
      { id: "overview", label: "Übersicht", show: true },
      { id: "projects", label: "Projekte", show: can("projects.view") },
      { id: "time", label: can("times.view_all") ? "Zeiterfassung" : "Meine Stunden", show: can("times.book") || can("times.view_all") },
      { id: "absences", label: can("absences.view_all") ? "Abwesenheiten" : "Meine Abwesenheiten", show: can("absences.request") || can("absences.view_all") },
      { id: "calendar", label: "Kalender", show: true },
      { id: "team", label: isAdmin() ? "Benutzer & Rollen" : "Mitarbeiter", show: isAdmin() || can("employees.view") },
    ].filter(t => t.show);
  }
  function setTab(t) { ui.tab = t; store.set("tr-tab", t); render(); window.scrollTo({ top: 0 }); }

  function render() {
    if (!data) return;
    const list = tabs();
    if (!list.some(t => t.id === ui.tab)) ui.tab = "overview";
    $("#tabs").innerHTML = list.map(t => `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === ui.tab}">${esc(t.label)}</button>`).join("");
    $$("#tabs button").forEach(b => b.onclick = () => setTab(b.dataset.tab));
    ["overview", "projects", "time", "absences", "calendar", "team"].forEach(v => $("#v-" + v).hidden = v !== ui.tab);
    $("#me-avatar").textContent = initials(me()).toUpperCase();
    $("#me-name").textContent = fullName(me());
    $("#me-role").textContent = isAdmin() ? "Administrator" : me().roleName;
    $("#btn-add-time").hidden = !(can("times.book") || can("times.manage"));
    $("#btn-add-abs").hidden = !(can("absences.request") || can("absences.manage"));
    $("#btn-add-abs").textContent = can("absences.manage") ? "Abwesenheit eintragen" : "Abwesenheit beantragen";
    $$(".unit-seg button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.unit === ui.unit)));
    ({ overview: renderOverview, projects: renderProjects, time: renderTime, absences: renderAbsences, calendar: renderCalendar, team: renderTeam })[ui.tab]();
  }

  // ---------- Übersicht ----------
  function vacationFor(e, y) {
    let taken = 0, planned = 0, sick = 0;
    data.absences.forEach(a => {
      if (a.mitarbeiterId !== e.id || !overlapsYear(a, y) || a.status === "abgelehnt") return;
      const n = workdays(a, y);
      if (a.art === "krank") sick += n;
      if (a.art !== "urlaub") return;
      if (a.status === "genehmigt") taken += n; else planned += n;
    });
    const anspruch = Number(e.urlaub) || 0;
    return { anspruch, taken, planned, sick, rest: anspruch - taken - planned };
  }
  function weekStart(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); }

  function projCard(p) {
    const budget = budgetOf(p), booked = Number(p.gebucht) || 0, cls = progCls(booked, budget);
    return `<div class="proj" role="button" tabindex="0" aria-pressed="${ui.tab === "projects" && p.id === ui.projSel}" data-proj="${esc(p.id)}">
      <div class="proj-top"><div style="min-width:0"><div class="proj-name"><span class="dot" style="background:${projColor(p)};margin-right:8px"></span>${esc(p.name || "Ohne Namen")}</div><div class="muted" style="font-size:.84rem">${esc([p.kunde, p.nummer].filter(Boolean).join(" · ") || "Ohne Kunde")}</div></div>
        ${p.status === "abgeschlossen" ? `<span class="pill neutral">Abgeschlossen</span>` : ""}</div>
      <div class="proj-big"><span class="pct big ${cls}" title="${esc(progTitle(booked, budget))}">${progText(booked, budget)}</span><span class="muted" style="font-size:.82rem">${ui.unit === "pct" ? `${fmtH(booked)} / ${fmtH(budget)} h` : budget ? `${Math.round(booked / budget * 100)} %` : ""}</span></div>
      ${progBar(booked, budget, cls)}
      <div class="pos-list">${(p.positions || []).map(x => { const b = Number(x.gebucht) || 0, s = Number(x.stunden) || 0, c = progCls(b, s); return `<div class="pos-row"><span>${esc(x.name)}</span><span class="val pct ${c}">${progText(b, s)}</span>${progBar(b, s, c)}</div>`; }).join("") || `<span class="muted" style="font-size:.84rem">Keine Positionen festgelegt.</span>`}</div>
    </div>`;
  }
  function bindProjCards(root) {
    $$("[data-proj]", root).forEach(el => {
      const go = () => { ui.projSel = el.dataset.proj; if (ui.tab !== "projects") setTab("projects"); else renderProjects(); };
      el.onclick = go; el.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } };
    });
  }
  function unitSeg() { return `<div class="seg unit-seg" role="group" aria-label="Anzeige"><button data-unit="pct" aria-selected="${ui.unit === "pct"}">Prozent</button><button data-unit="h" aria-selected="${ui.unit === "h"}">Stunden</button></div>`; }

  function renderOverview() {
    const v = $("#v-overview"); const t = todayIso(); const td = new Date(); const y = ui.year;
    const mine = data.times.filter(x => x.mitarbeiterId === me().id);
    const ws = weekStart(td), month = t.slice(0, 7);
    const weekH = sumH(mine.filter(x => x.datum >= ws && x.datum <= t)), monthH = sumH(mine.filter(x => x.datum.startsWith(month)));
    const vac = vacationFor(me(), y);
    const stats = [];
    if (can("projects.view")) {
      const act = data.projects.filter(p => p.status !== "abgeschlossen");
      const bk = act.reduce((s, p) => s + (Number(p.gebucht) || 0), 0), bu = act.reduce((s, p) => s + budgetOf(p), 0);
      stats.push({ k: "Laufende Projekte", v: act.length, s: `${fmtH(bk)} von ${fmtH(bu)} h gebucht` });
    }
    let awayToday = [], open = [];
    if (can("absences.view_all")) {
      awayToday = data.absences.filter(a => a.status === "genehmigt" && a.von <= t && a.bis >= t && empById(a.mitarbeiterId));
      open = data.absences.filter(a => a.status === "beantragt").sort((a, b) => a.von.localeCompare(b.von));
      stats.push({ k: "Heute nicht im Büro", v: awayToday.length, s: `${Math.max(activeEmps().length - awayToday.length, 0)} anwesend` });
      stats.push({ k: "Offene Anträge", v: open.length, s: open.length ? "warten auf Entscheidung" : "nichts offen" });
    }
    if (can("times.book")) stats.push({ k: "Meine Stunden diese Woche", v: fmtH(weekH), s: `${fmtH(monthH)} h im ${MONTHS[td.getMonth()]}` });
    if (can("absences.request")) stats.push({ k: `Mein Resturlaub ${y}`, v: fmtDays(vac.rest), s: `von ${fmtDays(vac.anspruch)} Tagen · ${fmtDays(vac.planned)} beantragt` });

    const myNext = data.absences.filter(a => a.mitarbeiterId === me().id && a.bis >= t && a.status !== "abgelehnt").sort((a, b) => a.von.localeCompare(b.von)).slice(0, 5);
    const myLast = [...mine].sort((a, b) => b.datum.localeCompare(a.datum) || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 6);
    const projs = sortedProjects(false);

    v.innerHTML = `
      <div class="toolbar"><div><span class="eyebrow">${WD[td.getDay()]}, ${de(t)}${holidayName(t) ? " · " + esc(holidayName(t)) : ""}</span><h2 style="font-size:1.5rem">Moin, ${esc(me().vorname || me().username)}!</h2></div></div>
      ${stats.length ? `<div class="stats">${stats.map(x => `<div class="stat"><span class="eyebrow">${esc(x.k)}</span><span class="big">${x.v}</span><span class="sub">${esc(x.s)}</span></div>`).join("")}</div>` : ""}
      ${can("projects.view") ? `<div class="panel">
        <div class="panel-head"><h2>Projektstand</h2><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${unitSeg()}${can("projects.manage") ? `<button class="small" id="ov-add-proj">Projekt anlegen</button>` : ""}</div></div>
        <div class="legend"><span><span class="dot" style="background:var(--ok)"></span>unter 80 %</span><span><span class="dot" style="background:var(--warn)"></span>80–100 %</span><span><span class="dot" style="background:var(--bad)"></span>über Budget</span></div>
        ${projs.length ? `<div class="projects">${projs.map(projCard).join("")}</div>` : `<div class="empty">Noch keine laufenden Projekte.${can("projects.manage") ? " Lege über „Projekt anlegen“ das erste an." : ""}</div>`}
      </div>` : ""}
      <div class="grid2">
        <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
          ${can("absences.view_all") ? `<div class="panel"><div class="panel-head"><h2>Offene Anträge</h2><span class="pill warn">${open.length}</span></div><div class="list" id="ov-open">${open.length ? open.map(a => `<div class="list-row"><div class="who"><span class="name">${esc(fullName(empById(a.mitarbeiterId)))}</span><span class="muted" style="font-size:.85rem">${typePill(a.art)} · ${range(a)} · <span class="num">${fmtDays(workdays(a))}</span> Tg.</span></div>
            ${can("absences.manage") ? `<div style="display:flex;gap:6px"><button class="small" data-approve="${esc(a.id)}">Genehmigen</button><button class="small ghost danger" data-reject="${esc(a.id)}">Ablehnen</button></div>` : ""}</div>`).join("") : `<div class="muted" style="font-size:.9rem">Keine offenen Anträge.</div>`}</div></div>` : ""}
          ${can("times.book") ? `<div class="panel"><div class="panel-head"><h2>Meine letzten Buchungen</h2>${can("times.book") ? `<button class="small primary" id="ov-add-time">Zeit erfassen</button>` : ""}</div><div class="list">${myLast.length ? myLast.map(x => { const p = projById(x.projektId); return `<div class="list-row click" data-time="${esc(x.id)}" style="cursor:pointer"><div class="who"><span class="type"><span class="dot" style="background:${projColor(p)}"></span>${esc(p ? p.name : "Gelöschtes Projekt")}${posById(p, x.positionId) ? ` · <span class="muted">${esc(posById(p, x.positionId).name)}</span>` : ""}</span><span class="muted" style="font-size:.84rem">${WD[parse(x.datum).getDay()]}, ${de(x.datum)}${x.beschreibung ? " · " + esc(x.beschreibung) : ""}</span></div><strong>${fmtH(Number(x.stunden) || 0)} h</strong></div>`; }).join("") : `<div class="muted" style="font-size:.9rem">Noch keine Stunden gebucht.</div>`}</div></div>` : ""}
        </div>
        <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
          ${can("absences.view_all") ? `<div class="panel"><div class="panel-head"><h2>Heute nicht im Büro</h2></div><div class="list">${awayToday.length ? awayToday.map(a => `<div class="list-row"><div class="who"><span class="name">${esc(fullName(empById(a.mitarbeiterId)))}</span><span class="muted" style="font-size:.85rem">bis ${de(a.bis)}</span></div>${typePill(a.art)}</div>`).join("") : `<div class="muted" style="font-size:.9rem">Alle da.</div>`}</div></div>` : ""}
          <div class="panel"><div class="panel-head"><h2>Meine nächsten Abwesenheiten</h2></div><div class="list">${myNext.length ? myNext.map(a => `<div class="list-row"><div class="who"><span class="name">${typePill(a.art)}</span><span class="muted" style="font-size:.85rem">${range(a)}</span></div>${statusPill(a.status)}</div>`).join("") : `<div class="muted" style="font-size:.9rem">Nichts geplant.</div>`}</div></div>
        </div>
      </div>`;
    bindProjCards(v); bindUnitSeg(v); bindDecisions(v);
    const ap = $("#ov-add-proj"); if (ap) ap.onclick = () => openProj(null);
    const at = $("#ov-add-time"); if (at) at.onclick = () => openTime(null);
    $$("[data-time]", v).forEach(r => r.onclick = () => openTime(data.times.find(x => x.id === r.dataset.time)));
  }
  function bindUnitSeg(root) {
    $$(".unit-seg button", root).forEach(b => b.onclick = () => { ui.unit = b.dataset.unit; store.set("tr-unit", ui.unit); render(); });
  }
  function bindDecisions(root) {
    $$("[data-approve],[data-reject]", root).forEach(b => b.onclick = async (ev) => {
      ev.stopPropagation();
      const id = b.dataset.approve || b.dataset.reject; const a = data.absences.find(x => x.id === id); if (!a) return;
      b.disabled = true;
      try { await api("PUT", `/api/absences/${a.id}`, { ...a, status: b.dataset.approve ? "genehmigt" : "abgelehnt" }); await refresh(); toast(b.dataset.approve ? "Genehmigt" : "Abgelehnt"); }
      catch (e) { toast(e.message); b.disabled = false; }
    });
  }

  // ---------- Projekte ----------
  function renderProjects() {
    const st = $("#pj-status").value;
    const all = sortedProjects(true);
    const projs = all.filter(p => !st || (p.status || "aktiv") === st);
    if (!projs.some(p => p.id === ui.projSel)) ui.projSel = (projs[0] || {}).id || null;
    $("#btn-add-proj").hidden = !can("projects.manage");
    const box = $("#pj-list");
    box.innerHTML = projs.length ? projs.map(projCard).join("") : `<div class="panel empty">${all.length ? "Keine Projekte mit diesem Status." : "Noch keine Projekte." + (can("projects.manage") ? " Lege über „Projekt anlegen“ das erste an." : "")}</div>`;
    bindProjCards(box); bindUnitSeg($("#v-projects"));

    const rep = $("#pj-report"); const p = projById(ui.projSel);
    if (!p) { rep.hidden = true; return; }
    rep.hidden = false;
    const budget = budgetOf(p), booked = Number(p.gebucht) || 0, rest = budget - booked, cls = progCls(booked, budget);
    const tms = data.times.filter(t => t.projektId === p.id);
    const seeAll = can("times.view_all");
    const byEmp = {};
    tms.forEach(t => { const k = t.mitarbeiterId; (byEmp[k] = byEmp[k] || { total: 0, pos: {} }).total += Number(t.stunden) || 0; byEmp[k].pos[t.positionId] = (byEmp[k].pos[t.positionId] || 0) + (Number(t.stunden) || 0); });
    const empRows = Object.entries(byEmp).sort((a, b) => b[1].total - a[1].total);
    rep.innerHTML = `
      <div class="panel-head">
        <div style="min-width:0"><span class="eyebrow">Projektstand</span><h2><span class="dot" style="background:${projColor(p)};margin-right:8px;vertical-align:2px"></span>${esc(p.name || "Ohne Namen")}</h2>
          <div class="muted" style="font-size:.88rem">${esc([p.kunde, p.nummer, p.start || p.ende ? `${de(p.start)} – ${de(p.ende)}` : ""].filter(Boolean).join(" · "))}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${can("projects.manage") ? `<button class="small" id="rep-edit">Projekt bearbeiten</button>` : ""}
          ${(can("times.book") || can("times.manage")) && p.status !== "abgeschlossen" ? `<button class="small primary" id="rep-add">Zeit buchen</button>` : ""}
        </div>
      </div>
      <div class="minis">
        <div class="mini"><span class="k">Fortschritt</span><span class="v pct ${cls}">${budget ? Math.round(booked / budget * 100) + " %" : "–"}</span></div>
        <div class="mini"><span class="k">Gebucht</span><span class="v">${fmtH(booked)} h</span></div>
        <div class="mini"><span class="k">Geplant</span><span class="v">${fmtH(budget)} h</span></div>
        <div class="mini"><span class="k">Rest</span><span class="v ${rest < 0 ? "diff-under" : ""}">${fmtH(rest)} h</span></div>
      </div>
      <div class="subhead">Nach Position</div>
      <div class="tablebox"><table><thead><tr><th>Position</th><th class="num">Geplant</th><th class="num">Gebucht</th><th class="num">Rest</th><th class="num">Fortschritt</th><th style="width:26%"></th></tr></thead><tbody>
        ${(p.positions || []).length ? p.positions.map(x => { const b = Number(x.gebucht) || 0, s = Number(x.stunden) || 0, c = progCls(b, s); return `<tr><td class="name">${esc(x.name)}</td><td class="num">${fmtH(s)} h</td><td class="num"><strong>${fmtH(b)} h</strong></td><td class="num ${s - b < 0 ? "diff-under" : ""}">${fmtH(s - b)} h</td><td class="num"><span class="pct ${c}">${s ? Math.round(b / s * 100) + " %" : "–"}</span></td><td>${progBar(b, s, c)}</td></tr>`; }).join("") : `<tr><td colspan="6" class="empty">Für dieses Projekt sind noch keine Positionen festgelegt.</td></tr>`}
      </tbody>${(p.positions || []).length > 1 ? `<tfoot><tr><td class="name">Summe</td><td class="num">${fmtH(budget)} h</td><td class="num"><strong>${fmtH(booked)} h</strong></td><td class="num">${fmtH(rest)} h</td><td class="num"><span class="pct ${cls}">${budget ? Math.round(booked / budget * 100) + " %" : "–"}</span></td><td></td></tr></tfoot>` : ""}</table></div>
      ${p.notiz ? `<div class="hint">${esc(p.notiz)}</div>` : ""}
      ${seeAll ? `<div class="subhead">Nach Mitarbeiter</div>
      <div class="tablebox"><table><thead><tr><th>Mitarbeiter</th><th>Positionen</th><th class="num">Stunden</th><th class="num">Anteil</th></tr></thead><tbody>
        ${empRows.length ? empRows.map(([id, r]) => `<tr><td class="name">${esc(fullName(empById(id)))}</td><td class="muted">${Object.entries(r.pos).map(([pid, h]) => `${esc((posById(p, pid) || {}).name || "?")} ${fmtH(h)} h`).join(" · ")}</td><td class="num"><strong>${fmtH(r.total)}</strong></td><td class="num">${booked ? Math.round(r.total / booked * 100) : 0} %</td></tr>`).join("") : `<tr><td colspan="4" class="empty">Noch keine Stunden gebucht.</td></tr>`}
      </tbody></table></div>
      <div class="subhead">Einträge</div>
      <div class="tablebox"><table><thead><tr><th>Datum</th><th>Mitarbeiter</th><th>Position</th><th>Tätigkeit</th><th class="num">Stunden</th></tr></thead><tbody>
        ${tms.length ? [...tms].sort((a, b) => b.datum.localeCompare(a.datum)).map(t => `<tr class="click" data-time="${esc(t.id)}"><td style="white-space:nowrap">${WD[parse(t.datum).getDay()]}, ${de(t.datum)}</td><td>${esc(fullName(empById(t.mitarbeiterId)))}</td><td>${esc((posById(p, t.positionId) || {}).name || "–")}</td><td class="muted">${esc(t.beschreibung || "–")}</td><td class="num"><strong>${fmtH(Number(t.stunden) || 0)}</strong></td></tr>`).join("") : `<tr><td colspan="5" class="empty">Noch keine Zeiten erfasst.</td></tr>`}
      </tbody></table></div>` : ""}`;
    const ed = $("#rep-edit"); if (ed) ed.onclick = () => openProj(p);
    const ad = $("#rep-add"); if (ad) ad.onclick = () => openTime(null, { projektId: p.id });
    $$("tr[data-time]", rep).forEach(r => r.onclick = () => openTime(data.times.find(t => t.id === r.dataset.time)));
  }

  // ---------- Zeiterfassung ----------
  function filteredTimes() {
    const m = $("#tm-month").value, e = $("#tm-emp").value, p = $("#tm-proj").value;
    return data.times.filter(t => (!m || t.datum.startsWith(m)) && (!e || t.mitarbeiterId === e) && (!p || t.projektId === p))
      .sort((a, b) => b.datum.localeCompare(a.datum) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function renderTime() {
    const mSel = $("#tm-month"), eSel = $("#tm-emp"), pSel = $("#tm-proj");
    const months = [...new Set([todayIso().slice(0, 7), ...data.times.map(t => t.datum.slice(0, 7))])].sort().reverse();
    const curM = mSel.dataset.init ? mSel.value : todayIso().slice(0, 7); mSel.dataset.init = "1";
    mSel.innerHTML = `<option value="">Alle Monate</option>` + months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join("");
    mSel.value = months.includes(curM) || curM === "" ? curM : "";
    const seeAll = can("times.view_all");
    eSel.hidden = !seeAll;
    const curE = eSel.value;
    eSel.innerHTML = `<option value="">Alle Mitarbeiter</option>` + [...data.users].sort(sortEmp).map(e => `<option value="${esc(e.id)}">${esc(fullName(e))}</option>`).join("");
    eSel.value = data.users.some(e => e.id === curE) ? curE : "";
    const curP = pSel.value;
    pSel.innerHTML = `<option value="">Alle Projekte</option>` + sortedProjects(true).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    pSel.value = projById(curP) ? curP : "";
    const rows = filteredTimes();
    const total = sumH(rows);
    $("#tm-sum").innerHTML = `<span>Einträge <strong>${rows.length}</strong></span><span>Summe <strong>${fmtH(total)} h</strong></span>`;
    $("#tm-body").innerHTML = rows.length ? rows.map(t => { const p = projById(t.projektId); return `<tr class="click" data-time="${esc(t.id)}">
      <td style="white-space:nowrap">${WD[parse(t.datum).getDay()]}, ${de(t.datum)}</td><td class="name">${esc(fullName(empById(t.mitarbeiterId)))}</td>
      <td><span class="type"><span class="dot" style="background:${projColor(p)}"></span>${esc(p ? p.name : "Gelöschtes Projekt")}</span></td><td>${esc((posById(p, t.positionId) || {}).name || "–")}</td>
      <td class="muted" style="max-width:260px">${esc(t.beschreibung || "–")}</td><td class="muted" style="white-space:nowrap">${t.von && t.bis ? `${esc(t.von)}–${esc(t.bis)}` : ""}</td><td class="num"><strong>${fmtH(Number(t.stunden) || 0)}</strong></td></tr>`; }).join("")
      : `<tr><td colspan="7" class="empty">Für diese Auswahl sind keine Stunden erfasst.</td></tr>`;
    $$("#tm-body tr[data-time]").forEach(r => r.onclick = () => openTime(data.times.find(t => t.id === r.dataset.time)));
  }
  ["#tm-month", "#tm-emp", "#tm-proj"].forEach(s => $(s).addEventListener("input", renderTime));
  function csv(rows) { return "﻿" + rows.map(r => r.map(v => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";")).join("\r\n"); }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("#tm-export").onclick = () => {
    const rows = [["Datum", "Mitarbeiter", "Projekt", "Kunde", "Position", "Von", "Bis", "Pause (Min.)", "Stunden", "Tätigkeit"]];
    filteredTimes().forEach(t => { const p = projById(t.projektId); rows.push([de(t.datum), fullName(empById(t.mitarbeiterId)), p ? p.name : "", p ? p.kunde || "" : "", (posById(p, t.positionId) || {}).name || "", t.von || "", t.bis || "", t.pause ?? "", fmtH(Number(t.stunden) || 0), t.beschreibung || ""]); });
    download(`stunden-${$("#tm-month").value || "alle"}.csv`, csv(rows)); toast("Export erstellt");
  };

  // ---------- Abwesenheiten ----------
  function yearOptions(sel, withAll) {
    const ys = new Set([new Date().getFullYear(), new Date().getFullYear() + 1]);
    data.absences.forEach(a => { if (a.von) ys.add(parse(a.von).getFullYear()); });
    const list = [...ys].sort((a, b) => b - a);
    const cur = sel.dataset.init ? sel.value : String(ui.year); sel.dataset.init = "1";
    sel.innerHTML = (withAll ? `<option value="">Alle Jahre</option>` : "") + list.map(y => `<option value="${y}">${y}</option>`).join("");
    sel.value = list.map(String).includes(cur) || (withAll && cur === "") ? cur : String(ui.year);
  }
  function renderAbsences() {
    const seeAll = can("absences.view_all");
    yearOptions($("#ab-year"), true);
    const y = Number($("#ab-year").value) || ui.year;
    $("#ab-vac-title").textContent = `Urlaubskonto ${y}`;
    const people = seeAll ? activeEmps() : [me()];
    $("#ab-vac").innerHTML = people.map(e => {
      const v = vacationFor(e, y); const max = Math.max(v.anspruch, v.taken + v.planned, 1);
      const restCls = v.rest < 0 ? "bad" : v.rest <= 3 ? "warn" : "neutral";
      return `<tr><td class="name">${esc(fullName(e))}</td><td class="num">${fmtDays(v.anspruch)}</td><td class="num">${fmtDays(v.taken)}</td><td class="num">${fmtDays(v.planned)}</td><td class="num"><span class="pill ${restCls} num">${fmtDays(v.rest)}</span></td><td class="num">${fmtDays(v.sick)}</td>
        <td style="width:24%"><div class="bar" title="${fmtDays(v.taken)} genommen, ${fmtDays(v.planned)} beantragt von ${fmtDays(v.anspruch)}"><span class="taken" style="width:${v.taken / max * 100}%"></span><span class="planned" style="width:${v.planned / max * 100}%"></span></div></td></tr>`;
    }).join("") || `<tr><td colspan="7" class="empty">Keine aktiven Mitarbeiter.</td></tr>`;

    const empSel = $("#ab-emp"); empSel.hidden = !seeAll; const cur = empSel.value;
    empSel.innerHTML = `<option value="">Alle Mitarbeiter</option>` + [...data.users].sort(sortEmp).map(e => `<option value="${esc(e.id)}">${esc(fullName(e))}</option>`).join("");
    empSel.value = data.users.some(e => e.id === cur) ? cur : "";
    const typeSel = $("#ab-type"); if (!typeSel.options.length) typeSel.innerHTML = `<option value="">Alle Arten</option>` + Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("");
    const yy = $("#ab-year").value, st = $("#ab-status").value, ty = typeSel.value;
    const rows = data.absences.filter(a => (!yy || overlapsYear(a, Number(yy))) && (!empSel.value || a.mitarbeiterId === empSel.value) && (!ty || a.art === ty) && (!st || a.status === st))
      .sort((a, b) => b.von.localeCompare(a.von));
    $("#ab-body").innerHTML = rows.length ? rows.map(a => `<tr class="click" data-abs="${esc(a.id)}">
      <td class="name">${esc(fullName(empById(a.mitarbeiterId)))}</td><td>${typePill(a.art)}</td><td class="mono" style="white-space:nowrap">${range(a)}${a.halberTag ? ' <span class="muted">(½)</span>' : ""}</td>
      <td class="num">${fmtDays(workdays(a))}</td><td>${statusPill(a.status)}</td><td class="muted" style="max-width:220px">${esc(a.notiz || "")}</td>
      <td class="actions">${can("absences.manage") && a.status === "beantragt" ? `<button class="small" data-approve="${esc(a.id)}">Genehmigen</button> <button class="small ghost danger" data-reject="${esc(a.id)}">Ablehnen</button>` : ""}</td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">Keine Abwesenheiten für diese Auswahl.</td></tr>`;
    $$("#ab-body tr[data-abs]").forEach(r => r.onclick = () => openAbs(data.absences.find(a => a.id === r.dataset.abs)));
    bindDecisions($("#ab-body"));
  }
  ["#ab-year", "#ab-emp", "#ab-type", "#ab-status"].forEach(s => $(s).addEventListener("input", renderAbsences));

  // ---------- Kalender ----------
  function renderCalendar() {
    const m = ui.calMonth, y = m.getFullYear(), mo = m.getMonth();
    const timeMode = ui.calMode === "time";
    $("#cal-title").textContent = `${MONTHS[mo]} ${y}`;
    $$("#cal-mode button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.mode === ui.calMode)));
    const ps = $("#cal-proj"); ps.hidden = !timeMode;
    if (timeMode) {
      ps.innerHTML = `<option value="">Alle Projekte</option>` + sortedProjects(true).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
      ps.value = projById(ui.calProj) ? ui.calProj : ""; ui.calProj = ps.value;
    }
    const seeAll = timeMode ? can("times.view_all") : can("absences.view_all");
    $("#cal-legend").innerHTML = timeMode
      ? [["var(--ok)", "Tagessoll erreicht"], ["var(--warn)", "Unter Tagessoll"], ["var(--bad)", "Arbeitstag ohne Buchung"]].map(([c, l]) => `<span><span class="dot" style="background:${c}"></span>${l}</span>`).join("")
      : Object.values(TYPES).map(t => `<span><span class="dot" style="background:${t.color}"></span>${t.label}</span>`).join("");
    $("#cal-note").textContent = (timeMode
      ? "Gebuchte Stunden pro Tag. Tagessoll = Wochenstunden ÷ Diensttage. Tippe auf einen Tag für Details."
      : "Grau: Wochenende, Feiertage in NRW und Tage ohne Dienst. Schraffiert: beantragt, noch nicht genehmigt.")
      + (seeAll ? "" : " Du siehst nur deine eigenen Einträge.");
    const cal = $("#cal"); cal.classList.toggle("time", timeMode);
    const days = new Date(y, mo + 1, 0).getDate(); const t = todayIso();
    const ds = []; for (let i = 1; i <= days; i++) { const d = new Date(y, mo, i); ds.push({ d, s: iso(d), wd: d.getDay(), we: d.getDay() === 0 || d.getDay() === 6, hol: holidayName(iso(d)) }); }
    const first = `${y}-${pad(mo + 1)}-01`, last = `${y}-${pad(mo + 1)}-${pad(days)}`;
    const emps = seeAll ? activeEmps() : [me()];
    let html = `<thead><tr><th class="person">Mitarbeiter</th>${ds.map(x => `<th class="day ${x.we ? "we" : ""} ${x.hol ? "hol" : ""} ${x.s === t ? "today" : ""}" ${x.hol ? `title="${esc(x.hol)}"` : ""}>${x.d.getDate()}<small>${WD[x.wd]}</small></th>`).join("")}${timeMode ? `<th class="sum">Summe</th>` : ""}</tr></thead><tbody>`;
    emps.forEach(e => {
      const myDays = empDays(e);
      const abs = data.absences.filter(a => a.mitarbeiterId === e.id && a.status !== "abgelehnt" && a.von <= last && a.bis >= first);
      html += `<tr><td class="person" title="${esc(fullName(e))}">${esc(fullName(e))}</td>`;
      if (timeMode) {
        const tms = data.times.filter(x => x.mitarbeiterId === e.id && x.datum >= first && x.datum <= last && (!ui.calProj || x.projektId === ui.calProj));
        const soll = Number(e.stunden) ? Number(e.stunden) / myDays.length : 0;
        let istSum = 0;
        ds.forEach(x => {
          const ist = sumH(tms.filter(z => z.datum === x.s)); istSum += ist;
          const off = x.we || x.hol || !myDays.includes(x.wd);
          const a = abs.find(a => a.status === "genehmigt" && a.von <= x.s && a.bis >= x.s);
          let cls = off ? "we" : "";
          if (ist > 0) cls = !soll || ist >= soll - 0.01 || ui.calProj ? "s-ok" : "s-under";
          else if (!off && !a && x.s < t && !ui.calProj) cls = "s-miss";
          let inner = "";
          if (ist) inner = `<span class="ist">${fmtH(ist)}</span>`;
          else if (a && !off) { const tt = TYPES[a.art] || TYPES.sonstiges; inner = `<span class="dot" style="background:${tt.color}"></span>`; }
          const title = `${fullName(e)} · ${de(x.s)}${x.hol ? " · " + x.hol : ""} · ${fmtH(ist)} h gebucht${a ? " · " + (TYPES[a.art] || TYPES.sonstiges).label : ""}`;
          html += `<td class="c h ${cls}" data-emp="${esc(e.id)}" data-day="${x.s}" title="${esc(title)}" tabindex="0">${inner}</td>`;
        });
        html += `<td class="sum"><strong>${fmtH(istSum)}</strong> h</td>`;
      } else {
        ds.forEach(x => {
          const a = abs.find(a => a.von <= x.s && a.bis >= x.s);
          const off = x.we || x.hol || !myDays.includes(x.wd);
          let cell = "";
          if (a && !off) { const tt = TYPES[a.art] || TYPES.sonstiges; cell = `<span class="blk ${a.status === "beantragt" ? "req" : ""}" style="background-color:${tt.color}" title="${esc(tt.label)} · ${range(a)}${a.status === "beantragt" ? " (beantragt)" : ""}" data-abs="${esc(a.id)}"></span>`; }
          html += `<td class="c ${off ? "we" : ""}">${cell}</td>`;
        });
      }
      html += `</tr>`;
    });
    cal.innerHTML = html + `</tbody>`;
    if (timeMode) $$("td.h", cal).forEach(td => {
      const go = () => openDay(empById(td.dataset.emp), td.dataset.day);
      td.onclick = go; td.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } };
    });
    else $$("[data-abs]", cal).forEach(el => { el.style.cursor = "pointer"; el.onclick = () => openAbs(data.absences.find(a => a.id === el.dataset.abs)); });
  }
  $$("#cal-mode button").forEach(b => b.onclick = () => { ui.calMode = b.dataset.mode; store.set("tr-calmode", ui.calMode); renderCalendar(); });
  $("#cal-proj").onchange = (ev) => { ui.calProj = ev.target.value; renderCalendar(); };
  $("#cal-prev").onclick = () => { ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() - 1, 1); renderCalendar(); };
  $("#cal-next").onclick = () => { ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() + 1, 1); renderCalendar(); };
  $("#cal-today").onclick = () => { const d = new Date(); ui.calMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar(); };

  // ---------- Team / Benutzer ----------
  function rightsChips(u) {
    if (u.effectiveAdmin) return `<span class="chip admin">Administrator</span>`;
    const role = u.roleId ? roleById(u.roleId) : null;
    const n = (u.effectivePermissions || []).length;
    return `<span class="chip">${esc(role ? role.name : "Individuell")}</span> <span class="muted" style="font-size:.78rem">${n} Recht${n === 1 ? "" : "e"}</span>`;
  }
  function renderTeam() {
    const admin = isAdmin();
    $("#btn-add-user").hidden = !admin;
    $("#roles-panel").hidden = !admin;
    const q = $("#tt-q").value.trim().toLowerCase(), st = $("#tt-status").value;
    const rows = data.users.filter(e => (!st || (e.status || "aktiv") === st) && (!q || [fullName(e), e.username, e.position, e.abteilung, e.email].join(" ").toLowerCase().includes(q))).sort(sortEmp);
    $("#tt-head").innerHTML = admin
      ? `<tr><th>Name</th><th>Benutzername</th><th>Rolle / Rechte</th><th>Position</th><th>Kontakt</th><th class="num">Std./Wo.</th><th>Status</th></tr>`
      : `<tr><th>Name</th><th>Position</th><th>Abteilung</th><th>Kontakt</th><th>Eintritt</th><th>Status</th></tr>`;
    const statusCell = (e) => (e.status || "aktiv") === "aktiv" ? `<span class="pill ok">Aktiv</span>` : `<span class="pill neutral">Deaktiviert</span>`;
    const contact = (e) => `<div style="font-size:.85rem">${esc(e.email || "")}</div><div class="muted mono" style="font-size:.8rem">${esc(e.telefon || "")}</div>`;
    $("#tt-body").innerHTML = rows.length ? rows.map(e => admin
      ? `<tr class="click" data-user="${esc(e.id)}"><td class="name">${esc(fullName(e))}${e.id === me().id ? '<span class="role-chip">Du</span>' : ""}<div class="muted" style="font-size:.8rem;font-weight:400">${esc(e.abteilung || "")}</div></td><td class="mono">${esc(e.username)}</td><td>${rightsChips(e)}</td><td>${esc(e.position || "–")}</td><td>${contact(e)}</td><td class="num">${esc(e.stunden ?? "–")}</td><td>${statusCell(e)}</td></tr>`
      : `<tr><td class="name">${esc(fullName(e))}</td><td>${esc(e.position || "–")}</td><td>${esc(e.abteilung || "–")}</td><td>${contact(e)}</td><td class="mono">${de(e.eintritt)}</td><td>${statusCell(e)}</td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">Keine Treffer.</td></tr>`;
    $$("#tt-body tr[data-user]").forEach(r => r.onclick = () => openUser(data.users.find(u => u.id === r.dataset.user)));
    if (admin) {
      $("#roles-list").innerHTML = data.roles.map(r => {
        const n = data.users.filter(u => u.roleId === r.id).length;
        return `<div class="list-row click" data-role="${esc(r.id)}" style="cursor:pointer"><div class="who"><span class="name">${esc(r.name)}${r.isAdmin ? '<span class="role-chip">Admin</span>' : ""}</span><span class="muted" style="font-size:.84rem">${r.isAdmin ? "Alle Rechte inkl. Benutzerverwaltung" : r.permissions.map(k => permLabel(k)).join(" · ") || "Keine Rechte"}</span></div><span class="pill neutral">${n} Benutzer</span></div>`;
      }).join("") || `<div class="muted">Noch keine Rollen.</div>`;
      $$("#roles-list [data-role]").forEach(r => r.onclick = () => openRole(roleById(r.dataset.role)));
    }
  }
  const permLabel = (k) => (data.catalog.find(p => p.key === k) || { label: k }).label;
  ["#tt-q", "#tt-status"].forEach(s => $(s).addEventListener("input", renderTeam));

  // ---------- Formulare ----------
  function closeDrawer() { $("#drawer-root").innerHTML = ""; document.removeEventListener("keydown", escClose); }
  function escClose(e) { if (e.key === "Escape") closeDrawer(); }
  function openDrawer(html, onMount) {
    const root = $("#drawer-root");
    root.innerHTML = `<div class="scrim"><aside class="drawer" role="dialog" aria-modal="true">${html}</aside></div>`;
    const scrim = $(".scrim", root);
    scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) closeDrawer(); });
    document.addEventListener("keydown", escClose);
    onMount($(".drawer", root));
    const f = $("input:not([disabled]):not([type=checkbox]), select:not([disabled])", root); if (f) f.focus();
  }
  function showErr(d, sel, msg) { const err = $(sel, d); err.textContent = msg; err.hidden = false; }
  // Löschen mit Rückfrage im Fuß des Formulars
  function confirmDelete(d, wrapSel, text, onYes, onNo) {
    const wrap = $(wrapSel, d);
    wrap.innerHTML = `<div class="confirm"><span>${esc(text)}</span><button type="button" class="small danger" data-yes>Löschen</button><button type="button" class="small ghost" data-no>Nein</button></div>`;
    $("[data-no]", wrap).onclick = onNo;
    $("[data-yes]", wrap).onclick = async (ev) => { ev.target.disabled = true; try { await onYes(); } catch (x) { toast(x.message); ev.target.disabled = false; } };
  }
  async function submitWith(btn, d, errSel, fn) {
    $(errSel, d).hidden = true;
    if (btn) btn.disabled = true;
    try { await fn(); } catch (x) { showErr(d, errSel, x.message); } finally { if (btn) btn.disabled = false; }
  }

  // Rechte-Auswahl (für Benutzer und Rollen)
  function rightsHtml(prefix, withRole) {
    const groups = [...new Set(data.catalog.map(p => p.group))];
    return `${withRole ? `<label>Rolle<select id="${prefix}-role"><option value="">Individuell (eigene Auswahl)</option>${data.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select></label>` : ""}
      <label class="perm admin"><input type="checkbox" id="${prefix}-admin"><span><strong>Administrator</strong><br><span class="muted">Alle Rechte. Darf Benutzer, Rollen und Passwörter verwalten.</span></span></label>
      ${groups.map(g => `<div class="perm-group"><span class="subhead" style="margin:0">${esc(g)}</span>${data.catalog.filter(p => p.group === g).map(p => `<label class="perm"><input type="checkbox" data-perm="${esc(p.key)}"><span>${esc(p.label)}</span></label>`).join("")}</div>`).join("")}`;
  }
  function bindRights(d, prefix, initial, onManualChange) {
    const adm = $(`#${prefix}-admin`, d), boxes = $$("[data-perm]", d);
    const apply = (isAdm, perms) => {
      adm.checked = !!isAdm;
      boxes.forEach(b => { b.checked = isAdm || perms.includes(b.dataset.perm); b.disabled = !!isAdm; });
    };
    apply(initial.isAdmin, initial.permissions || []);
    adm.onchange = () => { apply(adm.checked, read().permissions); onManualChange && onManualChange(); };
    boxes.forEach(b => b.onchange = () => onManualChange && onManualChange());
    const read = () => ({ isAdmin: adm.checked, permissions: boxes.filter(b => b.checked).map(b => b.dataset.perm) });
    return { apply, read };
  }

  function genPassword() {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!?$%";
    const a = new Uint32Array(14); crypto.getRandomValues(a);
    return [...a].map(n => chars[n % chars.length]).join("");
  }

  function openUser(u) {
    const isNew = !u;
    u = u || { status: "aktiv", stunden: 40, urlaub: 30, eintritt: todayIso(), tage: ALL_WD, roleId: (data.roles.find(r => r.id === "role_mitarbeiter") || {}).id || "", permissions: [] };
    const self = !isNew && u.id === me().id;
    openDrawer(`
      <div><span class="eyebrow">${isNew ? "Neu" : "Benutzer"}</span><h2>${isNew ? "Benutzer anlegen" : esc(fullName(u))}</h2></div>
      <form id="f-user" novalidate autocomplete="off">
        <div class="section">
          <span class="subhead" style="margin:0">Zugang</span>
          <div class="row2"><label>Benutzername<input id="u-username" value="${esc(u.username)}" autocapitalize="none" spellcheck="false" placeholder="z. B. maxmustermann"></label>
            <label>Status<select id="u-status"><option value="aktiv">Aktiv – darf sich anmelden</option><option value="inaktiv">Deaktiviert / ausgeschieden</option></select></label></div>
          <label>${isNew ? "Passwort" : "Neues Passwort setzen"}<div class="inline"><input id="u-password" type="text" autocomplete="new-password" placeholder="${isNew ? "mindestens 8 Zeichen" : "leer lassen = unverändert"}"><button type="button" class="small" id="u-gen">Generieren</button></div></label>
          ${isNew ? `<div class="hint">Gib das Passwort dem Mitarbeiter persönlich weiter. Er kann es danach in seinen Einstellungen selbst ändern.</div>` : ""}
        </div>
        <div class="section">
          <span class="subhead" style="margin:0">Rechte</span>
          ${rightsHtml("u", true)}
          <div class="inline"><input id="u-newrole" placeholder="Name für neue Rolle, z. B. Editor"><button type="button" class="small" id="u-saverole">Als Rolle speichern</button></div>
          <div class="err" id="u-role-err" hidden></div>
        </div>
        <div class="section">
          <span class="subhead" style="margin:0">Person</span>
          <div class="row2"><label>Vorname<input id="u-vorname" value="${esc(u.vorname)}"></label><label>Nachname<input id="u-nachname" value="${esc(u.nachname)}"></label></div>
          <div class="row2"><label>Position<input id="u-position" value="${esc(u.position)}" list="dl-pos"></label><label>Abteilung<input id="u-abteilung" list="dl-dept" value="${esc(u.abteilung)}"></label></div>
          <datalist id="dl-dept">${[...new Set(data.users.map(x => x.abteilung).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join("")}</datalist>
          <datalist id="dl-pos">${[...new Set([...POS_SUGGEST, ...data.users.map(x => x.position).filter(Boolean)])].map(x => `<option value="${esc(x)}">`).join("")}</datalist>
          <div class="row2"><label>E-Mail<input id="u-email" type="email" value="${esc(u.email)}"></label><label>Telefon<input id="u-telefon" type="tel" value="${esc(u.telefon)}"></label></div>
          <div class="row2"><label>Eintrittsdatum<input id="u-eintritt" type="date" value="${esc(u.eintritt)}"></label><label>Austrittsdatum<input id="u-austritt" type="date" value="${esc(u.austritt)}"></label></div>
          <div class="row2"><label>Wochenstunden<input id="u-stunden" type="number" min="0" max="80" step="0.5" value="${esc(u.stunden)}"></label><label>Urlaubstage pro Jahr<input id="u-urlaub" type="number" min="0" max="80" step="0.5" value="${esc(u.urlaub)}"></label></div>
          <fieldset class="wk"><legend>Diensttage</legend>${[1, 2, 3, 4, 5, 6].map(i => `<label class="chk"><input type="checkbox" value="${i}" ${empDays(u).includes(i) ? "checked" : ""}>${WD[i]}</label>`).join("")}</fieldset>
          <label>Notizen (nur für Admins sichtbar)<textarea id="u-notiz" rows="3">${esc(u.notiz)}</textarea></label>
        </div>
        <div class="err" id="u-err" hidden></div>
        <div class="drawer-foot">
          <div id="u-del-wrap">${!isNew && !self ? `<button type="button" class="ghost danger" id="u-del">Löschen</button>` : ""}</div>
          <div class="right"><button type="button" id="u-cancel">Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
        </div>
      </form>`, (d) => {
      const q = (s) => $(s, d);
      q("#u-status").value = u.status || "aktiv";
      const roleSel = q("#u-role");
      roleSel.value = u.roleId && roleById(u.roleId) ? u.roleId : "";
      const startRole = roleById(roleSel.value);
      const rights = bindRights(d, "u", startRole ? startRole : { isAdmin: u.isAdmin, permissions: u.permissions || [] }, () => { roleSel.value = ""; });
      roleSel.onchange = () => { const r = roleById(roleSel.value); if (r) rights.apply(r.isAdmin, r.permissions); };
      q("#u-gen").onclick = () => { q("#u-password").value = genPassword(); q("#u-password").select(); };
      q("#u-saverole").onclick = async (ev) => {
        const name = q("#u-newrole").value.trim(); const err = q("#u-role-err"); err.hidden = true;
        if (!name) { showErr(d, "#u-role-err", "Bitte einen Namen für die Rolle eintragen."); return; }
        ev.target.disabled = true;
        try {
          const r = await api("POST", "/api/roles", { name, ...rights.read() });
          await refresh();
          roleSel.insertAdjacentHTML("beforeend", `<option value="${esc(r.id)}">${esc(name)}</option>`);
          roleSel.value = r.id; q("#u-newrole").value = "";
          toast(`Rolle „${name}“ gespeichert`);
        } catch (x) { showErr(d, "#u-role-err", x.message); } finally { ev.target.disabled = false; }
      };
      q("#u-cancel").onclick = closeDrawer;
      const del = q("#u-del");
      if (del) del.onclick = () => {
        const n = data.times.filter(x => x.mitarbeiterId === u.id).length + data.absences.filter(x => x.mitarbeiterId === u.id).length;
        confirmDelete(d, "#u-del-wrap", `Endgültig löschen${n ? ` inkl. ${n} Einträgen` : ""}? Tipp: Deaktivieren behält die Historie.`,
          async () => { await api("DELETE", `/api/users/${u.id}`); await refresh(); closeDrawer(); toast("Benutzer gelöscht"); }, () => openUser(u));
      };
      q("#f-user").onsubmit = (ev) => {
        ev.preventDefault();
        const g = (id) => q(id).value.trim();
        const body = {
          username: g("#u-username"), password: q("#u-password").value, status: q("#u-status").value,
          roleId: roleSel.value || null, ...rights.read(),
          vorname: g("#u-vorname"), nachname: g("#u-nachname"), position: g("#u-position"), abteilung: g("#u-abteilung"),
          email: g("#u-email"), telefon: g("#u-telefon"), eintritt: g("#u-eintritt"), austritt: g("#u-austritt"),
          stunden: g("#u-stunden"), urlaub: g("#u-urlaub"), notiz: g("#u-notiz"), tage: $$(".wk input:checked", d).map(x => Number(x.value)),
        };
        if (isNew && !body.password) { showErr(d, "#u-err", "Bitte ein Passwort festlegen oder generieren."); return; }
        submitWith(ev.submitter, d, "#u-err", async () => {
          if (isNew) await api("POST", "/api/users", body); else await api("PUT", `/api/users/${u.id}`, body);
          await refresh(); closeDrawer(); toast(isNew ? "Benutzer angelegt" : body.password ? "Gespeichert, Passwort geändert" : "Gespeichert");
        });
      };
    });
  }

  function openRole(r) {
    const isNew = !r; r = r || { name: "", isAdmin: false, permissions: ["times.book", "absences.request"] };
    const n = isNew ? 0 : data.users.filter(u => u.roleId === r.id).length;
    openDrawer(`
      <div><span class="eyebrow">${isNew ? "Neu" : "Rolle"}</span><h2>${isNew ? "Rolle anlegen" : esc(r.name)}</h2></div>
      ${n ? `<div class="hint">${n} Benutzer haben diese Rolle. Änderungen gelten sofort für alle.</div>` : ""}
      <form id="f-role" novalidate>
        <label>Name<input id="r-name" value="${esc(r.name)}" placeholder="z. B. Editor, Kameramann, Projektleitung"></label>
        ${rightsHtml("r", false)}
        <div class="err" id="r-err" hidden></div>
        <div class="drawer-foot">
          <div id="r-del-wrap">${!isNew ? `<button type="button" class="ghost danger" id="r-del">Löschen</button>` : ""}</div>
          <div class="right"><button type="button" id="r-cancel">Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
        </div>
      </form>`, (d) => {
      const rights = bindRights(d, "r", r);
      $("#r-cancel", d).onclick = closeDrawer;
      const del = $("#r-del", d);
      if (del) del.onclick = () => confirmDelete(d, "#r-del-wrap", "Rolle löschen?", async () => { await api("DELETE", `/api/roles/${r.id}`); await refresh(); closeDrawer(); toast("Rolle gelöscht"); }, () => openRole(r));
      $("#f-role", d).onsubmit = (ev) => {
        ev.preventDefault();
        const body = { name: $("#r-name", d).value.trim(), ...rights.read() };
        submitWith(ev.submitter, d, "#r-err", async () => {
          if (isNew) await api("POST", "/api/roles", body); else await api("PUT", `/api/roles/${r.id}`, body);
          await refresh(); closeDrawer(); toast(isNew ? "Rolle angelegt" : "Gespeichert");
        });
      };
    });
  }

  function openMe() {
    const m = me();
    openDrawer(`
      <div><span class="eyebrow">Benutzereinstellungen</span><h2>${esc(fullName(m))}</h2></div>
      <div class="minis"><div class="mini"><span class="k">Benutzername</span><span class="mono">${esc(m.username)}</span></div><div class="mini"><span class="k">Rolle</span><span>${esc(isAdmin() ? "Administrator" : m.roleName)}</span></div></div>
      <div class="section"><span class="subhead" style="margin:0">Deine Rechte</span>
        <div class="chips">${isAdmin() ? `<span class="chip admin">Administrator – alle Rechte</span>` : m.permissions.map(k => `<span class="chip">${esc(permLabel(k))}</span>`).join("") || `<span class="muted">Keine besonderen Rechte</span>`}</div>
        <span class="muted" style="font-size:.82rem">Rechte vergibt die Geschäftsführung.</span></div>
      <form id="f-pw" novalidate class="section">
        <span class="subhead" style="margin:0">Passwort ändern</span>
        <label>Aktuelles Passwort<input id="pw-cur" type="password" autocomplete="current-password"></label>
        <label>Neues Passwort<input id="pw-new" type="password" autocomplete="new-password" placeholder="mindestens 8 Zeichen"></label>
        <label>Neues Passwort wiederholen<input id="pw-rep" type="password" autocomplete="new-password"></label>
        ${isAdmin() ? `<div class="hint">Passwörter anderer Benutzer änderst du unter „Benutzer &amp; Rollen“.</div>` : ""}
        <div class="err" id="pw-err" hidden></div>
        <div class="drawer-foot"><span></span><div class="right"><button type="button" id="pw-close">Schließen</button><button class="primary" type="submit">Passwort ändern</button></div></div>
      </form>`, (d) => {
      $("#pw-close", d).onclick = closeDrawer;
      $("#f-pw", d).onsubmit = (ev) => {
        ev.preventDefault();
        const cur = $("#pw-cur", d).value, nw = $("#pw-new", d).value, rep = $("#pw-rep", d).value;
        if (!cur || !nw) { showErr(d, "#pw-err", "Bitte aktuelles und neues Passwort eintragen."); return; }
        if (nw !== rep) { showErr(d, "#pw-err", "Die neuen Passwörter stimmen nicht überein."); return; }
        if (nw.length < 8) { showErr(d, "#pw-err", "Das neue Passwort muss mindestens 8 Zeichen lang sein."); return; }
        submitWith(ev.submitter, d, "#pw-err", async () => { await api("POST", "/api/me/password", { current: cur, next: nw }); closeDrawer(); toast("Passwort geändert"); });
      };
    });
  }
  $("#btn-me").onclick = openMe;

  function openProj(p) {
    const isNew = !p; p = p || { status: "aktiv", farbe: data.projects.length % PCOL.length, positions: [{ name: "", stunden: "" }] };
    const booked = {}; (p.positions || []).forEach(x => booked[x.id] = Number(x.gebucht) || 0);
    openDrawer(`
      <div><span class="eyebrow">${isNew ? "Neu" : "Projekt"}</span><h2>${isNew ? "Projekt anlegen" : esc(p.name || "Projekt")}</h2></div>
      <form id="f-proj" novalidate>
        <label>Projektname<input id="p-name" value="${esc(p.name)}"></label>
        <div class="row2"><label>Kunde<input id="p-kunde" value="${esc(p.kunde)}"></label><label>Projektnummer<input id="p-nr" value="${esc(p.nummer)}"></label></div>
        <div class="row2"><label>Start<input id="p-start" type="date" value="${esc(p.start)}"></label><label>Ende<input id="p-ende" type="date" value="${esc(p.ende)}"></label></div>
        <div class="row2"><label>Status<select id="p-status"><option value="aktiv">Läuft</option><option value="abgeschlossen">Abgeschlossen</option></select></label>
          <label>Farbe<select id="p-farbe">${PCOL_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join("")}</select></label></div>
        <div class="section">
          <span class="subhead" style="margin:0">Positionen &amp; geplante Stunden</span>
          <div class="pos-edit muted" style="font-size:.76rem"><span>Position</span><span>Stunden</span><span></span></div>
          <div class="pos-edit-list" id="p-pos"></div>
          <datalist id="dl-ppos">${POS_SUGGEST.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
          <button type="button" class="small" id="p-pos-add" style="align-self:flex-start">+ Position hinzufügen</button>
          <div class="pos-sum"><span>Geplant gesamt</span><strong id="p-pos-sum"></strong></div>
        </div>
        <label>Notizen<textarea id="p-notiz" rows="3">${esc(p.notiz)}</textarea></label>
        <div class="err" id="p-err" hidden></div>
        <div class="drawer-foot">
          <div id="p-del-wrap">${!isNew ? `<button type="button" class="ghost danger" id="p-del">Löschen</button>` : ""}</div>
          <div class="right"><button type="button" id="p-cancel">Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
        </div>
      </form>`, (d) => {
      const q = (s) => $(s, d);
      q("#p-status").value = p.status || "aktiv";
      q("#p-farbe").value = String(Number.isInteger(p.farbe) ? p.farbe % PCOL.length : 0);
      const list = q("#p-pos");
      const updateSum = () => { q("#p-pos-sum").textContent = fmtH($$("[data-h]", list).reduce((s, i) => s + (Number(i.value) || 0), 0)) + " h"; };
      const addRow = (x) => {
        const row = document.createElement("div"); row.className = "pos-edit"; if (x.id) row.dataset.id = x.id;
        const b = booked[x.id] || 0;
        row.innerHTML = `<input data-n list="dl-ppos" value="${esc(x.name)}" placeholder="z. B. Editor" aria-label="Position"><input data-h type="number" min="0" step="0.5" value="${esc(x.stunden)}" placeholder="Std." aria-label="Geplante Stunden">
          <button type="button" class="ghost danger small" aria-label="Position entfernen" ${b ? `disabled title="Schon ${fmtH(b)} h gebucht"` : ""}>✕</button>`;
        $("button", row).onclick = () => { row.remove(); updateSum(); };
        $("[data-h]", row).oninput = updateSum;
        list.appendChild(row);
        return row;
      };
      (p.positions || []).forEach(addRow); updateSum();
      q("#p-pos-add").onclick = () => { $("[data-n]", addRow({ name: "", stunden: "" })).focus(); };
      q("#p-cancel").onclick = closeDrawer;
      const del = q("#p-del");
      if (del) del.onclick = () => {
        const n = data.times.filter(t => t.projektId === p.id).length;
        confirmDelete(d, "#p-del-wrap", `Projekt${Number(p.gebucht) ? ` mit ${fmtH(Number(p.gebucht))} gebuchten Stunden` : n ? ` mit ${n} Einträgen` : ""} endgültig löschen?`,
          async () => { await api("DELETE", `/api/projects/${p.id}`); await refresh(); closeDrawer(); toast("Projekt gelöscht"); }, () => openProj(p));
      };
      q("#f-proj").onsubmit = (ev) => {
        ev.preventDefault();
        const g = (id) => q(id).value.trim();
        const positions = $$(".pos-edit", list).map(r => ({ id: r.dataset.id, name: $("[data-n]", r).value.trim(), stunden: $("[data-h]", r).value }))
          .filter(x => x.id || x.name || x.stunden);
        const body = { name: g("#p-name"), kunde: g("#p-kunde"), nummer: g("#p-nr"), start: g("#p-start"), ende: g("#p-ende"), status: q("#p-status").value,
          farbe: Number(q("#p-farbe").value), notiz: g("#p-notiz"), positions };
        submitWith(ev.submitter, d, "#p-err", async () => {
          const r = isNew ? await api("POST", "/api/projects", body) : await api("PUT", `/api/projects/${p.id}`, body);
          ui.projSel = isNew ? r.id : p.id;
          await refresh(); closeDrawer(); toast(isNew ? "Projekt angelegt" : "Gespeichert");
        });
      };
    });
  }

  function openTime(t, preset) {
    const projs = sortedProjects(false);
    const isNew = !t;
    if (isNew && !projs.length) { toast(can("projects.manage") ? "Lege zuerst ein Projekt an." : "Es gibt noch keine laufenden Projekte."); return; }
    const ro = !isNew && !mayEditTime(t);
    const manage = can("times.manage");
    const selP = projById(ui.projSel);
    t = t || { mitarbeiterId: me().id, projektId: selP && selP.status !== "abgeschlossen" ? selP.id : projs[0].id, datum: todayIso(), stunden: "", ...(preset || {}) };
    const ePool = manage ? [...new Set([...activeEmps(), empById(t.mitarbeiterId)].filter(Boolean))] : [empById(t.mitarbeiterId) || me()];
    const pPool = [...new Set([...projs, projById(t.projektId)].filter(Boolean))];
    const dis = ro ? "disabled" : "";
    openDrawer(`
      <div><span class="eyebrow">${isNew ? "Neu" : "Zeiteintrag"}</span><h2>${isNew ? "Zeit erfassen" : ro ? "Zeiteintrag" : "Zeiteintrag bearbeiten"}</h2></div>
      <form id="f-time" novalidate>
        <label>Mitarbeiter<select id="t-emp" ${manage && !ro ? "" : "disabled"}>${ePool.map(e => `<option value="${esc(e.id)}">${esc(fullName(e))}</option>`).join("")}</select></label>
        <div class="row2"><label>Projekt<select id="t-proj" ${dis}>${pPool.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
          <label>Position<select id="t-pos" ${dis}></select></label></div>
        <label>Datum<input id="t-datum" type="date" value="${esc(t.datum)}" ${dis}></label>
        <div class="row3"><label>Von<input id="t-von" type="time" value="${esc(t.von)}" ${dis}></label><label>Bis<input id="t-bis" type="time" value="${esc(t.bis)}" ${dis}></label><label>Pause (Min.)<input id="t-pause" type="number" min="0" step="5" value="${esc(t.pause)}" ${dis}></label></div>
        <label>Stunden<input id="t-std" type="number" min="0" max="24" step="0.25" value="${esc(t.stunden)}" placeholder="oder Von/Bis ausfüllen" ${dis}></label>
        <div class="hint" id="t-calc"></div>
        <label>Tätigkeit<textarea id="t-desc" rows="2" placeholder="z. B. Schnitt Rohfassung" ${dis}>${esc(t.beschreibung)}</textarea></label>
        <div class="err" id="t-err" hidden></div>
        <div class="drawer-foot">
          <div id="t-del-wrap">${!isNew && !ro ? `<button type="button" class="ghost danger" id="t-del">Löschen</button>` : ""}</div>
          <div class="right"><button type="button" id="t-cancel">${ro ? "Schließen" : "Abbrechen"}</button>${ro ? "" : `<button class="primary" type="submit">Speichern</button>`}</div>
        </div>
      </form>`, (d) => {
      const q = (s) => $(s, d);
      q("#t-emp").value = t.mitarbeiterId; q("#t-proj").value = t.projektId;
      const fillPos = (keep) => {
        const p = projById(q("#t-proj").value); const ps = (p && p.positions) || [];
        const empPos = (empById(q("#t-emp").value) || {}).position || "";
        q("#t-pos").innerHTML = ps.length ? ps.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("") : `<option value="">Keine Positionen</option>`;
        const guess = ps.find(x => x.id === keep) || ps.find(x => x.name.toLowerCase() === empPos.toLowerCase());
        if (guess) q("#t-pos").value = guess.id;
      };
      fillPos(t.positionId);
      const toMin = (v) => { const [h, m] = v.split(":").map(Number); return h * 60 + m; };
      const fromClock = () => {
        const von = q("#t-von").value, bis = q("#t-bis").value;
        if (!von || !bis) return;
        let mins = toMin(bis) - toMin(von); if (mins < 0) mins += 1440;
        mins -= Number(q("#t-pause").value) || 0;
        q("#t-std").value = mins > 0 ? String(Math.round(mins / 60 * 100) / 100) : "";
      };
      const hint = () => {
        const p = projById(q("#t-proj").value), pos = posById(p, q("#t-pos").value);
        const day = q("#t-datum").value, mid = q("#t-emp").value;
        const dayH = sumH(data.times.filter(x => x.id !== t.id && x.mitarbeiterId === mid && x.datum === day)) + (Number(q("#t-std").value) || 0);
        let txt = day ? `An diesem Tag insgesamt ${fmtH(dayH)} h gebucht` : "Bitte ein Datum wählen.";
        if (pos && can("projects.view")) {
          const own = !isNew && t.positionId === pos.id ? Number(t.stunden) || 0 : 0;
          const b = (Number(pos.gebucht) || 0) - own + (Number(q("#t-std").value) || 0), s = Number(pos.stunden) || 0;
          txt += ` · ${pos.name}: danach ${fmtH(b)} von ${fmtH(s)} h${s ? ` (${Math.round(b / s * 100)} %)` : ""}`;
        }
        q("#t-calc").textContent = txt;
      };
      ["#t-von", "#t-bis", "#t-pause"].forEach(s => q(s).addEventListener("input", () => { fromClock(); hint(); }));
      ["#t-std", "#t-datum", "#t-pos"].forEach(s => q(s).addEventListener("input", hint));
      q("#t-proj").addEventListener("input", () => { fillPos(); hint(); });
      q("#t-emp").addEventListener("input", () => { fillPos(q("#t-pos").value); hint(); });
      hint();
      q("#t-cancel").onclick = closeDrawer;
      const del = q("#t-del");
      if (del) del.onclick = () => confirmDelete(d, "#t-del-wrap", "Eintrag löschen?", async () => { await api("DELETE", `/api/times/${t.id}`); await refresh(); closeDrawer(); toast("Eintrag gelöscht"); }, () => openTime(t));
      q("#f-time").onsubmit = (ev) => {
        ev.preventDefault();
        const std = Number(q("#t-std").value);
        if (!q("#t-datum").value) { showErr(d, "#t-err", "Bitte ein Datum eintragen."); return; }
        if (!q("#t-pos").value) { showErr(d, "#t-err", "Für dieses Projekt sind keine Positionen festgelegt."); return; }
        if (!std || std <= 0 || std > 24) { showErr(d, "#t-err", "Bitte Stunden zwischen 0 und 24 eintragen oder Von und Bis ausfüllen."); return; }
        const body = { mitarbeiterId: q("#t-emp").value, projektId: q("#t-proj").value, positionId: q("#t-pos").value, datum: q("#t-datum").value,
          von: q("#t-von").value, bis: q("#t-bis").value, pause: q("#t-pause").value, stunden: std, beschreibung: q("#t-desc").value.trim() };
        submitWith(ev.submitter, d, "#t-err", async () => {
          if (isNew) await api("POST", "/api/times", body); else await api("PUT", `/api/times/${t.id}`, body);
          await refresh(); closeDrawer(); toast(isNew ? `${fmtH(std)} h erfasst` : "Gespeichert");
        });
      };
    });
  }
  $("#btn-add-time").onclick = () => openTime(null);

  function openDay(e, day) {
    if (!e) return;
    const tms = data.times.filter(x => x.mitarbeiterId === e.id && x.datum === day && (!ui.calProj || x.projektId === ui.calProj));
    const mayAdd = can("times.manage") || (can("times.book") && e.id === me().id);
    if (!tms.length && mayAdd) { openTime(null, { mitarbeiterId: e.id, datum: day, ...(ui.calProj ? { projektId: ui.calProj } : {}) }); return; }
    const d0 = parse(day); const hol = holidayName(day);
    const a = data.absences.find(a => a.mitarbeiterId === e.id && a.status !== "abgelehnt" && a.von <= day && a.bis >= day);
    const notes = [hol, a ? `${(TYPES[a.art] || TYPES.sonstiges).label} (${(STATUS[a.status] || {}).label || ""})` : ""].filter(Boolean);
    openDrawer(`
      <div><span class="eyebrow">${WD[d0.getDay()]}, ${de(day)}</span><h2>${esc(fullName(e))}</h2></div>
      ${notes.length ? `<div class="hint">${esc(notes.join(" · "))}</div>` : ""}
      <div class="minis"><div class="mini"><span class="k">Gebucht</span><span class="v">${fmtH(sumH(tms))} h</span></div></div>
      <div class="list">
        ${tms.length ? tms.map(x => { const p = projById(x.projektId); return `<div class="list-row" data-time="${esc(x.id)}" style="cursor:pointer"><div class="who"><span class="type"><span class="dot" style="background:${projColor(p)}"></span>${esc(p ? p.name : "Gelöschtes Projekt")} · ${esc((posById(p, x.positionId) || {}).name || "")}</span><span class="muted" style="font-size:.84rem">${esc(x.beschreibung || "")}${x.von && x.bis ? ` · ${esc(x.von)}–${esc(x.bis)}` : ""}</span></div><strong>${fmtH(Number(x.stunden) || 0)} h</strong></div>`; }).join("") : `<div class="muted" style="font-size:.9rem">Nichts gebucht.</div>`}
      </div>
      <div class="drawer-foot"><span></span><div class="right"><button type="button" id="dy-close">Schließen</button>${mayAdd ? `<button type="button" class="primary" id="dy-add">Zeit erfassen</button>` : ""}</div></div>`, (dr) => {
      $("#dy-close", dr).onclick = closeDrawer;
      const add = $("#dy-add", dr); if (add) add.onclick = () => openTime(null, { mitarbeiterId: e.id, datum: day, ...(tms[0] ? { projektId: tms[0].projektId } : {}) });
      $$("[data-time]", dr).forEach(r => r.onclick = () => openTime(data.times.find(x => x.id === r.dataset.time)));
    });
  }

  function openAbs(a) {
    const manage = can("absences.manage");
    const isNew = !a;
    a = a || { mitarbeiterId: me().id, art: "urlaub", von: todayIso(), bis: todayIso(), status: manage ? "genehmigt" : "beantragt" };
    const ro = !isNew && !mayEditAbs(a);
    const dis = ro ? "disabled" : "";
    const pool = manage ? [...new Set([...activeEmps(), empById(a.mitarbeiterId)].filter(Boolean))] : [empById(a.mitarbeiterId) || me()];
    openDrawer(`
      <div><span class="eyebrow">${isNew ? "Neu" : "Abwesenheit"}</span><h2>${isNew ? (manage ? "Abwesenheit eintragen" : "Abwesenheit beantragen") : esc(fullName(empById(a.mitarbeiterId)))}</h2></div>
      ${ro && !isNew ? `<div class="hint">${a.status === "beantragt" ? "Diesen Eintrag kannst du nicht bearbeiten." : `Dieser Eintrag ist ${esc((STATUS[a.status] || {}).label || "")} und kann nur noch von der Geschäftsführung geändert werden.`}</div>` : ""}
      <form id="f-abs" novalidate>
        <label>Mitarbeiter<select id="a-emp" ${manage && !ro ? "" : "disabled"}>${pool.map(e => `<option value="${esc(e.id)}">${esc(fullName(e))}</option>`).join("")}</select></label>
        <div class="row2"><label>Art<select id="a-art" ${dis}>${Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("")}</select></label>
          <label>Status<select id="a-status" ${manage && !ro ? "" : "disabled"}>${Object.entries(STATUS).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("")}</select></label></div>
        <div class="row2"><label>Von<input id="a-von" type="date" value="${esc(a.von)}" ${dis}></label><label>Bis<input id="a-bis" type="date" value="${esc(a.bis)}" ${dis}></label></div>
        <label style="flex-direction:row;align-items:center;gap:8px;color:var(--fg)"><input id="a-halb" type="checkbox" style="width:auto" ${a.halberTag ? "checked" : ""} ${dis}> Enthält einen halben Tag</label>
        <div class="hint" id="a-calc"></div>
        <label>Notiz<textarea id="a-notiz" rows="2" ${dis}>${esc(a.notiz)}</textarea></label>
        <div class="err" id="a-err" hidden></div>
        <div class="drawer-foot">
          <div id="a-del-wrap">${!isNew && !ro ? `<button type="button" class="ghost danger" id="a-del">${manage ? "Löschen" : "Antrag zurückziehen"}</button>` : ""}</div>
          <div class="right"><button type="button" id="a-cancel">${ro ? "Schließen" : "Abbrechen"}</button>${ro ? "" : `<button class="primary" type="submit">${!manage && isNew ? "Absenden" : "Speichern"}</button>`}</div>
        </div>
      </form>`, (d) => {
      const q = (s) => $(s, d);
      q("#a-emp").value = a.mitarbeiterId; q("#a-art").value = a.art; q("#a-status").value = a.status;
      const syncStatus = () => { if (!manage) q("#a-status").value = q("#a-art").value === "krank" ? "genehmigt" : "beantragt"; };
      if (isNew) q("#a-art").addEventListener("change", (ev) => { if (manage) q("#a-status").value = ["urlaub", "fortbildung"].includes(ev.target.value) ? "beantragt" : "genehmigt"; syncStatus(); });
      const calc = () => {
        const von = q("#a-von").value, bis = q("#a-bis").value, box = q("#a-calc");
        if (!von || !bis || bis < von) { box.textContent = "Bitte einen gültigen Zeitraum wählen."; return; }
        const tmp = { von, bis, halberTag: q("#a-halb").checked, mitarbeiterId: q("#a-emp").value };
        const n = workdays(tmp);
        const hols = []; let x = parse(von); const end = parse(bis);
        while (x <= end) { const h = holidayName(iso(x)); if (h && x.getDay() !== 0 && x.getDay() !== 6) hols.push(`${h} (${deShort(iso(x))})`); x.setDate(x.getDate() + 1); }
        let txt = `${fmtDays(n)} Arbeitstag${n === 1 ? "" : "e"}`;
        if (hols.length) txt += ` · Feiertag${hols.length > 1 ? "e" : ""}: ${hols.join(", ")}`;
        const emp = empById(q("#a-emp").value);
        if (emp && q("#a-art").value === "urlaub") {
          const yy = parse(von).getFullYear(); const v = vacationFor(emp, yy);
          const own = !isNew && a.art === "urlaub" && a.status !== "abgelehnt" ? workdays(a, yy) : 0;
          txt += ` · Resturlaub ${yy} danach: ${fmtDays(v.rest + own - workdays(tmp, yy))} Tage`;
        }
        if (!manage && !ro) txt += q("#a-art").value === "krank" ? " · Krankmeldung wird direkt eingetragen." : " · Wird als Antrag an die Geschäftsführung geschickt.";
        box.textContent = txt;
      };
      ["#a-von", "#a-bis", "#a-halb", "#a-emp", "#a-art"].forEach(s => q(s).addEventListener("input", calc));
      q("#a-von").addEventListener("change", () => { const v = q("#a-von"), b = q("#a-bis"); if (!b.value || b.value < v.value) b.value = v.value; calc(); });
      calc();
      q("#a-cancel").onclick = closeDrawer;
      const del = q("#a-del");
      if (del) del.onclick = () => confirmDelete(d, "#a-del-wrap", manage ? "Eintrag löschen?" : "Antrag zurückziehen?", async () => { await api("DELETE", `/api/absences/${a.id}`); await refresh(); closeDrawer(); toast(manage ? "Eintrag gelöscht" : "Antrag zurückgezogen"); }, () => openAbs(a));
      q("#f-abs").onsubmit = (ev) => {
        ev.preventDefault();
        const von = q("#a-von").value, bis = q("#a-bis").value;
        if (!von || !bis) { showErr(d, "#a-err", "Bitte Von- und Bis-Datum eintragen."); return; }
        if (bis < von) { showErr(d, "#a-err", "Das Bis-Datum liegt vor dem Von-Datum."); return; }
        const body = { mitarbeiterId: q("#a-emp").value, art: q("#a-art").value, status: q("#a-status").value, von, bis, halberTag: q("#a-halb").checked, notiz: q("#a-notiz").value.trim() };
        submitWith(ev.submitter, d, "#a-err", async () => {
          if (isNew) await api("POST", "/api/absences", body); else await api("PUT", `/api/absences/${a.id}`, body);
          await refresh(); closeDrawer(); toast(isNew ? (manage || body.art === "krank" ? "Eintrag gespeichert" : "Antrag gesendet") : "Gespeichert");
        });
      };
    });
  }
  $("#btn-add-abs").onclick = () => openAbs(null);
  $("#btn-add-proj").onclick = () => openProj(null);
  $("#btn-add-user").onclick = () => openUser(null);
  $("#btn-add-role").onclick = () => openRole(null);
  $("#pj-status").addEventListener("input", renderProjects);

  // ---------- Start ----------
  // Regelmäßig nachladen, damit Änderungen anderer sichtbar werden
  setInterval(() => { if (data && !document.hidden) refresh().catch(() => {}); }, 60000);
  document.addEventListener("visibilitychange", () => { if (data && !document.hidden) refresh().catch(() => {}); });
  enterApp().catch(() => showLogin());
})();
