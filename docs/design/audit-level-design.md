# Level-design audit — Dungeon Dash

Scope: dungeon/floor/room generation, room sequencing, encounter placement,
spatial readability, run-length pacing. Not scored: enemy stats/HP/damage
(systems-design), decoration art/prop rendering (graphics), minimap-as-UI
(ux-ui), room/floor naming (narrative).

Method: read `js/floor.js`, `js/room.js`, `js/util.js`, the run/spawn/gating
code in `js/game.js`, and the per-room decor planner in `js/decor3d.js`.
Verified against the running game with headless Playwright against the
server already up on `:8123`: sampled `DD.generateFloor` directly (5 floors
× 2 plan shapes, plus a 2,000-run stress sample per plan), and drove
`?floors&cam=fixed` to screenshot a live floor overview, a locked combat
room, and a `trap`-type room.

## What exists

- **Two live dungeon-traversal systems.** The default is the connected-floor
  generator, `DD.generateFloor` (`js/floor.js:44-158`), selected by
  `beginRun` (`js/game.js:15-16`) unless `?classic` is set. The older
  single-room-per-room path — `DD.room.generate` (`js/room.js:30-113`) driven
  by `loadRoom` (`js/game.js:538-662`) — is still fully wired and is what
  `?classic`, `startRaid` (`js/game.js:1321-1327`), and `startFinale`
  (`js/game.js:1345-1349`) all use, via `startRun` (`js/game.js:284-308`)
  rather than `startFloorRun` (`js/game.js:313-337`).
- **Floor generator**: a 5×5 macro grid (`js/floor.js:49`), uniform
  5×4-tile rooms (8×7 for boss, `js/floor.js:21-24`) centred in 10×9 macro
  cells so corridors stay axis-aligned. The critical path is an
  upward-biased random walk from bottom-centre (`js/floor.js:54-80`); 1-3
  side rooms (`shrine`/`storage`/`dining`/`treasure`, chosen uniformly,
  `js/floor.js:32,82-101`) hang off random non-terminal critical rooms.
  Corridors are always 2 tiles wide, dead straight, one door tile + one
  permanent seam-wall tile per room's own mouth (`carveCorridor`,
  `js/floor.js:166-193`).
- **Room carving in floor mode is a bare rectangle.** `carveRect`
  (`js/floor.js:36-40`) only ever writes `FLOOR`. There is no equivalent in
  `js/floor.js` of the corner-notch biting or obstacle-cluster placement
  that `DD.room.generate` does for the classic path (`js/room.js:62-94`) —
  floor-mode rooms carry zero `OBSTACLE` tiles.
- **Room gating**: `GATED_ROOM = {combat, elite, boss}` (`js/game.js:369`);
  `updateFloorGating` (`js/game.js:443-483`) locks a room once the player is
  a tile clear of its threshold and enemies are present, unlocks on clear,
  and flips `game.stairsReady` when the boss/stairs room clears
  (`js/game.js:471-479`).
- **Content spawning per room type**: `spawnFloorEntities`
  (`js/game.js:371-421`) only has branches for `combat`, `elite`, `boss`,
  `treasure`. `trap`, `shrine`, `storage`, `dining`, `entry` get nothing.
  Enemy variety ramps one kind per successive combat/elite room
  (`js/game.js:380`, `391-392`); enemy count is
  `clamp(3 + floor + combatIdx, 3, 6)` (`js/game.js:381`).
- **Floor plans**: `DUNGEONS` (`js/game.js:48-110`) — 3 dungeons × 3 floors.
  Floor 1 is `[combat×4, boss]`; floors 2-3 add `trap`, `elite`, `treasure`
  for a 7-room plan. `loadFloor` (`js/game.js:341-365`) filters `"shop"` out
  of any plan before generating (`js/game.js:342`), and no `DUNGEONS` floor
  plan contains `"shop"` in the first place — the fully-built shop-room
  branch in `loadRoom` (`js/game.js:649-660`) is unreachable from both paths.
