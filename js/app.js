import { kv, packs as packStore, clearAll, requestPersist } from "./store.js";
import { CONDITIONS, COND_BY_NAME, QUICK_CONDITIONS, DAMAGE_TYPES, ALL_TYPES } from "./conditions.js";
import { rollExpr, rollDamage, d20, degree, mapPenalty, resolveDamage, currentAC, currentHardness, actionsAtStart, cond } from "./rules.js";

export const APP_VERSION = "1.2.1";

/* ================================================================ state */
const DEFAULT_PALETTE = [
  { c: "#CC1F1A", n: "Red" }, { c: "#0072B2", n: "Blue" }, { c: "#F0E442", n: "Yellow" }, { c: "#009E73", n: "Green" },
  { c: "#E69F00", n: "Orange" }, { c: "#CC79A7", n: "Pink" }, { c: "#1E1E1E", n: "Black" }, { c: "#8C5A2B", n: "Brown" },
  { c: "#56B4E9", n: "Sky" }, { c: "#8A8A8A", n: "Gray" }, { c: "#6A3D9A", n: "Purple" }, { c: "#9ACD32", n: "Lime" },
];
const DEFAULT_SETTINGS = {
  party: [], partySize: 5, colors: true, palette: DEFAULT_PALETTE, theme: "dark", fontScale: 1,
  keepAwake: true, tiesMonstersFirst: true, skipDefeated: true, critMode: "double",
};
const S = {
  settings: structuredClone(DEFAULT_SETTINGS),
  packs: {},          // id -> pack
  enc: null,          // active encounter
  undo: [],
  setup: null,        // draft encounter setup
  secState: {},       // "pack:sec" -> state
  ui: { sel: null, tab: "creature", modal: null, lastRoll: null, glossQ: "", turnNotes: null },
  persisted: false,
};
const $app = () => document.getElementById("app");
const $modal = () => document.getElementById("modal");

/* ============================================================== helpers */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sgn = n => (n >= 0 ? "+" : "−") + Math.abs(n);
const clone = o => JSON.parse(JSON.stringify(o));
function textOn(hex) {
  const n = parseInt(String(hex || "#888888").slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? "#111" : "#fff";
}
const COND_WORDS = ["off-guard", "frightened", "stunned", "slowed", "prone", "grabbed", "restrained", "concealed", "clumsy", "sickened", "fatigued", "immobilized", "invisible", "undetected", "dazzled", "blinded", "enfeebled", "stupefied", "unconscious", "quickened", "drained", "doomed", "confused", "fascinated", "paralyzed", "deafened", "suppressed", "glitching"];
const COND_RE = new RegExp(`\\b(${COND_WORDS.join("|")})\\b`, "gi");
function fmt(t, { link = true } = {}) {
  let s = esc(t);
  if (link) s = s.replace(COND_RE, m => `<button class="tref" data-act="ref" data-ref="cond:${esc(m.toLowerCase())}">${m}</button>`);
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\/\/(.+?)\/\//g, "<i>$1</i>").replace(/\n/g, "<br>");
  return s;
}
function icon(cost) {
  const d = (x, fill = true) => `<path d="M${x} 2 L${x + 6} 8 L${x} 14 L${x - 6} 8 Z" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.6"'}/>`;
  let w = 14, inner = "";
  if (cost === "1") inner = d(7);
  else if (cost === "2") { w = 26; inner = d(7) + d(19); }
  else if (cost === "3") { w = 38; inner = d(7) + d(19) + d(31); }
  else if (cost === "free") inner = d(7, false);
  else if (cost === "reaction") { w = 16; inner = `<path d="M13 4 A6 6 0 1 0 13 12" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 1 L13 7 L8 4 Z" fill="currentColor"/>`; }
  else return "";
  return `<svg class="aico" viewBox="0 0 ${w} 16" width="${w}" height="16" aria-label="${cost === "1" ? "one action" : cost === "2" ? "two actions" : cost === "3" ? "three actions" : cost}" role="img">${inner}</svg>`;
}
function toast(msg, ms = 2600) {
  const t = document.getElementById("toast"); t.innerHTML = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), ms);
}
function pack(id) { return S.packs[id]; }
function crOf(c) {
  if (c.custom) return c.custom;
  const p = S.enc && pack(S.enc.packId); return p ? p.creatures[c.creatureId] : null;
}
function sectionOf(packId, secId) { const p = pack(packId); return p ? p.sections.find(s => s.id === secId) : null; }
function refText(key, packId) {
  if (key.startsWith("cond:")) { const c = COND_BY_NAME[key.slice(5)]; return c ? { name: c.name, kind: "condition", text: c.text, source: "Player Core, Conditions Appendix" } : null; }
  const tryPacks = packId ? [pack(packId), ...Object.values(S.packs)] : Object.values(S.packs);
  for (const p of tryPacks) if (p && p.refs && p.refs[key]) return p.refs[key];
  return null;
}

/* ========================================================= persistence */
let saveT = null;
function saveEnc() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { kv.set("enc", S.enc).catch(() => toast("Couldn't save — storage error")); kv.set("undo", S.undo.slice(-40)).catch(() => {}); }, 150);
}
function flushNow() { clearTimeout(saveT); if (S.enc !== undefined) { kv.set("enc", S.enc); kv.set("undo", S.undo.slice(-40)); } }
function saveSettings() { kv.set("settings", S.settings); applyTheme(); }
function mutate(fn, { snapshot = true } = {}) {
  if (snapshot && S.enc) { S.undo.push(JSON.stringify(S.enc)); if (S.undo.length > 100) S.undo.shift(); }
  fn();
  saveEnc(); render();
}
function logLine(text) { if (S.enc) { S.enc.log.push({ t: Date.now(), r: S.enc.round, text }); if (S.enc.log.length > 400) S.enc.log.shift(); } }

/* ============================================================ routing */
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name, a, b] = h.split("/");
  return { name: name || "library", a: a ? decodeURIComponent(a) : null, b: b ? decodeURIComponent(b) : null };
}
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
window.addEventListener("hashchange", () => { S.ui.modal = null; render(); });

/* ============================================================ render */
function render() {
  const r = route();
  const scrolls = [...document.querySelectorAll("[data-keep-scroll]")].map(el => [el.dataset.keepScroll, el.scrollTop]);
  let html = "";
  try {
    if (r.name === "library") html = viewLibrary();
    else if (r.name === "pack") html = viewPack(r.a);
    else if (r.name === "section") html = viewSection(r.a, r.b);
    else if (r.name === "setup") html = viewSetup();
    else if (r.name === "combat") html = viewCombat();
    else if (r.name === "glossary") html = viewGlossary();
    else if (r.name === "settings") html = viewSettings();
    else html = viewLibrary();
  } catch (e) {
    console.error(e);
    html = `<div class="page"><div class="panel warn">Something went wrong drawing this screen: ${esc(e.message)}. Your data is safe. <button data-act="go" data-href="#library">Back to library</button></div></div>`;
  }
  $app().innerHTML = html;
  for (const [k, top] of scrolls) { const el = document.querySelector(`[data-keep-scroll="${k}"]`); if (el) el.scrollTop = top; }
  renderModal();
  wakeLock(r.name === "combat" && S.settings.keepAwake);
}
function topbar(title, { back = null, right = "" } = {}) {
  return `<header class="topbar">
    ${back ? `<button class="iconbtn" data-act="go" data-href="${back}" aria-label="Back">‹</button>` : `<span class="brand">◆ Encounter Runner</span>`}
    <h1>${title}</h1>
    <div class="tb-right">${right}</div>
  </header>`;
}
function resumeBanner() {
  if (!S.enc) return "";
  const cur = S.enc.combatants.find(c => c.uid === S.enc.active);
  return `<button class="resume" data-act="go" data-href="#combat"><b>Resume encounter:</b> ${esc(S.enc.title)} · Round ${S.enc.round}${cur ? ` · ${esc(cur.name)}'s turn` : ""} <span class="go">›</span></button>`;
}

