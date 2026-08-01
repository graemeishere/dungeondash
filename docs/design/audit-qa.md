# QA Audit — Dungeon Dash

Scope: correctness and robustness — crashes, corruption, dead/unreachable code,
softlocks, and the structural conditions that make breakage likely or hide it.
Code is truth; `docs/GAME_DESIGN.md` is checked as current (partly stale)
intent, `README.md`/`DungeonDash_DesignBrief.md` as marketing/historical
(drift expected but logged). Verified live against `http://localhost:8123`
with Playwright/Chromium (headless, software WebGL fallback) — multiple
classes, all three dungeons, `?classic`, `?floors`, town/lobby/raid/finale
state jumps, forced WebGL context loss, and simulated `localStorage`
corruption/quota failure. Findings are labeled **confirmed** (reproduced or
the code path is unambiguous) or **suspected**.

## What exists

- No build step, no `package.json`, no TypeScript, no linter, no test runner
  wired to CI. `index.html:198-214` loads 15 classic scripts onto a single
  `window.DD` in a hardcoded, load-order-dependent sequence, plus an ES-module
  3D boot (`index.html:219-254`) that races GLB loads against gameplay start.
  `.github/workflows/pages.yml` does exactly one thing — `sed`s a commit SHA
  into `index.html`/`js/render3d.js` for cache-busting, then publishes the
  entire repo to Pages. No lint, type-check, or test step exists anywhere in
  CI. `dev/room-checks.mjs` (203 lines, real Playwright assertions for
  draw-call/triangle budgets and decor-planner determinism) is never invoked
  by any workflow and its Playwright dependency is declared nowhere — it only
  runs if a developer happens to have Playwright installed globally and
  remembers the command.
- `js/game.js` is 2,567 lines and owns the state machine, both run-generation
  paths (classic single-room and connected-floor), town, all NPC menus, the
  world map, raids, the finale, save/load, co-op message handling, and the
  draw loop. `js/entities.js` (1,324 lines) owns every entity class. This
  concentration means a change to, e.g., quest progress touches the same file
  as HUD text and camera-adjacent state.