- **Per-room decor** is planned once per floor tile grid by `planRoomDecor`
  (`js/decor3d.js:301-430`); in floor mode it resolves a composition
  *intent* per room from `INTENT` (`js/floor.js:27-31`) via `tablesAt`
  (`js/decor3d.js:354-377`), which is how `trap` rooms get the `"ruin"`
  intent (rubble) rather than their own identity.
- **Raid/finale dungeons** (`buildRaidDungeon` `js/game.js:1310-1319`,
  `buildFinaleDungeon` `js/game.js:1331-1343`) are synthesized `DUNGEONS`
  entries with their own `plan` arrays, but run through `startRun`, so they
  render as one big classic-style room per step, not the small connected-room
  floors a normal dungeon run uses.
- **Dungeon lobby** (`DD.room.generateLobby`, `js/room.js:200-237`): three
  glowing tier pads, no doorway tiles — entry is a 0.7s dwell (confirmed via
  `js/game.js`, not re-cited here per lane).
- **World map**: `MAP_LOCS` (`js/game.js:1819-1825`), 5 locations
  (3 dungeons, town, Champion-gated finale).

## What's solid

- The macro-grid + biased-walk + door/seam-wall model is a clean, compact
  (~200-line) solution to "small rooms joined by straight corridors, still
  collision-simple." Screenshotting a live floor with `cam=fixed` shows a
  genuinely legible, readable graph: the critical path reads at a glance,
  side-room detours are visually distinct spurs, and nothing overlaps.
- Combat gating fully works as designed in practice — entering a
  contested room locks it ("The doors slam shut!"), the HUD reflects
  "Doors locked — foes: N", clearing it unlocks and (for the stairs room)
  reveals the descent with its own beat/text. Verified live, not just read.
- Enemy-variety ramp is coherent with the *forced* traversal order: because
  the critical path is a strict linear chain (edges only connect
  consecutive walk steps, no loops/merges), `combatIdx` incrementing in
  room-array order (`js/game.js:376,389,407`) always matches the order the
  player is actually forced to meet those rooms in. No accidental
  reshuffling.
- `DUNGEONS` as a single data table (`js/game.js:48-110`) making floor
  plans/enemy kinds/tier stats declarative is good scaffolding — adding a
  4th dungeon is additive, not invasive, and the room-type plan strings
  (`"combat"`, `"trap"`, ...) are the same vocabulary both traversal paths
  understand.
- The stress-tested random walk is robust at current scale: 2,000
  generations each of the 6-room and 8-room critical-path shapes on the 5×5
  grid never truncated early or produced a bossless floor. The theoretical
  early-break path exists (`js/floor.js:71-74`, `break` on no free neighbour)
  but doesn't bite in practice at today's grid/plan sizes.

## What's rough, incomplete, or inconsistent

- **Floor-mode combat rooms have zero interior obstacles.** Because
  `carveRect` (`js/floor.js:36-40`) never writes `OBSTACLE`, and
  `decor3d.js`'s obstacle-cluster/crate-fort prop placement is keyed to
  *existing* `OBSTACLE` tiles (`js/decor3d.js:644-652`), every combat/elite
  encounter in the default mode happens in a flat, coverless 5×4 box (8×7
  for boss). No pillars, no chokepoints, nowhere to get cornered *or* to use
  cover — this is a direct regression against the classic path, which does
  carve corner notches and obstacle clusters (`js/room.js:62-94`) into every
  room. Screenshots confirm: rooms render as plain rectangles with enemies
  in the open.
