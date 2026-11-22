// Condition-driven stat adjustments (Player Core conditions; same-type penalties don't stack —
// only the worst status penalty and the worst circumstance penalty apply, and different types add).

const SKILL_ATTR = {
  acrobatics: "dex", arcana: "int", athletics: "str", computers: "int", crafting: "int", deception: "cha",
  diplomacy: "cha", intimidation: "cha", medicine: "wis", nature: "wis", occultism: "int", performance: "cha",
  piloting: "dex", religion: "wis", society: "int", stealth: "dex", survival: "wis", thievery: "dex",
};
export function skillAttr(name) {
  const n = String(name || "").toLowerCase().trim();
  if (n.includes("lore")) return "int";
  return SKILL_ATTR[n] || null;
}

/* stat descriptors
   {k:"ac"} {k:"save", s:"fort"|"ref"|"will"} {k:"perception"} {k:"skill", attr}
   {k:"attack", range:"melee"|"ranged"} {k:"damage", range} {k:"dc"} */
const isCheckOrDC = st => st.k !== "damage";
function effectsOf(name, v) {
  // returns [{type, value, applies(st)}]
  const all = st => isCheckOrDC(st);
  const dexStat = st => st.k === "ac" || (st.k === "save" && st.s === "ref") || (st.k === "attack" && st.range === "ranged") || (st.k === "skill" && st.attr === "dex");
  const offGuard = { type: "circumstance", value: -2, applies: st => st.k === "ac", why: "off-guard" };
  switch (name) {
    case "Frightened": return [{ type: "status", value: -v, applies: all }];
    case "Sickened": return [{ type: "status", value: -v, applies: all }];
    case "Clumsy": return [{ type: "status", value: -v, applies: dexStat }];
    case "Encumbered": return [{ type: "status", value: -1, applies: dexStat, why: "clumsy 1" }];
    case "Enfeebled": return [{ type: "status", value: -v, applies: st => (st.k === "attack" && st.range === "melee") || (st.k === "damage" && st.range === "melee") || (st.k === "skill" && st.attr === "str") }];
    case "Stupefied": return [{ type: "status", value: -v, applies: st => (st.k === "save" && st.s === "will") || st.k === "perception" || (st.k === "skill" && ["int", "wis", "cha"].includes(st.attr)) }];
    case "Drained": return [{ type: "status", value: -v, applies: st => st.k === "save" && st.s === "fort" }];
    case "Fatigued": return [{ type: "status", value: -1, applies: st => st.k === "ac" || st.k === "save" }];
    case "Unconscious": return [{ type: "status", value: -4, applies: st => st.k === "ac" || st.k === "perception" || (st.k === "save" && st.s === "ref") }, offGuard];
    case "Off-Guard": case "Grabbed": case "Restrained": case "Paralyzed": case "Confused": return [offGuard];
    case "Prone": return [offGuard, { type: "circumstance", value: -2, applies: st => st.k === "attack", why: "prone" }];
    case "Suppressed": return [{ type: "circumstance", value: -1, applies: st => st.k === "attack" }];
    default: return [];
  }
}
export function condList(c) {
  return [...(c.permanent || []), ...(c.conditions || [])].filter(x => x.name !== "Persistent Damage");
}
/** penalty for one stat: {total, parts:[{label,value,type,used}]} */
export function penalty(c, st) {
  const parts = [];
  for (const x of condList(c)) {
    for (const e of effectsOf(x.name, Number(x.value) || 0)) {
      if (!e.value || !e.applies(st)) continue;
      const label = `${x.name}${x.value ? " " + x.value : ""}${e.why && e.why.toLowerCase() !== x.name.toLowerCase() ? ` (${e.why})` : ""}`;
      parts.push({ label, value: e.value, type: e.type });
    }
  }
  let total = 0;
  for (const type of ["status", "circumstance"]) {
    const ofType = parts.filter(p => p.type === type);
    if (!ofType.length) continue;
    const worst = ofType.reduce((a, b) => (b.value < a.value ? b : a));
    worst.used = true; total += worst.value;
  }
  return { total, parts };
}
export function penaltyText(p) {
  return p.parts.filter(x => x.used).map(x => `${x.label.toLowerCase()} ${x.value}`).join(", ");
}
// Conditions that can matter but aren't automated
export function manualNotes(c) {
  const out = [];
  for (const x of condList(c)) {
    if (x.name === "Glitching") out.push(`Glitching ${x.value || ""}: on a failed flat check (DC ${5 + (Number(x.value) || 0)}) it takes an item penalty of −${x.value || 0} to all checks and DCs — not applied automatically`);
    if (x.name === "Drained") out.push(`Drained ${x.value}: also lowers max HP by level × ${x.value} — adjust HP by hand`);
    if (x.name === "Blinded" || x.name === "Dazzled") out.push(`${x.name}: Perception and targeting penalties depend on its senses — not applied automatically`);
  }
  return out;
}
