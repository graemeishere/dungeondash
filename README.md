# Dungeon Dash

A cartoon hack & slash roguelike for the web — desktop and mobile, solo or
two-player co-op. Fight through three floors of combat rooms, trap gauntlets,
elite hunts, and treasure vaults; spend gold at the shop between floors; and
take down the Skeleton King, the Bone Emperor, and The Deathless.

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
  gauntlets, and named elite minibosses, each floor capped by its own boss
  (Skeleton King → Bone Emperor → The Deathless) with AoE slams, summons,
  and enrage phases
- Enemy variety: melee skeletons, tanky brutes, hooded archers that kite and
  shoot bones, and bombers that sprint in and explode
- XP and level-ups: each level pauses the action with a choice of 3 random
  upgrades (damage, speed, max HP, attack speed, reach, lifesteal-on-kill)
- A shop between floors: gold buys a full heal, +3 max HP, or a random upgrade
- Run saves: the run checkpoints to localStorage after every floor boss (as
  the design brief specifies) and the menu offers Continue; death wipes it
- Two-player WebRTC co-op with downed/revive (see above)
- Coin/heart pickups with magnet collection, HP/XP bars, boss HP bar
- Responsive rooms that fill any screen, with twin-stick touch controls on mobile
- Hit feedback: knockback, hit-flash, damage numbers, particles, screen shake
- Synthesized sound effects via the Web Audio API

## Assets

The 3D scene uses CC0 asset packs, vendored into the repo (no CDN, no build
step): the **Kenney Modular Dungeon Kit** for the architecture and the
**KayKit** Adventurers / Skeletons / Character Animations packs for the
animated heroes and enemies, loaded with a vendored three.js (`js/lib/three/`).

Everything else is still code: NPC/pickup/UI sprites are pixel art generated
onto offscreen canvases at boot in `js/sprites.js` (they stand in the 3D scene
as billboards), and every sound is synthesized at runtime in `js/audio.js`.

## Code layout

```
index.html      page shell, DOM overlays, 3D boot
css/style.css   layout and menu styling
js/util.js      constants and math helpers
js/sprites.js   procedural pixel-art generation (billboards + UI)
js/audio.js     Web Audio sound effects
js/input.js     keyboard + mouse + touch state
js/render3d.js  three.js dungeon renderer (instanced Kenney kit)
js/char3d.js    KayKit character rigs + animation clips
js/fx3d.js      3D combat effects (particles, orbs, rings, swing trails)
js/game3d.js    the 3D view driver: entities -> models/billboards, overlays
js/particles.js effect triggers bridged into fx3d + damage-number data
js/room.js      room generation, tile grid, collision
js/entities.js  player classes, skeletons, projectiles, pickups
js/items.js     gear, rarities, inventory data
js/stats.js     hero attributes and derived stats
js/profile.js   persistent heroes and save data
js/hud.js       in-game HUD (screen-space overlay)
js/net.js       WebRTC pairing, remote input, world snapshot sync
js/game.js      state machine, main loop, wiring
```

## Next steps (toward the design brief)

- Guest joining mid-run at floor transitions, co-op save of both characters
- A lobby/signaling helper to replace manual code exchange
- Pointer-aim screen→world mapping tuned for the 3D camera
- More floors, bosses, and class abilities
