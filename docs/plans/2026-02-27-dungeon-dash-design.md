# Dungeon Dash — Design Document

## Tech Stack

| Decision | Choice | Reason |
|---|---|---|
| Engine | Godot 4 | Purpose-built 2D, Android export, built-in multiplayer, no fees |
| Language | GDScript | Python-like, beginner-friendly, well-documented |
| Networking | Godot ENet (LAN WiFi only) | Built-in, no server needed, covers home co-op use case |
| Art | Kenney.nl free top-down packs | Free, high quality, swappable later |
| Dev platform | Desktop (keyboard/mouse) | Fast iteration; Android export added later |
| Controls | Virtual joystick (left) + skill buttons (right) | Industry standard for mobile action games |

**Bluetooth dropped** — Godot 4 has no native Bluetooth networking. LAN WiFi covers the target use case (playing at home) with far less complexity.

---

## Architecture

**Host/Client model:**
- Host = Player 1 + server authority (owns game state, enemies, saves)
- Guest = Player 2, connects by entering host's local IP on port 7777
- Guest joins only at floor transition screens
- If guest disconnects, host continues solo seamlessly

**Key Godot systems:**
- `ENetMultiplayerPeer` — creates host server or client connection
- `MultiplayerSpawner` — syncs character/enemy spawning across peers
- `MultiplayerSynchronizer` — replicates position + animation state automatically
- `@rpc` annotations — for game events (damage, item pickup, room cleared, level up)
- `Autoload (GameState.gd)` — global singleton for all run state

**Input model:** Each player sends input locally → moves their own character → position syncs to peer. Input is never transmitted.

---

## Project Structure

```
dungeondash/
├── scenes/
│   ├── characters/       # warrior.tscn, mage.tscn, rogue.tscn, ranger.tscn
│   ├── enemies/          # skeleton.tscn, slime.tscn, elite_*.tscn, boss_*.tscn
│   ├── rooms/            # combat_room.tscn, shop.tscn, treasure.tscn, boss_room.tscn
│   ├── ui/               # hud.tscn, main_menu.tscn, class_select.tscn, level_up.tscn
│   └── world/            # floor.tscn, game.tscn (root)
├── scripts/
│   └── autoload/         # game_state.gd
├── assets/
│   ├── sprites/
│   ├── tilesets/
│   └── audio/
└── data/                 # JSON: item definitions, enemy stats, ability trees
```

**Root scene (`game.tscn`)** owns networking setup. Never move spawning logic out of here.

---

## Dungeon Generation

Room-template stitching (not pure procedural). Floor structure:

```
[Entry] → [Combat] → [Combat] → [Elite or Treasure] → [Shop] → [Boss]
```

- Rooms are pre-built scenes selected randomly from a pool at runtime
- Rooms connect via doorway triggers
- Floor 4 is the final boss floor
- Dungeon seed stored in GameState for save/resume

---

## Combat System

**Hitbox/Hurtbox pattern:**
- `CharacterBody2D` for all characters and enemies
- `Hurtbox` (Area2D) — detects incoming damage
- `Hitbox` (Area2D) — enabled briefly during attack animation

**Character state machine:** `idle → move → attack → hurt → dead`

**Enemy AI (host-controlled):** chase nearest player → attack when in range. State synced to guest via MultiplayerSynchronizer.

**Downed state:** HP → 0 triggers 15–20s revive timer. Both downed = run over.

---

## Progression

**GameState autoload tracks:** floor number, seed, both players' class/level/XP/gold/gear/abilities.

**Level up:** XP from room clears → pause → 3 random ability upgrade cards → pick one.

**Save:** JSON to `user://save.json` after each floor boss. Death wipes it.

---

## Milestones

| Milestone | Description | Done When |
|---|---|---|
| 0 — Prove It | Two placeholder characters moving over LAN WiFi | Both screens show both players moving in real time |
| 1 — MVP Loop | One floor, 2 classes, basic combat, can die and restart | Full solo/co-op floor cleared |
| 2 — Ship It | 4 classes, 4 floors, XP, shop, save | Full co-op run with wife, start to finish |
