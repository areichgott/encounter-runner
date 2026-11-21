# Encounter Runner — Spec

An offline, installable web app (PWA) for running Starfinder 2e / Pathfinder 2e encounters at the table on a Galaxy Tab A8 (10.5", 1920×1200, landscape).

## Principles

- **Offline first.** After one online visit and "Add to Home screen", everything works in airplane mode. A service worker caches the app shell; all state lives in IndexedDB on the device (persistent storage requested).
- **No adventure content in this repo.** The app is an empty shell. Adventure data comes from *content packs* (JSON) that the GM imports from the tablet's storage. Packs never leave the device.
- **Never lose a fight.** Every change autosaves. Closing the app, reloading, or rebooting resumes the encounter exactly where it was. Undo covers every action.
- **No book flipping.** Each creature card is self-contained: tactics, full stat block, and every referenced condition, ability and trait one tap away.
- **Touch-first.** Large targets, two-pane layout in landscape and stacked layout in portrait, dark theme by default, keeps the screen awake during combat.

## Screens

1. **Library** — imported packs → chapters → sections in book order (combat, hazard, chase, social, exploration, scene). Resume banner for an active encounter. Glossary, Settings.
2. **Section** — read-aloud/summary notes, NPC panel (wants / knows / personality / influence), counters (Chase Points, Influence Points, hazard successes, rounds), rewards and treasure. "Start encounter" for combat sections.
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
- **Counters**: hazard successes/rounds, ability cooldowns (e.g. 1d4 rounds rolled automatically), once-per-round toggles.
- **Undo**: last 100 actions.

## Content pack format (v1)

```jsonc
{
  "format": "encounter-runner-pack", "version": 1,
  "id": "pzo24006e-ch2", "adventure": "…", "chapter": "Chapter 2: …",
  "partyLevel": 2, "lookupsAsOf": "2026-11-21",
  "creatures": { "<id>": Creature },
  "npcs":      { "<id>": Npc },
  "refs":      { "<key>": { "name", "kind": "condition|ability|action|trait|item|affliction", "text", "source" } },
  "sections":  [ Section ]
}
```

**Creature**: `name, kind (creature|hazard), level, rarity, size, traits[], source, sourcePages[], notes[], perception, senses, languages, skills[{name,mod}], attrs{str,dex,con,int,wis,cha}, items, ac, saves{fort,ref,will}, hp, hardness, broken{ac,hardness,when:["half","crit"]}, fastHealing, immunities[], weaknesses[{type,value}], resistances[{type,value}], speed, stealth (hazards), disable, conditional[{id,label,dice,type,applies: melee|ranged|all,when}], abilities[{name, cost, traits, text, place: top|mid|bottom, frequency, cooldown, rollAttack, rollDamage, rollType, refs[]}], strikes[{range: melee|ranged, name, cost, bonus, traits[], damage, type, extra, refs[]}], routine{actions,text,damage,type,save}, reset, refs[]`. Costs: `1 | 2 | 3 | free | reaction`.

**Section**: `id, title, kind, tag (e.g. "Moderate or Severe 2"), summary, notes[], npcs[], counters[{label,start,max,down}], obstacles[] (chases), events[] (exploration), rewards, treasure, variants[{id,label,p4:[Slot],p5:[Slot],scaling}], tactics{creatureId:text}`.

**Slot**: `{creature, count, initAdj, initNote, startConditions[{name,value}], joinsRound, labelPrefix}`.

**Npc**: `name, descriptor, wants[], knows[], personality, attitude, tips[], influence{perception, will, discovery, skills[{dc,skill,note}], thresholds[{points,text}], resistances, weaknesses, rounds}`.

Text fields accept `**bold**` and `//italic//`. Rules references (`refs` keys) render as tappable terms.

## Hosting & install

GitHub Pages from `main` (repo root). On the tablet: open the Pages URL in Chrome → ⋮ → Add to Home screen → open once online so the service worker caches everything → import a pack from Downloads.
