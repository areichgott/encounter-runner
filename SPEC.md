# Encounter Runner — Spec

An offline, installable web app (PWA) for running Starfinder 2e / Pathfinder 2e encounters at the table on a Galaxy Tab A8 (10.5", 1920×1200, landscape).

## Principles

- **Offline first.** After one online visit and "Add to Home screen", everything works in airplane mode. A service worker caches the app shell; all state lives in IndexedDB on the device (persistent storage requested).
- **No adventure content in this repo.** The app is an empty shell. Adventure data comes from *content packs* (JSON) that the GM imports from the tablet's storage. Packs never leave the device.
- **Never lose a fight.** Every change autosaves. Closing the app, reloading, or rebooting resumes the encounter exactly where it was. Undo covers every action.
- **No book flipping.** Each creature card is self-contained: tactics, full stat block, and every referenced condition, ability and trait one tap away.
- **Touch-first.** Large targets, two-pane layout in landscape and stacked layout in portrait, dark theme by default, keeps the screen awake during combat.

## Screens

1. **Library** — imported packs → chapters → sections in book order. Packs hold only sections that need a tracker (combat, chase, influence, points trackers) plus one NPC page per chapter; everything read-only stays in the book. Tapping a combat goes straight to setup. Resume banner for an active encounter. Glossary, Settings.
2. **Section** — summary and in-fight notes, counters (Chase Points, Cooking Points, rounds). **NPC page**: one collapsible card per NPC (wants, knows, personality, attitude, tips). **Influence tracker**: start attitude (pre-selected from the last finished fight when the book ties it to one), round and Influence Point bar with threshold marks, one Influence or Discover action per PC per round (players roll openly, the GM taps the degree of success), Discover reveals (lowest-DC unknown skill, resistances, weaknesses; false clue on a critical failure), resistance/weakness buttons that adjust DCs or points, automatic end at the top threshold or when rounds run out, book outcome text, undo and log.
   **Loot**: gear from each defeated creature's Items line, multiplied and merged, plus the section's found treasure; shown in setup notes (preview), the Encounter notes tab and the End encounter dialog. Sections can set loot modes (e.g. one set only).
3. **Encounter setup** — add or remove creatures (− / + per type, × per creature, add any creature from the pack; colors stay with their creature and new ones take the first unused color); choose the book variant (e.g. Moderate vs Severe) and party size (4 or 5; default from Settings). Combatants are filled in from the pack, including the pre-built five-player version. Mini colors are assigned in Mini press order (running count across the encounter, same palette), editable per combatant. PCs from the roster are included. Initiative: tap to roll for all monsters (Perception by default, Stealth per group when sneaking, with the pack's per-encounter adjustments), type PC results on a number pad. Combatants can be set to join on a later round.
4. **Combat** — turn order (drag the ⋮⋮ grip to reorder; the moved combatant takes its new neighbor's initiative): initiative order with color chip, name, HP bar, AC, condition chips, current turn highlighted. Detail pane: selected combatant with HP controls, conditions, and the stat block in table order — tactics, conditional-damage toggles, attacks and actions, defenses, then Perception, skills and items. Tap a toggle for one creature; press and hold (or tap “All …”) to set every creature of that kind: if any are off they all turn on, if all are on they all turn off.
5. **Glossary** — searchable conditions, creature abilities, actions and traits (built-in conditions + each pack's references).
6. **Settings** — party roster, default party size, mini palette (defaults to the Mini press palette), theme, text size, keep-awake, backup export/import, clear data.

## Combat rules automation

- **Turn order**: Next/Previous turn, round counter, drag to reorder, Delay (remove and re-enter), combatants joining at the start of a set round.
- **Start of turn**: fast healing applied; stunned/slowed action loss computed (stunned overrides slowed; stunned value reduced by the actions it took); timed effects that end at the start of this creature's turn expire; per-round ability frequencies reset; cooldowns tick.
- **End of turn**: frightened drops by 1; persistent damage prompt (roll, apply with IWR, DC 15 flat check to end); timed effects that end at the end of this creature's turn expire.
- **Damage pad**: number pad with a live running total. Add one or more damage components (amount + type). Applies immunities, then weaknesses (highest applicable once per instance), then resistances (highest applicable per component), then Hardness; temp HP absorbs first. Concussive option uses the weaker of the target's piercing/bludgeoning defenses. Critical-hit toggle for abilities that react to crits (e.g. construct armor breaking). Multi-target mode for area damage with a basic-save result (or auto-rolled save vs a DC) per target.
- **Breakable armor**: data-driven alternate state (e.g. Hardness 3 → 0 and AC 16 → 12 when below half HP or on a critical hit), applied automatically.
- **Rolls**: d20 + modifier for strikes (MAP 1st/2nd/3rd, agile aware), saves, skills, Perception. Attack rolls also show hit and crit damage, including active conditional damage. Crit setting: double the total (official) or roll twice the dice and double flat bonuses (house rule). Natural 1/20 flagged. Optional DC shows degree of success. Roll log.
- **Conditions**: valued and unvalued, optional duration (N rounds, or until the start/end of a chosen combatant's next turn), rules text one tap away.
- **Condition penalties**: frightened, sickened, clumsy, enfeebled, stupefied, drained, fatigued, off-guard (and conditions that include it), prone, suppressed, unconscious and fascinated adjust AC, saves, Perception, skills, attacks, Strength melee damage and creature DCs. Same-type penalties don't stack; status and circumstance add. Adjusted numbers show in the warning text color; a summary line under the conditions opens a breakdown. Finesse melee uses the higher of Str/Dex. Drained lowers current and max HP by level × value. Immunities are respected (warning for mental immunity vs frightened).
- **Attack counter**: the next 1st/2nd/3rd attack button is highlighted per turn; abilities tagged `map: "hold2"` (e.g. Attack Pattern Beta) make two Strikes share a penalty.
- **Counters**: hazard successes/rounds, ability cooldowns (e.g. 1d4 rounds rolled automatically), once-per-round toggles.
- **Undo**: last 100 actions.

## Content pack format (v1)

```jsonc
{
  "format": "encounter-runner-pack", "version": 1, "minAppVersion": "1.2.0",
  "id": "pzo24006e-ch2", "adventure": "…", "chapter": "Chapter 2: …",
  "partyLevel": 2, "lookupsAsOf": "2026-11-21",
  "creatures": { "<id>": Creature },
  "npcs":      { "<id>": Npc },
  "refs":      { "<key>": { "name", "kind": "condition|ability|action|trait|item|affliction", "text", "source" } },
  "sections":  [ Section ]
}
```

**Creature**: `name, kind (creature|hazard), simple (no turn: simple hazards and objects), object, ally (no mini color), turnTable{label, options[{name,text,heal,conds[{name,value,untilEnd}],endDamage,endText}]} (random state rolled at the start of each turn), stealthDC, bt, hpNote, level, rarity, size, traits[], source, sourcePages[], notes[], perception, senses, languages, skills[{name,mod}], attrs{str,dex,con,int,wis,cha}, items, ac, saves{fort,ref,will}, hp, hardness, broken{ac,hardness,when:["half","crit"]}, fastHealing, immunities[], weaknesses[{type,value}], resistances[{type,value}], speed, stealth (hazards), disable, conditional[{id,label,dice,type,applies: melee|ranged|all,when}], abilities[{name, cost, traits, text, place: top|mid|bottom, frequency, cooldown, rollAttack, rollDamage, rollType, refs[]}], strikes[{range: melee|ranged, name, cost, bonus, traits[], damage, type, extra, refs[]}], routine{actions,text,damage,type,save}, reset, refs[]`. Costs: `1 | 2 | 3 | free | reaction`.

**Section**: `id, title, kind (npcs|combat|chase|influence|scene), npc (influence), lootModes[{id,label,maxSets,countAll,note}], bookNote, tag (e.g. "Moderate or Severe 2"), summary, notes[], npcs[], counters[{label,start,max,down}], obstacles[] (chases), events[] (exploration), rewards, treasure, variants[{id,label,p4:[Slot],p5:[Slot],scaling}], tactics{creatureId:text}`.

**Slot**: `{creature, count, initAdj, initNote, startConditions[{name,value}], joinsRound, labelPrefix}`.

**Npc**: `name, descriptor, where, wants[], knows[], personality, attitude, tips[], bookNote, influence{optional, perception, will, discovery[{dc,skill}], skills[{id,dc,skill,note}], thresholds[{points,text}], resistances[Eff], weaknesses[Eff], starts[{id,label,rounds|null,text,autoIf{section,damaged}}], outcomes[{min,text}], after[], hostile{label,text,section,variant}, penalty{label,text}}`. **Eff**: `{id, label, short, text, dc + scope: all|pc, or points + once, or bonus + scope: pc}`.

Text fields accept `**bold**` and `//italic//`. Creature-imposed DCs are written `DC {dc:N}` (or `{skilldc:Skill}` for a DC derived from a skill) so condition penalties adjust them; pack builders fail on any untagged creature DC or on ability text that mentions the multiple attack penalty without a `map` tag. Rules references (`refs` keys) render as tappable terms.

## Hosting & install

GitHub Pages from `main` (repo root). On the tablet: open the Pages URL in Chrome → ⋮ → Add to Home screen → open once online so the service worker caches everything → import a pack from Downloads.
