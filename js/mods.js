// Condition penalties -> adjusted creature statistics.
// Rules (Player Core conditions): bonuses/penalties of the same type don't stack (worst one counts);
// different types add up. Only status and circumstance penalties come from conditions here.

const SKILL_ATTR = {
  acrobatics: "dex", stealth: "dex", thievery: "dex", piloting: "dex",
  athletics: "str",
  arcana: "int", crafting: "int", computers: "int", occultism: "int", society: "int",
  medicine: "wis", nature: "wis", religion: "wis", survival: "wis",
  deception: "cha", diplomacy: "cha", intimidation: "cha", performance: "cha",
};
export function skillAttr(name) {
  const n = String(name).toLowerCase();
  if (/lore$/.test(n)) return "int";
  return SKILL_ATTR[n] || null;
}
// Which attribute a strike uses: ranged = Dex; melee = Str, finesse = the higher of Str/Dex; data may override.
export function strikeAttr(cr, s) {
  if (s.attr) return s.attr;
  if (s.range === "ranged") return "dex";
  const fin = (s.traits || []).some(t => /^finesse/i.test(t));
  if (fin && cr.attrs && (cr.attrs.dex || 0) > (cr.attrs.str || 0)) return "dex";
  return "str";
}

// Conditions that include off-guard
const OFF_GUARD_FROM = ["off-guard", "grabbed", "restrained", "paralyzed", "confused", "prone", "unconscious"];

/**
 * Collect penalty entries from a combatant's conditions.
 * Each entry: {cond, type: "status"|"circumstance", value (negative), applies(statKey, ctx) -> bool}
 * statKey: "ac","fort","ref","will","perception","skill","attack","damage","dc"; ctx: {attr, range, skill}
 */
export function penaltyEntries(c, cr) {
  const out = []; const warn = [];
  const imm = new Set((cr && cr.immunities || []).map(x => String(x).toLowerCase()));
  const conds = (c.conditions || []).filter(x => !x.immune);
  const has = n => conds.find(x => x.name.toLowerCase() === n);
  const val = n => { const x = has(n); return x ? (x.value || 0) : 0; };
  const add = (cond, type, value, applies) => { if (value) out.push({ cond, type, value: -Math.abs(value), applies }); };
  const all = () => true;
  for (const n of ["frightened", "sickened"]) if (val(n)) add(`${cap(n)} ${val(n)}`, "status", val(n), (k) => k !== "damage");
  let clumsy = val("clumsy"); if (has("encumbered")) clumsy = Math.max(clumsy, 1);
  if (clumsy) add(`Clumsy ${clumsy}`, "status", clumsy, (k, x) => k === "ac" || k === "ref" || ((k === "attack" || k === "skill") && x.attr === "dex"));
  if (val("enfeebled")) add(`Enfeebled ${val("enfeebled")}`, "status", val("enfeebled"), (k, x) => (k === "attack" || k === "damage") ? (x.attr === "str" && x.range !== "ranged") : (k === "skill" && x.attr === "str"));
  if (val("stupefied")) add(`Stupefied ${val("stupefied")}`, "status", val("stupefied"), (k, x) => k === "will" || k === "perception" || (k === "skill" && ["int", "wis", "cha"].includes(x.attr)));
  if (val("drained")) add(`Drained ${val("drained")}`, "status", val("drained"), (k) => k === "fort");
  if (has("fatigued")) add("Fatigued", "status", 1, (k) => k === "ac" || k === "fort" || k === "ref" || k === "will");
  if (has("unconscious")) add("Unconscious", "status", 4, (k) => k === "ac" || k === "perception" || k === "ref");
  if (has("fascinated")) add("Fascinated", "status", 2, (k) => k === "perception" || k === "skill");
  const og = OFF_GUARD_FROM.find(n => has(n));
  if (og) add(og === "off-guard" ? "Off-guard" : `Off-guard (${cap(og)})`, "circumstance", 2, (k) => k === "ac");
  if (has("prone")) add("Prone", "circumstance", 2, (k) => k === "attack");
  if (has("suppressed")) add("Suppressed", "circumstance", 1, (k) => k === "attack");
  return out;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Combine entries that apply to a stat: worst per type, then sum. Returns {delta, parts:[{cond,value}]} */
export function combine(entries, statKey, ctx = {}) {
  const best = {};
  for (const e of entries) {
    if (!e.applies(statKey, ctx)) continue;
    if (!best[e.type] || e.value < best[e.type].value) best[e.type] = e;
  }
  const parts = Object.values(best).map(e => ({ cond: e.cond, value: e.value, type: e.type }));
  return { delta: parts.reduce((a, p) => a + p.value, 0), parts };
}

/** Build a stat calculator for one combatant. */
export function statCalc(c, cr) {
  const entries = penaltyEntries(c, cr);
  const calc = (key, base, ctx = {}) => {
    const r = combine(entries, key, ctx);
    return { base, value: base + r.delta, delta: r.delta, parts: r.parts };
  };
  return {
    entries,
    any: entries.length > 0,
    ac: base => calc("ac", base),
    save: (k, base) => calc(k, base),
    perception: base => calc("perception", base),
    skill: (name, base) => calc("skill", base, { attr: skillAttr(name) }),
    attack: (s, base) => calc("attack", base, { attr: strikeAttr(cr, s), range: s.range }),
    damage: (s) => calc("damage", 0, { attr: strikeAttr(cr, s), range: s.range }),
    dc: base => calc("dc", base),
    summary() {
      if (!entries.length) return "";
      const generic = combine(entries, "dc").delta; // frightened/sickened style penalties
      const bits = [];
      if (generic) bits.push(`${generic} to all checks and DCs`);
      const stats = [["AC", "ac"], ["Fort", "fort"], ["Reflex", "ref"], ["Will", "will"], ["Perception", "perception"]];
      for (const [lbl, k] of stats) { const d = combine(entries, k).delta; if (d !== generic) bits.push(`${lbl} ${d}`); }
      for (const [lbl, ctx] of [["melee attacks", { range: "melee", attr: "str" }], ["ranged attacks", { range: "ranged", attr: "dex" }]]) {
        const d = combine(entries, "attack", ctx).delta; if (d !== generic) bits.push(`${lbl} ${d}`);
      }
      const dmg = combine(entries, "damage", { range: "melee", attr: "str" }).delta; if (dmg) bits.push(`Strength melee damage ${dmg}`);
      return bits.join(" · ").replace(/-(\d)/g, "−$1");
    },
  };
}

/** Immunity check when adding a condition. Returns {immune, warn} */
export function immunityFor(cr, condName) {
  if (!cr) return { immune: false, warn: "" };
  const imm = (cr.immunities || []).map(x => String(x).toLowerCase());
  const n = condName.toLowerCase();
  if (imm.includes(n)) return { immune: true, warn: `${cr.name} is immune to ${n}; it has no effect.` };
  if (n === "frightened" && imm.includes("mental")) return { immune: false, warn: `${cr.name} is immune to mental effects, so fear effects like Demoralize don't work on it. Added anyway in case this came from a non-mental source.` };
  if (n === "off-guard" || OFF_GUARD_FROM.includes(n)) return { immune: false, warn: "" };
  return { immune: false, warn: "" };
}
