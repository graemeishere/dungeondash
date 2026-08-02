# Phase 2 — Progression Correctness: Level-Design Spec

Owner: level-design. Produced 2026-08-02, against the current post-Phase-0/1
tree, jointly with `docs/design/phase2-systems-spec.md` (systems-design,
produced the same day — read first; this spec assumes its §1/§6/§7 verbatim
except where amended below). All references are by symbol name.

Two deliverables, per the roadmap's Phase 2 section and decisions 7/9:

1. New `tiers[].scale` values for all three dungeons (§1), plus a verdict on
   whether systems' boss-HP table (§6 of their spec) needs a matching
   adjustment (§2).
2. Final `spawnFloorEntities` branches for `shrine`/`storage`/`dining` (§3),
   reviewing and amending systems' §7 proposal.

Do not touch: `js/floor.js` tile-carving itself (`carveRect`,
`carveRoomFeatures`, `trapSpikes`) — already correct per Phase 1, not
re-litigated here. This is a spec; implementation is a later pass.

---

## 1. `tiers[].scale` — measured, not assumed

Before picking numbers I measured what Phase 1's geometry actually put into a
standard combat/elite room, rather than reasoning from the roadmap's "coverless
box → cover" framing in the abstract. Sampled 400 floor generations
(`generateFloor({ plan: [...7-room plan], boss: true })`, `js/floor.js`) and
counted `OBSTACLE` tiles inside each room's own `rect`:

| Room type | tiles (area) | avg obstacle tiles | avg open floor | rooms with 0 obstacles |
|---|---|---|---|---|
| combat (5×4) | 20 | **1.77** | 18.2 | 0.4% |
| elite (5×4) | 20 | **1.76** | 18.2 | 0.25% |
| boss (8×7) | 56 | 5.59 | 49.0 | 0% |

This matters because `carveRoomFeatures` (`js/floor.js:245-331`) gates corner
notches behind `roomy = w >= 6 && h >= 5` (`js/floor.js:272`) — a standard
5×4 combat/elite room is **not** "roomy," so it gets *only* the single-tile
obstacle-cluster pass, never corner notches, and only `[1,1]`-shaped clusters
(the `roomy ? [...] : [[1,1]]` branch, `js/floor.js:304`). The boss chamber
(8×7) is the one room type that gets the full treatment (corner notches +
1×1..2×2 clusters) — which is irrelevant to this pullback, since boss
`hp`/`dmg` are hand-tuned independently of `scale` (systems' spec, confirmed
below).

**Conclusion up front: the fix Phase 1 shipped is real but structurally
modest for the rooms that matter to `scale`.** An average combat/elite room
gained fewer than two single 32px props in a 20-tile box — enough to
occasionally break a ranged enemy's sightline or force two melee enemies to
pass a prop shoulder-to-shoulder into a Warrior's cleave arc, not enough to
create hard chokepoints or reliable cover. The roadmap's "coverless box, so
rebalance" framing is directionally right, but the magnitude the code
actually produces argues for a **moderate** pullback, not a steep one. I'm
not gutting the curve — I'm calibrating the giveback to the ~9% obstacle
density actually measured, not to a "cover fortress" that doesn't exist in
standard rooms.

### What the geometry buys, concretely

- **Ranged/caster encounters** (archer, warlock, goblinArcher/Shaman,
  necromancer — all present in every dungeon by floor 2): a stray 1×1 prop
  gives the player something to duck behind mid-fight, worth an occasional
  missed volley. In a 5×4 room this is small — there's rarely a spot that's
  fully out of every enemy's line, since the room is small enough that most
  angles route around a single prop in 1-2 tiles. Real, but modest.
- **Melee bunching / cleave**: with ~1.8 props average, a genuine choke
  (enemies forced single-file) is uncommon in standard rooms; the far more
  reliable chokepoint in the game is the room's own 2-tile door mouth, but
  that only matters for entry/exit, not for enemies that spawn already
  inside the room. So the cleave-bunching benefit the roadmap names is real
  but occasional, not the room's dominant tactical fact.
- **Downside not to ignore**: obstacles also let the player get cornered —
  Phase 1's BFS-validated placement (`reachableAll`, `js/floor.js:253-269`)
  guarantees the room stays *solvable*, not that a bad position can't trap
  the player against a corner. This partially offsets the pure-benefit
  framing; I'm treating the net effect as positive-but-modest for the
  player, not free.

