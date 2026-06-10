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

Per the design brief, a host owns the run and a guest can join peer-to-peer —
no server involved. On the web this uses WebRTC with a copy-paste pairing code
(the spiritual equivalent of the brief's Bluetooth pairing):

1. Host clicks **Host Co-op**, picks a class, and sends the invite code to a friend
2. Guest clicks **Join Co-op**, picks a class, pastes the code, and sends back the reply code
3. Host pastes the reply — the run starts on both screens

The host simulates the world; the guest streams input and renders snapshots.
Co-op adds downed/revive (stand next to a fallen friend to pick them up,
fallen players respawn at the entrance when the room is cleared), shared
gold/XP, and both players choose their own upgrade on each level-up. If the
guest disconnects, the host continues solo seamlessly. Works best on the same
network; the pairing codes can be sent over any chat.

## What's in the game so far

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

## Code layout (additions)

```
js/net.js       WebRTC pairing, remote input, world snapshot sync
```

## Next steps (toward the design brief)

- Gear drops and inventory (the last big brief feature missing)
- Guest joining mid-run at floor transitions, co-op save of both characters
- A lobby/signaling helper to replace manual code exchange
- More floors, bosses, and class abilities