/* ------------------------------------------------------------ library */
function viewLibrary() {
  const ps = Object.values(S.packs).sort((a, b) => (a.adventure + a.chapter).localeCompare(b.adventure + b.chapter));
  return `${topbar("Library", { right: `<button data-act="go" data-href="#glossary">Glossary</button><button data-act="go" data-href="#settings">Settings</button>` })}
  <main class="page">
    ${resumeBanner()}
    ${S.settings.party.length ? "" : `<div class="panel hint">Add your players' characters in <a href="#settings">Settings</a> so they appear in initiative.</div>`}
    <div class="row between"><h2>Content packs</h2>
      <label class="btn primary">Import pack…<input type="file" accept=".json,application/json" data-in="importPack" hidden></label></div>
    ${ps.length ? `<div class="cards">${ps.map(p => `
      <button class="card" data-act="go" data-href="#pack/${encodeURIComponent(p.id)}">
        <span class="card-k">${esc(p.adventure)}</span>
        <span class="card-t">${esc(p.chapter)}</span>
        <span class="card-m">${p.sections.length} sections · ${Object.keys(p.creatures).length} stat blocks · rules checked ${esc(p.lookupsAsOf || "")}</span>
      </button>`).join("")}</div>`
      : `<div class="empty">No packs yet. Copy a pack file (.json) to this tablet, then tap <b>Import pack…</b>. Packs stay on this device.</div>`}
    <p class="muted small">Version ${APP_VERSION} · ${S.persisted ? "Storage is persistent" : "Storage may be cleared by the browser if space runs low — export a backup in Settings"}${navigator.onLine ? "" : " · Offline"}</p>
  </main>`;
}
const KIND_LABEL = { combat: "Combat", social: "Social", chase: "Chase", exploration: "Exploration", scene: "Scene", hazard: "Hazard" };
function viewPack(id) {
  const p = pack(id); if (!p) return `${topbar("Pack not found", { back: "#library" })}`;
  return `${topbar(esc(p.chapter), { back: "#library", right: `<button class="danger" data-act="delPack" data-id="${esc(p.id)}">Remove pack</button>` })}
  <main class="page">
    ${resumeBanner()}
    <ol class="seclist">${p.sections.map((s, i) => `
      <li><button data-act="go" data-href="#section/${encodeURIComponent(p.id)}/${encodeURIComponent(s.id)}">
        <span class="num">${i + 1}</span>
        <span class="t">${esc(s.title)}</span>
        <span class="kind k-${s.kind}">${KIND_LABEL[s.kind] || s.kind}</span>
        ${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ""}
      </button></li>`).join("")}</ol>
  </main>`;
}

/* ------------------------------------------------------------ section */
function secKey(p, s) { return `${p}:${s}`; }
function secState(packId, sec) {
  const k = secKey(packId, sec.id);
  if (!S.secState[k]) {
    S.secState[k] = {
      counters: (sec.counters || []).map(c => c.start || 0),
      obstacle: 0, points: (sec.obstacles || []).map(() => 0), horde: 0, round: 1,
      events: (sec.events || []).map(() => ""), variant: (sec.variants && sec.variants[0] && sec.variants[0].id) || null,
    };
  }
  return S.secState[k];
}
function saveSec(packId, secId) { kv.set("sec:" + secKey(packId, secId), S.secState[secKey(packId, secId)]); }
function counterHtml(label, val, max, act, extra = "") {
  return `<div class="counter"><span class="lbl">${esc(label)}</span>
    <button class="stepbtn" data-act="${act}" data-d="-1" ${extra}>−</button>
    <span class="val">${val}${max != null ? `<small>/${max}</small>` : ""}</span>
    <button class="stepbtn" data-act="${act}" data-d="1" ${extra}>+</button></div>`;
}
function npcCard(n, packId, secId) {
  const inf = n.influence;
  return `<article class="npc">
    <header><h3>${esc(n.name)}</h3><span class="muted">${esc(n.descriptor)}</span></header>
    <div class="npc-grid">
      <section class="wants"><h4>Wants</h4><ul>${(n.wants || []).map(w => `<li>${fmt(w)}</li>`).join("")}</ul></section>
      <section><h4>Knows</h4><ul>${(n.knows || []).map(w => `<li>${fmt(w)}</li>`).join("")}</ul></section>
    </div>
    ${n.personality ? `<p><b>Personality:</b> ${fmt(n.personality)}</p>` : ""}
    ${n.attitude ? `<p><b>Starting attitude:</b> ${fmt(n.attitude)}</p>` : ""}
    ${n.tips && n.tips.length ? `<ul class="tips">${n.tips.map(t => `<li>${fmt(t)}</li>`).join("")}</ul>` : ""}
    ${inf ? `<div class="influence">
      <h4>Influence · Perception +${inf.perception} · Will +${inf.will} · ${inf.rounds} rounds</h4>
      <p><b>Discovery</b> ${fmt(inf.discovery)}</p>
      <table class="inftab"><tbody>${inf.skills.map(s => `<tr><td class="dc">DC ${s.dc}</td><td>${fmt(s.skill)}${s.note ? ` <span class="muted">— ${fmt(s.note)}</span>` : ""}</td></tr>`).join("")}</tbody></table>
      <ul class="thresh">${inf.thresholds.map(t => `<li><b>${t.points}</b> ${fmt(t.text)}</li>`).join("")}</ul>
      <p><b>Resistances</b> ${fmt(inf.resistances)}</p>
      <p><b>Weaknesses</b> ${fmt(inf.weaknesses)}</p>
    </div>` : ""}
  </article>`;
}
function refChips(keys, packId) {
  const ks = [...new Set(keys)].filter(k => refText(k, packId));
  if (!ks.length) return "";
  return `<div class="refchips"><span class="muted small">Rules:</span> ${ks.map(k => `<button class="chip" data-act="ref" data-ref="${esc(k)}">${esc(refText(k, packId).name)}</button>`).join("")}</div>`;
}
function viewSection(packId, secId) {
  const p = pack(packId), s = sectionOf(packId, secId);
  if (!p || !s) return topbar("Not found", { back: "#library" });
  const st = secState(packId, s);
  const five = S.settings.partySize >= 5;
  let body = "";
  body += `<p class="lead">${fmt(s.summary)}</p>`;
  if (s.kind === "combat") {
    const v = s.variants.find(x => x.id === st.variant) || s.variants[0];
    body += `<div class="panel startbox">
      ${s.variants.length > 1 ? `<div class="seg">${s.variants.map(x => `<button aria-pressed="${x.id === v.id}" data-act="secVariant" data-id="${esc(x.id)}" data-pack="${esc(packId)}" data-sec="${esc(secId)}">${esc(x.label)}</button>`).join("")}</div>` : ""}
      <div class="row">${partySeg()}</div>
      <div class="slotprev">${(five ? v.p5 : v.p4).map(sl => { const cr = p.creatures[sl.creature]; return `<span class="slotchip">${sl.count} × ${esc(cr.name)}${sl.joinsRound ? ` <small>(joins round ${sl.joinsRound})</small>` : ""}</span>`; }).join("")}</div>
      ${five ? `<p class="scaling"><b>5 players:</b> ${fmt(v.scaling)}</p>` : ""}
      <button class="primary big" data-act="newSetup" data-pack="${esc(packId)}" data-sec="${esc(secId)}" data-variant="${esc(v.id)}">Set up encounter ›</button>
    </div>`;
  } else if (s.scaling && five) body += `<p class="scaling"><b>5 players:</b> ${fmt(s.scaling)}</p>`;
  if (s.counters && s.counters.length) body += `<div class="counters">${s.counters.map((c, i) => counterHtml(c.label, st.counters[i], c.max, "secCounter", `data-i="${i}" data-pack="${esc(packId)}" data-sec="${esc(secId)}"`)).join("")}</div>`;
  if (s.npcs) body += s.npcs.map(n => npcCard(p.npcs[n], packId, secId)).join("");
  if (s.obstacles) {
    const need = o => five ? (o.points5 || o.points) : o.points;
    body += `<div class="panel chase">
      <div class="row between"><h3>Chase</h3>
        <div class="row">${counterHtml("Round", st.round, null, "chaseRound", `data-pack="${esc(packId)}" data-sec="${esc(secId)}"`)}
        ${counterHtml("Horde at obstacle", st.horde + 1, s.obstacles.length, "chaseHorde", `data-pack="${esc(packId)}" data-sec="${esc(secId)}"`)}
        <button data-act="flat" data-dc="5">Horde flat check (DC 5)</button></div></div>
      <ol class="obstacles">${s.obstacles.map((o, i) => `<li class="${i === st.obstacle ? "cur" : i < st.obstacle ? "done" : ""}">
        <div class="row between"><b>${esc(o.name)}</b> <span class="muted">Obstacle level ${o.level} · needs ${need(o)} points</span></div>
        <p>${fmt(o.text)}</p><p><b>Overcome</b> ${fmt(o.overcome)}</p>
        ${counterHtml("Chase Points", st.points[i], need(o), "chasePts", `data-i="${i}" data-pack="${esc(packId)}" data-sec="${esc(secId)}"`)}
        ${i === st.obstacle ? `<span class="badge">PCs are here</span>` : ""} ${i === st.horde ? `<span class="badge warnb">Horde is here</span>` : ""}
      </li>`).join("")}</ol></div>`;
  }
  if (s.events) body += `<div class="panel"><h3>Events</h3><ol class="events">${s.events.map((e, i) => `<li>
      <div class="row between"><b>${esc(e.name)}</b>
      <div class="seg small">${["", "Done", "Failed"].map(x => `<button aria-pressed="${st.events[i] === x}" data-act="eventState" data-i="${i}" data-v="${x}" data-pack="${esc(packId)}" data-sec="${esc(secId)}">${x || "To do"}</button>`).join("")}</div></div>
      <p><b>Overcome</b> ${fmt(e.overcome)}</p>${e.bonus ? `<p>${fmt(e.bonus)}</p>` : ""}<p><b>Failure</b> ${fmt(e.failure)}</p>${e.treasure ? `<p><b>Treasure</b> ${fmt(e.treasure)}</p>` : ""}
      ${refChips(e.refs || [], packId)}</li>`).join("")}</ol></div>`;
  if (s.notes && s.notes.length) body += `<div class="panel"><h3>Notes</h3><ul class="notes">${s.notes.map(n => `<li>${fmt(n)}</li>`).join("")}</ul></div>`;
  if (s.treasure) body += `<div class="panel"><h3>Treasure</h3><p>${fmt(s.treasure)}</p></div>`;
  if (s.bookNote) body += `<p class="booknote">${fmt(s.bookNote)}</p>`;
  if (s.refs) body += refChips(s.refs, packId);
  return `${topbar(esc(s.title) + (s.tag ? ` <span class="tag">${esc(s.tag)}</span>` : ""), { back: `#pack/${encodeURIComponent(packId)}` })}
    <main class="page narrow">${resumeBanner()}${body}</main>`;
}
function partySeg() {
  return `<span class="muted">Players</span><div class="seg">${[4, 5].map(n => `<button aria-pressed="${S.settings.partySize === n}" data-act="partySize" data-n="${n}">${n}</button>`).join("")}</div>`;
}

/* -------------------------------------------------------------- setup */
function buildSetup(packId, secId, variantId) {
  const p = pack(packId), s = sectionOf(packId, secId);
  const v = s.variants.find(x => x.id === variantId) || s.variants[0];
  const slots = S.settings.partySize >= 5 ? v.p5 : v.p4;
  const pal = S.settings.palette;
  const rows = []; let colorRun = 0;
  const countBy = {};
  slots.forEach(sl => { countBy[sl.creature] = (countBy[sl.creature] || 0) + sl.count; });
  const seen = {};
  for (const sl of slots) {
    const cr = p.creatures[sl.creature];
    for (let k = 0; k < sl.count; k++) {
      seen[sl.creature] = (seen[sl.creature] || 0) + 1;
      let color = null, colorName = null;
      if (cr.kind !== "hazard" && !cr.ally && S.settings.colors && pal.length) { const pc = pal[colorRun % pal.length]; color = pc.c; colorName = pc.n; colorRun++; }
      const skill = sl.initSkill || (cr.kind === "hazard" ? "Stealth" : "Perception");
      const mod = initModFor(cr, skill) + (sl.initAdj || 0);
      rows.push({
        uid: uid(), kind: cr.kind === "hazard" ? "hazard" : "monster", creatureId: sl.creature, baseName: cr.name,
        color, colorName, num: countBy[sl.creature] > 1 ? seen[sl.creature] : null,
        initSkill: skill, initMod: mod, initNote: [sl.initAdj ? `${sgn(sl.initAdj)} ${sl.initNote || ""}`.trim() : "", sl.initSkill && sl.initNote && !sl.initAdj ? sl.initNote : ""].filter(Boolean).join("; "),
        init: null, joinsRound: sl.joinsRound || 0, startConditions: sl.startConditions || [],
      });
    }
  }
  const pcs = S.settings.party.map(pc => ({ uid: uid(), kind: "pc", name: pc.name, include: true, init: null, pcId: pc.id }));
  return { packId, secId, variantId: v.id, partySize: S.settings.partySize, rows, pcs, title: s.title };
}
function initModFor(cr, skill) {
  if (!cr) return 0;
  if (skill === "Perception") return cr.perception || 0;
  if (skill === "Stealth" && cr.kind === "hazard") return cr.stealth || 0;
  const sk = (cr.skills || []).find(x => x.name.toLowerCase() === skill.toLowerCase());
  if (sk) return sk.mod;
  return cr.perception || 0;
}
function rowName(r) {
  if (r.colorName && S.settings.colors) return `${r.baseName} · ${r.colorName}`;
  return r.num ? `${r.baseName} ${r.num}` : r.baseName;
}
function setupAdd(creatureId) {
  const st = S.setup; const p = pack(st.packId); const cr = p.creatures[creatureId];
  const like = st.rows.find(r => r.creatureId === creatureId);
  let color = null, colorName = null;
  if (cr.kind !== "hazard" && !cr.ally && S.settings.colors && S.settings.palette.length) {
    const used = new Set(st.rows.map(r => r.color));
    const pc = S.settings.palette.find(x => !used.has(x.c)) || S.settings.palette[st.rows.length % S.settings.palette.length];
    color = pc.c; colorName = pc.n;
  }
  const skill = like ? like.initSkill : (cr.kind === "hazard" ? "Stealth" : "Perception");
  st.rows.push({
    uid: uid(), kind: cr.kind === "hazard" ? "hazard" : "monster", creatureId, baseName: cr.name, color, colorName, num: null,
    initSkill: skill, initMod: like ? like.initMod : initModFor(cr, skill), initNote: like ? like.initNote : "",
    init: null, joinsRound: 0, startConditions: like ? clone(like.startConditions) : [],
  });
  renumberSetup();
}
function renumberSetup() {
  const count = {}, seen = {};
  for (const r of S.setup.rows) count[r.creatureId] = (count[r.creatureId] || 0) + 1;
  for (const r of S.setup.rows) { seen[r.creatureId] = (seen[r.creatureId] || 0) + 1; r.num = count[r.creatureId] > 1 ? seen[r.creatureId] : null; }
}
function viewSetup() {
  const st = S.setup;
  if (!st) return `${topbar("Encounter setup", { back: "#library" })}<main class="page"><div class="empty">Pick an encounter from a pack first.</div></main>`;
  const p = pack(st.packId), s = sectionOf(st.packId, st.secId);
  const v = s.variants.find(x => x.id === st.variantId);
  const missing = st.rows.filter(r => r.init == null && !p.creatures[r.creatureId].simple).length + st.pcs.filter(r => r.include && r.init == null).length;
  return `${topbar(`Set up: ${esc(s.title)}`, { back: `#section/${encodeURIComponent(st.packId)}/${encodeURIComponent(st.secId)}` })}
  <main class="page setup">
    <div class="row between">
      <div class="row">${s.variants.length > 1 ? `<div class="seg">${s.variants.map(x => `<button aria-pressed="${x.id === st.variantId}" data-act="setupVariant" data-id="${esc(x.id)}">${esc(x.label)}</button>`).join("")}</div>` : ""}
      ${partySeg()}</div>
      <button class="primary" data-act="rollAllInit">🎲 Roll all monsters</button>
    </div>
    ${st.partySize >= 5 ? `<p class="scaling"><b>5 players:</b> ${fmt(v.scaling)}</p>` : ""}
    <div class="setup-grid">
      <section class="panel"><h3>Enemies & hazards</h3>
        <table class="inittab"><thead><tr><th></th><th>Name</th><th>Initiative</th><th></th><th>Result</th><th></th></tr></thead><tbody>
        ${st.rows.map(r => `<tr>
          <td>${r.kind === "hazard" ? `<span class="chipc hz">HZ</span>` : `<button class="chipc" style="background:${r.color || "transparent"};color:${textOn(r.color)}" data-act="cycleColor" data-uid="${r.uid}" aria-label="Change color">${r.color ? "" : "—"}</button>`}</td>
          <td><b>${esc(rowName(r))}</b>${r.joinsRound ? ` <span class="badge">joins round ${r.joinsRound}</span>` : ""}${r.startConditions.length ? ` <span class="badge">${r.startConditions.map(c => esc(c.name + (c.value ? " " + c.value : ""))).join(", ")}</span>` : ""}</td>
          <td>${esc(r.initSkill)} ${sgn(r.initMod)}${r.initNote ? ` <span class="muted small">(${esc(r.initNote)})</span>` : ""}</td>
          ${p.creatures[r.creatureId].simple ? `<td></td><td class="muted small">no turn</td>` : `<td><button data-act="rollInit" data-uid="${r.uid}">🎲</button></td>
          <td><input type="number" inputmode="numeric" class="initin" value="${r.init ?? ""}" data-in="setInit" data-uid="${r.uid}"></td>`}
          <td><button class="mini x" data-act="setupRemove" data-uid="${r.uid}" aria-label="Remove">×</button></td>
        </tr>`).join("")}</tbody></table>
        <div class="setupsteps">${[...new Set(st.rows.map(r => r.creatureId))].map(id => counterHtml(p.creatures[id].name, st.rows.filter(r => r.creatureId === id).length, null, "setupStep", `data-id="${esc(id)}"`)).join("")}
          <button data-act="setupAddOpen">+ Add creature…</button></div>
      </section>
      <section class="panel"><h3>Party</h3>
        ${st.pcs.length ? `<table class="inittab"><tbody>${st.pcs.map(r => `<tr>
          <td><input type="checkbox" ${r.include ? "checked" : ""} data-in="pcInclude" data-uid="${r.uid}"></td>
          <td><b>${esc(r.name)}</b></td>
          <td><input type="number" inputmode="numeric" class="initin" value="${r.init ?? ""}" data-in="setInit" data-uid="${r.uid}" placeholder="roll"></td></tr>`).join("")}</tbody></table>`
          : `<p class="muted">No party roster yet. <a href="#settings">Add characters in Settings</a>, or add them later from the combat screen.</p>`}
      </section>
    </div>
    <div class="row end">
      <span class="muted" id="missingCount">${missing ? `${missing} without initiative (they'll start at 0)` : ""}</span>
      <button class="primary big" data-act="startEnc">Start encounter ›</button>
    </div>
  </main>`;
}
function startEncounter() {
  const st = S.setup; const p = pack(st.packId);
  const combatants = [];
  for (const r of st.rows) {
    const cr = p.creatures[r.creatureId];
    combatants.push({
      uid: r.uid, kind: r.kind, creatureId: r.creatureId, name: rowName(r), color: r.color, colorName: r.colorName,
      init: r.init ?? 0, hp: cr.hp ?? null, maxHp: cr.hp ?? null, temp: 0, broken: false, defeated: false,
      conditions: r.startConditions.map(c => ({ id: uid(), name: c.name, value: c.value || null })),
      permanent: cr.permanent || [], joinsRound: r.joinsRound || 0, delayed: false, noTurn: !!cr.simple, ally: !!cr.ally,
      counters: (cr.counters || []).map(c => ({ label: c.label, val: c.start || 0, max: c.max, down: !!c.down })),
      cooldowns: {}, used: {},
    });
  }
  for (const r of st.pcs) if (r.include) combatants.push({ uid: r.uid, kind: "pc", name: r.name, init: r.init ?? 0, hp: null, maxHp: null, temp: 0, conditions: [], permanent: [], joinsRound: 0, delayed: false, counters: [], cooldowns: {}, used: {} });
  sortByInit(combatants);
  const sec = sectionOf(st.packId, st.secId);
  S.enc = { id: uid(), packId: st.packId, secId: st.secId, variantId: st.variantId, partySize: st.partySize, title: sec.title, round: 1, active: null, combatants, log: [], started: Date.now() };
  S.undo = [];
  const first = eligible(S.enc.combatants)[0];
  S.enc.active = first ? first.uid : null;
  logLine(`Encounter started: ${sec.title} (${st.partySize} players)`);
  if (first) { const n = startOfTurn(first); S.ui.turnNotes = { uid: first.uid, notes: n }; logLine(`${first.name}'s turn: ${n.join("; ").replace(/<[^>]+>/g, "")}`); }
  S.ui.sel = first ? first.uid : null; S.ui.tab = "creature";
  S.setup = null;
  saveEnc(); go("#combat");
}
function sortByInit(list) {
  const kindRank = c => (S.settings.tiesMonstersFirst ? (c.kind === "pc" ? 1 : 0) : 0);
  list.sort((a, b) => (b.init - a.init) || (kindRank(a) - kindRank(b)));
}
// Insert (or re-insert) one combatant by initiative without disturbing anyone else's manual order.
function placeByInit(list, c) {
  const i = list.indexOf(c); if (i >= 0) list.splice(i, 1);
  const pcLast = S.settings.tiesMonstersFirst;
  let at = list.findIndex(x => x.init < c.init || (x.init === c.init && pcLast && c.kind !== "pc" && x.kind === "pc"));
  if (at < 0) at = list.length;
  list.splice(at, 0, c);
}