### The numbers: flat absolute reduction, not a percentage

Because the same floor generator with the same obstacle density (~9%
combat/elite, both floors) underlies all three dungeons — faction has no
effect on tile carving — I applied a **flat absolute subtraction** to
`scale` rather than a per-dungeon percentage. A flat cut preserves each
dungeon's existing relative-difficulty spacing exactly (Goblin Mines and
Crypt were already tuned 0.1-0.2 harder than Catacombs per tier; a flat
subtraction keeps that spacing bit-for-bit, where a percentage cut would
compress it slightly since the dungeons start from different bases).

- **Tier 0: unchanged.** Fights here resolve in 1-2 hits (`TTK ≈ 0.5s` per
  systems' own worked table) — there's no time window for a player to
  exploit a sightline break or for enemies to bunch at a 1-tile prop before
  the fight's already over. The geometry has nothing to buy back at this
  tier, and it's the tuned anchor everything else (rewards, boss HP ratio)
  already keys off — no regression risk by leaving it alone.
- **Tier 1: `scale -= 0.2`.** Modest — Tier 1 combat rooms already read as
  comfortably tuned in systems' own reward-scaling table (flat 10 XP/sec
  before and after their fix), so there's less pressure to touch it; the
  cut mainly shows up in the tankier enemy kinds (see worked numbers below),
  not the common trash mob.
- **Tier 2: `scale -= 0.7`.** This is where the roadmap's "6× HP sponge"
  complaint was aimed, and where the boss chamber's stronger geometry sits
  right next to it in a floor's room order — the cut is proportionally
  larger here (10-12% of the pre-cut value, vs ~6-7% at Tier 1) to reflect
  that Tier 2's `elite`/`trap`/multi-kind rooms are where a fight is most
  likely to run long enough for cover/bunching to matter at all.

### Final values

| Dungeon | Tier 0 (unchanged) | Tier 1 (was → now) | Tier 2 (was → now) |
|---|---|---|---|
| Catacombs | 1.0 | 3.0 → **2.8** | 6.0 → **5.3** |
| Goblin Mines | 1.1 | 3.3 → **3.1** | 6.5 → **5.8** |
| Crypt | 1.2 | 3.6 → **3.4** | 7.0 → **6.3** |

Relative dungeon spacing is exactly preserved: Tier 1 gaps stay 0.3/0.3,
Tier 2 gaps stay 0.5/0.5, identical to today's table — nothing about *which*
dungeon is hardest, or by how much, changes; only the absolute climb within
each dungeon eases slightly at the top two tiers.

### Worked check — does this still escalate meaningfully, or did it flatten?

