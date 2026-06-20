# Dungeon Dash — Game Design & Flow

A browser action-roguelite built in vanilla JS on a single HTML5 canvas, with no build step and
no image assets (all sprites are procedurally drawn at boot). This document captures the intended
design, the current state of the systems, and the roadmap.

---

## 1. Core fantasy & goal

You are a persistent hero who lives between runs. From a **world map** you travel to themed
**dungeons**, fight through floors of a faction's enemies, grab loot, and grow stronger. A **town**
is your safe hub for managing your hero. Occasionally the town is **raided** and you defend it.

**Victory condition (target):** clear all three dungeons at **Tier 3** (levels 21–30). Doing so
unlocks a capstone **"Town Under Siege" raid finale**. After winning, play continues freely for gear
hunting and higher challenge. Per-hero clears are tracked and clearing all three dungeons at Tier 3
marks the hero a **Champion**, which unlocks **"The Last Stand"** finale on the world map — a
town-themed siege by every faction at once, capped by a unique boss, **THE WORLD-EATER**.

**Death model:** the hero is persistent — **level, XP, and gear are never lost**. Dying in a dungeon
only **forfeits the gold collected during that run** (gold is banked only when a run is completed).
No permadeath. This keeps stakes meaningful without erasing progression.

---

## 2. Core loop & screen flow

```
        ┌─────────────────────────────────────────────────────┐
        │                     WORLD MAP                        │
        │   (Catacombs · Goblin Mines · The Crypt · Town)      │
        └───────────┬───────────────────────────┬─────────────┘
        click dungeon │                           │ click town
                      ▼                           ▼
              ┌───────────────┐           ┌──────────────────┐
              │ DUNGEON LOBBY │           │   TOWN (walkable) │
              │ 3 tier doors  │           │ Barkeep/Innkeeper │
              │ (level-gated) │           │ Trader/QuestGiver │
              └───────┬───────┘           └────────┬─────────┘
            walk through door                       │ (25% chance on entry)
                      ▼                             ▼
              ┌───────────────┐           ┌──────────────────┐
              │      RUN       │◀──────────│   RAID WARNING    │
              │ floors → boss  │ Fight Back│ Fight Back / Flee │
              └───────┬───────┘           └──────────────────┘
                      ▼
              ┌───────────────┐
              │    RESULT      │ → Play Again / World Map
              └───────────────┘
```

- **Menu** — first-time class pick (only shown when no hero exists). Co-op host/join lives here.
- **World Map** — canvas-drawn top-down map with four locations; click to travel.
- **Dungeon Lobby** — a themed walkable entry room with three doorways, one per tier. Walk through a
  doorway to begin a run at that tier.
- **Run** — the dungeon proper: a sequence of rooms ending in a boss, repeated per floor.
- **Result** — win/lose summary. Play Again or World Map.
- **Town** — walkable hub; talk to NPCs. Exit door (top) returns to the map.

---

## 3. Game states (`game.state`)

| State | Meaning | Update | Draw |
|------|---------|--------|------|
| `menu` | Title / class pick | idle | room backdrop |
| `map` | World map | input via click/tap | `drawMap` |
| `lobby` | Dungeon entry room | movement, door → tier | `drawPeaceful` |
| `town` | Walkable hub | movement, NPC proximity | `drawPeaceful` |
| `stats` | Barkeep overlay open | frozen | `drawPeaceful` (behind) + DOM |
| `raid-warn` | Raid warning overlay | frozen | DOM overlay |
| `play` | Active combat | full sim | room + entities + HUD |
| `transition` | Room fade | fade timer | fade overlay |
| `levelup` | Upgrade pick | frozen | DOM cards |
| `inventory` | Bag overlay | frozen | DOM overlay |
| `won` / `lost` | Run ended | result timer | result overlay |
| `hub` | Legacy hero panel (reachable via map Esc) | idle | room backdrop |

`game.peaceful` is set in `lobby`/`town` so the player can move but not attack.

---

## 4. Dungeons, factions & tiers

Defined data-driven in `DUNGEONS` (`js/game.js`). Adding a dungeon = one map entry + a sprite theme.

| Dungeon | Faction | Theme | Enemies |
|---------|---------|-------|---------|
| Catacombs | skeleton | grey stone + torches | melee, archer, shade (wall-phaser) |
| Goblin Mines | goblin | wood beams + lanterns + rail track | goblin, goblinArcher, goblinBerserker (enrages), goblinShaman (heals) |
| The Crypt | undead | dark stone + gravestones + bats | zombie (tank), warlock (magic orbs), necromancer (summons) |

Each dungeon has **3 floors** (room sequences ending in a boss) and **3 tiers** (difficulty bands
that multiply enemy/boss stats):

| Tier | Levels | Unlocks at hero level |
|------|--------|-----------------------|
| 1 | 1–10 | always |
| 2 | 11–20 | **level 10** (`TIER_REQ`) |
| 3 | 21–30 | **level 20** |

Locked tier doorways show a red **LOCKED / Reach Lv N** sign and block entry with a toast.

### Enemy grades (per-spawn)
Independent of tier, each non-boss enemy rolls a **grade** (`DD.rollGrade`) that scales with floor
depth + tier: **regular** (red HP bar), **veteran** (purple, ×1.6 HP / ×1.35 dmg), **elite** (gold,
×2.8 HP / ×2.0 dmg, better loot). Separate from the "elite room" mini-boss flag.

