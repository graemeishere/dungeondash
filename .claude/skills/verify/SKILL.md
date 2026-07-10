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

`node dev/room-checks.mjs` (run from a dir with playwright installed, server
on :8123) asserts per-theme draw-call/triangle budgets and decor-planner
determinism (same desc → same plan; guest `setData(getData())` round-trip).

## Room navigation tricks

- Jump to a specific room: `DD.game.floor = F; DD.game.roomIndex = I - 1;
  DD.game.state = "transition"; DD.game.transitionPhase = "out";
  DD.game.transitionT = 0.999;` — the transition machinery calls
  advanceRoom() next frame (floor 1 of catacombs: index 1 = trap,
  4 = treasure, 6 = boss).
- Clear a room: empty `DD.game.spawnQueue`, then for each skeleton set
  `s.state = "chase"` (dormant ones ignore damage) and call
  `s.damage(9999, s.x, s.y, DD.game)`.

## Gotchas

- `/favicon.ico` 404 in the console is normal.
- Skeletons start dormant (skull piles); they wake on proximity or after 60s.
- Each page load generates a fresh random room layout.
