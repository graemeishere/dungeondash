# Phase 0 Change Spec — Structure

Author: `qa`. Consumed by: the main session (implements literally), then `qa`
again (verifies against the running build per `.claude/skills/verify/SKILL.md`).

Scope is exactly roadmap.md §3 Phase 0: (1) WebGL context-loss recovery,
shipped standalone first; (2) the `js/game.js` module split + retirement of
`window.DD`/the fixed script order; (3) hygiene (`?safe`/`?dev` gating,
`dev/room-checks.mjs` in CI, asset exclusion). No code is written here. All
`file:line` citations were re-read against the current tree today
(2026-08-01) — they will drift the moment implementation starts; re-grep
before trusting a line number to the digit.

No bundler, no package.json, no TypeScript, no test framework — decision 2 is
settled, this spec does not re-litigate it. Every mechanism below has to work
as flat files served by `python3 -m http.server`/GitHub Pages.

---

## Part 1 — WebGL context-loss recovery

Ships standalone, ahead of the module split, on the *current* file
structure. `js/render3d.js` and `js/game3d.js` stay classic IIFE scripts for
this part; Part 2 carries the same code forward when they convert to modules
in place (see Part 2, "Module inventory," row for `render3d.js`/`game3d.js`).

### 1.1 Where the listeners attach

`js/render3d.js`'s `DungeonRenderer` constructor owns the only
`HTMLCanvasElement` the `WebGLRenderer` is bound to (`this.renderer = new
THREE.WebGLRenderer({ canvas, antialias: false })`, `js/render3d.js:65`, where
`canvas` is the constructor's `canvas` parameter — `#game3d` from
`index.html:14`, passed in by the inline module boot at `index.html:223`).
`webglcontextlost`/`webglcontextrestored` fire on that same canvas element,
so attach both listeners inside the constructor, immediately after line 65,
before the rest of the renderer/scene setup runs:

```js
this._contextLost = false;
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  this._contextLost = true;
  console.error("WebGL context lost");
}, false);
canvas.addEventListener("webglcontextrestored", () => {
  console.warn("WebGL context restored (reload still required — see 1.4)");
}, false);
```

Store `_contextLost` as a plain instance field alongside the renderer's other
state fields (next to `this.needsRebuild = false;` at `js/render3d.js:126` is
a reasonable spot if you want it colocated with the other rebuild-tracking
flags instead of right after the listeners — either is fine, just pick one
and keep it next to the renderer, not duplicated).

### 1.2 What `preventDefault()` buys, and what it doesn't

Per the WebGL spec, if `webglcontextlost`'s handler does **not** call
`event.preventDefault()`, the browser will never fire
`webglcontextrestored` — the context is permanently dead until the page
reloads, full stop. Calling `preventDefault()` keeps the *option* open for
the browser/driver to restore the context later; it does not itself restore
anything, and does not guarantee restoration ever happens (a genuine device
loss, e.g. GPU driver crash on some mobile platforms, may never fire
`restored`). Call it unconditionally — it's free, and per §1.4 below we are
not currently promising to *act* on a successful restore beyond logging it,
so there's no correctness obligation this creates that we're not already
meeting.

### 1.3 The gate: one guard, at the one place the crash actually happens

The audit's repro stack was `DungeonRenderer.render` → three.js's internal
`WebGLProgram.getUniforms`/`onFirstUse`, called from `game3d.js:268`'s
`drawCombat3D`. `render()` (`js/render3d.js:738`) is the single choke point
every per-frame GPU touch funnels through — `buildRoom()`, `mgr.sync()`
(character animation mixers), `setEntities()`/`setItems()`/`setProjectiles()`
all only manipulate plain JS/three.js scene-graph objects (matrices, texture
`image`/`needsUpdate` flags) and never touch the GPU directly; the actual
`gl.*` calls happen inside `this.renderer.render(this.scene, this.camera)`
at `js/render3d.js:779`. So the guard belongs at the top of `render()`, and
nowhere else needs touching:

```js
render() {
  if (this._contextLost) return null;
  const now = performance.now();
  ...
```

Verify the caller tolerates `null`: `drawCombat3D` calls `dr.render();` at
`js/game3d.js:268` and discards the return value, so this is safe. (The only
consumer of `render()`'s real return shape — `{ calls, triangles }` — is
`dev/room-checks.mjs`'s draw-call/triangle-budget assertions, a dev-only
script that never exercises a lost context; no compatibility concern there.)

Do not scatter additional `_contextLost` checks through `buildRoom`,
`mgr.sync`, or the `set*` methods — they're harmless no-ops against a dead
context and keeping the guard singular avoids the failure mode of a second
call site forgetting the check.

### 1.4 What the player sees, and what keeps ticking

**Decision: prompt-to-reload, not in-place recovery. Say so plainly, don't
promise what the code can't deliver.**

