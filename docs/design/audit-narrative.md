# Narrative Audit — Dungeon Dash

Scope: world lore, faction identity, NPC characterization/dialogue, quest
writing, naming, and player-facing tone. Assessed from what actually renders
to a first-time player, not from design-doc ambition. All citations are
`file:line` against the current tree.

## What exists

**NPCs (4, zero dialogue).** `spawnTownNpcs()` defines Barkeep, Innkeeper,
Trader, Quest Giver as `{id, label, sprite, interact}` — a role label and a
function pointer, nothing else (`js/game.js:1009-1024`). The 3D overlay prompt
literally says `[E] Talk to ${n.label}` (`js/game3d.js:373`), but `interact`
immediately opens a DOM overlay — `openBarkeepMenu`, `openTraderMenu`,
`openQuestGiverMenu`, `openInnkeeperMenu` (`js/game.js:1061-1096, 1176-1186`).
No NPC ever produces a line of text addressed to the player. The overlay
titles are the only "voice" they have, and they're role placeholders:
"THE BARKEEP", "THE TRADER", "QUEST GIVER" (`index.html:113,134,150`). The one
exception to pure silence is a single system-voiced instruction line for the
Innkeeper: `"INNKEEPER — pick a new class. Your level, gold and gear are
kept."` (`js/game.js:1079`) — informational, not characterization.

**Quests (10, `js/profile.js:116-127`).** Every `desc` is a mechanic
restated as a sentence, e.g. `"Defeat 25 skeletons."`, `"Defeat the Skeleton
King."`, `"Clear every floor of the Goblin Mines."`, `"Repel a town raid."`
None carry a reason, a requester's voice, or a consequence. They read as
tooltips, not quests. The Quest Giver hands these out with no framing text of
their own (`buildQuestGiverOverlay`, `js/game.js:1204-1272`) — you open the
overlay and the list is just there.

**Bosses.** Per dungeon-tier, one boss name is reused across all three floors
of that tier: `bossName: "SKELETON KING"` is identical for tier 0/1/2 of
Catacombs and, because `dungeonFloorCfg()` merges the *tier's* `bossName` over
all three *floors* (`js/game.js:114-128`), a single tier-0 Catacombs run has
the player kill "SKELETON KING" three times in a row — floor 0, floor 1, floor
2 — with identical `bossHp: 70`/`bossDmg: 2` every time (`js/game.js:67`).
There is no per-floor boss escalation or distinct identity anywhere in the
data. Total distinct boss names in the whole game: **SKELETON KING**, **GOBLIN
WARLORD**, **THE LICH** (one per dungeon, `js/game.js:67-107`), **RAID
CAPTAIN** (town raids, `js/game.js:1317`), **THE WORLD-EATER** (Champion
finale, `js/game.js:1341`). Five names total, none with a line of
characterization, motive, or death quote.

**Elites.** Three names per faction, drawn at random for "elite room"
mini-bosses: skeleton → `GRAVE WARDEN, TOMB HERALD, MARROW FIEND`; goblin →
`RAID CAPTAIN, CAVE BRUISER, MINE TYRANT` (note: collides with the raid
boss's own name "RAID CAPTAIN" — same string, different entity, no
in-fiction connection); undead → `DEATH KNIGHT, DREAD REVENANT, BONE HERALD`
(`js/game.js:142-146`). Names only — no other text attached.

**Factions.** Three: skeleton (Catacombs), goblin (Goblin Mines), undead (The
Crypt) (`js/game.js:48-110`). Each has a name, a floor-name set, and item
flavor via `faction:` tags on 9 of the 21 item bases (`js/items.js:42-52`,
e.g. `"Bone Axe"`, `"Skull Ring"`, `"Soul Blade"`, `"Phylactery"`). No faction
has a stated motive, relationship to the others, or reason it's fighting the
player anywhere in `js/`. Nothing explains why skeletons, goblins, and undead
are three separate factions rather than reskins of each other — the game
never claims otherwise, but nothing claims anything at all.