### Room types (per floor `plan`)
`combat`, `elite` (mini-boss + minions), `treasure` (chests), `trap` (spike gauntlet, door pre-open),
`boss`. **No shops inside dungeons** — shopping is a town-only activity (Trader, planned).

---

## 5. Hero progression

- **Persistent profile** (`js/profile.js`, localStorage): one hero per class, with level, XP, gold,
  kills/deaths, attributes, equipped gear, and inventory (cap **15**).
- **Classes:** Warrior, Rogue, Mage, Ranger (`DD.CLASSES`). Differ in attack type, stats, dash.
- **Attributes** (`DD.ATTRS`): Might (dmg), Agility (speed), Focus (range/proj), Vitality (hp). One
  point granted per level-up; spent at the **Barkeep**.
- **Derived stats** (`DD.deriveStats`): class base + per-level growth + attributes + equipped gear.
- **In-run upgrades:** the `levelup` overlay offers run-scoped buffs (`DD.UPGRADES`) on level gains
  during a run.
- **Gear:** weapon/armor/trinket slots; rarity (common/rare/epic) scales mod values; **faction-
  weighted drops** (70% the current dungeon's faction, 30% universal).

---

## 6. Town & NPCs

A walkable, town-themed room (`DD.room.generateTown`). Approach an NPC and press **E** (or tap on
mobile) to interact. Exit via the top door → world map.

| NPC | Role | Status |
|-----|------|--------|
| **Barkeep** | Opens the stats overlay: view stats, spend attribute points, manage equipment & bag | **done** |
| **Innkeeper** | Change class while keeping all progression | **done** |
| **Trader** | Buy/sell gear for gold | stub ("coming soon") |
| **Quest Giver** | Accept/track quests | stub ("coming soon") |

### Town raids
On ~25% of town arrivals a **raid warning** appears: **Fight Back** or **Flee to Map**. Fighting
back drops you into a **town-themed mini-dungeon** (`buildRaidDungeon`): one floor, three rooms
(`combat, combat, boss`) using the raiding faction's enemies, boss "RAID CAPTAIN". Clearing it (or
"Play Again" from the result) returns you to the town.

---

## 7. Rendering & rooms

- Fixed-aspect world (`DD.WIDTH/HEIGHT` from `ROOM_W×ROOM_H` tiles); letterboxed to the canvas via
  `DD.view`. Room size is recomputed per screen so it fills any device; the resize handler reflows
  map/town/lobby.
- **Themes** (`DD.sprites.themes`): per-dungeon wall/floor/door tiles + decorations (torches,
  lanterns, bats, gravestones, fences, mine cart, rail track, bar counter). `DD.room.setTheme(id)`
  selects one; `prerender()` bakes tiles + static props; `drawDecorations()` animates the rest.
- Sprites are procedural (`surface()` + pixel plotting), drawn once at boot in `DD.sprites.init()`.

---

## 8. Co-op (multiplayer)

Peer-to-peer via PeerJS (`js/net.js`). **Host is authoritative**: it simulates the world and streams
snapshots; the **guest renders snapshots** and streams only its input. Pairing is a short room code.
Co-op currently targets the dungeon run flow. Town/lobby/map are single-player surfaces today —
co-op parity for them is on the roadmap.

---

## 9. Controls

- **Keyboard/mouse:** WASD/arrows move; click or space attack (aim with mouse); Shift dash;
  **E** interact (town); **I** inventory.
- **Touch:** left thumb = move stick, right thumb = aim/attack; on-screen Dash/Bag buttons; tap an
  NPC to talk; tap map/lobby doors to navigate.

---

## 10. Roadmap (prioritized)

**Shipped:**
- ✅ **Trader shop** — buy/sell economy in town (gold sink; pairs with the death model).
- ✅ **Quest system** — NPC-assigned quests (accept up to 3, abandon for a fee) covering faction
  kills, boss kills, dungeon clears, full runs, and raid defenses.
- ✅ **Victory tracking** — per-hero (dungeon, tier) clears persist; clearing all three dungeons at
  the top tier marks the hero a Champion (one-time victory screen + map/lobby clear indicators).
- ✅ **Victory finale** — "The Last Stand" appears on the map once you're Champion: a town-themed
  multi-faction siege (all enemy types at once) ending with a unique final boss, **THE WORLD-EATER**.

**Remaining:**
1. **Town-raid depth** — defense rewards, scaling, frequency tuning.
2. **Co-op parity** — town/lobby/map/themes working for the guest; sync raid state.

---

## 11. Source map

| File | Responsibility |
|------|----------------|
| `js/game.js` | State machine, run lifecycle, world map, town/lobby, NPCs, raids, draw loop |
| `js/room.js` | Tile grid, generation (`generate`/`generateLobby`/`generateTown`), themes, decorations |
| `js/sprites.js` | All procedural sprites + theme/decoration registry |
| `js/entities.js` | Player, enemies (Skeleton/Enemy + Boss), projectiles, pickups, grades |
| `js/items.js` | Gear bases, rarity, rolling, equip/compare |
| `js/profile.js` | Persistent hero(es), quests, save/migrate |
| `js/stats.js` | `deriveStats` (class + level + attrs + gear) |
| `js/hud.js` | In-run HUD |
| `js/input.js` | Keyboard/mouse/touch input |
| `js/net.js` | Co-op (PeerJS, snapshots) |
| `js/particles.js`, `js/audio.js`, `js/util.js` | FX, sound, helpers |