/* ------------------------------------------------------------- combat */
function eligible(list) {
  return list.filter(c => !c.noTurn && !c.delayed && !(c.joinsRound && S.enc.round < c.joinsRound) && !(S.settings.skipDefeated && c.defeated));
}
function startOfTurn(c) {
  const notes = [];
  const cr = crOf(c);
  // timed conditions ending at start of this creature's turn
  expire(c.uid, "start", notes);
  if (c.kind !== "pc" && cr) {
    if (cr.fastHealing && c.hp > 0 && c.hp < c.maxHp) {
      const b = c.hp; c.hp = Math.min(c.maxHp, c.hp + cr.fastHealing); notes.push(`Fast healing ${cr.fastHealing}: HP ${b} → ${c.hp}`);
    }
    for (const k of Object.keys(c.cooldowns || {})) {
      c.cooldowns[k]--; if (c.cooldowns[k] <= 0) { delete c.cooldowns[k]; notes.push(`${k} is available again`); }
      else notes.push(`${k}: ${c.cooldowns[k]} more round${c.cooldowns[k] === 1 ? "" : "s"}`);
    }
    c.used = {};
  }
  if (cr && cr.turnTable && cr.turnTable.options && cr.turnTable.options.length) {
    c.conditions = (c.conditions || []).filter(x => x.src !== "table");
    const opt = cr.turnTable.options[Math.floor(Math.random() * cr.turnTable.options.length)];
    c.tableState = opt.name;
    let extra = "";
    if (opt.heal && c.hp != null) { const r = rollExpr(opt.heal); const b = c.hp; c.hp = Math.min(c.maxHp, c.hp + r.total); if (c.hp > 0) c.defeated = false; extra = ` (regains ${r.total}: HP ${b} → ${c.hp})`; }
    for (const k of opt.conds || []) c.conditions.push({ id: uid(), name: k.name, value: k.value || null, src: "table", untilEnd: !!k.untilEnd });
    notes.push(`<b>${esc(cr.turnTable.label || "Random state")}: ${esc(opt.name)}</b> — ${fmt(opt.text, { link: false })}${extra}`);
  }
  const base = c.kind === "hazard" && cr && cr.routine ? cr.routine.actions : 3;
  const a = actionsAtStart(c, base);
  notes.push(...a.notes);
  notes.unshift(`<b>${a.actions} action${a.actions === 1 ? "" : "s"}</b> this turn${c.kind === "hazard" ? " (routine)" : ""}`);
  return notes;
}
function endOfTurn(c) {
  const notes = [];
  const crx = crOf(c);
  if (crx && crx.turnTable && c.tableState) {
    const opt = crx.turnTable.options.find(o => o.name === c.tableState);
    if (opt && opt.endDamage) { const r = rollExpr(opt.endDamage); notes.push(`<b>${esc(opt.name)}</b>: ${esc(opt.endText || "")} ${esc(opt.endDamage)} = <b>${r.total}</b>`); }
    const before = c.conditions.length; c.conditions = c.conditions.filter(x => !(x.src === "table" && x.untilEnd));
    if (c.conditions.length < before) notes.push(`${esc(opt ? opt.name : "State")} effect ends`);
  }
  const fr = cond(c, "Frightened");
  if (fr && fr.value) { fr.value--; notes.push(fr.value > 0 ? `Frightened drops to ${fr.value}` : "Frightened ends"); if (fr.value <= 0) c.conditions = c.conditions.filter(x => x !== fr); }
  const cr = crOf(c);
  for (const pd of (c.conditions || []).filter(x => x.name === "Persistent Damage")) {
    if (c.kind === "pc" || !cr || c.hp == null) { notes.push(`Remind: persistent ${pd.ptype || ""} ${pd.dice || ""} damage, then DC 15 flat check`); continue; }
    const r = rollExpr(pd.dice || "1");
    const res = resolveDamage(cr, c, [{ amount: r.total, type: pd.ptype || "untyped" }], {});
    const b = c.hp; c.hp = res.hp; c.temp = res.temp; if (res.breaks) c.broken = true;
    if (c.hp <= 0 && c.kind !== "pc") c.defeated = true;
    const fl = d20(0);
    notes.push(`Persistent ${pd.ptype}: ${pd.dice} = ${r.total} → takes ${res.total} (HP ${b} → ${c.hp}). Flat check DC 15: ${fl.nat} — ${fl.nat >= 15 ? "<b>ends</b>" : "continues"}`);
    if (fl.nat >= 15) c.conditions = c.conditions.filter(x => x !== pd);
  }
  for (const ct of c.counters || []) if (ct.down && ct.val > 0) { ct.val--; notes.push(`${ct.label}: ${ct.val}${ct.val === 0 ? " — <b>time's up!</b>" : ""}`); }
  expire(c.uid, "end", notes);
  return notes;
}
function expire(whoUid, edge, notes) {
  for (const c of S.enc.combatants) {
    const keep = [];
    for (const x of c.conditions || []) {
      if (x.dur && x.dur.who === whoUid && x.dur.edge === edge) {
        if (x.dur.skip) { x.dur.skip = false; keep.push(x); continue; }
        x.dur.n = (x.dur.n || 1) - 1;
        if (x.dur.n <= 0) { notes.push(`${c.name}: ${x.name}${x.value ? " " + x.value : ""} ends`); continue; }
      }
      keep.push(x);
    }
    c.conditions = keep;
  }
}
function nextTurn(dir = 1) {
  mutate(() => {
    const enc = S.enc; const order = enc.combatants;
    const cur = order.find(c => c.uid === enc.active);
    if (dir < 0) { // previous: no automation, just move pointer back
      const el = eligible(order); const i = el.findIndex(c => c.uid === enc.active);
      if (i > 0) enc.active = el[i - 1].uid;
      else if (enc.round > 1) { enc.round--; const el2 = eligible(order); enc.active = el2[el2.length - 1].uid; }
      S.ui.turnNotes = null; S.ui.sel = enc.active; return;
    }
    let endNotes = [];
    if (cur) { endNotes = endOfTurn(cur); if (endNotes.length) logLine(`End of ${cur.name}'s turn: ${endNotes.join("; ").replace(/<[^>]+>/g, "")}`); }
    // find next eligible after current position in full order
    const idx = order.findIndex(c => c.uid === enc.active);
    let next = null;
    for (let i = idx + 1; i < order.length; i++) if (eligible([order[i]]).length) { next = order[i]; break; }
    if (!next) {
      enc.round++; logLine(`— Round ${enc.round} —`);
      const joiners = order.filter(c => c.joinsRound === enc.round);
      if (joiners.length) toast(`${joiners.map(j => esc(j.name)).join(", ")} join${joiners.length === 1 ? "s" : ""} the fight this round`, 4000);
      next = eligible(order)[0] || null;
    }
    enc.active = next ? next.uid : null;
    if (next) {
      const notes = startOfTurn(next);
      S.ui.turnNotes = { uid: next.uid, notes, prev: cur ? { name: cur.name, notes: endNotes } : null };
      logLine(`${next.name}'s turn: ${notes.join("; ").replace(/<[^>]+>/g, "")}`);
      S.ui.sel = next.uid;
    }
    S.ui.tab = "creature";
  });
}
function hpBar(c) {
  if (c.hp == null || !c.maxHp) return "";
  const pct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
  const cls = pct <= 25 ? "low" : pct <= 50 ? "mid" : "";
  return `<span class="hpbar ${cls}"><i style="width:${pct}%"></i></span>`;
}
function condChips(c, small = true) {
  const list = [...(c.permanent || []).map(p => ({ name: p.name, value: p.value, perm: true })), ...(c.conditions || [])];
  return list.map(x => `<span class="cchip ${x.perm ? "perm" : ""}">${esc(x.name === "Persistent Damage" ? `Persistent ${x.ptype || ""} ${x.dice || ""}` : x.name)}${x.value ? " " + x.value : ""}${!small && x.dur ? ` <small>⏱</small>` : ""}</span>`).join("");
}
function colorDot(c) {
  if (c.kind === "pc") return `<span class="dot pc">PC</span>`;
  if (c.kind === "hazard") return `<span class="dot hz">${c.noTurn && crOf(c) && crOf(c).object ? "OBJ" : "HZ"}</span>`;
  if (c.ally) return `<span class="dot ally">ALLY</span>`;
  return `<span class="dot" style="background:${c.color || "var(--line)"};color:${textOn(c.color)}">${c.color ? "" : esc((c.name || "?")[0])}</span>`;
}
function viewCombat() {
  const enc = S.enc;
  if (!enc) return `${topbar("Combat", { back: "#library" })}<main class="page"><div class="empty">No active encounter. Start one from a pack.</div></main>`;
  const order = enc.combatants;
  const cur = order.find(c => c.uid === enc.active);
  if (!S.ui.sel || !order.find(c => c.uid === S.ui.sel)) S.ui.sel = enc.active;
  const waiting = order.filter(c => c.joinsRound && enc.round < c.joinsRound);
  const delayed = order.filter(c => c.delayed);
  const noturn = order.filter(c => c.noTurn);
  const main = order.filter(c => !waiting.includes(c) && !delayed.includes(c) && !c.noTurn);
  const row = c => {
    const cr = crOf(c);
    const ac = c.kind === "pc" ? null : currentAC(cr, c);
    return `<li class="crow ${c.uid === enc.active ? "active" : ""} ${c.uid === S.ui.sel ? "sel" : ""} ${c.defeated ? "dead" : ""}" data-act="sel" data-uid="${c.uid}">
      <span class="grip" data-grip="${c.uid}" aria-label="Drag to reorder">⋮⋮</span>
      ${c.noTurn ? `<span class="init blank"></span>` : `<button class="init" data-act="editInit" data-uid="${c.uid}" aria-label="Edit initiative">${c.init}</button>`}
      ${colorDot(c)}
      <span class="cname"><b>${esc(c.name)}</b><span class="cconds">${condChips(c)}</span></span>
      <span class="cstats">${c.hp != null ? `<span class="hpn">${c.hp}${c.temp ? `<small>+${c.temp}</small>` : ""}<small>/${c.maxHp}</small></span>${hpBar(c)}` : ""}
        ${ac != null ? `<span class="acn">AC ${ac}</span>` : ""}
        ${(c.counters || []).map(ct => `<span class="ctn">${esc(ct.label.split(" ")[0])} ${ct.val}</span>`).join("")}</span>
    </li>`;
  };
  const curName = cur ? esc(cur.name) : "—";
  return `<div class="combat">
    <header class="topbar ctop">
      <button class="iconbtn" data-act="go" data-href="#library" aria-label="Library">‹</button>
      <div class="ctitle"><span class="small muted">${esc(enc.title)}</span><b>Round ${enc.round} · ${curName}</b></div>
      <div class="tb-right">
        <button data-act="undo" ${S.undo.length ? "" : "disabled"}>↶ Undo</button>
        <button data-act="menu">⋯</button>
        <button data-act="prevTurn" aria-label="Previous turn">◀</button>
        <button class="primary next" data-act="nextTurn">Next turn ▶</button>
      </div>
    </header>
    <div class="panes">
      <section class="pane-left" data-keep-scroll="left">
        <ol class="order" id="mainOrder">${main.map(row).join("")}</ol>
        ${delayed.length ? `<h4 class="subh">Delaying</h4><ol class="order">${delayed.map(c => `<li class="crow delayed" data-act="sel" data-uid="${c.uid}">${colorDot(c)}<span class="cname"><b>${esc(c.name)}</b></span><button class="primary" data-act="undelay" data-uid="${c.uid}">Act now</button></li>`).join("")}</ol>` : ""}
        ${noturn.length ? `<h4 class="subh">Hazards & objects (no turn)</h4><ol class="order">${noturn.map(c => row(c).replace('<span class="grip"', '<span class="grip hidden"')).join("")}</ol>` : ""}
        ${waiting.length ? `<h4 class="subh">Joining later</h4><ol class="order">${waiting.map(c => `<li class="crow waiting ${c.uid === S.ui.sel ? "sel" : ""}" data-act="sel" data-uid="${c.uid}"><span class="init">${c.init}</span>${colorDot(c)}<span class="cname"><b>${esc(c.name)}</b><span class="muted small">joins round ${c.joinsRound}</span></span><button data-act="joinNow" data-uid="${c.uid}">Join now</button></li>`).join("")}</ol>` : ""}
        <div class="leftfoot"><button data-act="addCombatant">+ Add combatant</button></div>
      </section>
      <section class="pane-right">
        <nav class="tabs">${[["creature", "Combatant"], ["notes", "Encounter notes"], ["log", "Log"]].map(([k, l]) => `<button aria-pressed="${S.ui.tab === k}" data-act="tab" data-tab="${k}">${l}</button>`).join("")}</nav>
        <div class="rscroll" data-keep-scroll="right">${S.ui.tab === "notes" ? encNotes() : S.ui.tab === "log" ? encLog() : detail(order.find(c => c.uid === S.ui.sel))}</div>
        ${S.ui.lastRoll ? `<div class="rollbar">${S.ui.lastRoll}<button class="x" data-act="clearRoll" aria-label="Dismiss">×</button></div>` : ""}
      </section>
    </div>
  </div>`;
}
function encNotes() {
  const enc = S.enc; const s = sectionOf(enc.packId, enc.secId); const p = pack(enc.packId);
  if (!s) return "";
  const v = (s.variants || []).find(x => x.id === enc.variantId);
  return `<div class="pad">
    <h2>${esc(s.title)} ${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ""}</h2>
    <p class="lead">${fmt(s.summary)}</p>
    ${v ? `<p><b>${esc(v.label)}</b>${enc.partySize >= 5 ? ` · <b>5 players:</b> ${fmt(v.scaling)}` : ""}</p>` : ""}
    ${s.tactics ? `<h3>Tactics</h3><ul>${Object.entries(s.tactics).filter(([k]) => enc.combatants.some(c => c.creatureId === k)).map(([k, t]) => `<li><b>${esc(p.creatures[k].name)}:</b> ${fmt(t)}</li>`).join("")}</ul>` : ""}
    ${s.notes ? `<h3>Notes</h3><ul class="notes">${s.notes.map(n => `<li>${fmt(n)}</li>`).join("")}</ul>` : ""}
    ${s.treasure ? `<h3>Treasure</h3><p>${fmt(s.treasure)}</p>` : ""}
    ${s.bookNote ? `<p class="booknote">${fmt(s.bookNote)}</p>` : ""}
  </div>`;
}
function encLog() {
  const l = S.enc.log.slice().reverse();
  return `<div class="pad"><ul class="log">${l.map(x => `<li><span class="muted">R${x.r}</span> ${x.text}</li>`).join("")}</ul></div>`;
}
function detail(c) {
  if (!c) return `<div class="pad empty">Select a combatant.</div>`;
  const cr = crOf(c);
  const enc = S.enc;
  const tn = S.ui.turnNotes && S.ui.turnNotes.uid === c.uid && c.uid === enc.active ? S.ui.turnNotes : null;
  let h = `<div class="pad">`;
  if (tn) {
    h += `<div class="turnnotes">${tn.prev && tn.prev.notes.length ? `<div class="muted small">End of ${esc(tn.prev.name)}'s turn: ${tn.prev.notes.join(" · ")}</div>` : ""}
      <div>${tn.notes.join(" · ")}</div></div>`;
  }
  h += `<div class="dhead">${colorDot(c)}<div class="dname"><h2>${esc(c.name)}</h2>${cr ? `<span class="muted">${esc(cr.kind === "hazard" ? "Hazard" : "Creature")} ${cr.level}${cr.sourceOverride === "elite adjustment" ? " · elite" : ""}</span>` : `<span class="muted">Player character</span>`}</div>
    <div class="dbtns">
      ${c.uid === enc.active && c.kind !== "hazard" ? `<button data-act="delay" data-uid="${c.uid}">Delay</button>` : ""}
      <button data-act="rename" data-uid="${c.uid}">Rename</button>
      ${c.kind !== "pc" ? `<button data-act="recolor" data-uid="${c.uid}">Color</button>` : ""}
      <button class="danger" data-act="remove" data-uid="${c.uid}">Remove</button>
    </div></div>`;
  // HP block
  if (c.kind !== "pc" && c.hp != null) {
    const ac = currentAC(cr, c), hard = currentHardness(cr, c);
    h += `<div class="hpblock ${c.defeated ? "dead" : ""}">
      <div class="hpbig"><span class="lbl">HP</span><b>${c.hp}</b><small>/ ${c.maxHp}</small>${c.temp ? `<span class="temp">+${c.temp} temp</span>` : ""}</div>
      <div class="acbig"><span class="lbl">AC</span><b>${ac}</b>${hard ? `<small>Hardness ${hard}</small>` : ""}</div>
      <div class="hpbtns">
        <button class="dmg big" data-act="pad" data-mode="damage" data-uid="${c.uid}">− Damage</button>
        <button class="heal big" data-act="pad" data-mode="heal" data-uid="${c.uid}">+ Heal</button>
        <button data-act="pad" data-mode="temp" data-uid="${c.uid}">Temp HP</button>
        ${cr && cr.broken ? `<button aria-pressed="${!!c.broken}" data-act="toggleBroken" data-uid="${c.uid}">${c.broken ? "Armor broken" : "Armor intact"}</button>` : ""}
        <button aria-pressed="${!!c.defeated}" data-act="toggleDefeated" data-uid="${c.uid}">${c.defeated ? "Defeated" : "Mark defeated"}</button>
      </div></div>`;
  } else if (c.kind === "hazard") {
    h += `<div class="hpblock"><div class="hpbtns"><button aria-pressed="${!!c.defeated}" data-act="toggleDefeated" data-uid="${c.uid}">${c.defeated ? "Disabled / done" : "Mark disabled"}</button></div></div>`;
  }
  // counters
  if (c.counters && c.counters.length) h += `<div class="counters">${c.counters.map((ct, i) => counterHtml(ct.label, ct.val, ct.max, "cCounter", `data-uid="${c.uid}" data-i="${i}"`)).join("")}</div>`;
  // conditions
  h += `<div class="conds"><span class="lbl">Conditions</span>
    ${(c.permanent || []).map(p => `<span class="cchip perm">${esc(p.name)} ${p.value || ""} <small>permanent</small></span>`).join("")}
    ${(c.conditions || []).map(x => `<span class="cchip big">
      <button class="cname" data-act="ref" data-ref="cond:${esc(x.name.toLowerCase())}">${esc(x.name === "Persistent Damage" ? `Persistent ${x.ptype || ""} ${x.dice || ""}` : x.name)}</button>
      ${x.value != null && x.name !== "Persistent Damage" ? `<button class="mini" data-act="condVal" data-uid="${c.uid}" data-id="${x.id}" data-d="-1">−</button><b>${x.value}</b><button class="mini" data-act="condVal" data-uid="${c.uid}" data-id="${x.id}" data-d="1">+</button>` : ""}
      ${x.dur ? `<small class="dur">${esc(durText(x.dur))}</small>` : ""}
      <button class="mini x" data-act="condDel" data-uid="${c.uid}" data-id="${x.id}" aria-label="Remove">×</button></span>`).join("")}
    <button class="addc" data-act="condAdd" data-uid="${c.uid}">+ Condition</button></div>`;
  if (cr) h += statblock(cr, c);
  else if (c.kind === "pc") h += `<p class="muted">Players track their own HP. Conditions here get end-of-turn reminders (frightened drops automatically).</p>`;
  h += `</div>`;
  return h;
}
function durText(d) {
  const who = S.enc.combatants.find(c => c.uid === d.who);
  const nm = who ? who.name : "?";
  return `until ${d.edge} of ${nm}'s ${d.n > 1 ? d.n + " turns" : "next turn"}`;
}
function rollBtn(label, mod, extra = "") {
  return `<button class="rb" data-act="roll" data-mod="${mod}" data-label="${esc(label)}" ${extra}>${sgn(mod)}</button>`;
}
function activeConds(c, cr, range) {
  return (cr.conditional || []).filter(x => (c.toggles || {})[x.id] && (x.applies === "all" || x.applies === range));
}
function damageLine(c, cr, s, crit) {
  const mode = S.settings.critMode;
  const base = rollDamage(s.damage, crit, mode);
  const parts = [{ total: base.total, type: s.type, text: base.text, expr: base.expr }];
  for (const x of activeConds(c, cr, s.range || "melee")) { const r = rollDamage(x.dice, crit, mode); parts.push({ total: r.total, type: x.type === "same" ? s.type : x.type, text: r.text, expr: r.expr, label: x.label }); }
  const total = parts.reduce((a, q) => a + q.total, 0);
  const desc = parts.map(q => `${q.total} ${q.type}${q.label ? ` (${q.label})` : ""}`).join(" + ");
  // full working, e.g. "1d8+4: [6] +4 = 10 fire + Show No Mercy 2: 2 = 2 fire"
  const calc = parts.map(q => `${q.label ? q.label + " " : ""}${q.expr}${/d/i.test(q.expr) || crit ? `: ${q.text}` : ""} = ${q.total} ${q.type}`).join("  +  ");
  return { total, desc, calc, detail: parts.map(q => q.text).join("; ") };
}
function strikeOf(c, el) {
  const cr = crOf(c); if (!cr) return null;
  if (el.dataset.si != null) return cr.strikes[+el.dataset.si];
  if (el.dataset.ai != null) { const a = cr.abilities[+el.dataset.ai]; return { name: a.name, damage: a.rollDamage, type: a.rollType || "", range: a.range || "melee" }; }
  return null;
}
function statblock(cr, c) {
  const enc = S.enc; const p = pack(enc.packId); const sec = sectionOf(enc.packId, enc.secId);
  const tactics = sec && sec.tactics && sec.tactics[c.creatureId];
  const allRefs = [...(cr.refs || [])];
  const ab = place => (cr.abilities || []).map((a, ai) => ({ a, ai })).filter(({ a }) => (a.place || "bottom") === place).map(({ a, ai }) => {
    (a.refs || []).forEach(r => allRefs.push(r));
    const cd = c.cooldowns && c.cooldowns[a.name];
    const used = c.used && c.used[a.name];
    const atkAndDmg = a.rollAttack != null && a.rollDamage;
    return `<div class="ability"><b>${esc(a.name)}</b> ${a.cost ? icon(a.cost) : ""}${a.traits ? ` <span class="muted">(${esc(a.traits)})</span>` : ""} ${fmt(a.text)}
      ${(a.refs || []).map(r => refText(r, enc.packId) ? `<button class="chip" data-act="ref" data-ref="${esc(r)}">${esc(refText(r, enc.packId).name)}</button>` : "").join("")}
      ${atkAndDmg ? `<button class="rb atk" data-act="roll" data-strike="1" data-uid="${c.uid}" data-ai="${ai}" data-mod="${a.rollAttack}" data-label="${esc(`${c.name}: ${a.name}`)}">Attack ${sgn(a.rollAttack)}</button>`
        : a.rollAttack != null ? rollBtn(`${c.name}: ${a.rollLabel || a.name}`, a.rollAttack) : ""}
      ${a.rollDamage ? `<button class="rb dmgroll" data-act="rollDmg" data-uid="${c.uid}" data-ai="${ai}" data-label="${esc(c.name + ": " + a.name)}">${esc(a.rollDamage)} ${esc(a.rollType || "")}</button>` : ""}
      ${a.cooldown ? (cd ? `<span class="badge warnb">Recharging: ${cd} round${cd === 1 ? "" : "s"}</span> <button class="mini" data-act="cdClear" data-uid="${c.uid}" data-name="${esc(a.name)}">Reset</button>` : `<button class="rb" data-act="useCd" data-uid="${c.uid}" data-name="${esc(a.name)}" data-expr="${esc(a.cooldown)}">Use (roll ${esc(a.cooldown)})</button>`) : ""}
      ${a.frequency === "round" ? `<button class="rb" aria-pressed="${!!used}" data-act="useRound" data-uid="${c.uid}" data-name="${esc(a.name)}">${used ? "Used this round" : "Mark used"}</button>` : ""}
    </div>`;
  }).join("");
  let h = `<div class="sb">`;
  if (tactics) h += `<div class="tactics"><b>Tactics</b> ${fmt(tactics)}</div>`;
  for (const n of cr.notes || []) h += `<p class="sbnote"><i>${fmt(n)}</i></p>`;
  h += `<div class="traits">${cr.rarity ? `<span class="trait rare">${esc(cr.rarity)}</span>` : ""}${cr.size ? `<span class="trait">${esc(cr.size)}</span>` : ""}${(cr.traits || []).map(t => `<span class="trait">${esc(t)}</span>`).join("")}</div>`;
  if (cr.kind === "hazard") {
    if (cr.routine) h += `<div class="ability"><b>Routine</b> (${cr.routine.actions} actions) ${fmt(cr.routine.text)}
      <button class="rb dmgroll" data-act="rollDmg" data-expr="${esc(cr.routine.damage)}" data-type="${esc(cr.routine.type)}" data-label="${esc(cr.name)} routine">${esc(cr.routine.damage)} ${esc(cr.routine.type)}</button>
      <button class="rb" data-act="areaFromRoutine" data-uid="${c.uid}">Apply to monsters…</button></div>`;
    if (cr.ac != null || cr.hp != null) h += `<p>${cr.ac != null ? `<b>AC</b> ${currentAC(cr, c)}` : ""}${cr.saves && cr.saves.fort != null ? `; <b>Fort</b> ${rollBtn(`${cr.name}: Fortitude`, cr.saves.fort)}` : ""}${cr.saves && cr.saves.ref != null ? ` <b>Ref</b> ${rollBtn(`${cr.name}: Reflex`, cr.saves.ref)}` : ""}${cr.saves && cr.saves.will != null ? ` <b>Will</b> ${rollBtn(`${cr.name}: Will`, cr.saves.will)}` : ""}${cr.hp != null ? `; <b>HP</b> ${cr.hp}${cr.bt ? ` (BT ${cr.bt})` : ""}` : ""}${cr.hardness ? `; <b>Hardness</b> ${cr.hardness}` : ""}${cr.immunities && cr.immunities.length ? `; <b>Immunities</b> ${esc(cr.immunities.join(", "))}` : ""}${cr.weaknesses && cr.weaknesses.length ? `; <b>Weaknesses</b> ${esc(cr.weaknesses.map(w => `${w.type} ${w.value}`).join(", "))}` : ""}${cr.hpNote ? ` <span class="muted">(${fmt(cr.hpNote)})</span>` : ""}</p>`;
    h += ab("top") + ab("mid") + ab("bottom");
    if (cr.reset) h += `<p><b>Reset</b> ${fmt(cr.reset)}</p>`;
    h += `<hr><p><b>Disable</b> ${fmt(cr.disable)}</p><hr>`;
    if (cr.stealthDC != null) h += `<p><b>Stealth DC</b> ${cr.stealthDC} ${cr.stealthNote ? fmt("(" + cr.stealthNote + ")") : ""}</p>`;
    else if (cr.stealth != null) h += `<p><b>Stealth</b> ${rollBtn(`${cr.name}: Stealth`, cr.stealth)} ${cr.stealthNote ? fmt("(" + cr.stealthNote + ")") : ""}</p>`;
    if (cr.description) h += `<p><b>Description</b> ${fmt(cr.description)}</p>`;
  } else {
    h += ab("top");
    // conditional damage toggles
    if (cr.conditional && cr.conditional.length) {
      h += `<div class="condtoggles">${cr.conditional.map(x => {
        const on = !!(c.toggles || {})[x.id];
        return `<span class="ctog"><button class="togchip" aria-pressed="${on}" data-act="toggleCond" data-hold="toggleCondAll" data-uid="${c.uid}" data-id="${esc(x.id)}">
          <span class="tl">${on ? "✓ " : ""}${esc(x.label)}</span><span class="ts">+${esc(x.dice)} ${x.type === "same" ? "damage" : esc(x.type)} · ${x.applies === "all" ? "all attacks" : x.applies + " attacks"}</span><span class="th">hold = all</span></button>
          <button class="mini allbtn" data-act="toggleCondAll" data-uid="${c.uid}" data-id="${esc(x.id)}">All ${esc(cr.name)}</button></span>`;
      }).join("")}</div>`;
    }
    h += `<p><b>Speed</b> ${esc(cr.speed)}</p>`;
    (cr.strikes || []).forEach((s, si) => {
      (s.refs || []).forEach(r => allRefs.push(r));
      const agile = (s.traits || []).includes("agile");
      const extras = activeConds(c, cr, s.range);
      h += `<div class="strike"><div><b>${s.range === "melee" ? "Melee" : "Ranged"}</b> ${icon(s.cost || "1")} ${esc(s.name)}
          ${s.traits && s.traits.length ? `<span class="muted">(${s.traits.map(t => esc(t)).join(", ")})</span>` : ""}
          <span class="dmgtxt">${esc(s.damage)} ${esc(s.type)}${extras.map(x => ` <b class="plus">+ ${esc(x.dice)} ${x.type === "same" ? "" : esc(x.type)} (${esc(x.label)})</b>`).join("")}${s.extra ? ` ${fmt(s.extra)}` : ""}</span></div>
        <div class="strike-rolls">
          ${[1, 2, 3].map(n => { const m = s.bonus + mapPenalty(n, agile); return `<button class="rb atk" data-act="roll" data-strike="1" data-uid="${c.uid}" data-si="${si}" data-mod="${m}" data-label="${esc(`${c.name}: ${s.name} (${["1st", "2nd", "3rd"][n - 1]})`)}">${["1st", "2nd", "3rd"][n - 1]} ${sgn(m)}</button>`; }).join("")}
          <button class="rb dmgroll" data-act="rollDmg" data-uid="${c.uid}" data-si="${si}" data-label="${esc(c.name + ": " + s.name)}">Damage</button>
          <button class="rb dmgroll" data-act="rollDmg" data-crit="1" data-uid="${c.uid}" data-si="${si}" data-label="${esc(c.name + ": " + s.name + " (critical)")}">Crit</button>
          ${(s.refs || []).map(r => refText(r, enc.packId) ? `<button class="chip" data-act="ref" data-ref="${esc(r)}">${esc(refText(r, enc.packId).name)}</button>` : "").join("")}
        </div></div>`;
    });
    h += ab("bottom");
    h += `<hr><p><b>AC</b> ${currentAC(cr, c)}${cr.acNote ? ` <span class="muted">(${esc(cr.acNote)})</span>` : ""}; <b>Fort</b> ${rollBtn(`${c.name}: Fortitude`, cr.saves.fort)} <b>Ref</b> ${rollBtn(`${c.name}: Reflex`, cr.saves.ref)} <b>Will</b> ${rollBtn(`${c.name}: Will`, cr.saves.will)}</p>`;
    h += `<p><b>HP</b> ${cr.hp}${cr.fastHealing ? `, fast healing ${cr.fastHealing}` : ""}${cr.voidHealing ? ", void healing" : ""}${cr.hardness ? `; <b>Hardness</b> ${cr.hardness}` : ""}${cr.immunities && cr.immunities.length ? `; <b>Immunities</b> ${esc(cr.immunities.join(", "))}` : ""}${cr.weaknesses && cr.weaknesses.length ? `; <b>Weaknesses</b> ${esc(cr.weaknesses.map(w => `${w.type} ${w.value}`).join(", "))}` : ""}${cr.resistances && cr.resistances.length ? `; <b>Resistances</b> ${esc(cr.resistances.map(w => `${w.type} ${w.value}`).join(", "))}` : ""}</p>`;
    h += ab("mid");
    h += `<hr><p><b>Perception</b> ${rollBtn(`${c.name}: Perception`, cr.perception)}${cr.senses ? `; ${esc(cr.senses)}` : ""}</p>`;
    if (cr.languages) h += `<p><b>Languages</b> ${esc(cr.languages)}</p>`;
    if (cr.skills && cr.skills.length) h += `<p><b>Skills</b> ${cr.skills.map(s => `${esc(s.name)} ${rollBtn(`${c.name}: ${s.name}`, s.mod)}`).join(" ")}</p>`;
    if (cr.attrs) h += `<p class="attrs">${["str", "dex", "con", "int", "wis", "cha"].map(k => `<span><b>${k[0].toUpperCase() + k.slice(1)}</b> ${sgn(cr.attrs[k])}</span>`).join("")}</p>`;
    if (cr.items) h += `<p><b>Items</b> ${fmt(cr.items)}</p>`;
  }
  h += refChips(allRefs, enc.packId);
  h += `<p class="muted small src">${esc(cr.source || "")}${cr.sourceOverride ? ` · ${esc(cr.sourceOverride)}` : ""}${p.lookupsAsOf ? ` · rules checked ${esc(p.lookupsAsOf)}` : ""}</p>`;
  return h + `</div>`;
}

/* ------------------------------------------------------------- modals */
function openModal(m) { S.ui.modal = m; renderModal(); }
function closeModal() { S.ui.modal = null; renderModal(); }
function renderModal() {
  const m = S.ui.modal; const el = $modal();
  if (!m) { el.innerHTML = ""; el.classList.remove("on"); return; }
  let inner = "";
  if (m.type === "ref") inner = modalRef(m);
  else if (m.type === "pad") inner = modalPad(m);
  else if (m.type === "cond") inner = modalCond(m);
  else if (m.type === "menu") inner = modalMenu();
  else if (m.type === "prompt") inner = modalPrompt(m);
  else if (m.type === "add") inner = modalAdd(m);
  else if (m.type === "setupAdd") { const p = pack(S.setup.packId); inner = `<h3>Add to this encounter</h3><div class="addlist">${Object.entries(p.creatures).map(([id, cr]) => `<button data-act="setupAddPick" data-id="${esc(id)}">${esc(cr.name)} <span class="muted">${cr.kind === "hazard" ? "Hazard" : "Creature"} ${cr.level}</span></button>`).join("")}</div><div class="row end"><button data-act="closeModal">Close</button></div>`; }
  else if (m.type === "confirm") inner = `<h3>${esc(m.title)}</h3><p>${m.text || ""}</p><div class="row end"><button data-act="closeModal">Cancel</button><button class="primary ${m.danger ? "danger-bg" : ""}" data-act="confirmYes">${esc(m.yes || "OK")}</button></div>`;
  else if (m.type === "colors") inner = `<h3>Mini color</h3><div class="swatchgrid">${S.settings.palette.map((p, i) => `<button class="swatch" style="background:${p.c};color:${textOn(p.c)}" data-act="pickColor" data-i="${i}">${esc(p.n)}</button>`).join("")}<button class="swatch" data-act="pickColor" data-i="-1">None</button></div>`;
  el.innerHTML = `<div class="scrim" data-act="closeModal"></div><div class="sheet ${m.type === "pad" ? "wide" : ""}" role="dialog">${inner}</div>`;
  el.classList.add("on");
}
function modalRef(m) {
  const r = refText(m.ref, S.enc ? S.enc.packId : null);
  if (!r) return `<h3>Not found</h3><p>No rules text for “${esc(m.ref)}”.</p><div class="row end"><button data-act="closeModal">Close</button></div>`;
  return `<h3>${esc(r.name)} <span class="muted small">${esc(r.kind)}</span></h3><div class="reftext">${fmt(r.text)}</div><p class="muted small">${esc(r.source || "")}</p><div class="row end"><button data-act="closeModal">Close</button></div>`;
}
function modalMenu() {
  return `<h3>Encounter</h3><div class="menu">
    <button data-act="addCombatant">+ Add combatant</button>
    <button data-act="tab" data-tab="log">Roll & turn log</button>
    <button data-act="go" data-href="#glossary">Glossary</button>
    <button data-act="flat" data-dc="5">Flat check DC 5</button>
    <button data-act="flat" data-dc="11">Flat check DC 11</button>
    <button data-act="flat" data-dc="15">Flat check DC 15</button>
    <button class="danger" data-act="endEnc">End encounter</button>
  </div><div class="row end"><button data-act="closeModal">Close</button></div>`;
}
function modalPrompt(m) {
  return `<h3>${esc(m.title)}</h3><input class="promptin" type="${m.inputType || "text"}" ${m.inputType === "number" ? 'inputmode="numeric"' : ""} value="${esc(m.value ?? "")}" data-in="promptVal" autofocus>
    <div class="row end"><button data-act="closeModal">Cancel</button><button class="primary" data-act="promptOk">OK</button></div>`;
}
function modalAdd(m) {
  const p = pack(S.enc.packId);
  const crs = Object.entries(p.creatures);
  return `<h3>Add combatant</h3>
    <div class="seg">${["creature", "pc", "custom"].map(k => `<button aria-pressed="${m.mode === k}" data-act="addMode" data-mode="${k}">${{ creature: "From pack", pc: "Player character", custom: "Custom" }[k]}</button>`).join("")}</div>
    ${m.mode === "creature" ? `<div class="addlist">${crs.map(([id, cr]) => `<button data-act="addCreature" data-id="${esc(id)}">${esc(cr.name)} <span class="muted">${cr.kind === "hazard" ? "Hazard" : "Creature"} ${cr.level}</span></button>`).join("")}</div>`
      : m.mode === "pc" ? `<label>Name <input data-in="addField" data-f="name" value="${esc(m.name || "")}"></label><label>Initiative <input type="number" inputmode="numeric" data-in="addField" data-f="init" value="${esc(m.init ?? "")}"></label><div class="row end"><button class="primary" data-act="addPc">Add</button></div>`
      : `<label>Name <input data-in="addField" data-f="name" value="${esc(m.name || "")}"></label>
         <div class="row"><label>HP <input type="number" inputmode="numeric" data-in="addField" data-f="hp" value="${esc(m.hp ?? "")}"></label><label>AC <input type="number" inputmode="numeric" data-in="addField" data-f="ac" value="${esc(m.ac ?? "")}"></label><label>Initiative <input type="number" inputmode="numeric" data-in="addField" data-f="init" value="${esc(m.init ?? "")}"></label></div>
         <div class="row end"><button class="primary" data-act="addCustom">Add</button></div>`}
    <div class="row end"><button data-act="closeModal">Close</button></div>`;
}
function modalCond(m) {
  const c = S.enc.combatants.find(x => x.uid === m.uid);
  const chosen = m.name ? COND_BY_NAME[m.name.toLowerCase()] : null;
  const others = S.enc.combatants;
  if (!chosen) {
    const rest = CONDITIONS.map(x => x.name).filter(n => !QUICK_CONDITIONS.includes(n));
    return `<h3>Add condition to ${esc(c.name)}</h3>
      <div class="condgrid">${QUICK_CONDITIONS.map(n => `<button data-act="condPick" data-name="${esc(n)}">${esc(n)}</button>`).join("")}</div>
      <details><summary>All conditions</summary><div class="condgrid">${rest.map(n => `<button data-act="condPick" data-name="${esc(n)}">${esc(n)}</button>`).join("")}</div></details>
      <div class="row end"><button data-act="closeModal">Cancel</button></div>`;
  }
  const isPd = chosen.name === "Persistent Damage";
  return `<h3>${esc(chosen.name)} → ${esc(c.name)}</h3>
    <p class="muted small">${fmt(chosen.text, { link: false })}</p>
    ${chosen.valued && !isPd ? `<div class="row"><span>Value</span>${[1, 2, 3, 4].map(v => `<button aria-pressed="${m.value === v}" data-act="condSet" data-k="value" data-v="${v}">${v}</button>`).join("")}</div>` : ""}
    ${isPd ? `<div class="row"><label>Damage <input data-in="condField" data-k="dice" value="${esc(m.dice || "1d6")}" placeholder="1d6"></label>
      <label>Type <select data-in="condField" data-k="ptype">${["fire", "acid", "bleed", "cold", "electricity", "poison", "void", "vitality", "sonic", "spirit", "mental", "force"].map(t => `<option ${m.ptype === t ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>` : ""}
    <div class="durbox"><span>Duration</span>
      <div class="seg wrap">
        <button aria-pressed="${!m.edge}" data-act="condSet" data-k="edge" data-v="">Until removed</button>
        <button aria-pressed="${m.edge === "start"}" data-act="condSet" data-k="edge" data-v="start">Until start of…</button>
        <button aria-pressed="${m.edge === "end"}" data-act="condSet" data-k="edge" data-v="end">Until end of…</button>
      </div>
      ${m.edge ? `<div class="row">…<select data-in="condField" data-k="who">${others.map(o => `<option value="${o.uid}" ${m.who === o.uid ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>'s
        <select data-in="condField" data-k="n">${[1, 2, 3, 4, 5, 10].map(n => `<option value="${n}" ${Number(m.n) === n ? "selected" : ""}>${n === 1 ? "next turn" : n + " turns"}</option>`).join("")}</select></div>` : ""}
    </div>
    <div class="row end"><button data-act="condBack">Back</button><button class="primary" data-act="condOk">Add</button></div>`;
}
/* damage pad */
function padTargets(m) { return m.targets.map(t => S.enc.combatants.find(c => c.uid === t.uid)).filter(Boolean); }
function modalPad(m) {
  const enc = S.enc;
  const comps = m.comps;
  const cur = comps[m.ci];
  const targets = padTargets(m);
  const first = targets[0]; const fcr = first && crOf(first);
  const hl = new Map();
  if (fcr) {
    (fcr.weaknesses || []).forEach(w => hl.set(w.type, `weak ${w.value}`));
    (fcr.resistances || []).forEach(w => hl.set(w.type, `resist ${w.value}`));
    (fcr.immunities || []).forEach(w => { if (ALL_TYPES.includes(w)) hl.set(w, "immune"); });
    if (fcr.voidHealing) hl.set("void", "immune");
  }
  const typeBtn = t => `<button class="tchip ${cur && cur.type === t ? "on" : ""} ${hl.has(t) ? "hl" : ""}" data-act="padType" data-t="${t}">${t}${hl.has(t) ? `<small>${hl.get(t)}</small>` : ""}</button>`;
  const modeTabs = `<div class="seg">${["damage", "heal", "temp"].map(k => `<button aria-pressed="${m.mode === k}" data-act="padMode" data-mode="${k}">${{ damage: "Damage", heal: "Heal", temp: "Temp HP" }[k]}</button>`).join("")}</div>`;
  // preview
  let preview = "";
  const total = comps.reduce((a, c) => a + (c.amount || 0), 0);
  if (m.mode === "damage") {
    preview = targets.map(t => {
      const cr = crOf(t); if (!cr || t.hp == null) return `<div class="pv"><b>${esc(t.name)}</b>: no HP tracked</div>`;
      const sv = (m.saves && m.saves[t.uid]) || null;
      const res = resolveDamage(cr, t, comps.map(c => ({ amount: c.amount || 0, type: c.type })), { concussive: m.concussive, crit: m.crit, saveMult: m.area ? saveMult(sv) : 1 });
      return `<div class="pv"><b>${esc(t.name)}</b>${m.area ? ` <span class="seg small">${["CS", "S", "F", "CF"].map(k => `<button aria-pressed="${sv === k}" data-act="padSave" data-uid="${t.uid}" data-v="${k}">${k}</button>`).join("")}</span>${m.saveRolls && m.saveRolls[t.uid] ? ` <span class="muted small">${m.saveRolls[t.uid]}</span>` : ""}` : ""}
        <div class="pvline">${res.lines.length ? res.lines.map(esc).join(" · ") + " · " : ""}<b>takes ${res.total}</b> → HP ${t.hp}${t.temp ? `+${t.temp}` : ""} → <b>${res.hp}</b>${res.temp ? `+${res.temp}` : ""}${res.breaks ? ` · <b class="warn">armor breaks (AC ${cr.broken.ac})</b>` : ""}${res.hp <= 0 ? ` · <b class="warn">defeated</b>` : ""}</div></div>`;
    }).join("");
  } else if (m.mode === "heal") {
    preview = targets.map(t => t.hp == null ? "" : `<div class="pv"><b>${esc(t.name)}</b>: HP ${t.hp} → <b>${Math.min(t.maxHp, t.hp + total)}</b></div>`).join("");
  } else {
    preview = targets.map(t => `<div class="pv"><b>${esc(t.name)}</b>: temp HP ${t.temp || 0} → <b>${Math.max(t.temp || 0, total)}</b> <span class="muted small">(temp HP doesn't stack; the higher value is kept)</span></div>`).join("");
  }
  const monsters = enc.combatants.filter(c => c.kind === "monster");
  return `<div class="padwrap">
    <div class="padleft">
      <div class="row between"><h3>${m.area ? "Area / multiple targets" : esc(first ? first.name : "")}</h3>${modeTabs}</div>
      <div class="comps">${comps.map((c, i) => `<button class="comp ${i === m.ci ? "on" : ""}" data-act="padComp" data-i="${i}"><b>${c.amount || 0}</b> ${m.mode === "damage" ? esc(c.type) : ""}${comps.length > 1 ? `<span class="x" data-act="padCompDel" data-i="${i}">×</span>` : ""}</button>`).join("")}
        ${m.mode === "damage" ? `<button class="comp add" data-act="padCompAdd">+ type</button>` : ""}</div>
      <div class="bigtotal">${m.mode === "damage" ? "Total rolled" : m.mode === "heal" ? "Heal" : "Temp HP"}: <b>${total}</b></div>
      <div class="keypad">${[7, 8, 9, 4, 5, 6, 1, 2, 3].map(n => `<button data-act="padKey" data-k="${n}">${n}</button>`).join("")}<button data-act="padKey" data-k="C">C</button><button data-act="padKey" data-k="0">0</button><button data-act="padKey" data-k="B">⌫</button></div>
    </div>
    <div class="padright">
      ${m.mode === "damage" ? `<div class="types">
        <div>${DAMAGE_TYPES.physical.map(typeBtn).join("")}</div>
        <div>${DAMAGE_TYPES.energy.map(typeBtn).join("")}</div>
        <div>${DAMAGE_TYPES.other.map(typeBtn).join("")}</div></div>
        <div class="row wrap">
          <button aria-pressed="${!!m.crit}" data-act="padToggle" data-k="crit">Critical hit</button>
          <button aria-pressed="${!!m.concussive}" data-act="padToggle" data-k="concussive">Concussive</button>
          <button aria-pressed="${!!m.area}" data-act="padToggle" data-k="area">Multiple targets</button>
        </div>` : ""}
      ${m.area ? `<div class="areapick">${monsters.map(t => `<label class="chk"><input type="checkbox" ${m.targets.some(x => x.uid === t.uid) ? "checked" : ""} data-in="padTarget" data-uid="${t.uid}"> ${esc(t.name)}</label>`).join("")}
        <div class="row">Basic save: <select data-in="padSaveType">${["fort", "ref", "will"].map(s => `<option value="${s}" ${m.saveType === s ? "selected" : ""}>${{ fort: "Fortitude", ref: "Reflex", will: "Will" }[s]}</option>`).join("")}</select>
        DC <input type="number" inputmode="numeric" class="dcin" value="${esc(m.dc ?? "")}" data-in="padDc"> <button data-act="padRollSaves">🎲 Roll saves</button></div></div>` : ""}
      <div class="preview">${preview}</div>
      <div class="row end"><button data-act="closeModal">Cancel</button><button class="primary big" data-act="padApply">Apply</button></div>
    </div></div>`;
}
function saveMult(sv) { return sv === "CS" ? 0 : sv === "S" ? 0.5 : sv === "CF" ? 2 : 1; }
function applyPad() {
  const m = S.ui.modal; const targets = padTargets(m);
  const comps = m.comps.map(c => ({ amount: c.amount || 0, type: c.type }));
  const total = comps.reduce((a, c) => a + c.amount, 0);
  mutate(() => {
    for (const t of targets) {
      const cr = crOf(t);
      if (m.mode === "damage") {
        if (!cr || t.hp == null) continue;
        const sv = (m.saves && m.saves[t.uid]) || null;
        const res = resolveDamage(cr, t, comps, { concussive: m.concussive, crit: m.crit, saveMult: m.area ? saveMult(sv) : 1 });
        const b = t.hp; t.hp = res.hp; t.temp = res.temp; if (res.breaks) t.broken = true;
        if (t.hp <= 0 && t.kind !== "pc") t.defeated = true;
        logLine(`${t.name} takes ${res.total} (${comps.map(c => c.amount + " " + c.type).join(" + ")}${m.area && sv ? `, save ${sv}` : ""}${res.lines.length ? "; " + res.lines.join(", ") : ""}) — HP ${b} → ${t.hp}${res.breaks ? ", armor breaks" : ""}${t.hp <= 0 ? ", defeated" : ""}`);
      } else if (m.mode === "heal") {
        if (t.hp == null) continue;
        const b = t.hp; t.hp = Math.min(t.maxHp, t.hp + total); if (t.hp > 0) t.defeated = false;
        logLine(`${t.name} heals ${total} — HP ${b} → ${t.hp}`);
      } else {
        t.temp = Math.max(t.temp || 0, total); logLine(`${t.name} has ${t.temp} temp HP`);
      }
    }
    S.ui.modal = null;
  });
}

/* ------------------------------------------------------------- glossary/settings */
function viewGlossary() {
  const q = S.ui.glossQ.trim().toLowerCase();
  const items = [...CONDITIONS.map(c => ({ name: c.name, kind: "condition", text: c.text, source: "Player Core" }))];
  for (const p of Object.values(S.packs)) for (const [k, r] of Object.entries(p.refs || {})) if (!items.some(i => i.name === r.name)) items.push({ ...r, pk: p.short || "" });
  items.sort((a, b) => a.name.localeCompare(b.name));
  const f = q ? items.filter(i => (i.name + " " + i.text).toLowerCase().includes(q)) : items;
  return `${topbar("Glossary", { back: S.enc ? "#combat" : "#library" })}<main class="page narrow">
    <input class="search" type="search" placeholder="Search conditions, abilities, traits…" value="${esc(S.ui.glossQ)}" data-in="glossQ">
    <dl class="gloss">${f.map(i => `<dt>${esc(i.name)} <span class="muted small">${esc(i.kind)}</span></dt><dd>${fmt(i.text)}<div class="muted small">${esc(i.source || "")}</div></dd>`).join("")}</dl></main>`;
}
function viewSettings() {
  const st = S.settings;
  return `${topbar("Settings", { back: S.enc ? "#combat" : "#library" })}<main class="page narrow settings">
    <section class="panel"><h3>Party</h3>
      <ul class="party">${st.party.map(p => `<li><span>${esc(p.name)}</span><button class="danger" data-act="delPc" data-id="${p.id}">Remove</button></li>`).join("")}</ul>
      <div class="row"><input placeholder="Character name" data-in="newPc" id="newPc"><button class="primary" data-act="addPartyPc">Add</button></div>
      <div class="row">${partySeg()} <span class="muted small">Picks which version of each encounter loads.</span></div>
    </section>
    <section class="panel"><h3>Mini colors</h3>
      <label class="chk"><input type="checkbox" ${st.colors ? "checked" : ""} data-in="setColors"> Color-code enemies (same order as Mini press: a running count across the encounter)</label>
      <ol class="pal">${st.palette.map((p, i) => `<li><input type="color" value="${p.c}" data-in="palC" data-i="${i}"><input value="${esc(p.n)}" data-in="palN" data-i="${i}"><button data-act="palMove" data-i="${i}" data-d="-1">↑</button><button data-act="palMove" data-i="${i}" data-d="1">↓</button><button class="danger" data-act="palDel" data-i="${i}">×</button></li>`).join("")}</ol>
      <div class="row"><button data-act="palAdd">+ Add color</button><button data-act="palReset">Reset to Mini press palette</button></div>
    </section>
    <section class="panel"><h3>Display & behavior</h3>
      <div class="row">Theme <div class="seg">${["dark", "light"].map(t => `<button aria-pressed="${st.theme === t}" data-act="setTheme" data-v="${t}">${t}</button>`).join("")}</div></div>
      <div class="row">Text size <div class="seg">${[[0.9, "S"], [1, "M"], [1.12, "L"], [1.25, "XL"]].map(([v, l]) => `<button aria-pressed="${st.fontScale === v}" data-act="setFont" data-v="${v}">${l}</button>`).join("")}</div></div>
      <div class="row">Critical hits <div class="seg wrap">${[["double", "Double the total (official rule)"], ["dice", "Roll twice the dice, double bonuses (house rule)"]].map(([v, l]) => `<button aria-pressed="${st.critMode === v}" data-act="setCrit" data-v="${v}">${l}</button>`).join("")}</div></div>
      <label class="chk"><input type="checkbox" ${st.keepAwake ? "checked" : ""} data-in="setAwake"> Keep the screen on during combat</label>
      <label class="chk"><input type="checkbox" ${st.tiesMonstersFirst ? "checked" : ""} data-in="setTies"> On initiative ties, enemies go before PCs</label>
      <label class="chk"><input type="checkbox" ${st.skipDefeated ? "checked" : ""} data-in="setSkip"> Skip defeated enemies' turns</label>
    </section>
    <section class="panel"><h3>Data</h3>
      <p class="muted small">Everything is stored only on this device. ${S.persisted ? "The browser has granted persistent storage." : "Persistent storage wasn't granted, so export a backup now and then."}</p>
      <div class="row"><button data-act="exportBackup">Export backup</button>
        <label class="btn">Import backup…<input type="file" accept=".json,application/json" data-in="importBackup" hidden></label>
        <button class="danger" data-act="clearAll">Erase all data</button></div>
      <p class="muted small">Version ${APP_VERSION}</p>
    </section></main>`;
}

/* ============================================================ actions */
function findC(uid) { return S.enc && S.enc.combatants.find(c => c.uid === uid); }
function showRoll(html, log) { S.ui.lastRoll = html; if (log) logLine(log); saveEnc(); render(); }
const A = {
  go: el => go(el.dataset.href),
  closeModal: () => closeModal(),
  ref: el => openModal({ type: "ref", ref: el.dataset.ref }),
  partySize: el => { S.settings.partySize = Number(el.dataset.n); saveSettings(); if (S.setup) S.setup = buildSetup(S.setup.packId, S.setup.secId, S.setup.variantId); render(); },
  secVariant: el => { const st = secState(el.dataset.pack, sectionOf(el.dataset.pack, el.dataset.sec)); st.variant = el.dataset.id; saveSec(el.dataset.pack, el.dataset.sec); render(); },
  secCounter: el => { const st = secState(el.dataset.pack, sectionOf(el.dataset.pack, el.dataset.sec)); const i = +el.dataset.i; st.counters[i] = Math.max(0, st.counters[i] + Number(el.dataset.d)); saveSec(el.dataset.pack, el.dataset.sec); render(); },
  chaseRound: el => { const st = secState(el.dataset.pack, sectionOf(el.dataset.pack, el.dataset.sec)); st.round = Math.max(1, st.round + Number(el.dataset.d)); saveSec(el.dataset.pack, el.dataset.sec); render(); },
  chaseHorde: el => { const s = sectionOf(el.dataset.pack, el.dataset.sec); const st = secState(el.dataset.pack, s); st.horde = Math.max(0, Math.min(s.obstacles.length - 1, st.horde + Number(el.dataset.d))); saveSec(el.dataset.pack, el.dataset.sec); render(); },
  chasePts: el => {
    const s = sectionOf(el.dataset.pack, el.dataset.sec); const st = secState(el.dataset.pack, s); const i = +el.dataset.i;
    st.points[i] = Math.max(0, st.points[i] + Number(el.dataset.d));
    const o = s.obstacles[i]; const need = S.settings.partySize >= 5 ? (o.points5 || o.points) : o.points;
    if (st.points[i] >= need && st.obstacle === i) { st.obstacle = Math.min(s.obstacles.length, i + 1); toast(i + 1 >= s.obstacles.length ? "Final obstacle cleared — the PCs escape!" : `Obstacle cleared: on to ${esc(s.obstacles[i + 1].name)}`); }
    else if (st.points[i] < need && st.obstacle > i) st.obstacle = i;
    saveSec(el.dataset.pack, el.dataset.sec); render();
  },
  eventState: el => { const st = secState(el.dataset.pack, sectionOf(el.dataset.pack, el.dataset.sec)); st.events[+el.dataset.i] = el.dataset.v; saveSec(el.dataset.pack, el.dataset.sec); render(); },
  flat: el => { const dc = Number(el.dataset.dc); const r = d20(0); S.ui.modal = null; const txt = `Flat check DC ${dc}: <b>${r.nat}</b> — ${r.nat >= dc ? "success" : "failure"}`; if (S.enc && route().name === "combat") showRoll(txt, txt); else { toast(txt, 4000); render(); } },
  newSetup: el => {
    if (S.enc) { openModal({ type: "confirm", title: "Replace the active encounter?", text: `“${esc(S.enc.title)}” is still in progress. Starting a new one ends it.`, yes: "Set up new encounter", danger: true, then: () => { S.enc = null; kv.del("enc"); S.setup = buildSetup(el.dataset.pack, el.dataset.sec, el.dataset.variant); go("#setup"); } }); return; }
    S.setup = buildSetup(el.dataset.pack, el.dataset.sec, el.dataset.variant); go("#setup");
  },
  confirmYes: () => { const m = S.ui.modal; S.ui.modal = null; if (m && m.then) m.then(); else render(); },
  setupVariant: el => { S.setup = buildSetup(S.setup.packId, S.setup.secId, el.dataset.id); render(); },
  rollInit: el => { const r = S.setup.rows.find(x => x.uid === el.dataset.uid); r.init = d20(r.initMod).total; render(); },
  rollAllInit: () => { const p = pack(S.setup.packId); for (const r of S.setup.rows) if (!p.creatures[r.creatureId].simple) r.init = d20(r.initMod).total; render(); },
  cycleColor: el => {
    const r = S.setup.rows.find(x => x.uid === el.dataset.uid); const pal = S.settings.palette;
    const i = pal.findIndex(p => p.c === r.color); const n = pal[(i + 1) % pal.length]; r.color = n.c; r.colorName = n.n; render();
  },
  startEnc: () => startEncounter(),
  sel: (el, ev) => { if (ev.target.closest("button") && ev.target.closest("button") !== el) return; S.ui.sel = el.dataset.uid; S.ui.tab = "creature"; render(); },
  tab: el => { S.ui.tab = el.dataset.tab; S.ui.modal = null; render(); },
  nextTurn: () => nextTurn(1),
  prevTurn: () => nextTurn(-1),
  undo: () => { if (!S.undo.length) return; S.enc = JSON.parse(S.undo.pop()); S.ui.turnNotes = null; saveEnc(); toast("Undone"); render(); },
  menu: () => openModal({ type: "menu" }),
  endEnc: () => openModal({ type: "confirm", title: "End this encounter?", text: "The fight and its log are cleared from the tablet.", yes: "End encounter", danger: true, then: () => { const back = `#section/${encodeURIComponent(S.enc.packId)}/${encodeURIComponent(S.enc.secId)}`; S.enc = null; S.undo = []; kv.del("enc"); kv.del("undo"); go(back); } }),
  clearRoll: () => { S.ui.lastRoll = null; render(); },
  roll: el => {
    const mod = Number(el.dataset.mod); const r = d20(mod);
    const flag = r.nat === 20 ? ' <span class="nat20">NAT 20</span>' : r.nat === 1 ? ' <span class="nat1">NAT 1</span>' : "";
    let txt = `${esc(el.dataset.label)}: <span class="die">${r.nat}</span> ${sgn(mod)} = <b class="rtotal">${r.total}</b>${flag}`;
    if (el.dataset.strike && el.dataset.uid) {
      const c = findC(el.dataset.uid); const cr = c && crOf(c); const s = c && strikeOf(c, el);
      if (s && s.damage) {
        const hit = damageLine(c, cr, s, false), crit = damageLine(c, cr, s, true);
        txt += `<div class="dmgpair"><div><span>Hit <b>${hit.total}</b></span><small>${esc(hit.calc)}</small></div><div><span>Crit <b>${crit.total}</b>${S.settings.critMode === "dice" ? " <em>dice doubled</em>" : " <em>total × 2</em>"}</span><small>${esc(crit.calc)}</small></div></div>`;
      }
    }
    showRoll(txt, txt.replace(/<\/div><div>/g, " · ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  },
  rollDmg: el => {
    const crit = !!el.dataset.crit;
    let txt;
    if (el.dataset.uid && (el.dataset.si != null || el.dataset.ai != null)) {
      const c = findC(el.dataset.uid); const cr = crOf(c); const s = strikeOf(c, el);
      const d = damageLine(c, cr, s, crit);
      txt = `${esc(el.dataset.label)}: <b class="rtotal">${d.total}</b><div class="dmgcalc">${esc(d.calc)}</div>`;
    } else {
      const r = rollDamage(el.dataset.expr, crit, S.settings.critMode);
      txt = `${esc(el.dataset.label)}: ${esc(r.text)} = <b class="rtotal">${r.total}</b> ${esc(el.dataset.type || "")}`;
    }
    showRoll(txt, txt.replace(/<[^>]+>/g, ""));
  },
  toggleCond: el => {
    const c = findC(el.dataset.uid); const cr = crOf(c); const x = cr.conditional.find(y => y.id === el.dataset.id);
    mutate(() => { c.toggles = c.toggles || {}; c.toggles[x.id] = !c.toggles[x.id]; });
    if (!S.settings.tipHold) { S.settings.tipHold = true; saveSettings(); toast(`Tip: press and hold ${esc(x.label)} to set it for every ${esc(cr.name)}`, 4500); }
  },
  toggleCondAll: el => {
    const c = findC(el.dataset.uid); const cr = crOf(c); const x = cr.conditional.find(y => y.id === el.dataset.id);
    const same = S.enc.combatants.filter(o => o.creatureId === c.creatureId);
    const val = !same.every(o => (o.toggles || {})[x.id]); // any off -> all on; all on -> all off
    mutate(() => { for (const o of same) { o.toggles = o.toggles || {}; o.toggles[x.id] = val; } logLine(`${x.label} ${val ? "on" : "off"} for all ${cr.name} (${same.length})`); });
    toast(`${esc(x.label)} ${val ? "on" : "off"} for all ${same.length} ${esc(cr.name)}`);
  },
  editInit: (el, ev) => { ev.stopPropagation(); const c = findC(el.dataset.uid); openModal({ type: "prompt", title: `Initiative for ${c.name}`, inputType: "number", value: c.init, then: v => mutate(() => { c.init = Number(v) || 0; placeByInit(S.enc.combatants, c); }) }); },
  promptOk: () => { const m = S.ui.modal; const v = m.value; S.ui.modal = null; m.then(v); },
  rename: el => { const c = findC(el.dataset.uid); openModal({ type: "prompt", title: "Name", value: c.name, then: v => mutate(() => { if (v.trim()) c.name = v.trim(); }) }); },
  recolor: el => openModal({ type: "colors", uid: el.dataset.uid }),
  pickColor: el => { const m = S.ui.modal; const c = findC(m.uid); const i = Number(el.dataset.i); S.ui.modal = null; mutate(() => { if (i < 0) { c.color = null; c.colorName = null; } else { const p = S.settings.palette[i]; const cr = crOf(c); c.color = p.c; if (cr && c.colorName && c.name.endsWith("· " + c.colorName)) c.name = `${cr.name} · ${p.n}`; c.colorName = p.n; } }); },
  remove: el => { const c = findC(el.dataset.uid); openModal({ type: "confirm", title: `Remove ${c.name}?`, yes: "Remove", danger: true, then: () => mutate(() => { if (S.enc.active === c.uid) { const el2 = eligible(S.enc.combatants); const i = el2.findIndex(x => x.uid === c.uid); const nx = el2[i + 1] || el2[0]; S.enc.active = nx && nx.uid !== c.uid ? nx.uid : null; } S.enc.combatants = S.enc.combatants.filter(x => x.uid !== c.uid); if (S.ui.sel === c.uid) S.ui.sel = S.enc.active; }) }); },
  delay: el => mutate(() => { const c = findC(el.dataset.uid); const el2 = eligible(S.enc.combatants); const i = el2.findIndex(x => x.uid === c.uid); c.delayed = true; const nx = el2[i + 1]; if (nx) { S.enc.active = nx.uid; S.ui.turnNotes = { uid: nx.uid, notes: startOfTurn(nx) }; S.ui.sel = nx.uid; } else { S.enc.active = null; } logLine(`${c.name} delays`); }),
  undelay: el => mutate(() => {
    const c = findC(el.dataset.uid); const list = S.enc.combatants; c.delayed = false;
    const cur = list.find(x => x.uid === S.enc.active);
    list.splice(list.indexOf(c), 1);
    const at = cur ? list.indexOf(cur) + 1 : list.length; list.splice(at, 0, c);
    const before = list[at - 1], after = list[at + 1];
    c.init = before ? before.init : (after ? after.init : c.init);
    S.enc.active = c.uid; S.ui.sel = c.uid; S.ui.turnNotes = { uid: c.uid, notes: startOfTurn(c) }; logLine(`${c.name} acts after delaying`);
  }),
  joinNow: el => mutate(() => { const c = findC(el.dataset.uid); c.joinsRound = 0; logLine(`${c.name} joins the fight`); }),
  toggleBroken: el => mutate(() => { const c = findC(el.dataset.uid); c.broken = !c.broken; logLine(`${c.name}: armor ${c.broken ? "broken" : "restored"}`); }),
  toggleDefeated: el => mutate(() => { const c = findC(el.dataset.uid); c.defeated = !c.defeated; logLine(`${c.name} ${c.defeated ? "defeated" : "back in the fight"}`); }),
  cCounter: el => mutate(() => { const c = findC(el.dataset.uid); const ct = c.counters[+el.dataset.i]; ct.val = Math.max(0, ct.val + Number(el.dataset.d)); }),
  useCd: el => mutate(() => { const c = findC(el.dataset.uid); const r = rollExpr(el.dataset.expr); c.cooldowns[el.dataset.name] = r.total; S.ui.lastRoll = `${esc(c.name)}: ${esc(el.dataset.name)} used — recharges in <b>${r.total}</b> round${r.total === 1 ? "" : "s"}`; logLine(`${c.name} uses ${el.dataset.name} (recharge ${r.total})`); }),
  cdClear: el => mutate(() => { const c = findC(el.dataset.uid); delete c.cooldowns[el.dataset.name]; }),
  useRound: el => mutate(() => { const c = findC(el.dataset.uid); c.used[el.dataset.name] = !c.used[el.dataset.name]; }),
  condAdd: el => openModal({ type: "cond", uid: el.dataset.uid, name: null, value: 1, edge: "", who: S.enc.active, n: 1, dice: "1d6", ptype: "fire" }),
  condPick: el => { const m = S.ui.modal; m.name = el.dataset.name; m.who = m.who || S.enc.active; renderModal(); },
  condBack: () => { S.ui.modal.name = null; renderModal(); },
  condSet: el => { const m = S.ui.modal; m[el.dataset.k] = el.dataset.k === "value" ? Number(el.dataset.v) : el.dataset.v; renderModal(); },
  condOk: () => {
    const m = S.ui.modal; const def = COND_BY_NAME[m.name.toLowerCase()];
    mutate(() => {
      const c = findC(m.uid);
      const x = { id: uid(), name: def.name, value: def.valued && def.name !== "Persistent Damage" ? m.value : null };
      if (def.name === "Persistent Damage") { x.dice = m.dice || "1d6"; x.ptype = m.ptype || "fire"; }
      if (m.edge) x.dur = { who: m.who, edge: m.edge, n: Number(m.n) || 1, skip: m.edge === "end" && m.who === S.enc.active };
      // valued conditions don't stack: keep the higher
      const ex = def.name !== "Persistent Damage" && c.conditions.find(y => y.name === def.name);
      if (ex) { if (def.valued) ex.value = Math.max(ex.value || 0, x.value || 0); if (x.dur) ex.dur = x.dur; }
      else c.conditions.push(x);
      logLine(`${c.name}: ${def.name}${x.value ? " " + x.value : ""}${x.dice ? ` ${x.dice} ${x.ptype}` : ""}${x.dur ? " (" + durText(x.dur) + ")" : ""}`);
      S.ui.modal = null;
    });
  },
  condVal: el => mutate(() => { const c = findC(el.dataset.uid); const x = c.conditions.find(y => y.id === el.dataset.id); x.value = Math.max(0, (x.value || 0) + Number(el.dataset.d)); if (x.value === 0) c.conditions = c.conditions.filter(y => y !== x); }),
  condDel: el => mutate(() => { const c = findC(el.dataset.uid); c.conditions = c.conditions.filter(y => y.id !== el.dataset.id); }),
  pad: el => {
    const c = findC(el.dataset.uid); const cr = crOf(c);
    const defType = (cr && cr.weaknesses && cr.weaknesses[0] && "slashing") || "slashing";
    openModal({ type: "pad", mode: el.dataset.mode, targets: [{ uid: c.uid }], comps: [{ amount: 0, type: "untyped" }], ci: 0, crit: false, concussive: false, area: false, saves: {}, saveType: "ref", dc: null });
  },
  areaFromRoutine: el => {
    const c = findC(el.dataset.uid); const cr = crOf(c); const r = cr.routine;
    const roll = rollExpr(r.damage);
    const monsters = S.enc.combatants.filter(x => x.kind === "monster" && !x.defeated && !(x.joinsRound && S.enc.round < x.joinsRound));
    S.ui.lastRoll = `${esc(cr.name)} routine: ${esc(r.damage)} → ${esc(roll.text)} = <b class="rtotal">${roll.total}</b> ${esc(r.type)} (DC ${r.dc} basic ${r.save === "will" ? "Will" : r.save === "fort" ? "Fortitude" : "Reflex"})`;
    openModal({ type: "pad", mode: "damage", targets: monsters.map(x => ({ uid: x.uid })), comps: [{ amount: roll.total, type: r.type }], ci: 0, area: true, saves: {}, saveType: r.save, dc: r.dc });
  },
  padMode: el => { S.ui.modal.mode = el.dataset.mode; renderModal(); },
  padKey: el => {
    const m = S.ui.modal; const c = m.comps[m.ci]; const k = el.dataset.k;
    if (k === "C") c.amount = 0; else if (k === "B") c.amount = Math.floor((c.amount || 0) / 10);
    else c.amount = Math.min(9999, (c.amount || 0) * 10 + Number(k));
    renderModal();
  },
  padType: el => { const m = S.ui.modal; m.comps[m.ci].type = el.dataset.t; renderModal(); },
  padComp: (el, ev) => { if (ev.target.dataset.act === "padCompDel") return; S.ui.modal.ci = Number(el.dataset.i); renderModal(); },
  padCompAdd: () => { const m = S.ui.modal; m.comps.push({ amount: 0, type: "untyped" }); m.ci = m.comps.length - 1; renderModal(); },
  padCompDel: (el, ev) => { ev.stopPropagation(); const m = S.ui.modal; m.comps.splice(Number(el.dataset.i), 1); m.ci = Math.min(m.ci, m.comps.length - 1); renderModal(); },
  padToggle: el => {
    const m = S.ui.modal; const k = el.dataset.k; m[k] = !m[k];
    if (k === "area" && m.area && m.targets.length === 1) { /* keep current target; user adds more */ }
    if (k === "area" && !m.area) m.targets = m.targets.slice(0, 1);
    renderModal();
  },
  padSave: el => { const m = S.ui.modal; m.saves[el.dataset.uid] = m.saves[el.dataset.uid] === el.dataset.v ? null : el.dataset.v; renderModal(); },
  padRollSaves: () => {
    const m = S.ui.modal; if (m.dc == null || m.dc === "") { toast("Enter the save DC first"); return; }
    m.saveRolls = {};
    for (const t of padTargets(m)) {
      const cr = crOf(t); if (!cr || !cr.saves) continue;
      const mod = cr.saves[m.saveType]; const r = d20(mod); const dg = degree(r.total, r.nat, Number(m.dc));
      m.saves[t.uid] = { "Critical success": "CS", "Success": "S", "Failure": "F", "Critical failure": "CF" }[dg];
      m.saveRolls[t.uid] = `${r.nat}${sgn(mod)}=${r.total}`;
    }
    renderModal();
  },
  padApply: () => applyPad(),
  addCombatant: () => openModal({ type: "add", mode: "creature" }),
  addMode: el => { S.ui.modal.mode = el.dataset.mode; renderModal(); },
  addCreature: el => {
    const p = pack(S.enc.packId); const cr = p.creatures[el.dataset.id];
    const n = S.enc.combatants.filter(c => c.creatureId === el.dataset.id).length;
    const pal = S.settings.palette; const used = new Set(S.enc.combatants.map(c => c.color));
    const pc = cr.kind !== "hazard" && S.settings.colors ? (pal.find(x => !used.has(x.c)) || pal[n % pal.length]) : null;
    const init = d20(cr.kind === "hazard" ? cr.stealth || 0 : cr.perception || 0).total;
    mutate(() => {
      S.enc.combatants.push({ uid: uid(), kind: cr.kind === "hazard" ? "hazard" : "monster", creatureId: el.dataset.id, name: pc ? `${cr.name} · ${pc.n}` : `${cr.name}${n ? " " + (n + 1) : ""}`, color: pc ? pc.c : null, colorName: pc ? pc.n : null, init, hp: cr.hp ?? null, maxHp: cr.hp ?? null, temp: 0, broken: false, defeated: false, conditions: [], permanent: cr.permanent || [], joinsRound: 0, delayed: false, counters: (cr.counters || []).map(c => ({ label: c.label, val: c.start || 0, max: c.max, down: !!c.down })), cooldowns: {}, used: {} });
      placeByInit(S.enc.combatants, S.enc.combatants[S.enc.combatants.length - 1]); logLine(`Added ${cr.name} (initiative ${init})`); S.ui.modal = null;
    });
  },
  addPc: () => { const m = S.ui.modal; if (!m.name) { toast("Enter a name"); return; } mutate(() => { S.enc.combatants.push({ uid: uid(), kind: "pc", name: m.name, init: Number(m.init) || 0, hp: null, maxHp: null, temp: 0, conditions: [], permanent: [], joinsRound: 0, delayed: false, counters: [], cooldowns: {}, used: {} }); placeByInit(S.enc.combatants, S.enc.combatants[S.enc.combatants.length - 1]); S.ui.modal = null; }); },
  addCustom: () => {
    const m = S.ui.modal; if (!m.name) { toast("Enter a name"); return; }
    mutate(() => {
      const custom = { name: m.name, kind: "creature", level: "?", hp: Number(m.hp) || 0, ac: Number(m.ac) || 10, perception: 0, saves: { fort: 0, ref: 0, will: 0 }, immunities: [], weaknesses: [], resistances: [], speed: "", abilities: [], strikes: [] };
      S.enc.combatants.push({ uid: uid(), kind: "monster", custom, name: m.name, init: Number(m.init) || 0, hp: custom.hp, maxHp: custom.hp, temp: 0, conditions: [], permanent: [], joinsRound: 0, delayed: false, counters: [], cooldowns: {}, used: {} });
      placeByInit(S.enc.combatants, S.enc.combatants[S.enc.combatants.length - 1]); S.ui.modal = null;
    });
  },
  delPack: el => openModal({ type: "confirm", title: "Remove this pack?", text: "You can import it again from the file later.", yes: "Remove", danger: true, then: async () => { await packStore.del(el.dataset.id); delete S.packs[el.dataset.id]; go("#library"); } }),
  addPartyPc: () => { const inp = document.getElementById("newPc"); const v = inp && inp.value.trim(); if (!v) return; S.settings.party.push({ id: uid(), name: v }); saveSettings(); render(); },
  delPc: el => { S.settings.party = S.settings.party.filter(p => p.id !== el.dataset.id); saveSettings(); render(); },
  palMove: el => { const i = +el.dataset.i, j = i + Number(el.dataset.d); const p = S.settings.palette; if (j < 0 || j >= p.length) return; [p[i], p[j]] = [p[j], p[i]]; saveSettings(); render(); },
  palDel: el => { S.settings.palette.splice(+el.dataset.i, 1); saveSettings(); render(); },
  palAdd: () => { S.settings.palette.push({ c: "#FFFFFF", n: "White" }); saveSettings(); render(); },
  palReset: () => { S.settings.palette = clone(DEFAULT_PALETTE); saveSettings(); render(); },
  setCrit: el => { S.settings.critMode = el.dataset.v; saveSettings(); render(); },
  setupRemove: el => { S.setup.rows = S.setup.rows.filter(r => r.uid !== el.dataset.uid); renumberSetup(); render(); },
  setupStep: el => {
    const id = el.dataset.id;
    if (Number(el.dataset.d) > 0) setupAdd(id);
    else { const rs = S.setup.rows.filter(r => r.creatureId === id); if (rs.length) S.setup.rows = S.setup.rows.filter(r => r !== rs[rs.length - 1]); renumberSetup(); }
    render();
  },
  setupAddOpen: () => openModal({ type: "setupAdd" }),
  setupAddPick: el => { setupAdd(el.dataset.id); S.ui.modal = null; render(); },
  setTheme: el => { S.settings.theme = el.dataset.v; saveSettings(); render(); },
  setFont: el => { S.settings.fontScale = Number(el.dataset.v); saveSettings(); render(); },
  exportBackup: async () => {
    const data = { format: "encounter-runner-backup", version: 1, at: new Date().toISOString(), kv: await kv.all(), packs: await packStore.all() };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `encounter-runner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Backup saved to Downloads");
  },
  clearAll: () => openModal({ type: "confirm", title: "Erase everything?", text: "Packs, settings, and any active encounter will be deleted from this tablet.", yes: "Erase all data", danger: true, then: async () => { await clearAll(); location.reload(); } }),
  reload: async () => {
    flushNow();
    const r = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (r && r.waiting) { navigator.serviceWorker.addEventListener("controllerchange", () => location.reload()); r.waiting.postMessage("skipWaiting"); }
    else location.reload();
  },
};

/* input handlers */
const I = {
  importPack: async el => {
    const f = el.files && el.files[0]; if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (p.format !== "encounter-runner-pack" || !p.id || !Array.isArray(p.sections) || !p.creatures) throw new Error("This isn't an Encounter Runner pack.");
      const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
      await packStore.put(p); S.packs[p.id] = p;
      toast(p.minAppVersion && newer(p.minAppVersion, APP_VERSION) ? `Imported ${esc(p.chapter)}, but it needs app version ${esc(p.minAppVersion)} — reload the app while online to update.` : `Imported ${esc(p.chapter)}`, 6000); render();
    } catch (e) { toast("Import failed: " + esc(e.message), 5000); }
    el.value = "";
  },
  importBackup: async el => {
    const f = el.files && el.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.format !== "encounter-runner-backup") throw new Error("Not a backup file");
      for (const p of d.packs || []) await packStore.put(p);
      for (const [k, v] of Object.entries(d.kv || {})) await kv.set(k, v);
      toast("Backup restored"); setTimeout(() => location.reload(), 600);
    } catch (e) { toast("Restore failed: " + esc(e.message), 5000); }
  },
  setInit: (el, ev) => {
    const st = S.setup; const r = st.rows.find(x => x.uid === el.dataset.uid) || st.pcs.find(x => x.uid === el.dataset.uid);
    r.init = el.value === "" ? null : Number(el.value);
    const n = st.rows.filter(x => x.init == null && !pack(st.packId).creatures[x.creatureId].simple).length + st.pcs.filter(x => x.include && x.init == null).length;
    const mc = document.getElementById("missingCount"); if (mc) mc.textContent = n ? `${n} without initiative (they'll start at 0)` : "";
  },
  pcInclude: el => { const r = S.setup.pcs.find(x => x.uid === el.dataset.uid); r.include = el.checked; },
  promptVal: el => { S.ui.modal.value = el.value; },
  addField: el => { S.ui.modal[el.dataset.f] = el.value; },
  condField: el => { S.ui.modal[el.dataset.k] = el.value; if (el.tagName === "SELECT") renderModal(); },
  padTarget: el => { const m = S.ui.modal; if (el.checked) { if (!m.targets.some(t => t.uid === el.dataset.uid)) m.targets.push({ uid: el.dataset.uid }); } else m.targets = m.targets.filter(t => t.uid !== el.dataset.uid); renderModal(); },
  padSaveType: el => { S.ui.modal.saveType = el.value; },
  padDc: el => { S.ui.modal.dc = el.value === "" ? null : Number(el.value); },
  glossQ: el => { S.ui.glossQ = el.value; const pos = el.selectionStart; render(); const n = document.querySelector('[data-in="glossQ"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } },
  newPc: () => {},
  setColors: el => { S.settings.colors = el.checked; saveSettings(); },
  setAwake: el => { S.settings.keepAwake = el.checked; saveSettings(); },
  setTies: el => { S.settings.tiesMonstersFirst = el.checked; saveSettings(); },
  setSkip: el => { S.settings.skipDefeated = el.checked; saveSettings(); },
  palC: el => { S.settings.palette[+el.dataset.i].c = el.value.toUpperCase(); saveSettings(); },
  palN: el => { S.settings.palette[+el.dataset.i].n = el.value; saveSettings(); },
};

document.addEventListener("click", ev => {
  if (Date.now() < hold.suppressUntil) { hold.suppressUntil = 0; ev.preventDefault(); ev.stopPropagation(); return; }
  if (Date.now() - dragEndAt < 300) return;
  const el = ev.target.closest("[data-act]"); if (!el) return;
  const fn = A[el.dataset.act]; if (!fn) return;
  if (el.tagName === "A") ev.preventDefault();
  try { fn(el, ev); } catch (e) { console.error(e); toast("Error: " + esc(e.message), 5000); }
});
document.addEventListener("change", ev => { const el = ev.target.closest("[data-in]"); if (el && I[el.dataset.in] && !["glossQ", "promptVal", "addField"].includes(el.dataset.in)) I[el.dataset.in](el, ev); });
document.addEventListener("input", ev => { const el = ev.target.closest("[data-in]"); if (el && ["glossQ", "promptVal", "addField", "setInit", "padDc"].includes(el.dataset.in)) I[el.dataset.in](el, ev); });
document.addEventListener("keydown", ev => {
  if (ev.key === "Enter" && S.ui.modal && S.ui.modal.type === "prompt") { ev.preventDefault(); A.promptOk(); }
  if (ev.key === "Enter" && ev.target.id === "newPc") A.addPartyPc();
  if (ev.key === "Escape" && S.ui.modal) closeModal();
});

/* ============================================================ long press */
const hold = { t: null, el: null, x: 0, y: 0, fired: false, suppressUntil: 0 };
document.addEventListener("pointerdown", ev => {
  const el = ev.target.closest("[data-hold]"); if (!el) return;
  clearTimeout(hold.t);
  hold.el = el; hold.x = ev.clientX; hold.y = ev.clientY; hold.fired = false;
  hold.t = setTimeout(() => {
    hold.t = null; hold.fired = true; hold.suppressUntil = Date.now() + 5000;
    try { navigator.vibrate && navigator.vibrate(25); } catch (_) {}
    const fn = A[el.dataset.hold]; if (fn) fn(el);
  }, 500);
});
document.addEventListener("pointermove", ev => { if (hold.t && Math.hypot(ev.clientX - hold.x, ev.clientY - hold.y) > 10) { clearTimeout(hold.t); hold.t = null; } });
for (const t of ["pointerup", "pointercancel"]) document.addEventListener(t, () => { clearTimeout(hold.t); hold.t = null; if (hold.fired) { hold.fired = false; hold.suppressUntil = Date.now() + 350; } });
document.addEventListener("contextmenu", ev => { if (ev.target.closest("[data-hold],[data-grip]")) ev.preventDefault(); });

/* ============================================================ drag to reorder */
let drag = null, dragEndAt = 0;
document.addEventListener("pointerdown", ev => {
  const g = ev.target.closest("[data-grip]"); if (!g || !S.enc) return;
  ev.preventDefault();
  const li = g.closest(".crow"); const list = document.getElementById("mainOrder"); if (!li || !list) return;
  g.setPointerCapture(ev.pointerId);
  drag = { uid: g.dataset.grip, li, list, startY: ev.clientY, target: null, after: false, pid: ev.pointerId, grip: g };
  li.classList.add("dragging");
});
document.addEventListener("pointermove", ev => {
  if (!drag || ev.pointerId !== drag.pid) return;
  const dy = ev.clientY - drag.startY;
  drag.li.style.transform = `translateY(${dy}px)`;
  const rows = [...drag.list.querySelectorAll(".crow")].filter(r => r !== drag.li);
  rows.forEach(r => r.classList.remove("over-top", "over-bot"));
  let tgt = null, after = false;
  for (const r of rows) { const b = r.getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { tgt = r; after = false; break; } }
  if (!tgt && rows.length) { tgt = rows[rows.length - 1]; after = true; }
  if (tgt) tgt.classList.add(after ? "over-bot" : "over-top");
  drag.target = tgt ? tgt.dataset.uid : null; drag.after = after;
  // auto-scroll the list pane near its edges
  const pane = drag.list.closest(".pane-left"); if (pane) { const pb = pane.getBoundingClientRect(); if (ev.clientY < pb.top + 40) pane.scrollTop -= 12; else if (ev.clientY > pb.bottom - 40) pane.scrollTop += 12; }
});
function endDrag(ev) {
  if (!drag || (ev && ev.pointerId !== drag.pid)) return;
  const d = drag; drag = null; dragEndAt = Date.now();
  d.li.classList.remove("dragging"); d.li.style.transform = "";
  if (!d.target || d.target === d.uid || Math.abs((ev ? ev.clientY : d.startY) - d.startY) < 8) { render(); return; }
  mutate(() => {
    const list = S.enc.combatants; const c = list.find(x => x.uid === d.uid); const t = list.find(x => x.uid === d.target);
    list.splice(list.indexOf(c), 1);
    list.splice(list.indexOf(t) + (d.after ? 1 : 0), 0, c);
    const i = list.indexOf(c);
    const vis = x => !x.delayed && !(x.joinsRound && S.enc.round < x.joinsRound);
    let above = null, below = null;
    for (let k = i - 1; k >= 0; k--) if (vis(list[k])) { above = list[k]; break; }
    for (let k = i + 1; k < list.length; k++) if (vis(list[k])) { below = list[k]; break; }
    c.init = above ? above.init : below ? below.init : c.init;
    logLine(`${c.name} moved in the turn order (initiative ${c.init})`);
  });
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);

/* ============================================================ wake lock */
let lock = null, wantLock = false;
async function wakeLock(want) {
  wantLock = want;
  try {
    if (want && !lock && "wakeLock" in navigator && document.visibilityState === "visible") {
      lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; });
    } else if (!want && lock) { await lock.release(); lock = null; }
  } catch (_) { lock = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") wakeLock(wantLock); else flushNow();
});
window.addEventListener("pagehide", flushNow);

/* ============================================================ theme/boot */
function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme;
  document.documentElement.style.setProperty("--fs", S.settings.fontScale);
}
async function boot() {
  try {
    const st = await kv.get("settings"); if (st) S.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), st);
    const ps = await packStore.all(); for (const p of ps) S.packs[p.id] = p;
    S.enc = (await kv.get("enc")) || null;
    S.undo = (await kv.get("undo")) || [];
    const all = await kv.all();
    for (const [k, v] of Object.entries(all)) if (k.startsWith("sec:")) S.secState[k.slice(4)] = v;
  } catch (e) { console.error(e); toast("Couldn't open storage on this device: " + esc(e.message), 6000); }
  applyTheme();
  S.persisted = await requestPersist();
  if (S.enc && !location.hash) location.hash = "#combat";
  render();
}
boot();

/* service worker + update prompt */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").then(reg => {
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) toast(`A new version is ready. <button data-act="reload">Reload</button>`, 15000);
      });
    });
  }).catch(() => {});
}
export const _test = { S, resolveDamage, buildSetup };
