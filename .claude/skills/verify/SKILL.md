---
name: verify
description: How to run and drive Dungeon Dash headless to verify changes (2D or 3D path).
---

# Verifying Dungeon Dash changes

Static site, no build step. Serve the repo root and drive it with Playwright
against the pre-installed Chromium (`executablePath: "/opt/pw-browsers/chromium"`).

```sh
python3 -m http.server 8123 &   # from the repo root
```

## Useful URLs

The game is 3D-only (WebGL scene + a transparent 2D overlay canvas for
HUD/map UI).

- `?dev=combat` — skips all menus straight into a solo combat room.
- `&class=warrior|rogue|mage|ranger`, `&dungeon=crypt|goblinMines|catacombs`.
- `&cam=fixed` — whole-room camera (best for screenshots; the default
  follow camera is zoomed very close).
- `?camtest` — live camera tuning readout/buttons.
- Town/lobby can be reached from a running game via
  `DD.game.state = "town"` (or `"lobby"` + `DD.game.lobbyDungeonId`) followed
  by `window.dispatchEvent(new Event("resize"))` — the resize handler rebuilds
  the room for the new state.

## Driving it

- Wait for boot with `page.waitForFunction(() => window.DD && DD.game3d && DD.game3d.active("play"))`,
  then ~1s more for GLB models to settle.
- Attack: `page.keyboard.down(" ")` (hold — a quick `press` can fall between
  frames and be missed). Move: WASD. Aim: `page.mouse.move(...)`.
- Player's screen position: `DD.render3d.projectToScreen(p.x/DD.TILE, p.y/DD.TILE, 1)`.
- Short-lived effects (swing trails last ~0.24s) expire faster than headless
  screenshot latency: to capture one, pin it mid-life from `page.evaluate`
  (e.g. set `DD.fx3d.arcs[0].t = 500; .life = 999` freezes k≈0.5), screenshot,
  then set `t = life` to expire it.
- Inspect effects state via `DD.fx3d` (`arcs`, `arcPool`, `rings`, `n` = live
  particles) and game state via `DD.game`.

## Regression checks

Both run from a dir with playwright installed, with the server on :8123, and
both run in CI (`.github/workflows/room-checks.yml`, advisory-only for now):

- `node dev/room-checks.mjs` — per-theme draw-call/triangle budgets and
  decor-planner determinism (same desc → same plan; guest
  `setData(getData())` round-trip), plus floor connectivity and gating.
- `node dev/phase0-checks.mjs` — the "it still boots and plays" acceptance
  suite: 4 classes × 3 dungeons, combat, a full floor through a boss and down
  the stairs, town/lobby/map/hub/inventory, death and Play Again, raid,
  finale, save and resume, WebGL context loss, and the dev-flag gate.

## Floor / room navigation tricks

There is no in-place "jump to room I" — floors are connected room graphs
(no roomIndex ordering), and the transition machinery calls `advanceFloor()`
(js/run.js), which increments `game.floor` and generates a whole new floor.

- Jump to floor F: `DD.game.floor = F - 1; DD.game.state = "transition";
  DD.game.transitionPhase = "out"; DD.game.transitionT = 0.999;` — next
  frame the fade-out completes and `advanceFloor()` lands you on floor F
  with a fresh random layout.
- Reach a specific room type on the already-loaded floor: teleport the
  player into it (layouts are random, so find the room by type):

  ```js
  const rm = DD.room.rooms.find((r) => r.type === "boss"); // or "trap",
  const pl = DD.game.players[0];        // "treasure", "elite", "shrine", ...
  pl.x = (rm.rect.x + rm.rect.w / 2) * DD.TILE;
  pl.y = (rm.rect.y + rm.rect.h / 2) * DD.TILE;
  ```

  Gated rooms (combat/elite/boss) lock their doors and wake their enemies
  once the player is a tile inside the rect — teleporting to the room centre
  triggers that on the next gating tick, same as walking in.
- Clear a room: empty `DD.game.spawnQueue`, then for each skeleton set
  `s.state = "chase"` (dormant ones ignore damage) and call
  `s.damage(9999, s.x, s.y, DD.game)`.

## Forcing WebGL context loss

```js
const gl = DD.render3d.renderer.getContext();
const ext = gl.getExtension("WEBGL_lose_context");
ext.loseContext();     // expect: #webgl-lost overlay, DD.game.time frozen, rAF still running
ext.restoreContext();  // expect: a console warning only — the reload prompt stays up by design
```

`DD.render3d.contextLost` is the flag; `DD.game3d.contextLost()` is what the
game reads. Recovery is deliberately a reload prompt, not an in-place rebuild.

## Gotchas

- `/favicon.ico` 404 in the console is normal.
- `console.error("WebGL context lost…")` is deliberate, not a failure.
- Skeletons start dormant (skull piles); they wake on proximity or after 60s.
- Each page load generates a fresh random room layout.
