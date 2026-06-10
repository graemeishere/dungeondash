# Dungeon Dash

A cartoon hack & slash roguelike for the web — desktop and mobile. Pick a class
and fight through a five-room dungeon floor: three combat rooms, a treasure
room, and the Skeleton King.

See [DungeonDash_DesignBrief.md](DungeonDash_DesignBrief.md) for the full game design.

The game fills whatever screen it runs on: each room's tile grid is generated
to fit the viewport, so a phone in portrait gets a tall narrow dungeon and a
desktop gets a wide one. On touch screens it plays twin-stick style.

## Play it

No build step, no dependencies. Either:

- **Open `index.html` directly** in any modern browser, or
- Serve the folder and open it:

  ```sh
  python3 -m http.server 8000
  # then visit http://localhost:8000
  ```

## Controls

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Move | WASD or arrow keys | Drag on the left half (virtual stick) |
| Aim | Mouse | Drag on the right half |
| Attack | Left click or Space | Hold the right-side stick |
| Dash (Rogue only) | Shift | DASH button, bottom right |
| Play again / change class | Enter / Esc on the result screen | On-screen buttons |

## Classes

- **Warrior** — 12 HP, wide sword swings, slow but sturdy
- **Rogue** — 8 HP, fastest movement, rapid stabs, dash with brief invulnerability
- **Mage** — 6 HP, magic bolts that explode for area damage
- **Ranger** — 8 HP, fast arrows that pierce through enemies

## What's in the game so far

- A five-room floor: combat → combat → treasure → combat → boss, connected by
  doors that open when each room is cleared
- Skeletons rise from the floor in staggered waves, chase you, telegraph their
  attacks, and drop gold (and the occasional heart); later rooms add tanky brutes
- XP and level-ups: each level pauses the action with a choice of 3 random
  upgrades (damage, speed, max HP, attack speed, reach, lifesteal-on-kill)
- A treasure room full of chests, and the Skeleton King boss with a telegraphed
  AoE slam, skeleton summons, and an enrage phase
- Coin/heart pickups with magnet collection, HP/XP bars, boss HP bar
- Responsive rooms that fill any screen, with twin-stick touch controls on mobile
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

- Multi-floor runs with rising difficulty and run saves
- More room types (trap gauntlet, elite, shop) and more enemy/boss variety
- Gear drops and inventory
- Second player (the brief calls for local co-op; on the web this would map
  naturally to WebRTC peer-to-peer)
