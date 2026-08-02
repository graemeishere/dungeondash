# Phase 2 — Progression Correctness: Narrative Spec (decision 13)

Owner: narrative, joint with systems-design. Produced 2026-08-02, against
`docs/design/phase2-systems-spec.md` §6, which un-keys `bossName` from
`tiers[]` to `floors[]` and leaves `floors[i].bossName: null` as an explicit
placeholder on floor 0 and floor 1 of all three core dungeons (floor 2 keeps
today's tier-level name unchanged — it's the anchor, `BOSS_HP_RATIO[2] = 1.0`,
and "Warlord's Den" / "Lich's Sanctum" already name the floor after it).

This is a **naming spec**, not a patch. It does not touch `js/state.js` or any
other code file. Implementation drops these 6 strings into the `bossName:
null` placeholders identified in phase2-systems-spec.md §6's worked
`floors[]` example; floor 2's `bossName` in each dungeon is unchanged from
what's already in the tree today (listed below for completeness/copy-paste
convenience only, not because it's new).

## Drop-in table

| Dungeon | Floor idx | Floor name | `bossName` | Status |
|---|---|---|---|---|
| catacombs | 0 | Upper Catacombs | `"SKELETON SENTRY"` | **new** |
| catacombs | 1 | Deep Catacombs | `"SKELETON GENERAL"` | **new** |
| catacombs | 2 | Catacombs Core | `"SKELETON KING"` | unchanged (anchor) |
| goblinMines | 0 | Mine Entrance | `"GOBLIN OVERSEER"` | **new** |
| goblinMines | 1 | Deep Mines | `"GOBLIN CHIEFTAIN"` | **new** |
| goblinMines | 2 | Warlord's Den | `"GOBLIN WARLORD"` | unchanged (anchor) |
| crypt | 0 | Outer Crypt | `"CRYPT WARDEN"` | **new** |
| crypt | 1 | Inner Crypt | `"DEATHLESS HERALD"` | **new** |
| crypt | 2 | Lich's Sanctum | `"THE LICH"` | unchanged (anchor) |

Ready to paste as each dungeon's `floors[i].bossName` value in
`js/state.js`'s `DUNGEONS` table, replacing the `null` placeholders
phase2-systems-spec.md §6 left in place.

## Rationale, one line per name

**Catacombs** — a skeletal chain-of-command culminating in the already-shipped
"SKELETON KING," so all three floors read as one royal court rather than three
unrelated monsters.

- `SKELETON SENTRY` (floor 0): a lookout, not a warrior — "sentry" is the
  lowest rank a military hierarchy has, matching floor 0's role as the outer
  guard post ("Upper Catacombs") and the 60%-HP weakest fight of the three;
  faction-correct plain "SKELETON" prefix keeps it legible as the same royal
  line as the King, just its least significant member.
- `SKELETON GENERAL` (floor 1): a general outranks a sentry and answers only
  to the King — reads as the lieutenant guarding the approach to "Deep
  Catacombs" before the throne room, at 80% HP a visibly harder fight without
  claiming the King's own rank.
- `SKELETON KING` (floor 2, unchanged): stays exactly as shipped — the
  anchor, 100% HP, and "Catacombs Core" is the throne room this name already
  implies.

**Goblin Mines** — a labor-to-war escalation (foreman → tribal chief →
supreme warlord) that tracks the floor names' own shift from an industrial
space ("Mine Entrance," "Deep Mines") to a martial one ("Warlord's Den").

- `GOBLIN OVERSEER` (floor 0): an overseer runs a workforce, not a warband —
  fits "Mine Entrance" as a labor-management threat (a foreman keeping slaves
  and diggers in line) rather than a war leader, correctly reading as the
  weakest of the three and distinct in *kind*, not just degree, from what
  follows.
- `GOBLIN CHIEFTAIN` (floor 1): a chieftain commands one tribe; a warlord
  commands many chieftains — this is the first fight that's unambiguously a
  war leader, matching "Deep Mines" as the point the dungeon stops being a
  worksite and starts being a warcamp, and it's explicitly subordinate to
  (not a synonym for) the floor-2 Warlord it escalates toward.
- `GOBLIN WARLORD` (floor 2, unchanged): "Warlord's Den" already names the
  floor after this exact title — no change needed or wanted.

**The Crypt** — a herald structure (a herald announces and serves a monarch,
never outranks one), so floor 1 reads as clearly beneath "THE LICH" while
still being a distinct, escalating threat, not a reskinned floor-0 fight.

- `CRYPT WARDEN` (floor 0): a warden keeps a place, echoing "Outer Crypt" as
  the boundary this undead guardian is bound to hold — the least individuated
  of the three, appropriately, since it's guarding a threshold rather than a
  domain.
- `DEATHLESS HERALD` (floor 1): "deathless" is this game's own unshipped word
  for undying undead (drafted for an early README boss line — "The
  Deathless" — that was never wired into `js/`, per `audit-narrative.md`'s
  discrepancy note); reusing it here as a *herald* rather than a rival ruler
  keeps it a lieutenant proclaiming the Lich's dominion in "Inner Crypt," not
  a name that competes with the Lich's own rank.
- `THE LICH` (floor 2, unchanged): "Lich's Sanctum" already names the floor
  after this exact title — no change needed or wanted.

## Constraints checked

- No collision with `ELITE_NAMES` (`js/state.js:123-126`: `GRAVE WARDEN, TOMB
  HERALD, MARROW FIEND, RAID CAPTAIN, CAVE BRUISER, MINE TYRANT, DEATH
  KNIGHT, DREAD REVENANT, BONE HERALD`) — none of the 6 new strings above are
  exact matches to any of these nine. (`CRYPT WARDEN` and `GRAVE WARDEN`
  share a word but are different strings in different factions' pools, which
  is the kind of overlap the game's existing elite lists already tolerate
  across factions — the collision that mattered was the *exact-string*
  reuse between a goblin elite and the separate town-raid boss name, which
  this spec does not repeat.)
- No collision with the two out-of-scope synthetic boss names already in the
  tree (`js/town.js:358` town-raid `"RAID CAPTAIN"`, `js/town.js:385` finale
  `"THE WORLD-EATER"`) — both untouched by this spec; townRaid/finale are
  single-tier, single-floor constructs excluded from `dungeonFloorCfg()`'s
  per-floor `bossName` un-keying (§6 only touches the `CORE_DUNGEONS` three),
  so they're not this task's concern.
- All 9 final names (6 new + 3 unchanged anchors) keep the game's existing
  ALL-CAPS two-word title convention (`SKELETON KING`, `GOBLIN WARLORD`),
  except `THE LICH`, which was already the one two-word-with-article
  exception in the shipped set and is left as-is.

## Out of scope (flagging, not fixing)

- The finale boss (`"THE WORLD-EATER"`, `js/town.js:385`) and the town-raid
  boss (`"RAID CAPTAIN"`, `js/town.js:358`) are single-floor constructs with
  no `floors[]` array of their own — decision 13 and phase2-systems-spec.md
  §6 only un-key `bossName` for the three `CORE_DUNGEONS`. The town-raid's
  `RAID CAPTAIN` / goblin-elite `RAID CAPTAIN` exact-string collision
  (`audit-narrative.md` line ~129) is therefore still live in the tree after
  this spec ships — it was flagged before this phase and isn't this
  decision's scope to fix; leaving it recorded here so it isn't mistaken for
  newly introduced.
