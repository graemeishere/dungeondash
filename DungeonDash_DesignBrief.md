# DUNGEON DASH
### Game Design Brief
*Cartoon Hack & Slash Roguelike • Android • 2-Player Local Co-op*

---

## Overview

Dungeon Dash is a cartoon-style hack & slash roguelike for Android. One player acts as host and owns the run. A second player can optionally join over Bluetooth or local WiFi. The game is designed to be fun solo and better with two — not dependent on co-op to work.

Each run is a fresh start. Players fight through procedurally generated dungeon floors, grab loot, level up mid-run, and face increasingly dangerous enemies. 

---

## Core Game Loop

1. Players connect (host solo, or host + guest via Bluetooth/WiFi)
2. Both players select a class (no class locking — duplicates allowed)
3. Enter procedurally generated Floor 1
4. Clear rooms: combat, treasure, trap gauntlet, elite enemy, shop
5. Defeat floor boss → run saves to host device
6. Proceed to next floor, repeat until death or dungeon cleared
7. Death → save wiped, return to class select

---

## Multiplayer & Host System

### Host / Party Leader
- The host owns the run entirely — save data lives on their device
- Host can start a solo run at any time without a guest
- Host can open the session for a guest to join **between floors** (not mid-floor)
- If guest disconnects mid-run, host continues solo seamlessly
- Guest progress (class, gear, level) is run-local only — nothing persists on guest device

### Connection
- Bluetooth or local WiFi (peer-to-peer, no server required)
- Host broadcasts a lobby; guest searches and joins
- Guest can only join at floor transition screens, not mid-combat

---

## Progression

### Per-Run (resets on death)
- **XP** from room clears → level up grants a choice of 3 random ability upgrades
- **Gold** from enemy drops → split 50/50 between players
- **Gear drops** tagged to killing blow player — each player manages own inventory
- **Shops** between floors — shared space, first come first served on purchases
- **Treasure rooms / chests** — one item generated per player, no competition

### Save State (Host Device, Between Floors)
Saved after each floor boss is defeated:
- Current floor number and dungeon seed
- Both characters: class, level, ability loadout, equipped gear
- Gold carried by each player

---

## Classes

All 4 classes available. Players pick independently — no class lock, duplicates allowed.

| Class | Role | Playstyle | Co-op Contribution |
|---|---|---|---|
| **Warrior** | Frontline tank | High HP, crowd control, shield bash | Holds aggro, protects squishier teammates |
| **Rogue** | Skirmisher | Fast movement, backstab bonuses, dodge roll | Flanks and assassinates priority targets |
| **Mage** | Glass cannon | AoE spells, mana management, huge burst damage | Nukes grouped enemies from range |
| **Ranger** | Backline DPS | Kites enemies, traps, ranged combos | Controls space, covers exits and flanks |

---

## Combat & Health

### Separate HP
- Each player has their own HP bar — independent survival
- HP hits 0 → player enters **Downed state** (cannot move or attack)
- Downed timer: ~15–20 seconds for the other player to reach and revive
- Successful revive → downed player returns with partial HP
- Failed revive (timer expires) → player sits out until room is cleared, respawns at room entrance with low HP
- **Both players downed simultaneously → run over → restart floor**

### Enemy Scaling
- **Solo run:** enemies scale down (fewer HP, reduced damage)
- **Co-op run:** full enemy stats
- Scaling applied at floor start — no mid-run adjustment if guest joins or leaves

---

## Dungeon Structure

### Floor Layout
- **Floors 1–3:** Standard rooms + mini-boss at end
- **Floor 4:** Final boss floor
- Generation: procedurally stitched from handcrafted room templates (fresh feel, manageable scope)

### Room Types

| Room Type | Description |
|---|---|
| **Combat** | Standard enemy encounter — clear all enemies to unlock doors |
| **Elite Enemy** | Single tough enemy with a special mechanic, better loot reward |
| **Trap Gauntlet** | Navigate hazards (spikes, fire, projectiles) while fighting |
| **Treasure** | No enemies — chest with one item per player |
| **Shop** | Spend gold on gear, consumables, or HP restoration |
| **Boss** | End-of-floor boss with unique attack patterns and phases |

---

## Recommended Build Scope

### MVP (First Playable)
- 2 classes only: Warrior + Mage
- 1 biome / tileset
- 4 floors with boss
- Solo play only (add co-op once core loop is stable)
- 3–4 enemy types
- Basic loot: weapons and simple stat gear

### v1.0 Target
- All 4 classes
- Bluetooth/WiFi co-op with host/guest system
- 2 biomes
- 5–6 enemy types per biome
- Ability upgrade trees (3 upgrades per class)
- Shop and treasure rooms fully implemented

---

## Notes for Development

- **Tech stack:** Claude Code's discretion — no engine or framework mandated
- **Art style:** 2D top-down, cartoon — consider free asset packs for prototyping
- **Networking:** No server infrastructure — all multiplayer must be peer-to-peer (Bluetooth or LAN)
- **Save format:** Host-side local storage only, lightweight JSON or equivalent
- **Mobile-first:** Design all UI and controls for touchscreen from day one
- **Dungeon generation:** Room-template stitching recommended over pure procedural for scope control