**Floor names.** 9 total, 3 per dungeon, following an "Upper → Deep →
[Boss's Domain]" template: Catacombs = Upper Catacombs / Deep Catacombs /
Catacombs Core; Goblin Mines = Mine Entrance / Deep Mines / Warlord's Den;
Crypt = Outer Crypt / Inner Crypt / Lich's Sanctum (`js/game.js:56-103`). No
text anywhere distinguishes what's different about these rooms beyond the
name and the enemy-kind ramp (a systems concern, not narrative).

**Named upgrades (6, `js/entities.js:45-76`)** and **items (21,
`js/items.js:25-52`)** are mechanic-first naming (`"Sharpened Edge"` = +30%
damage, `"Iron Sword"`, `"Vampire Fang"`) — competent generic fantasy-loot
naming, no world-specific lore attached to any of them.

**Victory fiction.** Delivered in exactly two sentences, both only on the
result screen and only reachable by finishing the entire game:
`"You conquered every dungeon at the highest tier. The realm is yours!"`
(Champion) and `"You drove back the siege and felled the World-Eater. A true
legend!"` (finale) (`js/game.js:781-784`), paired with title-only lines
`"DUNGEON DASH CHAMPION!"` / `"THE REALM IS SAVED!"` (`js/game.js:768-772`)
and a `"★ REALM CHAMPION ★"` badge on the world map (`js/game.js:1939-1943`).
That is the entirety of the "Champion" / "Last Stand" / "World-Eater" fiction
that `docs/GAME_DESIGN.md` describes — no setup beforehand (no NPC ever
mentions the finale, the World-Eater, or an approaching threat), no scene, no
epilogue beyond the one line.

**Everything else player-facing** is UI/system copy in the narrator's neutral
voice: room-clear toasts (`"The doors slam shut!"`, `"The door creaks
open..."`, `"Cleared!"`, `"The stairs down are revealed..."` —
`js/game.js:462,477,480,697`), the raid warning (`"Raiders from the ${X} are
attacking the town!"` — `js/game.js:1299-1300`), and HUD labels (`js/hud.js`
throughout — "Doors locked — foes: N", "Clear the floor", "Descend the stairs
▼"). Functional, competent, zero characterization.

## What's solid

- The **naming conventions are internally consistent and legible** even
  without lore behind them: floor names track a clear depth progression per
  dungeon, elite names read as fantasy-military titles appropriate to their
  faction, and item names split cleanly into faction-flavored vs. universal
  pools. A first-time player can tell at a glance which dungeon an elite or
  item "belongs" to.
- The **UI/system voice is consistent** — toasts, HUD strings, and menu copy
  all share a plain, slightly archaic fantasy register ("The doors slam
  shut!", "Onward to the depths...") without clashing tones. Nothing reads as
  placeholder-Lorem-Ipsum or off-brand.
- The **two victory lines that do exist are well-judged for their size** —
  short, in-voice, and correctly gate on the actual accomplishment
  (`js/game.js:767-789`). They show the writer knows the tone; there's just
  almost none of it.
- **`docs/GAME_DESIGN.md`'s fictional framing (Champion, Last Stand,
  World-Eater) is not vaporware** — the finale dungeon, its boss, and the two
  result lines referencing it are real and reachable in `js/game.js`. The
  doc oversells the amount of delivered text, but not the existence of the
  system.

## What's rough, incomplete, or inconsistent

- **NPCs have no dialogue at all**, despite the game explicitly telling the
  player to `[E] Talk to Barkeep` (`js/game3d.js:373`). "Talk to" promises a
  conversation; what happens is a stats/shop/quest-list panel opens with no
  greeting, no in-character framing, no goodbye. This is the single largest
  gap in the domain — four characters exist as sprites and labels only.
- **Quests are goal restatements, not quests.** `"Defeat 25 skeletons."` is
  the entire text; there's no why, no NPC voice, no stakes, not even a
  cursory "the skeletons grow bold" framing (`js/profile.js:116-127`).
- **Boss identity doesn't escalate within a run.** Fighting "SKELETON KING"
  three times back-to-back with identical stats, once per floor of a single
  tier, undercuts every floor name's implied progression (Upper → Deep →
  Core) — the fiction promises depth and danger increasing; the boss fight
  says otherwise by being the literal same fight three times.
- **Elite name collision**: "RAID CAPTAIN" is both a goblin elite-room
  minion name and the boss name for every town raid regardless of faction
  (`js/game.js:144` vs `js/game.js:1317`) — a skeleton-faction raid is still
  led by someone called "RAID CAPTAIN," which reads like a reused string, not
  a character.
- **Factions have no stated identity.** Nothing in `js/` says why skeletons,
  goblins, and undead don't like the player, each other, or the town. The
  three-floor dungeon structure implies a faction stronghold being fought
  through, but nothing in the game confirms or contextualizes that idea.
- **`shade`** is a fully implemented enemy kind (wall-phasing, distinct
  sprite/behavior — `js/entities.js:554,821,952` etc.) that never appears in
  any `DUNGEONS` `kinds` array (`js/game.js:56-110`), so it's currently dead
  content: written, coded, unreachable by a normal player.
- **The "victory fiction" is a title card, not a story.** `GAME_DESIGN.md`
  describes Champion status and a World-Eater siege as if they're narrative
  beats; in-game they're two sentences that appear after the credits-moment,
  with zero setup anywhere before that point.

## Next steps

1. **Give the four NPCs one line each on first interact per game.** Not a
   dialogue tree — a single characterizing sentence shown before/around the
   overlay opens (e.g. a toast or overlay subtitle) turns "Talk to Barkeep"
   from a lie into a kept promise. This is the highest-leverage fix: it
   touches every player's first town visit and currently costs the game
   nothing to deliver on since the "talk" prompt already exists.
2. **Rewrite the 10 quest descriptions with a requester's voice and a reason**,
   even one clause each (`"Skeletons have been seen near the old well —
   thin their numbers."` instead of `"Defeat 25 skeletons."`). The `goal`/
   `reward` data model doesn't need to change, only the `desc` string.
3. **Differentiate the three per-tier boss fights**, or — if that's a
   systems-design call on whether floors 0/1 within a tier should have
   their own mid-bosses — at minimum stop calling all three fights by the
   identical name with identical stats; even a alternate title per floor
   ("Skeleton King's Herald" → "Skeleton King") would repair the escalation
   the floor names already promise.

## Salvage or rebuild?

**Salvage, and mostly by adding rather than rewriting.** Nothing in this
domain needs to be torn out. The naming system is coherent and reusable as-is
(floor names, elite names, item names all fit their factions and require no
rework), the UI/toast voice is consistent and worth keeping verbatim, and the
data model everywhere (`QUEST_DEFS`, `ELITE_NAMES`, `DUNGEONS[...].tiers`) is
a clean place to hang actual writing — the gap is almost entirely *absence*,
not *wrongness*. A rebuild would have to reinvent this naming scaffold from
scratch for no benefit; the actual missing work (NPC lines, quest framing,
boss-fight differentiation) is additive text that drops into the existing
structures without needing engine, language, or architecture changes. The one
piece of writing worth reconsidering rather than keeping is the boss-name
reuse pattern (same name, same stats, three times a run) — that's a content
decision to unwind, not a technical one. If the project restarts on a new
stack entirely, this domain's actual deliverable — the ~450 words that exist
plus the ~5,600 words of un-shipped intent in the docs — carries over
losslessly; none of it is coupled to three.js, the canvas renderer, or any
other technical choice being reconsidered.

## Discrepancies

- `README.md:6,73` names three bosses in sequence — "the Skeleton King, the
  Bone Emperor, and The Deathless" / "Skeleton King → Bone Emperor → The
  Deathless" — as if each dungeon floor has its own escalating boss. Neither
  "Bone Emperor" nor "The Deathless" exists anywhere in `js/`. The actual
  Catacombs boss is "SKELETON KING" for all three floors of a tier
  (`js/game.js:67-69`); nothing named Bone Emperor or Deathless is defined
  for any dungeon.
- `docs/GAME_DESIGN.md:90` lists Catacombs enemies as "melee, archer, shade
  (wall-phaser)" — but Catacombs' actual `kinds` are `["melee", "archer",
  "zombie", "warlock"]` (`js/game.js:57`); `shade` is not used by any
  dungeon (see above). The doc describes content that was written but never
  wired in.
- `docs/GAME_DESIGN.md:140-141` marks Trader and Quest Giver as "stub
  ('coming soon')" in its Town & NPCs table, while the same document's own
  Roadmap section eight lines later lists "✅ Trader shop" and "✅ Quest
  system" as shipped (`docs/GAME_DESIGN.md:184-186`) — and the code confirms
  shipped: `openTraderMenu`/`buildTraderOverlay` and
  `openQuestGiverMenu`/`buildQuestGiverOverlay` are fully implemented
  (`js/game.js:1084-1272`). The doc's own two sections disagree with each
  other; the Roadmap section is the accurate one.
- `docs/GAME_DESIGN.md:15-19` frames Champion status and "The Last Stand"
  finale as significant narrative payoffs; the actual delivered text is two
  sentences gated behind finishing the entire game (`js/game.js:781-784`),
  with no narrative setup anywhere before that point. Not false, but the doc
  reads like a story beat exists where in-game it's a title card.

## Hand-offs

→ ux-ui: the interact prompt reads `[E] Talk to ${label}` for every NPC
(`js/game3d.js:373`) but no NPC ever produces speech — worth deciding whether
the prompt wording or the NPC behavior is what should change.
→ systems-design: boss `bossHp`/`bossDmg` are keyed to tier only, not floor,
so the same-named boss is fought three times per tier run with identical
stats (`js/game.js:114-128,67`) — a difficulty/pacing question as much as a
naming one.
→ level-design: floor names imply a "deeper is worse" progression (Upper →
Deep → Core, etc.) that the current per-tier-not-per-floor boss scaling
doesn't back up.
→ qa: `shade` is a fully coded enemy kind (sprite, AI, wall-phase behavior)
that's unreachable in normal play because no `DUNGEONS` entry's `kinds`
array includes it (`js/entities.js:554` vs `js/game.js:56-110`) — dead code
or missing wiring, worth confirming which.