Using systems' own method (tier-appropriate character, `dmg = 3 + (lvl-1) ×
0.15`, `TTK = (hits-1) × cooldown`, `hits = ceil(hp/dmg)`, `cooldown = 0.5`),
against Catacombs' **weakest** enemy (`melee`, `baseHp=6`) and its
**tankiest** regular enemy (`zombie`, `baseHp=14`):

| Enemy | Tier | old scale | new scale | old hp | new hp | old hits | new hits | old TTK | new TTK |
|---|---|---|---|---|---|---|---|---|---|
| melee (baseHp 6) | 1 | 3.0 | 2.8 | 18 | 17 | 4 | 4 | 1.5s | 1.5s |
| melee (baseHp 6) | 2 | 6.0 | 5.3 | 36 | 32 | 6 | 6 | 2.5s | 2.5s |
| zombie (baseHp 14) | 2 | 6.0 | 5.3 | 84 | 74 | 14 | 13 | 6.5s | **6.0s** |
| "big" enemy (baseHp 16) | 2 | 6.0 | 5.3 | 96 | 85 | 16 | 15 | 7.5s | **7.0s** |

Because `hits = ceil(hp/dmg)` buckets in whole numbers, the cheapest trash
mob doesn't even move a bucket at either tier — the pullback is *invisible*
on the enemy type players kill fastest and most often, which is exactly right:
the "6× sponge" complaint was never about the 2-hit skeleton, it was about
the accumulated grind of a whole room of tankier kinds. The tankier types
(`zombie`, `big`) each drop one hit (~7-8% shorter TTK) at Tier 2 — real,
noticeable over a full room of 3-6 enemies, not a flattening. Tier 2 is
still unambiguously harder than Tier 1 (6 hits vs 4 for the same trash mob;
13 vs a Tier-1-appropriate character never even facing a zombie at that HP)
— the curve keeps climbing, just not purely through raw HP multiplication
at the top.

I ran the same shape of check for Crypt's `necromancer` (`baseHp=9`,
tier 2): old `scale=7.0` → hp 63 → 11 hits → 5.0s; new `scale=6.3` → hp 57 →
10 hits → 4.5s. Same ~10% pattern. Goblin Mines wasn't spot-checked
individually — same generator, same obstacle density, same flat-subtraction
method, no reason to expect a different shape.

---

## 2. Boss-HP table (systems' §6) — verdict: fine as-is, no change needed

Systems flagged this explicitly for a joint revisit: their `BOSS_HP_RATIO`
table (`[0.6, 0.8, 1.0]` applied to `tiers[t].bossHp`, which they leave
completely untouched) and their per-floor `bossDmg` arrays were hand-tuned
independently of `scale`, specifically so a `scale` change wouldn't silently
break them. I checked the interaction three ways:

1. **Nothing in their formula reads `scale`.** `bossHp = round(tier.bossHp ×
   ratio)` and `bossDmg = flr.bossDmg[tierIdx]` are both untouched by my
   change — `tier.bossHp` values (70/160/280 Catacombs, etc.) are exactly
   what I left alone in §1. Zero mechanical coupling.
2. **Boss-vs-mob HP ratio gets *slightly more* pronounced, not less** — a
   good direction. Catacombs Tier 2: old ratio `bossHp(280) / melee-hp(36) =
   7.8×`; new ratio `280 / 32 = 8.75×`. The boss reads as a bigger step up
   from regular fodder after the pullback, since its HP didn't move but the
   room's mobs got slightly cheaper. That's the correct direction for a
   climactic fight, not a regression.
3. **Tier-to-tier growth rates converge slightly**, which is also the right
   direction. Systems' own note: "boss HP goes ×4 across tiers while scale
   goes ×6" (Catacombs: `bossHp` 70→280 is ×4; old `scale` 1.0→6.0 is ×6 —
   a 2.0× gap between how much tougher a boss gets vs. how much tougher a
   regular mob gets, tier 0 to tier 2). With the new scale (1.0→5.3, ×5.3),
   the gap narrows to ×4 vs ×5.3 — a 1.3× gap. Bosses and their own floor's
   regular enemies scale more in step with each other after this change,
   which reads as *more* internally consistent, not less.

**Verdict: no change to §6's boss-HP or boss-dmg tables.** Ship them exactly
as systems specified. Re-check this pairing again only if a future pass
changes `scale` a second time.

---

## 3. Side rooms (decision 9) — reviewing and finalizing systems' §7

Systems' shrine/storage/dining primitives (`Chest` shrine variant, scattered
`Pickup`, `game.addXP`) and counts are the right shape and I'm keeping all
three unchanged: 8 coins for storage reads as "a room of crates," distinct
from treasure's tight single-point chest-burst; 4 hearts for dining reads as
a clear, sparse "place settings" identity without turning into a full heal
spa; 1 chest for shrine is correct as a *single* destination — a shrine
handing out multiple blessings would undercut its own "you found one thing
worth having" identity, and more than one interactable would fight the
"premium detour" framing that's supposed to stay unique to treasure's 3
chests.

Room math backs the counts up: I measured earlier (§1) that a standard 5×4
room has ~18 open floor tiles after obstacle carving. 8 coins in ~18 tiles
reads as "the room is full of scattered gold," not overcrowded; 4 hearts is
sparse by design (contrast, not clutter, is the dining identity). No count
changes needed.

I found and I'm amending two implementation problems in their proposed code
before finalizing it — both are correctness/parity issues, not taste calls:

### Amendment 1 — the shrine's maxHp buff loses its heal (order-of-operations bug)

Systems' proposed shrine buff:
```js
() => { pl.runBuffs.maxHp += 4; pl.hp = pl.maxHp; },  // set after recompute below
```
...with a single `pl.recompute()` called *after* the whole `SHRINE_BUFFS[...]()`
dispatch. As written, `pl.hp = pl.maxHp` executes *before* `recompute()` ever
runs, so it captures the **old** `maxHp` — the player's current HP doesn't
actually rise; only the ceiling does, silently, one frame later. Compare to
the existing, working `UPGRADES` entry for the same kind of buff
(`js/entities.js`, `id: "hp"`, "Tough Hide"):
```js
apply: (pl) => { pl.runBuffs.maxHp += 3; pl.recompute(); pl.hp = Math.min(pl.maxHp, pl.hp + 3); },
```
— `recompute()` runs *before* the hp adjustment, and the heal amount matches
the maxHp gain exactly (`+3` maxHp, `+3` current hp), not a full heal to max.
I'm using that exact, already-correct pattern for shrine's maxHp branch
instead: `pl.recompute()` first, then `pl.hp = Math.min(pl.maxHp, pl.hp + 4)`.

### Amendment 2 — don't full-heal on the maxHp roll (parity with the other three)

Beyond the ordering bug, systems' `pl.hp = pl.maxHp` is also the *wrong
value* even fixed: a full heal-to-max is a much bigger effect than the other
three shrine outcomes (+15% dmg, +10% speed, +10% cooldown) when a player
finds the shrine while badly hurt — it would make the maxHp roll the
obviously-best of the four 25% of the time, undercutting the "roughly equal
value, differentiated by type" parity systems themselves asked for across
shrine/storage/dining. Healing by the buff amount (+4, capped at the new
max) — exactly matching the level-up system's own "Tough Hide" convention —
keeps all four shrine outcomes in the same rough tier of value.

### Amendment 3 — the XP trickle currently fires whether or not the player ever visits the room

Systems' storage/dining branches call `game.addXP(6)` / `game.addXP(4)`
directly inside `spawnFloorEntities`. That function runs once, for every
room on the floor, at `loadFloor()` — **before** the player has moved at
all (`js/run.js:56-79`, "spawn every room's entities at once ... so entering
a room can wake just that room"). Side rooms are optional detours off the
critical path; a player can finish a floor never having set foot in a given
shrine/storage/dining room. Every other reward in the game — every coin,
heart, item, and the shrine's own buff-chest — requires physically walking
into the room and colliding with a pickup or opening a chest before it
pays out. A bare `game.addXP()` call in `spawnFloorEntities` breaks that
pattern silently: the player banks the side room's XP trickle for free, at
floor-load, regardless of whether they ever walk in. That's a real gap in
"was the detour worth it," not a rounding-error-sized nitpick — it quietly
removes part of the reason to visit.

Fix: gate the XP trickle on the existing first-visit signal,
`updateFloorGating()`'s `if (rm && !rm.seen) { rm.seen = true; ... }` block
(`js/run.js:181-187`) — this already fires exactly once, exactly when the
player's position resolves into that room for the first time, and needs
only three added lines, no new plumbing, no new primitive. The coin/heart
pickups themselves remain proximity-gated as-is (that part of systems'
proposal is already correct and unaffected by this change) — this only
moves the flat per-room XP grant from "always" to "on first entry."

---

## Final code — `spawnFloorEntities` (add to the existing `if/else if` chain in `js/run.js`, alongside `treasure`/`trap`)

```js
} else if (rm.type === "shrine") {
  const pos = room.randomFloorInRect(rm.rect);
  game.chests.push(new Chest(pos.x, pos.y, { shrine: true }));
} else if (rm.type === "storage") {
  for (let i = 0; i < 8; i++) {
    const pp = room.randomFloorInRect(rm.rect);
    game.pickups.push(new Pickup("coin", pp.x, pp.y));
  }
} else if (rm.type === "dining") {
  for (let i = 0; i < 4; i++) {
    const pp = room.randomFloorInRect(rm.rect);
    game.pickups.push(new Pickup("heart", pp.x, pp.y));
  }
}
```

(The `game.addXP` calls systems put here move to `updateFloorGating` below —
everything else is identical to their §7 proposal, same primitives, same
positioning pattern as the existing `treasure`/`trap` branches.)

## Final code — `updateFloorGating` (`js/run.js`), add to the existing first-visit block

```js
if (rm && !rm.seen) {
  rm.seen = true;
  for (const [a, b] of (room.edges || [])) {
    if (a === rm.id) { const n = room.roomById(b); if (n) n.seen = true; }
    else if (b === rm.id) { const n = room.roomById(a); if (n) n.seen = true; }
  }
  // Side rooms' small XP trickle pays out on first visit, not at floor load —
  // matches every other reward in the game (chest-open, pickup-collect) in
  // requiring the player to actually walk the detour, not just have it exist
  // on the generated floor.
  if (rm.type === "storage") game.addXP(6);
  else if (rm.type === "dining") game.addXP(4);
  else if (rm.type === "shrine") game.addXP(4);
}
```

## Final code — `Chest` (`js/entities.js`), shrine variant

```js
// entities.js — Chest constructor gains an optional opts param
constructor(x, y, opts = {}) {
  this.x = x; this.y = y; this.r = 12; this.opened = false;
  this.shrine = !!opts.shrine;
}