Justification: true in-place recovery would need every one of five
independently-cached resource pools to re-validate cleanly against the new
GL context — `render3d.js`'s `pieceProtos`/`itemProtos`/`projProtos`
(GLTFLoader-issued textures/geometries), `char3d.js`'s `CharacterManager`
(skinned meshes + `AnimationMixer`s), `fx3d.js`'s particle system, and
`game3d.js`'s per-entity billboard canvases re-uploaded as `CanvasTexture`s
— and this is the least-tested part of the codebase by the audit's own
finding (3D layer, first pass exercising it this deeply). Three.js *can*
often re-upload geometry/materials it still holds JS-side references to, but
this is a commonly-reported rough edge (exactly the audit's repro: "the
renderer logs 'Context Restored' but nothing re-uploads, so the screen stays
black"), and nothing in this codebase validates it today. Shipping a
best-effort rebuild that sometimes half-works (missing textures, wrong
materials, a billboard frozen mid-animation) is worse for the player than an
honest, unambiguous "reload" — it would look like a new bug, not a known,
understood state. Revisit true recovery in a later phase if field telemetry
shows context loss is common enough to justify validating all five
subsystems; that's real work, not a Phase 0 line-item.

**On loss**, in the same frame the flag flips:

- **Freeze gameplay simulation.** `js/game.js`'s `update(dt)` (`js/game.js:1642`)
  gets one new line at the top:
  ```js
  function update(dt) {
    if (DD.game3d && DD.game3d.contextLost()) return;
    ...
  ```
  This matches roadmap §3's own wording ("pause the render loop"): timers,
  AI, spawn queues, damage — everything `update(dt)` drives — stops
  advancing. The player is mid-combat and cannot see or react to what's
  happening; letting the fight continue off-screen would silently cost them
  HP for a hit they had no way to dodge. `draw(dt)` keeps running
  unconditionally every frame (see below) so the reload prompt stays live,
  input/resize keep working, and nothing else regresses.
- **Show a real DOM overlay, not just canvas text.** Every other
  player-facing message in this game (menu, result, hub, trader, quest
  giver, raid warning) is a DOM `.overlay` element, not canvas-drawn text —
  match that convention instead of inventing a canvas-only message that's
  harder to read/click reliably regardless of what state the (currently
  broken) 3D canvas is in. Add a new overlay to `index.html`, structurally
  identical to the existing ones (e.g. modeled on `#raid-warning`,
  `index.html:102-110`):
  ```html
  <div id="webgl-lost" class="overlay hidden">
    <h1 class="small" style="color:#ff5252">DISPLAY LOST</h1>
    <p class="tagline">Your browser reset the 3D graphics context — this
      happens under memory pressure or when a tab is backgrounded a long
      time. The game has paused. Reload to keep playing.</p>
    <div class="buttons"><button id="btn-webgl-reload">Reload</button></div>
  </div>
  ```
  `js/game3d.js` (which already owns `#game`/`#game3d` DOM references and
  already builds ad-hoc DOM in this file, see `setupCamButtons()` at
  `js/game3d.js:405-427` for precedent) shows this overlay the first time it
  observes `DD.render3d._contextLost` true, and wires
  `#btn-webgl-reload`'s click to `location.reload()`. Do this once, lazily,
  inside `drawCombat3D` (or the `draw()` wrapper that calls it) rather than
  every frame — check a local `shown` flag before touching the DOM.
- **What keeps ticking:** `draw(dt)` (`js/game.js:2021`) keeps calling
  `DD.game3d.draw`/`drawCombat3D` every frame (unconditionally — do **not**
  early-return there), so the overlay-show logic above actually executes and
  the page stays responsive to input, resize, and the reload button. The
  frozen `update(dt)` means world state (positions, timers, HUD numbers)
  stops changing, which is the intended, honest picture: paused, not
  crashed, not silently running invisibly.
- Text/positioning: reuse the `.overlay` CSS class wholesale (it already
  centers, dims the background, and matches the game's font/color palette —
  no new CSS needed beyond whatever `#webgl-lost` needs that
  `.overlay`/`.tagline`/`.buttons` don't already give it).

**On restore** (`webglcontextrestored` fires): log it (already specified in
§1.1) and do nothing else — leave `_contextLost` true, leave the reload
overlay showing. Do not attempt a rebuild. If a later phase adds real
recovery, this is the exact spot it hooks in (flip `_contextLost` false,
call `buildRoom(dr._lastDesc)` again, force `needsUpdate` on cached
textures) — leaving the listener in place now costs nothing and means that
future change doesn't need to re-derive where the hook goes.

### 1.5 `DD.game3d.contextLost()`

Add one method to the `DD.game3d` export object (`js/game3d.js:494-507`,
alongside `active`/`draw`/`resize`):

```js
contextLost() { return !!(DD.render3d && DD.render3d._contextLost); },
```

`js/game.js`'s `update(dt)` guard (§1.4) calls this rather than reaching
into `DD.render3d` directly — keeps the "is 3D usable" question answered in
one place (`game3d.js`, which already brokers every other 3D-readiness check
via `active()`).

### 1.6 How to verify (dev-only, no new URL flag)

Use the `WEBGL_lose_context` extension from a Playwright `page.evaluate`,
exactly as the audit's original repro did — no new `?dev=` flag needed for
this (Part 3 is about *reducing* the dev-flag surface, don't grow it here):

```js
const gl = DD.render3d.renderer.getContext();
const ext = gl.getExtension("WEBGL_lose_context");
ext.loseContext();          // trigger loss — expect the overlay, frozen sim
// ext.restoreContext();    // trigger restore — expect only the console log
```

Acceptance: boot into a combat room (`?dev=combat`), let a fight start,
`loseContext()`, confirm (a) no uncaught exception in the console, (b)
`#webgl-lost` is visible and its Reload button works, (c) `DD.game.time`
stops advancing, (d) HP/gold/kills are unchanged from the moment of loss.
Optionally document this snippet in `.claude/skills/verify/SKILL.md`'s
"Gotchas" section as a follow-up — not required for this fix to land.

---

## Part 2 — the module split

### 2.0 Two distinct operations — don't conflate them

1. **Convert 14 of the 15 classic scripts at `index.html:198-214` to ES
   modules *in place*** — same filename, same responsibilities, `export`
   instead of `(function(DD){ ... DD.x = ... })(window.DD = window.DD ||
   {})`. This is `util.js`, `sprites.js`, `audio.js`, `input.js`,
   `particles.js`, `net.js`, `room.js`, `floor.js`, `entities.js`,
   `profile.js`, `stats.js`, `items.js`, `hud.js`, `game3d.js`. (`js/lib/three/*`
   are already ES modules; `js/lib/peerjs.min.js` is a vendored third-party
   UMD build that sets `window.Peer` — see §2.4, it does **not** convert.)
2. **Split `js/game.js` (2,567 lines) into several new, purpose-named
   files** — this is the one file with no 1:1 successor.

### 2.1 New modules from `js/game.js`

Line ranges are function-start-line based (re-grep before trusting to the
digit — see the top-of-file caveat). Everything not explicitly called out
below moves verbatim into whichever module its containing function moves to;
existing per-function inline `document.getElementById` calls (73 of them —
grepped) stay exactly where they are unless the function itself moves, in
which case they move with it unchanged. Do **not** try to centralize all 73;
see §2.1.1 for the handful that genuinely need it.

| New file | Moves in (from `js/game.js`) | Exports |
|---|---|---|
| `js/state.js` | `DUNGEONS` (48-110), `dungeonFloorCfg` (114-136), `isChampion` (138-140), `ELITE_NAMES` (142-146), the `game` object + its getters/methods (148-217), `SAVE_KEY`, `writeSave`/`readSave`/`clearSave`/`usableSave` (222-257), `freshGameState` (273-283) | `game`, `DUNGEONS`, `dungeonFloorCfg`, `isChampion`, `ELITE_NAMES`, `freshGameState`, `writeSave`, `readSave`, `clearSave`, `usableSave`. Also a small exported mutable object for cross-module UI flags — see §2.1.1. |
| `js/env.js` | The `?safe`/`?classic`/URL-param reads currently at `js/game.js:9-16` | `params`, `safeMode`, `classicRun`. (Part 3 adds the production gate here — see §3.1; Part 2 just relocates the existing behavior unchanged.) |
| `js/dom.js` | The ~9 cross-module DOM refs at `js/game.js:31-40` | A single frozen object, e.g. `export const DOM = Object.freeze({ menuEl, resultEl, resultTitle, resultStats, levelupEl, upgradeCardsEl, continueBtn, hubEl, canvas, ctx });` — see §2.1.1. |
| `js/run.js` | `startRun`, `startFloorRun`, `loadFloor`, `spawnFloorEntities`, `roomHasEnemies`, `insideRoom`, `activateRoom`, `updateFloorGating`, `reachStairs`, `advanceFloor`, `resumeRun`, `loadRoom`, `setRoomCleared`, `startTransition`, `advanceRoom`, `endRun`, `showResult` (284-798) | `startRun`, `startFloorRun`, `resumeRun`, `endRun`, `advanceFloor`, `reachStairs`, `loadFloor`, `activateRoom`, `updateFloorGating`, `startTransition`, `advanceRoom`, `setRoomCleared`, `spawnFloorEntities` (needed by `coop.js`'s `sendRoomToGuest`/net message handlers and by `town.js`'s raid/finale start) |
| `js/worldmap.js` | `showMap`, `drawMapIcon`, `drawMap` (1044-1060, 1832-1995), `handleMapTap` (2350-2380) | `showMap`, `drawMap`, `handleMapTap` |
| `js/town.js` | `spawnTownNpcs`, `showTownRoom`, `showDungeonLobby`, `tierLocked`, `enterTierDoor`, `openBarkeepMenu`, `closeStatsOverlay`, `openInnkeeperMenu`, `openTraderMenu`, `closeTraderOverlay`, `buildTraderOverlay`, `openQuestGiverMenu`, `closeQuestGiverOverlay`, `questRewardText`, `questProgressHtml`, `buildQuestGiverOverlay`, `townToast`, `switchClass`, `showRaidWarning`, `factionDungeon`, `buildRaidDungeon`, `startRaid`, `buildFinaleDungeon`, `startFinale` (1009-1352), `drawTownNpc` (1996-2020), `handleTownTap` (2381-2470) | `spawnTownNpcs`, `showTownRoom`, `showDungeonLobby`, `enterTierDoor`, `openTraderMenu`, `openQuestGiverMenu`, `openBarkeepMenu`, `openInnkeeperMenu`, `switchClass`, `showRaidWarning`, `startRaid`, `startFinale`, `drawTownNpc`, `handleTownTap` |
| `js/overlays.js` | `hideAllOverlays`, `buildHub`, `showHub`, `selectClass`, `spawnHeroInRoom` (799-956), `buildStatsOverlay`, `backToMenu` (1353-1465), `buildUpgradeCards`, `openLevelUp`, `finishLevelUp`, `maybeFinishLevelUp`, `chooseUpgrade`, `openInventory`, `closeInventory`, `rebaseLocalPlayer`, `renderInventory`, `showInvTooltip`, `hideInvTooltip` (1470-1641), `buildClassCards`, `showLobby`, `setMenuMode` (2054-2112), `playAgain` (2310-2349) | `hideAllOverlays`, `showHub`, `buildHub`, `selectClass`, `spawnHeroInRoom`, `buildStatsOverlay`, `backToMenu`, `openLevelUp`, `maybeFinishLevelUp`, `chooseUpgrade`, `openInventory`, `closeInventory`, `rebaseLocalPlayer`, `buildClassCards`, `showLobby`, `setMenuMode`, `playAgain` |
| `js/coop.js` | `sendRoomToGuest`, `startCoopRun` (2113-2197), the three `DD.net.onOpen`/`onClose`/`onMessage` handler registrations (2198-2291), `sendGuestInput` (2292-2309), `coopActive` (1466-1469) | `sendRoomToGuest`, `startCoopRun`, `coopActive`, `sendGuestInput`. Registers its `net.onOpen/onClose/onMessage` callbacks as an import-time side effect (safe — see §2.2, "the internal cycles are not a real problem"). |
| `js/draw.js` | `fitCanvas`, `sizeRoomToCanvas` (18-29), `update` (1642-1783), `updatePeaceful` (1784-1831), `draw` (2021-2053), the resize listener (2520-2536), `frame`/the rAF loop (2538-2566) | `fitCanvas`, `sizeRoomToCanvas`, `update`, `draw`, `startLoop()` (wraps the existing `requestAnimationFrame(frame)` kickoff so `boot.js` calls it explicitly instead of it running at module-eval time) |
| `js/boot.js` (composition root) | Everything left at the bottom of the file: `DD.sprites.init()`, `DD.input.init(canvas)`, the `?dev=combat`/`?floors` boot dispatch (2487-2519), `continueBtn` wiring, `refreshContinueButton()` call, keydown handler registration, menu button click wiring | none — this is the entry point, imported by nothing |

#### 2.1.1 Two small mechanical rules that recur across this table

- **Cross-module mutable UI flags become properties on a plain exported
  object, never re-exported primitive bindings.** ES module `import { x }
  from "./y.js"` gives you a *read-only* live view — you cannot do `x =
  false` from the importing module (`SyntaxError`, assignment to imported
  binding). `game.mapSelected`, `game.hero`, etc. already dodge this by
  being properties of the one shared `game` object (property assignment is
  always fine). The one flag in `game.js` that doesn't already live on
  `game` but is genuinely written from one proposed module (`town.js`'s
  `openInnkeeperMenu`, `switchClass`) and read/reset from another
  (`overlays.js`'s `buildClassCards`, `backToMenu`, `selectClass`) is
  `townSwitchClass` (`js/game.js:1057` and 5 more sites). Move it onto
  `state.js`'s exported object as a property, e.g. `export const uiFlags = {
  townSwitchClass: false };`, and change every read/write site to
  `uiFlags.townSwitchClass`. If you find another such flag mid-split
  (`coopMode`, `guestClass`, `guestInGame`, `lvlHostDone`, `lvlGuestDone` at
  `js/game.js:2086-2088,1463-1464` all look coop-local enough to stay
  entirely inside `coop.js`/`overlays.js` as local `let`s — verify each one's
  actual read/write sites before deciding; don't assume this table's move
  list is exhaustive over every closure variable), apply the same rule.
- **`js/dom.js` only needs the handful of DOM refs read by more than one of
  the modules above** — `menuEl`, `resultEl`, `resultTitle`, `resultStats`,
  `levelupEl`, `upgradeCardsEl`, `continueBtn`, `hubEl`, `canvas`, `ctx`.
  Several functions that move (`drawMap(ctx)` at `js/game.js:1904`,
  `drawTownNpc(ctx, npc, time)` at `js/game.js:1996`) already take `ctx` as
  a parameter rather than closing over a module-level constant — keep that;
  `draw.js`'s `draw(dt)` passes its own `ctx` into `worldmap.drawMap(ctx)`
  and `town.drawTownNpc(ctx, ...)` explicitly, so those two files don't need
  to import `dom.js` for `ctx` at all. The other 73 `document.getElementById`
  call sites are single-module (only one function, in one destination file,
  reads that element) — leave them exactly as inline calls in whatever file
  that function lands in. Do not manufacture a `dom.js` entry for something
  only one file touches.

### 2.2 The import graph, and the three real cycles

**The internal cycles among `state.js`/`run.js`/`worldmap.js`/`town.js`/
`overlays.js`/`coop.js`/`draw.js` are not a real problem, and don't need a
mechanism beyond a coding-style rule.** Native ES modules resolve circular
`import`s via live bindings, not CommonJS's eager `require()` snapshot —
`showMap()` (worldmap.js) calling `hideAllOverlays()` (overlays.js) which is
called back by `showTownRoom()` (town.js) which calls `showMap()` again is
completely fine as long as: (a) every one of these ~90 functions is declared
with `export function name() {...}` (hoisted function declaration — already
true today, `js/game.js` uses `function foo() {}` throughout, not `const foo
= () => {}`), and (b) no module's *top-level* (outside any function body)
code calls into a circularly-imported module before that module has
finished evaluating. Rule (b) is satisfiable here because the only top-level
calls in the whole file are the boot sequence at the very bottom
(`buildClassCards()`, `showHub(_bootHero)`/`refreshContinueButton()`, the
`?dev`/`?floors` dispatch, the resize listener registration, `frame()`'s
kickoff) — all of which move into `boot.js`, which imports every other
module and is guaranteed by ESM's execution order to run its own body only
after all of its imports have finished evaluating. As long as `boot.js` is
the *only* module with top-level side-effecting calls into this group, the
cycle is inert. **This is the one thing to get right mechanically: don't let
any of `state/run/worldmap/town/overlays/coop/draw.js` call another
sibling's export outside a function body.** `coop.js` registering its
`net.onOpen/onClose/onMessage` callbacks at its own top level (§2.1, `coop.js`
row) is fine — those are calls *into* `net.js` (a strict layer below,
already converted, no cycle), not into a sibling.

**Three separate, real `DD.*`-global-reach cycles exist between the engine
layer and the run-lifecycle code, and each needs its own fix — a naive
"just add `export`/`import`" pass across the whole codebase will not
resolve these on its own:**

1. **`game.js` (now `hud.js`'s caller) → `hud.js` → `entities.js` →
   `game.js`.** `js/game.js` calls `DD.hud.draw(ctx, game)` (downward).
   `js/hud.js` does `instanceof DD.Boss` (downward, `entities.js`).
   `js/entities.js`'s `ShopItem.draw()` reads `DD.game.gold`
   (`js/entities.js:1301`) — the one upward edge that makes this a cycle.
   **Mechanism: delete the dead code, not add a binding.** `ShopItem`,
   `makeShopkeeper`, and the whole `shop` room type are unreachable (audit
   finding #8; roadmap decision 10: "Delete it and fix the README" — already
   a settled, separate cross-cutting correction). Once `ShopItem` is
   deleted, `entities.js` has zero references to `DD.game`/run-lifecycle
   state, and the graph becomes a clean DAG: `overlays.js`/`draw.js` → `hud.js`
   → `entities.js` (a leaf). If decision 10's deletion hasn't landed by the
   time this split starts, do the split in this order anyway and leave
   `ShopItem.draw()`'s `DD.game.gold` read as `(window.DD && window.DD.game
   && window.DD.game.gold) || 0` — an explicit, commented, temporary global
   reach-through — rather than inventing a real import for code that's about
   to be deleted.
2. **`game3d.js` ⇄ the draw-loop module.** `game3d.js` reads `DD.game.time`,
   `.players`, `.skeletons`, `.townNpcs`, `.state`, `.localPlayer` directly
   (5 sites, grepped) inside `drawCombat3D` and its helpers
   (`drawPeacefulOverlay`, `drawTierPads3D`); `draw.js`'s `draw(dt)` calls
   `DD.game3d.draw(dt)`/`DD.game3d.active(state)`. **Mechanism: parameter
   injection at the call boundary — the same pattern `DD.hud.draw(ctx,
   game)` already uses successfully today.** Change `drawCombat3D(dt)` to
   `drawCombat3D(game, dt)` (and thread `game` into
   `drawPeacefulOverlay(dr, game)`, `drawTierPads3D(dr, game)`,
   `drawDamageNumbers3D` already doesn't need it), and `draw.js`'s `draw(dt)`
   calls `DD.game3d.draw(game, dt)` — passing its own imported `game` from
   `state.js`. `active(state)` already takes `state` as a parameter
   (`js/game3d.js:496`) and needs no change. This removes `game3d.js`'s
   only reach into run-lifecycle state; `game3d.js` (converted to a module
   per §2.0's op 1) never imports `state.js`.
3. **`input.js` ⇄ `state.js`.** `js/input.js:99` reads `DD.game &&
   DD.game.localPlayer` once, inside the touch-start handler, purely to
   check `pl.cfg.dash` for the on-screen dash-button hit test. **Mechanism:
   a setter, not an import.** Add `DD.input.setDashable(bool)` (or,
   post-split, `export function setDashable(bool)` on `input.js`) and call
   it from wherever the local player is (re)assigned —
   `overlays.js`'s `spawnHeroInRoom`, `run.js`'s `resumeRun`, `overlays.js`'s
   `rebaseLocalPlayer`, `coop.js`'s `startCoopRun` — each already the exact
   moment `pl.cfg.dash` becomes known. `input.js` (a low-level device module,
   converted early per §2.5) never imports `state.js`; the value is pushed
   down at the moment it changes instead of pulled up on every touch.

### 2.3 What stays on `window.DD`, and what must not

**The rule:** after the split, cross-module communication inside the game's
own code happens exclusively via `import`/`export`. `window.DD` stops being
a load-bearing mechanism for anything the game itself does at runtime.
*However* — `dev/room-checks.mjs` and `.claude/skills/verify/SKILL.md` both
drive the live game through `window.DD.*` from Playwright, and the
roadmap's own Phase 0 acceptance bar is "drive it headless per SKILL.md," so
a debug/test handle has to keep existing. The two are not in tension if the
handle is treated as a deliberate, narrow, test-facing export — not the
by-default global reach every classic script currently gets for free.

Concretely: only `boot.js` (the composition root) writes to `window.DD`,
and only the following, because this is the exact surface `dev/room-checks.mjs`
and `SKILL.md` read today (grepped both files):

```js
// boot.js, after every other module has finished importing — a deliberate,
// narrow test/debug surface. Nothing else in this codebase reads
// window.DD; if you find yourself reaching for it from inside another
// first-party module, that's the bug to fix, not this list to extend.
window.DD = {
  game,                 // state.js — .state/.floor/.roomIndex/.skeletons/.time/...
  room: DD_room,        // room.js's export namespace (unchanged shape)
  render3d,             // the DungeonRenderer instance (already assigned by
                         // the inline module boot today; keep that pattern)
  game3d,                // game3d.js's exported { active, draw, resize, contextLost }
  charMgr,               // set once char3d.js's CharacterManager resolves
  char3d,                 // { classModelKey, enemyModelKey, RIG }
  fx3d,
  net,
  particles,
  TILE, WIDTH, HEIGHT,    // util.js constants SKILL.md/room-checks.mjs read
  Boss,                   // entities.js — room-checks.mjs does `instanceof DD.Boss`
};
```

New internal modules do **not** get added to this object automatically —
adding one is a deliberate one-line, reviewed change in `boot.js`, made only
when a test/dev script actually needs it (mirroring how `char3d`/`fx3d` are
already attached progressively/asynchronously as they finish loading in the
current `index.html:219-254` inline boot — preserve that staged-availability
behavior; `SKILL.md`'s own `waitForFunction(() => window.DD && DD.game3d &&
DD.game3d.active(...))` pattern already assumes partial availability during
boot, so this isn't a new constraint, just carrying forward an existing one).

### 2.4 `peerjs.min.js` does not convert

`js/lib/peerjs.min.js` is a vendored, minified UMD build (confirmed:
`window.peerjs={Peer:eG,...},window.Peer=eG` at the end of the file — a
classic global-assigning IIFE, no ESM export). It stays exactly as-is: a
plain, non-`type=module` `<script>` tag, loaded before the module graph.
Classic synchronous scripts always finish executing before any
`type=module` script runs (modules are deferred by spec, regardless of tag
position), so `window.Peer` is guaranteed to exist by the time `net.js` (now
a module) reads it — no ordering change needed here, just don't try to
"modernize" this file.

### 2.5 The `?v=__BUILD__` cache-bust story

Today `.github/workflows/pages.yml:24-27` seds `index.html` and
`js/render3d.js` only, because `render3d.js` is the one file with a static
`import` whose specifier needs the token (`import { planRoomDecor, PIECE_DIR
} from "./decor3d.js?v=__BUILD__";`, `js/render3d.js:17`). Static `import`
specifiers are plain string literals — there is no runtime mechanism to
inject a query string into them, and no central manifest to rewrite once
instead of per-file (that would be what a bundler gives you, which decision
2 rules out). Once every first-party file cross-imports every other one via
relative specifiers, **every one of those import statements needs the
`?v=__BUILD__` suffix baked into its literal source**, following the exact
precedent `render3d.js:17` already set.

**This is a deploy-correctness requirement, not a nice-to-have: skip it and
every deploy after the first one silently serves stale cached JS to anyone
whose browser cached the previous version's imports, and busts nothing.**

Concretely:

- Every `import ... from "./somefile.js"` between first-party modules
  becomes `import ... from "./somefile.js?v=__BUILD__"`.
- `index.html`'s classic-script-turned-`<script type="module" src="...">`
  tags (or a single bootstrapping `<script type="module"
  src="js/boot.js?v=__BUILD__">` — see ordering note below) keep the
  `?v=__BUILD__` suffix exactly as today.
- `js/lib/**` (including `three.module.js`, `GLTFLoader.js`,
  `SkeletonUtils.js`, `peerjs.min.js`) stay **unstamped** — this is
  deliberate and already commented in `index.html:195-197` ("lib/ scripts
  are pinned + unchanged so they stay cacheable across deploys"); don't add
  `?v=__BUILD__` to any import of a `js/lib/*` file.
- `pages.yml`'s sed step changes from two explicit filenames to a glob that
  covers every first-party file and nothing under `lib/`:
  ```sh
  V="${GITHUB_SHA::8}"
  sed -i "s/__BUILD__/$V/g" index.html js/*.js
  ```
  `js/*.js` (non-recursive) matches every first-party module (`state.js`,
  `run.js`, ..., `render3d.js`, `game3d.js`, `entities.js`, etc. — verified:
  all 19 first-party `.js` files sit flat in `js/`, only `peerjs.min.js` and
  the `three/` subdirectory live under `js/lib/`, which the non-recursive
  glob does not descend into) without needing to enumerate every new
  filename by hand as the split adds/renames files — the previous two-file
  sed line would have needed hand-editing every time a new cross-file import
  appeared, which is exactly the kind of thing that gets forgotten.
- **Verification step for whoever implements this:** after the split, grep
  the deployed (post-sed) `index.html` and every `js/*.js` for the literal
  string `__BUILD__` — if anything matches, either the sed glob missed a
  file or an import site forgot the token. This should be a one-line CI
  check or a manual step noted in the PR, not just assumed correct.

### 2.6 Ordering — bootable at every commit, no test suite to lean on

Convert lowest-risk (fewest/no `DD.*` cross-references) first, so each
commit leaves a runnable game and a small, reviewable diff. Suggested
sequence, each its own commit, each verified live per SKILL.md before moving
to the next:

1. **Leaves with zero `DD.game` reach:** `util.js`, `stats.js`, `items.js`,
   `particles.js`, `audio.js` — convert to `export`-based modules in place,
   update their `<script>` tag to `type="module"`, verify boot still works
   (these are read-only consumers of nothing controversial).
2. **`room.js`, `floor.js`, `sprites.js`, `profile.js`** — same treatment,
   still no `DD.game` reach (grepped, confirmed).
3. **`entities.js`**, after first landing the `ShopItem`/shop-room deletion
   (§2.2, cycle 1) so it converts with zero upward references from the
   start — verify all four classes/dungeons still spawn/kill/drop loot
   correctly.
4. **`hud.js`** — depends only on `entities.js` (for `instanceof DD.Boss`)
   and lower layers; convert next, verify HUD renders in both floor and
   classic-room modes.
5. **`input.js`**, after adding the `setDashable` setter (§2.2, cycle 3) —
   verify dash button hit-testing still works on a touch-emulated page.
6. **`net.js`** — verify host/join still reaches the PeerJS broker (or fails
   with the existing typed-error toast if the broker's unreachable, per the
   audit's "what's solid" finding — don't regress that).
7. **`game3d.js` and `render3d.js`**, after landing the `drawCombat3D(game,
   dt)` parameter-injection change (§2.2, cycle 2) and Part 1's context-loss
   guard (already shipped standalone before this Part starts). Verify a
   full combat room renders, and re-run the Part 1 `WEBGL_lose_context`
   check to confirm the guard survived the conversion.
8. **The `game.js` split itself** (§2.1's table) — do this as one atomic
   change, not incrementally, because the ten new files share the one
   `game` object and the boot sequence; a half-split `game.js` would have
   two competing owners of the same state. Land `state.js`/`env.js`/`dom.js`
   first within that same commit (they have no behavior, just relocated
   declarations), then the five UI-flow modules, then `coop.js`, then
   `draw.js`, then `boot.js` last (it's the one thing that imports
   everything). Verify the full matrix SKILL.md describes — menu → class
   select → floor run → combat → level-up → town → trader/quest-giver/
   barkeep → world map → raid → finale → co-op host+join — in one pass
   before calling this commit done; there is no automated safety net here
   beyond `dev/room-checks.mjs` (Part 3 wires that into CI, but it only
   covers room/decor generation, not this whole flow).
9. **Update `index.html`**: replace the 15 classic `<script>` tags
   (`index.html:198-214`) with a single `<script type="module"
   src="js/boot.js?v=__BUILD__"></script>`, remove the now-redundant inline
   module boot block (`index.html:219-254`) by folding its contents into
   whichever module owns `render3d`/`char3d`/`fx3d` construction (this logic
   doesn't cleanly belong in any of the ten `game.js`-derived files — keep
   it as its own small module, e.g. `js/boot3d.js`, imported by `boot.js`
   alongside the 2D-side modules; not enumerated in §2.1's table because it
   isn't extracted *from* `game.js`, it already exists as the inline
   `<script type="module">` block). Extend the importmap
   (`index.html:191-193`) only if a bare-specifier need actually arises
   (none identified in this spec — every internal import stays a relative
   path with the `?v=__BUILD__` suffix per §2.5; the importmap keeps doing
   exactly what it does today, resolving the bare `"three"` specifier, and
   doesn't need new entries for first-party files).

---

## Part 3 — hygiene

### 3.1 Gate `?safe`/`?dev` out of production

**Mechanism: hostname allowlist, fail-closed by construction.** Lives in
`js/env.js` (created verbatim in Part 2 §2.1, then edited here — don't
re-touch module boundaries for this, only the logic inside the file that
already exists by the time Part 3 starts):

```js
// js/env.js
export const params = new URLSearchParams(location.search);

const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);
const devFlagsAllowed = DEV_HOSTS.has(location.hostname) || location.protocol === "file:";

function devFlag(name) {
  const present = params.has(name);
  if (present && !devFlagsAllowed) {
    console.warn(`?${name} was requested but ignored — not a dev host (${location.hostname || "file:"})`);
  }
  return present && devFlagsAllowed;
}

// safeMode also today fires off ?camtest, not just ?safe (js/game.js:11) —
// gate the derived flag itself, not just the ?safe name, so camtest's
// enemy-freeze side effect is gated the same way ?safe is. camtest's OTHER
// effects (on-screen camera-tuning buttons, live readout) are cosmetic/
// harmless and intentionally NOT gated here — only the exploit surface is.
export const safeMode = devFlag("camtest") || devFlag("safe");
export const classicRun = params.has("classic"); // decision 4: stays UNGATED — Phase 1 retires ?classic entirely, this is not that
```

Every other module that today reads `location.search` directly for these
two flags (`?dev=combat` at `js/game.js:2489`, currently un-gated — also
route it through a `devFlag("dev")`-style check reading the `dev` param's
value, since the roadmap decision log names it alongside `?safe`) imports
`safeMode`/`params` from `env.js` instead of re-parsing the URL itself.

**Why this direction and not a `__BUILD__`-stamped constant:** a
stamped-constant approach (ship `const BUILD_ID = "__BUILD__"`; treat
`BUILD_ID !== "__BUILD__"` as "this is production") *fails open* — if the
CI sed step ever breaks (a regex typo, a file added to the split that the
sed glob doesn't cover, `pages.yml` edited without noticing this
dependency), the shipped file still contains the literal string
`"__BUILD__"`, `isProd` evaluates false, and `?safe`/`?dev` are silently
live on the real production site again — the exact bug this gate exists to
close, just relocated. The hostname check's failure mode is the opposite
direction: if the check itself is ever deleted or miscoded in a future edit,
the failure is a **silent regression to today's exploit** (not a crash, not
a build error — just quietly permissive again) — this is a real, named
risk, not a solved one, but it's the *safer* of the two available failure
directions, because the default state (hostname doesn't match, or the check
code is simply absent) is deny, not allow. The `devFlag()` wrapper's
`console.warn` when a flag is requested-but-suppressed is a cheap second
line of defense: a developer testing on an unexpected hostname gets an
honest signal instead of silently-different-than-expected behavior, and
anyone auditing production console output for stray warnings would notice
attempted exploitation.

**`?floors` is shaped identically** (a raw boot-bypass param,
`js/game.js:2498`) but is out of this spec's authorized scope — the roadmap
decision log names only `?safe`/`?dev`, and explicitly keeps `?classic`
alive pending Phase 1. Flagging `?floors` here as a similarly-shaped case
worth a follow-up decision, not deciding it unilaterally.

### 3.2 Wire `dev/room-checks.mjs` into CI

Read (`dev/room-checks.mjs`, 203 lines): asserts per-dungeon draw-call/
triangle budgets, decor-planner determinism (same `desc` → same plan; guest
`setData(getData())` round-trip), floor-mode room-graph connectivity/gating/
door state, and zero page errors — against `http://localhost:8123`, needs
Playwright, and defaults `CHROMIUM_PATH` to `/opt/pw-browsers/chromium`
(`dev/room-checks.mjs:13`) — a path that exists in *this* sandboxed dev
container, not on a stock GitHub-hosted `ubuntu-latest` runner. Two changes
needed, one in the script, one new/changed workflow:

**Script change (`dev/room-checks.mjs:17`):** only pass `executablePath`
when `CHROMIUM_PATH` is explicitly set; otherwise let Playwright resolve its
own installed browser:
```js
const CHROME = process.env.CHROMIUM_PATH; // undefined on CI unless set
...
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
```
This keeps the sandbox's `/opt/pw-browsers/chromium` working for local/dev
runs that set `CHROMIUM_PATH` (or don't — the fallback default can stay as
a local convenience if you want, just don't let it be the thing CI depends
on) while letting a stock GitHub runner use whatever `npx playwright
install` fetched.

**New workflow, `.github/workflows/room-checks.yml`, separate from
`pages.yml`:**
```yaml
name: Room checks
on:
  push:
    branches: [master]
  pull_request:
  workflow_dispatch:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm init -y && npm i -D playwright && npx playwright install --with-deps chromium
      - run: python3 -m http.server 8123 &
      - run: npx wait-on http://localhost:8123
      - run: node dev/room-checks.mjs
```
(`npm init -y`/`npm i` here creates a throwaway `node_modules`/`package.json`
inside the CI job's checkout only — this does **not** add a `package.json`
to the repo; don't commit what this step generates.)

**Advisory-only, not gating the deploy — justified, not a default punt:**

- This is the *first* time this suite has ever run outside a developer's
  local machine. It has zero track record on GitHub's `ubuntu-latest`
  software/virtualized GPU path, which may behave differently from both
  this sandbox's software WebGL fallback (what the QA audit itself ran
  against) and a real desktop GPU — the draw-call/triangle *budgets*
  specifically are exactly the kind of assertion that's sensitive to
  renderer differences a CI runner might exhibit that a local machine
  doesn't.
- Phases 1-4 of the roadmap *intentionally* change the things this suite
  measures — Phase 1 step 1 ports obstacle carving into floor-mode rooms
  (changes draw calls/prop counts), the decor-planner keying fix (Phase 1
  step 2) changes which pieces render where, Phase 2's boss/reward work
  changes entity counts. A newly-wired, never-before-CI'd suite blocking
  deploys through several phases of expected, correct changes to its own
  inputs is a recipe for a false "blocked" signal training people to ignore
  or bypass it.
- The suite *does* also assert real invariants that aren't expected to
  change (room graph reaches every room, doors start open, boss chamber
  bigger than a combat room, no page errors) — those are worth having in
  CI now, just not yet worth failing the build over given the above.

Run it on every push/PR, let it report pass/fail loudly in the Actions tab
and PR checks (don't set `continue-on-error: true` at the step level — let
individual check failures show as a red job so they're visible, just don't
make `pages.yml`'s deploy job `needs:` it). **Graduate it to
deploy-blocking** once it's shown a stretch of green runs through at least
one full roadmap phase boundary (Phase 1 is the natural first checkpoint,
since that's exactly the phase whose changes this suite is most sensitive
to) — that's a follow-up decision for whoever's running the roadmap at that
point, not something to pre-decide here.

### 3.3 Exclude unreferenced vendored-asset subtrees from the Pages deploy

**Verified directory names on disk** (via `find -maxdepth 3 -type d` across
all five vendored packs — case as shown, exactly):

| Pattern needed | Matches |
|---|---|
| `fbx` (lowercase) | `KayKit Skeletons/Animations/fbx`, `KayKit Skeletons/assets/fbx`, `KayKit Skeletons/characters/fbx`, `KayKit Adventurers/Animations/fbx`, `KayKit Adventurers/Assets/fbx`, `KayKit Adventurers/Characters/fbx`, `KayKit Character Animations/Animations/fbx` (29 MB alone), `KayKit Dungeon Remastered/Assets/fbx` |
| `fbx(unity)` (literal parens, lowercase) | `KayKit Skeletons/assets/fbx(unity)`, `KayKit Adventurers/Assets/fbx(unity)`, `KayKit Dungeon Remastered/Assets/fbx(unity)` |
| `FBX format` (capitalized, space) | `Kenney Modular Dungeon Kit/Models/FBX format` (contains its own `Textures` subdir too — covered redundantly by the `Textures` pattern below, harmless) |
| `obj` (lowercase) | `KayKit Skeletons/assets/obj`, `KayKit Adventurers/Assets/obj`, `KayKit Dungeon Remastered/Assets/obj` |
| `OBJ format` | `Kenney Modular Dungeon Kit/Models/OBJ format` |
| `Textures` (capitalized) | `Kenney Modular Dungeon Kit/Models/Textures`, `.../GLB format/Textures`, `.../FBX format/Textures`, `.../OBJ format/Textures`, `KayKit Adventurers/Textures` |
| `textures` (lowercase — distinct from the above, one instance) | `KayKit Dungeon Remastered/Assets/textures` |
| `Samples` (capitalized) | `KayKit Adventurers/Samples`, `KayKit Dungeon Remastered/Samples` |
| `samples` (lowercase — distinct, one instance) | `KayKit Skeletons/samples` |

**Explicitly checked and distinct from all of the above:** `KayKit
Skeletons/texture/` (**singular**, no "s") holds the shared
`skeleton_texture.png` atlas the roadmap's decision-5 costing depends on
("all four skeleton GLBs share a single texture atlas... per-faction reskin
is one texture variant each") — none of the patterns above match a
directory named exactly `texture` (singular), so this stays. Don't let
`Textures`/`textures` globs drift into matching this directory; the
distinction is real and load-bearing for a decision already made.

**Verified no collision with what the game actually loads:** grepped every
`.glb`/`.gltf` path referenced anywhere in `js/*.js` (`char3d.js`'s `RIG`
table, `render3d.js`'s `ITEMS`/`PROJECTILES`/`DUNGEON_KITS` tables) — every
one resolves under `Assets/gltf/`, `Characters/gltf/`, `Animations/gltf/`,
`characters/` (the Mannequin model), or `GLB format/` (the *models*, not the
sibling `GLB format/Textures`), never under any `fbx*`/`obj`/`Textures`/
`textures`/`Samples`/`samples` directory. Separately confirmed by direct
`find`: zero `.glb`/`.gltf` files exist anywhere under a path matching any
of the eight patterns above, repo-wide.

**How `exclude_assets` actually matches (checked against
`peaceiris/actions-gh-pages`'s source, not assumed):** `deleteExcludedAssets`
splits the input on `,`, and for each pattern does `path.join(destDir,
pattern)` before handing the joined paths to `@actions/glob`. This means a
**bare directory name is anchored to `destDir` root**, not "matches at any
depth" the way a `.gitignore` bare pattern would — the existing
`".github,docs,DungeonDash_DesignBrief.md"` entries only work today *because*
those three are top-level. Every pattern added here needs an explicit
`**/` prefix to match at the actual nested depth these directories live at.
`@actions/glob` supports `**` (globstar) and treats `(`/`)` as ordinary
literal characters (its extglob detection only triggers on a `(` immediately
preceded by one of `? * + @ !`, which `fbx(unity)` doesn't have — `x` precedes
it) — so no escaping is needed for the parenthesized directory name.

`.github/workflows/pages.yml:35` becomes:
```yaml
exclude_assets: ".github,docs,DungeonDash_DesignBrief.md,**/fbx,**/fbx(unity),**/FBX format,**/obj,**/OBJ format,**/Textures,**/textures,**/Samples"
```
(`**/samples` — lowercase — is deliberately omitted from this list: it
matches only `KayKit Skeletons/samples`, a 4.5 MB sample-scene directory;
include it too if the goal is maximum size reduction — there's no
correctness reason not to, it was left out of the sample line above only to
show that each pattern is independently justified rather than copy-pasted;
add it back, the full intended list is all nine patterns in the table
above.)

**Verification, not just trust:** after this lands, either dry-run the
workflow on a branch via `workflow_dispatch` and inspect the `gh-pages`
branch's tree (`git ls-tree -r --name-only gh-pages | grep -iE
'/(fbx|obj|textures|samples)'` should return nothing except the intentionally-
kept singular `KayKit Skeletons/texture/`), or add a temporary `- run: find .
-iname fbx -o -iname obj ...` debug step before/after the
`peaceiris/actions-gh-pages` step to confirm the expected files are gone
post-copy. Do not ship this unverified — a wrong glob "silently excludes
nothing or excludes too much," per the task brief, and the `path.join`
anchoring behavior above is exactly the kind of thing that's easy to get
wrong without reading the action's source, which is why this spec cites it
directly rather than assuming gitignore-style semantics.

---

## Ordered commit checklist

1. **Part 1** — context-loss guard + reload overlay, on the current
   (unsplit, classic-script) `render3d.js`/`game3d.js`/`game.js`. Ship and
   verify per §1.6 before touching anything else.
2. **Part 2, step 1** — convert `util.js`, `stats.js`, `items.js`,
   `particles.js`, `audio.js` to modules in place.
3. **Part 2, step 2** — convert `room.js`, `floor.js`, `sprites.js`,
   `profile.js`.
4. **Part 2, step 3** — delete the dead `shop` room (`ShopItem`,
   `makeShopkeeper`, the `roomType === "shop"` branch, its HUD label, net
   fields — decision 10, folded in here because it's the mechanism that
   breaks cycle 1) and correct `README.md:79`; then convert `entities.js`.
5. **Part 2, step 4** — convert `hud.js`.
6. **Part 2, step 5** — add `input.js`'s `setDashable` setter, convert
   `input.js`.
7. **Part 2, step 6** — convert `net.js`.
8. **Part 2, step 7** — land the `drawCombat3D(game, dt)` parameter change,
   re-verify Part 1's context-loss guard survived, convert `game3d.js` and
   `render3d.js`.
9. **Part 2, step 8** — the atomic `game.js` split into `state.js`,
   `env.js`, `dom.js`, `run.js`, `worldmap.js`, `town.js`, `overlays.js`,
   `coop.js`, `draw.js`, `boot.js` (+ `boot3d.js` carrying forward the
   inline 3D-boot module), per §2.1/§2.6. Full manual verification pass
   before calling it done — no automated safety net covers this breadth yet.
10. **Part 2, step 9** — `index.html` down to one `<script type="module"
    src="js/boot.js?v=__BUILD__">`; `pages.yml`'s sed glob widened per §2.5;
    grep the post-sed output for stray `__BUILD__` tokens.
11. **Part 3.1** — `env.js`'s hostname gate on `safeMode`/`?dev`.
12. **Part 3.2** — `dev/room-checks.mjs`'s `CHROMIUM_PATH` fallback fix +
    new `.github/workflows/room-checks.yml`, advisory-only.
13. **Part 3.3** — widen `pages.yml:35`'s `exclude_assets`; verify via a
    `workflow_dispatch` dry run before trusting it.