- **`trap` rooms are functionally empty in the default (floor) mode.**
  `DD.room.setFloor` always sets `this.spikes = []` (`js/room.js:125`), and
  `spawnFloorEntities` has no `trap` branch — so there's no hazard at all.
  Worse, the one piece of `trap`-specific *decoration* that exists — the
  grate cluster in `planRoomDecor` — is gated on `desc.roomType === "trap"`
  (`js/decor3d.js:420`), but in floor mode `desc.roomType` is always the
  literal string `"floor"` for the whole grid (set in `js/room.js:135` and
  `js/game.js:360`), never the per-room type. That check can never fire for
  a floor-mode room. Confirmed live: a `trap` room in a generated floor
  renders with generic `"ruin"` rubble decor (same as a boss chamber),
  indistinguishable from any other empty side room, with `DD.room.spikes`
  measured at length 0. The classic path's `trap` implementation (open door,
  spike bands, chest reward at the far end — `js/game.js:547,636-643`) is
  complete and works; it just isn't reachable from the mode most players see.
- **Side rooms are three-quarters cosmetic.** `SIDE_TYPES` is
  `["treasure", "shrine", "storage", "dining"]` chosen uniformly
  (`js/floor.js:32,92`), but only `treasure` gets content (3 chests,
  `js/game.js:414-419`). `shrine`, `storage`, `dining` are pure decoration —
  a detour through a locked-corridor spur for no reward roughly 3 times out
  of 4.
- **Two structurally different "run feel" experiences coexist** depending on
  entry point: a normal dungeon run is tiny connected boxes; a town raid or
  the Champion finale — both meaningful, advertised set-pieces — silently
  fall back to the old single-big-room-per-step path via `startRun`
  (confirmed at `js/game.js:1321-1327,1345-1349`). A player who has only
  ever seen floor-mode dungeons gets a visibly different (larger, single-room,
  no corridor/gating) space the first time they fight a raid.
  Whether this divergence is a real inconsistency or acceptable "raids are
  special" flavor is a judgment call, but it doubles the traversal surface
  that has to be reasoned about.
- **Room geometry is maximally uniform.** Every non-boss floor-mode room is
  exactly 5×4 tiles, every corridor is exactly 2 wide with a length fixed by
  the macro-cell margin — there is no `ROOM_SHAPES`-style size variety
  (`js/util.js:33-40`) applied to floor-mode rooms at all; that table only
  feeds the classic path's `roomSizeFor` (`js/game.js:545`). Combined with
  the lack of obstacles above, every combat encounter in a run is
  geometrically the same box, just re-skinned per theme/intent.
- **Shop room type is fully built and entirely dead** — not generation logic
  belonging to me to fix, but the *room-sequencing* fact that no `DUNGEONS`
  plan ever includes `"shop"` and `loadFloor` actively filters it
  (`js/game.js:342`) is squarely a level-design gap: the room type exists in
  the vocabulary and is never scheduled.

## Next steps

1. **Fix the `trap`-room decor keying bug and give it real content in floor
   mode.** `js/decor3d.js:420`'s `desc.roomType === "trap"` check needs to
   read the per-room type (the same way `tablesAt` already does at
   `js/decor3d.js:371`), and floor-mode `trap` rooms need an actual hazard
   (port the classic path's spike-band logic, `js/game.js:636-643`, into
   `js/floor.js`/`js/room.js:setFloor`) so the room type means what
   `GAME_DESIGN.md` and the README both say it means.
2. **Give floor-mode rooms interior geometry.** Port corner-notch and
   obstacle-cluster carving from `DD.room.generate` (`js/room.js:62-94`)
   into `js/floor.js`'s room realization step, so combat rooms have cover
   and chokepoints instead of being open boxes. This is the highest-leverage
   single change for "does a floor feel like a place" — it's decoration
   downstream (graphics) but a tile-grid decision upstream (mine).
3. **Decide `shrine`/`storage`/`dining`'s fate**: either give them a payoff
   (a guaranteed pickup, buff, or NPC — a systems-design call on *what*) so
   a detour is worth taking three times out of four instead of one, or trim
   `SIDE_TYPES` down to just `treasure` until there's content to justify the
   others.

## Salvage or rebuild?

