# Dungeon Dash

A cartoon hack & slash roguelike for the web — desktop and mobile, solo or
two-player co-op. Fight through three floors of combat rooms, trap gauntlets,
elite hunts, and treasure vaults; bank your gold and spend it at the Trader in
town; and take down the Skeleton King, the Goblin Warlord and the Lich.

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

## Two-player co-op

Per the design brief, a host owns the run and a guest joins peer-to-peer:

1. Host clicks **Host Co-op** and picks a class — a 4-letter room code appears
2. Guest clicks **Join Co-op**, picks a class, and types the room code
3. The run starts on both screens

Pairing uses [PeerJS](https://peerjs.com)'s free public broker for the WebRTC
handshake only — once paired, game data flows directly between the two
players, and a free TURN relay is configured so strict NATs can connect too.
The host simulates the world; the guest streams input and renders snapshots.

Co-op adds downed/revive (stand next to a fallen friend to pick them up,
fallen players respawn at the entrance when the room is cleared), shared
gold/XP, and both players choose their own upgrade on each level-up. If the
guest disconnects, the host continues solo seamlessly.

## What's in the game so far

- A full 3D WebGL view (three.js): dungeons are assembled from the KayKit
  modular kit with seeded per-room decoration — varied room sizes and shapes,
  themed floors/walls/props per dungeon, torches, banners, gates that slide
  open on room clear, staircases at floor exits, rising spike traps, and
  solid obstacle props (pillars, crates, barrels) — while all gameplay logic
  still runs on the original 2D tile grid underneath
- Animated KayKit heroes and skeletons, with GPU-particle combat effects
  (sparks, spell orbs, impact rings, weapon trails)
- Three floors of escalating rooms: combat, treasure vaults, spike-trap
  gauntlets, and named elite minibosses, ending in the dungeon's boss
  (Skeleton King, Goblin Warlord or the Lich) with AoE slams, summons,
  and enrage phases
- Enemy variety: melee skeletons, tanky brutes, hooded archers that kite and
  shoot bones, and bombers that sprint in and explode
- XP and level-ups: each level pauses the action with a choice of 3 random
  upgrades (damage, speed, max HP, attack speed, reach, lifesteal-on-kill)
- A town hub between runs: the Trader buys and sells gear, the Quest Giver
  hands out contracts, the Barkeep shows your sheet and the Innkeeper swaps
  your class
- Run saves: the run checkpoints to localStorage after every floor boss (as
  the design brief specifies) and the menu offers Continue; death wipes it
- Two-player WebRTC co-op with downed/revive (see above)
- Coin/heart pickups with magnet collection, HP/XP bars, boss HP bar
- Responsive rooms that fill any screen, with twin-stick touch controls on mobile
- Hit feedback: knockback, hit-flash, damage numbers, particles, screen shake
- Synthesized sound effects via the Web Audio API, plus vendored looping
  music/ambience beds per dungeon and town, mixed through a 4-bus (SFX world/
  UI, music, ambience) graph with a master limiter

## Assets

The 3D scene uses CC0 asset packs, vendored into the repo (no CDN, no build
step): the **Kenney Modular Dungeon Kit** for the architecture and the
**KayKit** Adventurers / Skeletons / Character Animations packs for the
animated heroes and enemies, loaded with a vendored three.js (`js/lib/three/`).

NPC/pickup/UI sprites are pixel art generated onto offscreen canvases at boot
in `js/sprites.js` (they stand in the 3D scene as billboards). Every sound
*effect* is synthesized at runtime in `js/audio.js` — no files. Music and
ambience, by contrast, are vendored loops under `assets/audio/` (mixed
licenses — CC0 and CC-BY; see `assets/audio/CREDITS.md` for per-track
attribution).

## Code layout

```
index.html      page shell, DOM overlays, importmap, module boot
css/style.css   layout and menu styling
js/boot.js      composition root: DOM wiring + the boot sequence (the only
                module that runs code at import time)
js/boot3d.js    3D boot: creates the renderer + character manager
js/runtime.js   late-bound handles to the async-loaded 3D systems
js/env.js       URL-flag parsing (?dev, ?floors, ...)
js/util.js      constants, room sizing and math helpers
js/dom.js       the DOM nodes more than one module touches
js/state.js     the shared `game` state object, DUNGEONS table, mid-run save
js/run.js       run lifecycle: start/generate/gate/advance/end a run
js/floor.js     floor generator: rooms + corridors on one tile grid
js/room.js      the live room/floor: tile grid, collision, themes
js/entities.js  player classes, enemies, bosses, projectiles, pickups
js/items.js     gear, rarities, inventory data
js/stats.js     hero attributes and derived stats
js/profile.js   persistent heroes, quests and save data
js/draw.js      the frame: simulation update, draw dispatch, rAF loop
js/hud.js       in-game HUD (screen-space overlay)
js/overlays.js  DOM overlays: hub, level-up, inventory, class cards, lobby
js/town.js      town + dungeon lobbies, NPC menus, raid/finale set-pieces
js/worldmap.js  the world map screen (2D screen-space)
js/input.js     keyboard + mouse + touch state
js/sprites.js   procedural pixel-art generation (billboards + UI)
js/audio.js     synthesized SFX + vendored music/ambience, 4-bus mix graph
js/particles.js effect triggers bridged into fx3d + damage-number data
js/render3d.js  three.js dungeon renderer (instanced Kenney kit)
js/char3d.js    KayKit character rigs + animation clips
js/fx3d.js      3D combat effects (particles, orbs, rings, swing trails)
js/game3d.js    the 3D view driver: entities -> models/billboards, overlays
js/decor3d.js   deterministic room-decoration planner
js/coop.js      co-op hosting/joining + host/guest message handlers
js/net.js       WebRTC pairing, remote input, world snapshot sync
```

## Next steps (toward the design brief)

- Guest joining mid-run at floor transitions, co-op save of both characters
- A lobby/signaling helper to replace manual code exchange
- Pointer-aim screen→world mapping tuned for the 3D camera
- More floors, bosses, and class abilities