- Two independent, differently-scoped persistence systems: `dungeondash_save_1`→
  `dungeondash_save_v1` mid-run checkpoint (`js/game.js:40,222-246`, written at
  each floor's stairs via `writeSave()` at `js/game.js:490`) and
  `dungeondash_profile_v2` (`js/profile.js:3-4`, version 3, hero roster +
  quests + meta, with an in-place migration path from a v1-shaped save at
  `js/profile.js:45-59`).
- Co-op is host-authoritative PeerJS/WebRTC against the **public PeerJS cloud
  broker** with hardcoded public `openrelay.metered.ca` TURN credentials
  (`js/net.js:27-37`) — not a secret leak (the service is free/public by
  design), but a real-world single point of failure the project doesn't
  control.
- The game is WebGL-only for the dungeon view (`js/render3d.js:65`,
  `new THREE.WebGLRenderer(...)`); the 2D canvas is a transparent HUD/map
  overlay only (per `.claude/skills/verify/SKILL.md`) — there is no 2D
  fallback if 3D rendering fails.

## What's solid

- **The dt clamp is correct and defends the right thing.** `js/game.js:2545`,
  `Math.max(0, Math.min((now-last)/1000, 1/30))`, guards both the documented
  negative-dt-on-boot case and unbounded catch-up after tab backgrounding —
  verified: the update loop keeps ticking smoothly across a simulated
  long-hidden tab without a physics/animation explosion.
- **GLB load failure degrades gracefully.** `CharacterFactory.preloadAll`
  (`js/char3d.js:253-261`) uses `Promise.allSettled`, and every 3D placement
  path (`js/game3d.js:161-267`) checks `spawnable()` before treating an entity
  as a 3D character, falling back to a 2D billboard otherwise. A missing or
  malformed model degrades visuals, it does not crash or block boot.
- **`localStorage` corruption self-heals.** Confirmed live: seeding
  `dungeondash_profile_v2` with invalid JSON, or with valid JSON in the wrong
  shape (`heroes` not an array), both fall through `profile.js:61-81`'s
  try/catch into a fresh default profile with no thrown error and no broken
  boot.
- **Co-op broker failure is handled with a real user-facing message, not a
  crash.** Confirmed live against the actual public PeerJS broker (which the
  sandbox's network proxy cannot reach): `DD.net.host()` rejects in ~1s with
  a typed error, and `hostWithClass`/`tryJoin` (`js/game.js:2119-2169`) catch
  it and show an actionable lobby message ("the free matchmaking server may
  be busy..."). Guest disconnects mid-run are also handled: the host drops
  to solo with an in-world toast (`js/game.js:2208-2227`), not a stuck state.
- **Boot is robust across the matrix tested.** All 4 classes × all 3 dungeons
  × `?classic` × `?floors` direct-boot loaded cleanly with zero console errors
  beyond the expected `/favicon.ico` 404.
- Save-mode mismatch is defended: `usableSave()` (`js/game.js:252-257`)
  discards a save whose `floorMode` doesn't match the current run mode
  instead of resuming into a corrupted-looking layout.

## What's rough, incomplete, or inconsistent

Ranked by real impact: crash / permanent visual break / exploit first,
cosmetic and dead-code last.

**1. WebGL context loss permanently blanks the 3D view with no recovery path — confirmed.**
There is no `webglcontextlost`/`webglcontextrestored` listener anywhere in
the codebase (`js/render3d.js`, `js/game3d.js`, or elsewhere — grepped, none
exist). Live repro: forcing context loss via `WEBGL_lose_context` while in a
combat room throws an uncaught exception from inside three.js's own render
path (`WebGLProgram.getUniforms` → `onFirstUse`, `TypeError: Cannot read
properties of null (reading 'trim')`, stack rooted at
`DungeonRenderer.render` called from `game3d.js:268`'s `drawCombat3D`), then
the 3D canvas goes solid black. The game logic underneath keeps running —
`DD.game.time` keeps advancing, the HUD overlay keeps drawing — so the player
is not kicked to an error screen, they're simply staring at a black rectangle
with a live HUD, mid-combat, indefinitely. **Programmatically restoring the
context afterward does not recover the scene** — the renderer logs "Context
Restored" but nothing re-uploads, so the screen stays black even after the
underlying GPU resource is usable again. Since the 3D view is the only
gameplay-visible layer (the 2D canvas is HUD-only per the project's own
`SKILL.md`), this is a full soft-lock of the visible game on any GPU context
loss — which browsers do trigger, particularly on mobile under memory
pressure, on tab background/restore on some platforms, and on driver
crashes/resets. This is the game's most severe defect by "can it actually
break for a real player" standard, and it's invisible in normal desktop dev
testing because context loss is rare there.

**2. `?dev=combat`, `?safe`, and `?classic` are live and reachable in the deployed production build — confirmed.**
`js/game.js:9-16` reads these straight from `location.search` with no
environment gate (no hostname check, no build-time strip), and CI
(`.github/workflows/pages.yml`) publishes `js/game.js` byte-for-byte to
Pages. `?safe` (`js/game.js:11`) is the sharper issue: it skips every enemy's
`update()` (`js/game.js:1678,1709,1715`), which also freezes `spawnQueue`
processing — enemies present in a room go permanently passive and no new ones
arrive, while the player's own attack path is untouched, so a real user
appending `?safe` to the live URL can farm any room (kills, XP, gold, quest
progress, dungeon clears) with zero retaliation risk. This is a defect
(unintended production reachability of a camera-tuning flag), not
balance-as-designed, so it's a QA exploit, not a systems-design one.

**3. Guest co-op progress is structurally discarded — confirmed.**
`startCoopRun` (`js/game.js:2173-2196`) constructs the guest's `Player` with
no `hero` argument: `new DD.Player(guestClassKey, 0, 0, new
DD.RemoteInput())`. `Player`'s constructor (`js/entities.js:107`) then takes
`baseStats = hero ? DD.deriveStats(hero) : { ...c }` — the guest always gets
raw level-1 class stats for the entire run, regardless of their actual
hero's level, attributes, or gear. Because only `game.hero` (the host's) is
read in `endRun` (`js/game.js:720-747`), the guest's gold, kills, quest
progress, and dungeon clears are never banked to anything — a full run as a
guest is invisible to that player's own save. This isn't a bug that
surfaces as an error; it silently discards a second player's entire session.

**4. `bossKill` and `clearDungeon` quest goals are always credited together, never separately — confirmed.**
`endRun` (`js/game.js:728-734`) passes `bossKill: clearedDungeon, clearDungeon:
clearedDungeon` — the identical value for both fields, every time, because
finishing any run's last floor always means both "killed this dungeon's boss"
and "cleared this dungeon" in the same instant. There is no code path where
one fires without the other. `slay_king`/`warlord_end`/`lich_hunter`
(bossKill quests) and `mine_clear` (clearDungeon quest) are therefore
functionally the same trigger under different labels — not merely
"indistinguishable" as an edge case, but permanently coupled by construction.

**5. Raids and the finale bypass the connected-floor generator every normal run uses — confirmed.**
`startRaid` (`js/game.js:1321-1327`) and `startFinale` (`js/game.js:1345-1349`)
both call `startRun` directly, which uses the old single-big-room generator
(`loadRoom`, `js/game.js:284-308`) — verified live: mid-raid, `DD.game.floorMode
=== false` and `DD.room.isFloor === false`, versus `true`/`true` for a normal
`beginRun` dungeon. It renders and plays without crashing (confirmed by
running an actual raid to a combat room and clearing it), but it means the
game's two biggest combat set-pieces — the raid and the Champion-only finale
against THE WORLD-EATER — run on a different, less-tested code path than
every other room in the game, with different door/gating semantics
(`js/hud.js:130-153`'s classic-mode HUD branch vs. the floor-mode branch at
`js/hud.js:114-129`). Any future bug fix to the floor generator silently does
not apply to raids/finale unless someone remembers to check both paths.

**6. `DD.profile.save()` and the mid-run `writeSave()` silently swallow all storage failures — confirmed.**
Both `js/profile.js:39-43` and `js/game.js:222-232` wrap
`localStorage.setItem` in a bare `try { } catch (e) { /* private browsing
etc. */ }`. Live repro: monkey-patching `Storage.prototype.setItem` to throw
`QuotaExceededError` and calling `DD.profile.save()` — it returns normally,
no exception, no console output, no in-game signal. A player whose
`localStorage` is full (common on mobile Safari, or after enough vendored-art
requests/other site data accumulate) keeps playing with in-memory progress
that silently never reaches disk. The very next reload reverts them with no
warning that anything was lost — this is the same failure mode as
`localStorage` being disabled entirely (private browsing), which the comment
name-checks but doesn't actually surface to the player either way.

**7. Sprite key typo: the Quest Giver renders as the Barkeep — confirmed live.**
`js/game.js:1016` sets `sprite: "npcQuestGiver"` (capital G); the generator
loop in `js/sprites.js:834-836` builds the key as `"npc" +
kind[0].toUpperCase() + kind.slice(1)` over `"questgiver"`, producing
`"npcQuestgiver"` (lowercase g). Confirmed by walking a live session to the
Quest Giver's town position and reading `DD.sprites["npcQuestGiver"]` →
`undefined`, so the draw path's fallback (`js/game.js:1997`, `DD.sprites[npc.sprite]
|| DD.sprites.npcBarkeep`) silently substitutes the Barkeep's sprite. The
bespoke Quest Giver art is dead — it's generated and simply never selected.

**8. Unreachable/never-populated content — confirmed.**
  - The entire `shop` room type is dead: `ShopItem`, `makeShopkeeper`, the
    `js/game.js:649` `roomType === "shop"` branch, its HUD label
    (`js/hud.js:143-145`), and its net-sync fields all exist, but no
    `DUNGEONS[*].floors[*].plan` contains `"shop"` (`js/game.js:48-110`) and
    `loadFloor` additionally filters any stray `"shop"` token out
    (`js/game.js:342`). README.md:5,79 still advertises "spend gold at the
    shop between floors."
  - `shade` and skeleton `bomber` are fully implemented (stats, AI branches,
    sprites — `js/entities.js:554,578-624,670-671,821-830,903-905,952-973`)
    but appear in no dungeon's `kinds`/`eliteKinds` array — they can never
    spawn in normal play.
  - `shrine`/`storage`/`dining` side rooms generate as part of every floor
    (`js/floor.js:28-32`, `SIDE_TYPES`) but `spawnFloorEntities`
    (`js/game.js:371-420`) only populates `combat`/`elite`/`boss`/`treasure` —
    these three room types are always empty pass-throughs. Not a softlock
    (they're not in `GATED_ROOM`, `js/game.js:369`), just permanently inert
    despite being planned, decorated, and walked through on every floor.

**9. Vendored assets ship ~105 MB of unreferenced files to GitHub Pages — confirmed, quantified.**
`exclude_assets` in `.github/workflows/pages.yml:28` excludes only
`.github,docs,DungeonDash_DesignBrief.md`. None of the five vendored art
packs are filtered, and within them `.fbx`/`.obj`/`Textures/`/`Samples/`
total **105.5 MB** (measured directly: 16.6+30.4+40.9+7.4+10.2 MB across the
five kit directories) against a 214 MB repo — roughly half the repo — with
zero references to `.fbx` or `.obj` anywhere in `js/` (grepped, none). Every
deploy publishes this. Not a crash risk, but it's real bandwidth/hosting cost
and repo bloat for content the game cannot load (the renderer only consumes
`.glb`/`.gltf`).

**10. Dead/write-only fields — confirmed, minor.** `game.mapSelected`
(`js/game.js:180,1047`, assigned, never read), `hero.stash` (`js/profile.js:17`,
declared in `makeHero`, never referenced anywhere else), `profile.unlocks`
(`js/profile.js:36,68`, round-trips through save/load, nothing ever writes a
key into it besides the load default), `profile.meta.shards` (`js/profile.js:34`,
initialized, never incremented anywhere), `item.levelReq` (`js/items.js:108`,
every rolled item gets `levelReq: 1`, and `DD.equip`, `js/items.js:115-122`,
never checks it — the field implies a gating feature that doesn't exist),
`hero.finaleWon` (`js/game.js:740`, set once, never read), `DD.room.tierDoorCols`
(`js/room.js:21,33,220,247`, the code's own comment calls it "legacy... unused;
pads replace them"), and `game.roomCleared` specifically in floor mode
(`js/game.js:356` force-sets it `true` once per floor and nothing in
floor-mode code paths reads it again — it's live and load-bearing in classic
mode, `js/hud.js:149` and `js/game.js:1754,1770` (both explicitly gated
`!DD.room.isFloor`), but inert in the default connected-floor mode).

**11. Resizing the window while in town silently rerolls the trader's stock and forces open menus closed — suspected, minor.**
The global resize handler (`js/game.js:2531-2532`) calls `showTownRoom(true)`
for any resize while `game.state === "town"`, which calls `hideAllOverlays()`
and re-rolls `game.shopStock` (`js/game.js:1041`) unconditionally. A player
resizing their browser (or rotating a mobile device) while the Trader
overlay is open would have it force-closed and its stock silently
regenerated. Not reproduced end-to-end against a live overlay in this pass
(the resize handler's town branch was read, not click-tested against an open
Trader panel), so this is flagged suspected rather than confirmed.

## Next steps

1. **Fix the WebGL context-loss soft-lock first** — it's the only finding
   here that turns a live session into a permanently broken screen with no
   player-visible explanation. At minimum, listen for
   `webglcontextlost`/`webglcontextrestored` on the canvas, pause the render
   loop and show a "reconnecting..." message on loss, and re-trigger asset
   re-upload (or a full reload prompt) on restore instead of silently
   resuming a renderer with lost GPU state.
2. **Close or gate the `?safe`/`?dev`/`?classic` URL surface in production** —
   either strip them at build/deploy time or gate them behind a hostname/flag
   check, so the shipped Pages build can't be used to trivialize combat.
3. **Give guest co-op players a real hero** (pass one into their `Player`,
   bank their gold/quest progress at `endRun`) — right now co-op's second
   player is, mechanically, a guest in the truest sense: nothing they do
   persists past the session.

## Salvage or rebuild?

**Keep and improve — do not start clean.** The verdict is not close for most
of the codebase, though it splits by layer.

The git history (`Phase 3: floor combat gating, boss descent...`, `Lock combat
room only once the player is clear of the doorway`, `Widen corridors to
2-wide, pinching to a single door at each room`, `Harden co-op signalling on
the public PeerJS broker`, `Never resume/leave a stale single-room save once
floors are the default`) shows the hard part of this project — the connected-
floor room generator with correct gating/lock/unlock/minimap semantics, the
host-authoritative co-op snapshot protocol with object-identity reuse so 3D
models don't restart their animations 15x/second, the stat-derivation
pipeline, the tier/scale/loot tables, the save-mode-mismatch defense — is
already **debugged**, not just written. None of that is visible from a line
count; it's the accumulated fix-up for edge cases (doorway timing, corridor
width, stale-save handling, model identity across snapshots) that only shows
up after the naive version was built and broke. Rewriting `js/room.js`'s
generator or `js/net.js`'s snapshot protocol from scratch would mean
re-discovering most of these edge cases the hard way; that's real, expensive,
and not visible in a fresh read of the "finished" code. The vendored KayKit/
Kenney art is a sunk, reusable asset regardless of the code's fate. And the
game is live and playable today — every dungeon, every class, co-op hosting/
joining, town, quests, and the raid/finale all function without crashing in
this pass, which a rebuild would have to earn back from zero before it's
worth anything to a player.

What should change is **structure, not substance**:

- **`js/game.js` (2,567 lines) should be split, not rewritten.** State
  machine, town/NPC menus, world map, save/load, and the draw loop are
  distinguishable concerns already living in one file out of history, not
  necessity — the DUNGEONS table, `dungeonFloorCfg`, `spawnFloorEntities`,
  `loadFloor`/`loadRoom`, and the town/menu/overlay code have almost no
  shared local state that would resist a mechanical split into modules. This
  is the single highest-leverage change available: it would make findings
  like #4, #5, and #8 (duplicate/dead logic hiding in a huge file) far harder
  to reintroduce.
- **The global `window.DD` + fixed-`<script>`-order coupling is worth
  replacing with real ES modules** (the 3D layer already proves modules work
  fine alongside this codebase) — not because it's caused a confirmed defect
  in this pass, but because it's the reason a defect *could* hide: nothing
  stops any file from reaching into any other file's exposed state, and nothing
  declares what any file actually needs from another. A build step (even a
  minimal bundler, no framework) plus module boundaries would pay for itself
  the first time someone reorders a `<script>` tag by accident.
- **The persistence layer (`js/profile.js` + the save half of `js/game.js`)
  is small, already has a working migration path, and is not worth touching
  beyond fixing #6** (stop swallowing storage errors silently) and
  reconsidering whether two independently-lifetimed save keys need to keep
  existing side by side.
- **The co-op layer (`js/net.js`, 346 lines) is well-engineered for what it
  does** (see "What's solid") but is missing a whole player's worth of
  persistence (#3) — that's an addition, not a rewrite: give the guest a
  real `hero` and route their `endRun` outcomes through it.
- **The raid/finale generator bypass (#5) should be fixed by routing them
  through the same floor generator**, not by hardening the classic path
  separately — maintaining two working room systems long-term is the
  expensive option, and the classic path's only remaining callers are these
  two set-pieces plus the `?classic` escape hatch.
- **The 3D layer (`render3d.js`, `decor3d.js`, `game3d.js`, `char3d.js`,
  `fx3d.js` — ~2,700 lines combined) is the least QA-tested part of the
  system by construction** (this is the first pass exercising it this
  deeply) **and is where the single worst defect in this audit lives** (#1).
  It should not be rewritten — the billboard-fallback resilience under GLB
  failure (see "What's solid") shows real defensive design — but it needs a
  context-loss recovery path before it can be trusted the way the rest of
  the game can.

Net: this is a codebase with real, hard-won behavior worth keeping, wrapped
in a file/module structure that's actively working against maintaining it.
The fix is decoupling and splitting, not starting over.

## Discrepancies

- `docs/GAME_DESIGN.md:4` describes "no image assets (all sprites are
  procedurally drawn at boot)" — the shipped game is a 3D-only WebGL renderer
  loading vendored KayKit/Kenney GLB models (`index.html:219-254`,
  `js/char3d.js`, `js/render3d.js`); the 2D procedural sprites in
  `js/sprites.js` now draw only HUD icons and town-NPC billboards, not the
  gameplay view the doc describes.
- `docs/GAME_DESIGN.md:140-141` lists Trader and Quest Giver as stubs
  ("coming soon"), while the same document's roadmap at line 184 marks
  "Trader shop" ✅ shipped — an internal contradiction. Both NPCs are fully
  implemented in code (`openTraderMenu`/`openQuestGiverMenu`,
  `js/game.js:1084-1088,1204+`).
- `README.md:5-6,73,79` advertises three named bosses per dungeon
  ("Skeleton King → Bone Emperor → The Deathless") and "a shop between
  floors." The code has exactly one boss per dungeon (`bossName` is constant
  across all 3 tiers within a dungeon, `js/game.js:66-109`) fought at the end
  of the final floor, and the between-floor shop is entirely dead code
  (finding #8).

## Hand-offs

→ systems-design: `?safe` mode (finding #2) is a QA-lane reachability defect,
  but whether risk-free farming would still be a problem if the flag were
  properly gated is a balance question worth a second look.
→ ux-ui: the Quest Giver sprite bug (#7) means a specific NPC's bespoke art
  never renders — confirming/fixing is QA's, but whether the fallback
  (silently becoming the Barkeep) is acceptable stopgap UX is theirs to weigh
  in on.
→ level-design: `shrine`/`storage`/`dining` rooms (#8) generate, decorate, and
  are walked through on every floor while doing nothing — QA confirms they're
  wired to nothing; whether they're worth populating or should stop
  generating is a level-design call.
→ graphics: the 3D layer has no visible failure state for a lost/never-loaded
  render context (#1) beyond going black — once QA's recovery-plumbing fix
  lands, whether that recovery state needs its own visual treatment is
  theirs.
→ narrative: README's named-boss roster ("Bone Emperor", "The Deathless") is
  fiction the code never implements — flagged under Discrepancies, but
  whether the writing should be walked back to match one-boss-per-dungeon or
  the roster should become a real content target is theirs to weigh in on.
