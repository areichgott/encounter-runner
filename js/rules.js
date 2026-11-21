// Dice, damage resolution, and turn automation. Pure functions (no DOM).
import { DAMAGE_TYPES } from "./conditions.js";

/* ------------------------------------------------------------------ dice */
export function rnd(n) {
  if (globalThis.crypto && crypto.getRandomValues) {
    const a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] % n) + 1;
  }
  return Math.floor(Math.random() * n) + 1;
}
// "2d6+4", "1d8", "1d4+3", "5" -> {total, dice:[...], text}
export function rollExpr(expr) {
  const s = String(expr || "").replace(/\s+/g, "");
  const terms = s.match(/[+-]?[^+-]+/g) || [];
  let total = 0; const parts = [];
  for (const t of terms) {
    const sign = t.startsWith("-") ? -1 : 1;
    const body = t.replace(/^[+-]/, "");
    const m = body.match(/^(\d*)d(\d+)$/i);
    if (m) {
      const n = parseInt(m[1] || "1", 10), sides = parseInt(m[2], 10);
      const rolls = []; for (let i = 0; i < n; i++) rolls.push(rnd(sides));
      const sum = rolls.reduce((a, b) => a + b, 0) * sign;
      total += sum; parts.push(`${sign < 0 ? "−" : ""}[${rolls.join(",")}]`);
    } else if (/^\d+$/.test(body)) {
      total += sign * parseInt(body, 10); parts.push(`${sign < 0 ? "−" : "+"}${body}`);
    }
  }
  return { total: Math.max(0, total), text: parts.join(" ").replace(/^\+/, "") };
}
/**
 * Damage roll with crit handling.
 * mode "double": roll normally, double the total (official rule).
 * mode "dice": roll twice as many dice and double flat bonuses (house rule).
 */
export function rollDamage(expr, crit = false, mode = "double") {
  if (!crit) { const r = rollExpr(expr); return { total: r.total, text: r.text, expr }; }
  if (mode === "dice") {
    const s = String(expr || "").replace(/\s+/g, "");
    const doubled = (s.match(/[+-]?[^+-]+/g) || []).map(t => {
      const sign = t.startsWith("-") ? "-" : "+";
      const body = t.replace(/^[+-]/, "");
      const m = body.match(/^(\d*)d(\d+)$/i);
      if (m) return `${sign}${parseInt(m[1] || "1", 10) * 2}d${m[2]}`;
      if (/^\d+$/.test(body)) return `${sign}${parseInt(body, 10) * 2}`;
      return "";
    }).join("").replace(/^\+/, "");
    const r = rollExpr(doubled);
    return { total: r.total, text: r.text, expr: doubled };
  }
  const r = rollExpr(expr);
  return { total: r.total * 2, text: `(${r.text}) × 2`, expr };
}
export function d20(mod) {
  const nat = rnd(20); return { nat, total: nat + mod, mod };
}
export function degree(total, nat, dc) {
  if (dc == null || dc === "" || isNaN(dc)) return null;
  let d = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (nat === 20) d = Math.min(3, d + 1);
  if (nat === 1) d = Math.max(0, d - 1);
  return ["Critical failure", "Failure", "Success", "Critical success"][d];
}
export function mapPenalty(attackNo, agile) {
  if (attackNo <= 1) return 0;
  return attackNo === 2 ? (agile ? -4 : -5) : (agile ? -8 : -10);
}

/* ------------------------------------------------------------ damage IWR */
const PHYS = new Set(DAMAGE_TYPES.physical);
const ENERGY = new Set(DAMAGE_TYPES.energy);

function entryMatches(entryType, dmgType) {
  const e = String(entryType).toLowerCase().trim();
  const t = dmgType.toLowerCase();
  if (e === t) return true;
  if (e === "all damage" || e === "all") return true;
  if (e === "physical" && PHYS.has(t)) return true;
  if (e === "energy" && ENERGY.has(t)) return true;
  return false;
}
// immunities is a list of strings (may include non-damage things like "poison", "death effects")
function isImmune(cr, t) {
  if (t === "void" && cr.voidHealing) return true;
  return (cr.immunities || []).some(i => entryMatches(i, t));
}
function bestValue(list, t) {
  let v = 0;
  for (const w of list || []) if (entryMatches(w.type, t)) v = Math.max(v, Number(w.value) || 0);
  return v;
}
/**
 * Resolve one instance of damage against a creature.
 * comps: [{amount, type}], opts: {concussive, crit, saveMult}
 * state: {hp, maxHp, temp, broken}
 */