// open() gains a branch — needs the acting player, so open(game, player)
open(game, player) {
  if (this.opened) return;
  this.opened = true;
  if (this.shrine) {
    const pl = player || game.localPlayer;
    const SHRINE_BUFFS = [
      () => { pl.runBuffs.dmg *= 1.15; pl.recompute(); },
      () => { pl.runBuffs.speed *= 1.10; pl.recompute(); },
      () => { pl.runBuffs.maxHp += 4; pl.recompute(); pl.hp = Math.min(pl.maxHp, pl.hp + 4); },
      () => { pl.runBuffs.cd *= 0.9; pl.recompute(); },
    ];
    SHRINE_BUFFS[Math.floor(Math.random() * SHRINE_BUFFS.length)]();
    audio.chest();
    particles.burst(this.x, this.y - 14, { count: 14, colors: ["#ffd14a", "#fff3b8"], speed: 120, life: 0.5, gravity: -40 });
    return;
  }
  // ...existing coin/heart/item logic, unchanged, runs when !this.shrine
  audio.chest();
  particles.burst(this.x, this.y - 14, { count: 14, colors: ["#ffd14a", "#fff3b8"], speed: 120, life: 0.5, gravity: -40 });
  const coins = randi(4, 7);
  for (let i = 0; i < coins; i++) {
    game.pickups.push(new Pickup("coin", this.x + rand(-10, 10), this.y + rand(-6, 10)));
  }
  if (Math.random() < 0.5) {
    game.pickups.push(new Pickup("heart", this.x, this.y + 6));
  }
  if (game.hero && rollItem) {
    game.pickups.push(new Pickup("item", this.x, this.y + 6, rollItem({ floor: game.floor })));
  }
  game.addXP(4);
}
```

(Each `SHRINE_BUFFS` closure calls its own `pl.recompute()` immediately,
matching the existing `UPGRADES` convention of "recompute inside each
apply," rather than one trailing `recompute()` after the dispatch — this is
what fixes Amendment 1 without adding any new state.)

`js/draw.js`'s one call site needs the one-line change systems specified:
`ch.open(game)` → `ch.open(game, p)` (the chest-proximity loop already has
`p` in scope, `js/draw.js:124-128`).

**Touch points** (same set systems listed, plus `updateFloorGating`):
`js/run.js` (`spawnFloorEntities` — three new branches; `updateFloorGating`
— three-line addition to the existing `!rm.seen` block), `js/entities.js`
(`Chest` constructor + `open`, shrine branch), `js/draw.js` (one call site).

---

## Summary of exact values to implement

`js/state.js` `DUNGEONS`:

```js
catacombs.tiers:   [ {scale: 1.0, ...}, {scale: 2.8, ...}, {scale: 5.3, ...} ]
goblinMines.tiers: [ {scale: 1.1, ...}, {scale: 3.1, ...}, {scale: 5.8, ...} ]
crypt.tiers:       [ {scale: 1.2, ...}, {scale: 3.4, ...}, {scale: 6.3, ...} ]
```

All other fields on `tiers[]` (bossHp, bossDmg, bossName, summonKind, etc.)
unchanged — this spec only touches `scale`. If systems' §6 boss un-keying
lands in the same pass, apply both changes to the same `DUNGEONS` table
without reconciliation — §2 above already confirms they don't interact.

---

## Hand-offs

→ systems-design: `Boss.update()`'s summon spawns (`js/entities.js`, the
`new Skeleton(pos.x, pos.y, { kind, faction })` call inside the `summonCd`
branch) never pass `scale`, so boss-summoned adds are always baseline
toughness regardless of tier — noticed while checking the boss-HP table for
this spec, not part of my `scale` pullback either way, but worth a look
since it's the same code path.
→ graphics: no positioning coordination needed for the shrine chest — the
`candleShrine` vignette anchors to `corner`/`obstacle1x1`/`wallMid`
(`js/decor3d.js:206-214`), not a fixed room-center altar, so a randomly
floor-placed `Chest` (same `room.randomFloorInRect` pattern as every other
chest) won't compete with a specific decor anchor point; flagging only so
this isn't silently assumed compatible without a look once both land.
