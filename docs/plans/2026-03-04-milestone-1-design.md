# Dungeon Dash — Milestone 1 Design

**Goal:** One playable floor with 2 classes, basic combat, downed/revive mechanic, and a restart loop. Done when a full solo or co-op run of the single room can be completed (or failed) and restarted.

---

## Decisions Summary

| Topic | Decision |
|---|---|
| Classes | Warrior (melee, high HP) and Mage (ranged, lower HP) — light differentiation |
| Room | Tileset-based arena using Kenney "Dungeon" tiles, hand-crafted |
| Enemies | 5–6 skeletons with chase + telegraph wind-up before attacking |
| Death | Downed state + partner revive; both downed = run over → class select |

---

## Scene & Script Structure

```
scenes/
  characters/
    warrior.tscn         ← extends player base; melee attack
    mage.tscn            ← extends player base; projectile attack
  enemies/
    skeleton.tscn
  rooms/
    combat_room.tscn     ← TileMap arena, spawn points, room_cleared logic
  ui/
    hud.tscn             ← HP bars, downed timer, win/lose overlays
    class_select.tscn    ← pick Warrior or Mage before the run
  world/
    game.tscn            ← networking hub (unchanged role from M0)

scripts/
  player_base.gd              ← movement, state machine, health; base for both classes
  warrior.gd                  ← melee attack behaviour, stats override
  mage.gd                     ← projectile attack behaviour, stats override
  magic_bolt.gd               ← Mage projectile (CharacterBody2D)
  components/
    health_component.gd       ← max_hp, current_hp, take_damage(), died signal
  enemies/
    skeleton.gd               ← chase/telegraph/attack state machine
  rooms/
    combat_room.gd            ← spawn enemies, watch for all-dead, emit room_cleared
  ui/
    hud.gd
    class_select.gd
```

---

## Player Base (`player_base.gd`)

**Stats (overridden per class):**
- `max_hp` — Warrior: 120, Mage: 70
- `speed` — both: 200 px/s
- `attack_damage` — Warrior: 25, Mage: 15
- `attack_cooldown` — Warrior: 0.6s, Mage: 0.8s

**State machine:**
```
idle → move → attack → hurt → downed
  ↑_____________↑         ↑
                    (revived)
                           ↓
                         dead (both downed → run_over RPC)
```

**Movement:** `Input.get_vector()` on the owning peer → `move_and_slide()`. Position synced via `MultiplayerSynchronizer` as in M0.

**Input action added:** `attack` mapped to Space / left mouse button / screen tap.

**Downed state:**
- HP → 0: enter `downed`, start 20s host-authoritative timer.
- Partner enters 64px radius + holds `attack` for 1.5s → `revive_player.rpc(peer_id)` fires → revived at 50% HP.
- Timer expires with no revive (or both downed) → `run_over.rpc()` → all peers load class select.

---

## Warrior (`warrior.gd`)

- **Attack:** 0.15s wind-up → enable `Hitbox` Area2D (short forward arc, 80×60px) for 0.1s → disable. Deals `attack_damage` to any enemy `Hurtbox` that overlaps.
- Visual: blue `ColorRect` (placeholder), "W" label.

---

## Mage (`mage.gd`)

- **Attack:** instantiate `MagicBolt` scene at player position, oriented toward movement direction (or last facing direction if still). Bolt travels at 400px/s, deletes on wall collision or 800px travel. Deals `attack_damage` on enemy `Hurtbox` overlap.
- Visual: purple `ColorRect`, "M" label.

---

## Health Component (`health_component.gd`)

```gdscript
signal died
signal health_changed(new_hp: int, max_hp: int)

var max_hp: int = 100
var current_hp: int = 100

func take_damage(amount: int) -> void   # decrements, emits signals, clamps to 0
func heal(amount: int) -> void
func is_dead() -> bool
```

Used by: `player_base.gd`, `skeleton.gd`.

---

## Skeleton (`skeleton.gd`)

**Stats:** 40 HP, 80 px/s move speed, 15 attack damage, 48px attack range.

**State machine (host-authoritative):**
```
idle → chase → telegraph (0.5s) → attack → cooldown (1.0s) → chase
                                      ↓
                                    hurt (0.2s) → chase
                                    dead → queue_free()
```

- **Chase:** `move_and_slide()` toward nearest player each `_physics_process`. Stops when within 48px.
- **Telegraph:** freeze movement, tint red for 0.5s (dodge window for players).
- **Attack:** enable `Hitbox` for 0.15s. No movement during attack.
- **Hurt:** brief knockback, flash white.
- **Sync to guest:** `MultiplayerSynchronizer` replicates `position` and `state` (int enum).

---

## Combat Room (`combat_room.gd`)

- `TileMap` with Kenney "Dungeon" tileset: 20×14 tile arena (~640×448px). Stone floor, wall border, 3–4 pillar obstacles for cover.
- 6 `Marker2D` spawn points at room corners and midpoints.
- On `_ready` (host only): spawn 5–6 skeletons via `_spawn_skeleton.rpc(spawn_index)`.
- Watch `HealthComponent.died` signals. When all skeleton nodes are freed → emit `room_cleared`.
- `game.gd` listens to `room_cleared` → show win overlay.

---

## Multiplayer Authority Summary

| What | Authority | Sync mechanism |
|---|---|---|
| Player position | Owning peer | `MultiplayerSynchronizer` |
| Player HP | Host | RPC `_receive_damage` → host applies → `MultiplayerSynchronizer` |
| Player state enum | Owning peer | `MultiplayerSynchronizer` |
| Enemy position + state | Host | `MultiplayerSynchronizer` |
| Enemy HP | Host only | Not synced (host-local) |
| Downed timer | Host | RPC broadcast on tick |
| Room cleared / run over | Host | RPC broadcast |

---

## HUD (`hud.gd`)

- **P1 HP bar** (top-left): `ProgressBar` driven by `health_changed` signal.
- **P2 HP bar** (top-right): same, hidden in solo.
- **Downed overlay:** replaces HP bar with countdown + "DOWNED" text when peer enters downed state.
- **Win screen:** "Floor Cleared!" + "Play Again" button → restart to class select.
- **Game over screen:** "Both Down — Run Over" + "Try Again" button → restart to class select.

---

## Class Select (`class_select.gd`)

- Shown before each run (and after game over / win).
- Host picks class → guest picks class → host starts the run once both have selected.
- Selection stored in `GameState.player_classes: Dictionary` keyed by peer ID.
- On start: `game.gd` spawns the correct warrior/mage scene per peer instead of the generic player.

---

## Flow Diagram

```
Main Menu → [Host/Join] → Class Select → Combat Room
                                             ↓           ↓
                                         Room Cleared   Both Downed
                                             ↓           ↓
                                         Win Screen   Game Over Screen
                                             ↓           ↓
                                         Class Select ←──┘
```

---

## Out of Scope for M1

- XP / levelling
- Shop or treasure rooms
- Multiple rooms or floor transitions
- Audio
- Actual sprite art (all placeholder ColorRects)
- Android export
- Save system
