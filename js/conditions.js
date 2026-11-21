// Conditions glossary, paraphrased from Starfinder Player Core (Conditions Appendix, p. 435+).
// valued: the condition carries a number. Text is a full paraphrase with every number kept.
export const CONDITIONS = [
  { name: "Blinded", text: "Can't see. All normal terrain is difficult terrain. Can't detect anything by vision; automatically critically fails Perception checks that need sight, and if vision is the only precise sense, takes a –4 status penalty to Perception. Immune to visual effects. Overrides dazzled." },
  { name: "Broken", text: "Objects only: HP at or below the Broken Threshold. A broken object can't do its normal job or grant bonuses, except armor, which still gives its item bonus to AC but also a status penalty to AC (–1 light, –2 medium, –3 heavy). Penalties from carrying or wearing it still apply." },
  { name: "Clumsy", valued: true, text: "Status penalty equal to the value to Dexterity-based rolls and DCs: AC, Reflex saves, ranged attack rolls, and Acrobatics, Stealth and Thievery checks." },
  { name: "Concealed", text: "Hard to see (fog, etc.). Anyone targeting a concealed creature with an attack, spell or other effect must succeed at a DC 5 flat check or it doesn't affect them. Area effects don't need the flat check." },
  { name: "Confused", text: "Off-guard, treats no one as an ally, and can't Delay, Ready or use reactions. Uses all actions to Strike or cast offensive cantrips at targets the GM picks randomly (moving or drawing weapons as needed). With no other target, targets itself (automatic hit, no critical). Each time it takes damage from an attack or spell, it can attempt a DC 11 flat check to end the condition." },
  { name: "Controlled", text: "Another creature dictates its actions, including attacks, reactions and Delay, usually without spending its own actions." },
  { name: "Dazzled", text: "If vision is its only precise sense, all creatures and objects are concealed from it." },
  { name: "Deafened", text: "Can't hear. Automatically critically fails Perception checks that need hearing; –2 status penalty to Perception for initiative and to checks involving sound that also use other senses. Using an auditory action requires a DC 5 flat check (after spending the action) or the action is lost. Immune to auditory effects." },
  { name: "Doomed", valued: true, text: "The dying value at which you die is reduced by the doomed value; if that reaches 0 you die instantly. Decreases by 1 after each full night's rest. Ends at death." },
  { name: "Drained", valued: true, text: "Status penalty equal to the value to Constitution-based rolls and DCs (such as Fortitude saves). Loses HP equal to level (minimum 1) × value, and maximum HP drops by the same amount (not damage). Decreases by 1 after each full night's rest; max HP returns but lost HP isn't restored." },
  { name: "Dying", valued: true, text: "Unconscious. Dies at dying 4. Recovery check at the start of each turn. Taking damage while dying adds 1 (2 from an enemy's critical hit or your critical failure on the save). Losing dying gives wounded 1 (or +1 wounded). Regaining 1 HP or more ends dying and wakes you. (Monsters normally just die at 0 HP.)" },
  { name: "Encumbered", text: "Clumsy 1 and a –10-foot penalty to all Speeds (minimum 5 feet)." },
  { name: "Enfeebled", valued: true, text: "Status penalty equal to the value to Strength-based rolls and DCs: Strength-based melee attack and damage rolls and Athletics checks." },
  { name: "Fascinated", text: "–2 status penalty to Perception and skill checks, and can't use concentrate actions unrelated to the subject of fascination (GM's call). Ends if a creature uses hostile actions against it or its allies." },
  { name: "Fatigued", text: "–1 status penalty to AC and saving throws; can't use exploration activities while traveling. Ends after a full night's rest." },
  { name: "Fleeing", text: "Must spend every action trying to escape the source as quickly as possible (moving away, opening doors in the way). Can't Delay or Ready." },
  { name: "Friendly", text: "Attitude: likes the character and will likely agree to simple, safe, cheap Requests. Hostile actions against it worsen its attitude (GM decides how far)." },
  { name: "Frightened", valued: true, text: "Status penalty equal to the value to all checks and DCs. Unless stated otherwise, the value drops by 1 at the end of each of its turns. (The runner does this automatically.)" },
  { name: "Glitching", valued: true, text: "Tech creatures, hazards or objects. Flat check at the start of each turn (creature) or when using glitching gear; DC = 5 + value. Critical success: reduce the value by 1. Success: act normally. Failure: item penalty equal to the value to all checks and DCs (saves, attack modifiers, ability and spell DCs). Critical failure: a glitching object doesn't work and the actions are lost; a glitching creature takes the failure effect and is stunned 1; a hazard takes the failure effect." },
  { name: "Grabbed", text: "Held in place: off-guard and immobilized. Manipulate actions need a DC 5 flat check (rolled after spending the action) or they're lost." },
  { name: "Helpful", text: "Attitude: wants to actively help and accepts reasonable Requests that don't cost it its goals or quality of life. Hostile actions worsen its attitude." },
  { name: "Hidden", text: "The observer knows its space but not exactly where it is. The hidden creature treats that observer as off-guard, and the observer must succeed at a DC 11 flat check to affect it with an attack, spell or other effect (area effects excepted). Seek can make it observed." },
  { name: "Hostile", text: "Attitude: actively wants to harm the character (not necessarily attacking) and won't accept Requests." },
  { name: "Immobilized", text: "Can't use actions with the move trait. If held in place, forced movement must beat the DC of the hold (or the holder's relevant defense, usually Fortitude DC)." },
  { name: "Indifferent", text: "Attitude: doesn't care either way. The default attitude unless stated otherwise." },
  { name: "Invisible", text: "Can't be seen: undetected to everyone. A creature that Seeks and beats its Stealth DC finds it hidden until it Sneaks again. If it becomes invisible while seen, it starts hidden. Can't become observed except through special abilities or magic." },
  { name: "Observed", text: "In plain view (or perceived with another precise sense). Hiding can make it hidden or undetected instead. Imprecise senses only make it hidden." },
  { name: "Off-Guard", text: "–2 circumstance penalty to AC. Some effects make a creature off-guard only to certain creatures or attacks; otherwise it applies to everything." },
  { name: "Paralyzed", text: "Off-guard and can't act except to Recall Knowledge and other purely mental actions (GM decides). Senses work only where it can perceive without moving, so it can't Seek." },
  { name: "Persistent Damage", valued: true, text: "Takes the listed damage at the end of each of its turns (roll dice anew), then a DC 15 flat check to end it. Doubled or halved like normal damage; immunities, weaknesses and resistances apply. Assisted recovery: an extra flat check (often 2 actions; DC 10 for especially apt help, or automatic end). Several persistent damages can stack if their types differ; the same type keeps the higher. Usually ends on its own after about 1 minute. (The runner rolls the damage and flat check automatically at end of turn.)" },
  { name: "Petrified", text: "Turned to stone: can't act or sense. Becomes an object with double Bulk, AC 9, Hardness 8 and its current HP, with no Broken Threshold. Destroyed statue = death. Doesn't age or notice time." },
  { name: "Prone", text: "Off-guard and –2 circumstance penalty to attack rolls. Only move actions allowed are Crawl and Stand (Standing ends it). Can Take Cover for +4 circumstance AC against ranged attacks (still off-guard). Knocked prone while Climbing or Flying means falling; can't be knocked prone while Swimming." },
  { name: "Quickened", text: "Gains 1 extra action at the start of each turn (often limited to certain uses). Gaining it mid-turn doesn't give an action that turn." },
  { name: "Restrained", text: "Tied up or pinned: off-guard and immobilized, and can't use attack or manipulate actions except to Escape or Force Open the bonds. Overrides grabbed." },
  { name: "Sickened", valued: true, text: "Status penalty equal to the value to all checks and DCs. Can't willingly ingest anything (including serums). Can spend 1 action retching to attempt a Fortitude save against the source's DC: success reduces the value by 1, critical success by 2." },
  { name: "Slowed", valued: true, text: "Regains that many fewer actions at the start of each turn. Gaining it mid-turn doesn't remove actions that turn. (The runner shows the actions available at the start of each turn.)" },
  { name: "Stunned", valued: true, text: "Can't act. The value is the total actions lost, possibly across turns: each time it regains actions, reduce them by the stunned value, then reduce stunned by the actions lost. Some stuns have a duration instead (lose all actions for that time). Overrides slowed: actions lost to stunned count toward those lost to slowed. (The runner does this at the start of each turn.)" },
  { name: "Stupefied", valued: true, text: "Status penalty equal to the value to Intelligence-, Wisdom- and Charisma-based rolls and DCs (Will saves, spell attacks, spell DCs, related skills). Casting a spell needs a flat check of DC 5 + value or the spell is disrupted." },
  { name: "Suppressed", text: "–1 circumstance penalty to attack rolls and a –10-foot status penalty to all Speeds." },
  { name: "Unconscious", text: "Can't act. –4 status penalty to AC, Perception and Reflex saves; blinded and off-guard; falls prone and drops held items. At 0 HP and dying, can't wake until healed to 1+ HP. Otherwise wakes on taking damage, receiving healing, being shaken awake (Interact), or a successful Perception check against loud noise at the start of its turn." },
  { name: "Undetected", text: "The observer can't see it, doesn't know its space and can't target it (area effects still work). Off-guard to it. The observer can guess a square: attack plus DC 11 flat check, rolled secretly by the GM. Seek can find it." },
  { name: "Unfriendly", text: "Attitude: dislikes and distrusts the character; won't accept Requests." },
  { name: "Unnoticed", text: "The creature has no idea it's there; also undetected. Matters for abilities that need a completely unaware target." },
  { name: "Untethered", text: "Floating in zero-g without a way to move: can't take move actions unless usable there; drifts 5 feet in its last direction at the end of each turn. Push Off (◆, needs a free limb and something its size or larger) floats it up to half its Speed in a new direction, and also works as a free action right after a successful melee Strike or Shove. Usually also clumsy 1 and off-guard." },
  { name: "Wounded", valued: true, text: "Gained (or +1) each time it loses the dying condition. When it gains dying, add the wounded value to dying. Ends after a successful Treat Wounds, or after being restored to full HP and resting 10 minutes." },
];

export const COND_BY_NAME = Object.fromEntries(CONDITIONS.map(c => [c.name.toLowerCase(), c]));

// Conditions offered first in the add-condition picker
export const QUICK_CONDITIONS = ["Off-Guard", "Frightened", "Prone", "Grabbed", "Stunned", "Slowed", "Clumsy", "Sickened", "Enfeebled", "Concealed", "Hidden", "Restrained", "Immobilized", "Fatigued", "Persistent Damage", "Invisible", "Dazzled", "Stupefied", "Fleeing", "Quickened"];

export const DAMAGE_TYPES = {
  physical: ["bludgeoning", "piercing", "slashing"],
  energy: ["acid", "cold", "electricity", "fire", "force", "sonic", "vitality", "void"],
  other: ["spirit", "mental", "poison", "bleed", "precision", "untyped"],
};
export const ALL_TYPES = [...DAMAGE_TYPES.physical, ...DAMAGE_TYPES.energy, ...DAMAGE_TYPES.other];
