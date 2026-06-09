# Dungeon Dash

A cartoon hack & slash roguelike for the web. This is the first playable slice:
pick a class, fight a room full of skeletons, clear it (or die trying).

See [DungeonDash_DesignBrief.md](DungeonDash_DesignBrief.md) for the full game design.

## Play it

No build step, no dependencies. Either:

- **Open `index.html` directly** in any modern browser, or
- Serve the folder and open it:

  ```sh
  python3 -m http.server 8000
  # then visit http://localhost:8000
  ```

## Controls

| Action | Input |
|---|---|
| Move | WASD or arrow keys |
| Aim | Mouse |
| Attack | Left click or Space |
| Dash (Rogue only) | Shift |
| Play again / change class | Enter / Esc on the result screen |

## Classes

- **Warrior** — 12 HP, wide sword swings, slow but sturdy
- **Rogue** — 8 HP, fastest movement, rapid stabs, dash with brief invulnerability
- **Mage** — 6 HP, magic bolts that explode for area damage
- **Ranger** — 8 HP, fast arrows that pierce through enemies

## What's in this slice

- One procedurally laid-out combat room (border walls, randomized pillars, exit door)
- 8 skeletons that rise from the floor in a staggered wave, chase you, telegraph
  their attacks, and drop gold coins (and the occasional heart) on death
- Coin/heart pickups with magnet collection, HP bar HUD, kill and gold counters
- Win flow (room cleared, door opens) and lose flow (you died), with instant restart
- Hit feedback: knockback, hit-flash, damage numbers, particles, screen shake
- Synthesized sound effects via the Web Audio API

## No asset files?

Correct — every sprite (heroes, skeletons, tiles, pickups) is pixel art generated
onto offscreen canvases at boot in `js/sprites.js`, and every sound is synthesized
at runtime in `js/audio.js`. The whole game is code.

## Code layout

```
index.html      page shell + class select / result overlays
css/style.css   layout and menu styling
js/util.js      constants and math helpers
js/sprites.js   procedural pixel-art generation
js/audio.js     Web Audio sound effects
js/input.js     keyboard + mouse state
js/particles.js particle bursts and floating damage text
js/room.js      room generation, tile collision, rendering
js/entities.js  player classes, skeletons, projectiles, pickups
js/hud.js       in-game HUD
js/game.js      state machine, main loop, wiring
```

## Next steps (toward the design brief)

- More room types (treasure, trap gauntlet, elite, shop) and room-to-room flow
- Floor boss + multi-floor runs with XP/level-up upgrade choices
- Gear drops and inventory
- Second player (the brief calls for local co-op; on the web this would map
  naturally to WebRTC peer-to-peer)
