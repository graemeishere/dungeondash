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

- `?dev=combat` — skips all menus straight into a solo combat room (2D path).
- `?3d&dev=combat` — same, on the 3D WebGL path.
- `&class=warrior|rogue|mage|ranger`, `&dungeon=crypt|goblinMines|catacombs`.
- `&cam=fixed` — whole-room 3D camera (best for screenshots; the default
  follow camera is zoomed very close).
- `?camtest` — live camera tuning readout/buttons.

## Driving it

- Wait for boot with `page.waitForFunction(() => window.DD && DD.game3d && DD.game3d.active("play"))`
  (3D) or `DD.game` (2D), then ~1s more for GLB models to settle.
- Attack: `page.keyboard.down(" ")` (hold — a quick `press` can fall between
  frames and be missed). Move: WASD. Aim: `page.mouse.move(...)`.
- Player's screen position: `DD.render3d.projectToScreen(p.x/DD.TILE, p.y/DD.TILE, 1)`.
- Short-lived effects (swing trails last ~0.24s) expire faster than headless
  screenshot latency: to capture one, pin it mid-life from `page.evaluate`
  (e.g. set `DD.fx3d.arcs[0].t = 500; .life = 999` freezes k≈0.5), screenshot,
  then set `t = life` to expire it.
- Inspect effects state via `DD.fx3d` (`arcs`, `arcPool`, `rings`, `n` = live
  particles) and game state via `DD.game`.

## Gotchas

- `/favicon.ico` 404 in the console is normal.
- Skeletons start dormant (skull piles); they wake on proximity or after 60s.
- Each page load generates a fresh random room layout.