**Keep and improve.** The floor generator's *approach* — macro-grid random
walk, uniform-footprint rooms centred for alignment, door+seam-wall corridor
mouths, per-room lock/gate state — is sound, compact, well-commented, and
already produces a floor that reads correctly and plays correctly end to end
(verified live, not just on paper). Rebuilding this from scratch would very
likely reproduce something close to what's already here; the actual gaps
(no interior obstacles, `trap` rooms empty, side rooms mostly decorative,
shop unscheduled) are all targeted content/wiring fixes on top of a
structurally fine generator, not evidence the structure itself is wrong.

What I would *not* carry forward as-is: maintaining two fully separate
traversal systems (classic single-room vs connected-floor) long-term. Pick
one — most likely the floor generator, since it's the default and the more
interesting design — port the classic path's genuinely better parts into it
(room-shape variety, obstacle/notch carving, the working `trap` spike logic),
and either retire `?classic`/raids/finale's dependency on `startRun` or
explicitly own the two-mode split as intentional. Don't let both keep
evolving independently.

The layout *intent* (small connected rooms, Isaac-style lock-on-entry
combat, a linear critical path with optional loot spurs, one new enemy kind
per room) and the generator *approach* both survive a code rewrite fine if
the user goes that route elsewhere in the stack — none of this is coupled to
three.js, canvas, or any framework choice. If the decision to rewrite is
made for reasons outside my lane (engine, build tooling, etc.), the floor.js
algorithm is worth porting near-verbatim rather than redesigning from zero.

## Discrepancies

- `docs/GAME_DESIGN.md:111` describes room type `trap` as "spike gauntlet,
  door pre-open" — true only of the classic path (`js/game.js:636-643`).
  In the default connected-floor mode a `trap` room has no spikes
  (`js/room.js:125`, no `spawnFloorEntities` branch) and doesn't even get
  its own decorative treatment (`js/decor3d.js:420`, see above).
- `README.md:4,71` markets "trap gauntlets" as part of the core loop with
  the same overstatement — accurate for `?classic` only, not for what a
  player reaches by default.
- `README.md:79` — "A shop between floors: gold buys a full heal, +3 max
  HP, or a random upgrade" — the room-sequencing half of this claim is
  false in both traversal paths: no `DUNGEONS` floor plan schedules a
  `"shop"` room, and `loadFloor` explicitly strips it if it were ever added
  (`js/game.js:342`). The shop UI/logic exists (`js/game.js:649-660`) but is
  unreachable in the current dungeon flow; `docs/GAME_DESIGN.md:112,140`
  correctly describes shopping as town-only ("Trader"), so the design doc
  and the README disagree with each other, and the README is the stale one.

## Hand-offs

→ systems-design: `shrine`/`storage`/`dining` side rooms are fully
generated and reachable but grant no reward, drop, or effect of any kind —
needs a decision on what they should give.
→ systems-design: the shop room-type's economy (heal/max-HP/upgrade
purchases, `js/game.js:649-660`) is complete but structurally unscheduled
in any dungeon plan — worth a call on whether to wire it back in or retire
it, since the README still advertises it.
→ graphics: floor-mode rooms never contain `OBSTACLE` tiles, so the
obstacle/crate-fort prop clusters in the decor planner
(`js/decor3d.js:644-652`) can never place anything in a connected-floor run
— worth knowing this prop category is currently dead weight in the default
mode, independent of whichever way the tile-carving gets fixed.
→ qa: the critical-path random walk (`js/floor.js:58-80`) can abandon the
walk early if it dead-ends with no free neighbour, which — unguarded —
could produce a floor missing its boss/stairs room; not reproduced in 2,000
samples at today's plan/grid sizes, but there's no explicit safeguard if
plan length or grid size ever change.
→ ux-ui: I didn't evaluate whether the floor minimap
(`js/game.js:448-454`, drawn in `js/hud.js:156+`) visually distinguishes a
critical-path room from a side-room detour — worth a legibility pass given
how much of the side-room content turned out to be a dead end.