export function resolveDamage(cr, state, comps, opts = {}) {
  const lines = [];
  const mult = opts.saveMult == null ? 1 : opts.saveMult;
  const work = comps.filter(c => c.amount > 0 || c.amount === 0).map(c => {
    let amt = Math.floor(c.amount * mult);
    return { type: c.type, base: c.amount, amt };
  });
  if (mult !== 1) lines.push(mult === 0 ? "Save: no damage" : mult === 0.5 ? "Save: half damage" : "Save: double damage");
  // immunities + choose concussive type
  for (const w of work) {
    let types = [w.type];
    if (opts.concussive && (w.type === "piercing" || w.type === "bludgeoning")) types = ["piercing", "bludgeoning"];
    let best = null;
    for (const t of types) {
      const imm = isImmune(cr, t);
      const res = imm ? Infinity : bestValue(cr.resistances, t);
      if (!best || res < best.res) best = { t, imm, res };
    }
    w.effType = best.t; w.immune = best.imm; w.res = best.imm ? 0 : best.res;
    if (w.immune && w.amt > 0) { lines.push(`Immune to ${w.effType}: ${w.amt} → 0`); w.amt = 0; }
  }
  // weakness: highest applicable once per instance
  let weak = 0, weakComp = null;
  for (const w of work) {
    if (w.immune || w.amt <= 0) continue;
    const v = bestValue(cr.weaknesses, w.effType);
    if (v > weak) { weak = v; weakComp = w; }
  }
  if (weakComp) { weakComp.amt += weak; lines.push(`Weakness ${weakComp.effType} ${weak}: +${weak}`); }
  // resistance per component
  for (const w of work) {
    if (w.immune || w.amt <= 0 || !w.res) continue;
    const before = w.amt; w.amt = Math.max(0, w.amt - w.res);
    lines.push(`Resistance ${w.effType} ${w.res}: ${before} → ${w.amt}`);
  }
  let total = work.reduce((a, w) => a + w.amt, 0);
  const hard = currentHardness(cr, state);
  if (hard && total > 0) { const b = total; total = Math.max(0, total - hard); lines.push(`Hardness ${hard}: ${b} → ${total}`); }
  // temp HP
  let temp = state.temp || 0, hp = state.hp;
  let toTemp = Math.min(temp, total); temp -= toTemp; const toHp = total - toTemp;
  if (toTemp) lines.push(`Temp HP absorbs ${toTemp}`);
  hp = Math.max(0, hp - toHp);
  // armor break
  let broken = !!state.broken, breaks = false;
  if (cr.broken && !broken) {
    const when = cr.broken.when || [];
    if ((when.includes("half") && hp < state.maxHp / 2) || (when.includes("crit") && opts.crit && total > 0)) { broken = true; breaks = true; }
  }
  return { total, toHp, hp, temp, broken, breaks, lines, work };
}
export function currentHardness(cr, state) {
  if (!cr || !cr.hardness) return 0;
  if (state.broken && cr.broken) return cr.broken.hardness || 0;
  return cr.hardness;
}
export function currentAC(cr, state) {
  if (!cr) return null;
  if (state.broken && cr.broken && cr.broken.ac != null) return cr.broken.ac;
  return cr.ac;
}

/* ------------------------------------------------------- turn automation */
export function cond(c, name) {
  return (c.conditions || []).find(x => x.name.toLowerCase() === name.toLowerCase());
}
// Start-of-turn: returns {notes:[], actions}
export function actionsAtStart(c, baseActions = 3) {
  const notes = [];
  const st = cond(c, "Stunned"), sl = cond(c, "Slowed");
  const perm = (c.permanent || []).find(p => p.name === "Slowed");
  const slowedVal = Math.max(sl ? (sl.value || 0) : 0, perm ? perm.value : 0);
  let actions = baseActions;
  if (cond(c, "Quickened")) { actions += 1; notes.push("Quickened: +1 action"); }
  let lostStun = 0;
  if (st && st.value > 0) {
    lostStun = Math.min(st.value, actions);
    actions -= lostStun;
    st.value -= lostStun;
    notes.push(`Stunned: loses ${lostStun} action${lostStun === 1 ? "" : "s"}${st.value > 0 ? ` (stunned ${st.value} left)` : " (stunned ends)"}`);
    if (st.value <= 0) c.conditions = c.conditions.filter(x => x !== st);
  }
  if (slowedVal > 0) {
    const lostSlow = Math.max(0, slowedVal - lostStun);
    const l = Math.min(lostSlow, actions);
    actions -= l;
    if (l) notes.push(`Slowed ${slowedVal}: loses ${l} more`);
  }
  return { notes, actions };
}
