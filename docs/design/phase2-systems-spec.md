# Phase 2 — Progression Correctness: Systems Spec

Owner: systems-design. Produced 2026-08-02, against the current post-Phase-0/1
tree (module split done, traversal unified onto `js/floor.js` +
`spawnFloorEntities`). This is a **spec**, not a patch — implementation happens
in a later pass. All references are by symbol name; re-read the file before
editing, since line numbers drift.

Do not touch: `js/floor.js` tile-carving (`carveRect`, `carveRoomFeatures`,
`trapSpikes`) or the `tiers[].scale` values themselves — that pullback is
level-design's joint call on Tier-3 HP-sponginess. This spec's boss-HP formula
(§6) is written to keep working unmodified if `scale` changes later.

---

## 1. Reward scaling (headline)

**Where:** `Skeleton` constructor in `js/entities.js` (the `baseHp`/`hp`
block, and the `xpValue`/`coinDrop` block directly below it). `Boss extends
Skeleton` constructor, same file. `Boss` instantiation in
`spawnFloorEntities()`, `js/run.js`.

### Skeleton: scale `xpValue` and `coinDrop` exactly like `hp` already is

Today: `this.hp = Math.round(baseHp * scale)` but `this.xpValue` /
`this.coinDrop` are assigned straight from the per-kind table with no `scale`
term at all. Fix: apply `scale` to the *result* of the existing per-kind
formula, before the veteran/elite grade multiplier (which already runs after
and is unaffected):

```js
const baseXpValue = opts.xpValue ?? ( /* existing per-kind ?: chain, unchanged */ );
this.xpValue = Math.max(1, Math.round(baseXpValue * scale));

const baseCoinDrop = opts.coinDrop ?? ( /* existing per-kind ?: chain, unchanged */ );
this.coinDrop = [
  Math.max(0, Math.round(baseCoinDrop[0] * scale)),
  Math.max(1, Math.round(baseCoinDrop[1] * scale)),
];
// grade multiplier block (veteran ×1.6 dmg-only today / elite xp×2, coin+flat)
// stays exactly as-is, now operating on the scaled values above.
```

Because `opts.xpValue`/`opts.coinDrop` (used by `Boss`, see below) are passed
explicitly and `Boss` never sets `opts.scale`, `scale` defaults to `1` for
those calls — no double-scaling.

### Worked numbers — Catacombs, "melee" skeleton (`baseHp=6`, `baseXpValue=5`, `baseCoinDrop=[1,3]`)

Using a **tier-appropriate** character (the level a player has when a tier
*first* unlocks — `TIER_REQ = [1, 11, 21]` in `js/state.js` — with 0 attribute
points spent, i.e. the floor of investment, `deriveStats` dmg formula
`dmg = 3 + (lvl-1)*0.15`), melee is an instant-hit cone so
`TTK = (hits-1) * cooldown` with `hits = ceil(hp/dmg)`, `cooldown = 0.5`:

| Tier | scale | lvl | dmg | enemy HP | hits | TTK | xpValue (old→new) | XP/sec (old→new) |
|---|---|---|---|---|---|---|---|---|
| 0 | 1.0 | 1  | 3.0 | 6  | 2 | 0.5s | 5 → 5  | 10 → 10 |
| 1 | 3.0 | 11 | 4.5 | 18 | 4 | 1.5s | 5 → 15 | 3.3 → 10 |
| 2 | 6.0 | 21 | 6.0 | 36 | 6 | 2.5s | 5 → 30 | 2.0 → 12 |

The fix takes XP/sec from **10 → 3.3 → 2.0** (today, collapsing hard) to
**10 → 10 → 12** (flat-to-slightly-rising). Coin follows the same shape:
`coinDrop` avg 2 → scaled avg 2/6/12, gold/sec **4 → 4 → 4.8** (was 4 → 1.3 →
0.9). This is the audit's own worked TTK table (`audit-systems.md` "What's
rough" #1), now closed.

**Farm-vs-progress check** (the actually degenerate case): a level-21, full-might
character (`effDmg=16`, per the audit's own worked example) farming Tier 0 vs
playing Tier 2:
- Tier 0: `hits=ceil(6/16)=1`, TTK≈0 (cooldown-limited pace, 0.5s/kill) →
  2 kills/sec × 5 xp = **10 xp/sec**.
- Tier 2: `hits=ceil(36/16)=3`, TTK=1.0s → 1 kill/sec × 30 xp = **30 xp/sec**.

Tier 2 is now **3× more efficient** than farming the out-levelled Tier 0,
where before it was strictly worse forever. This is the fix that matters.

### Boss: `xpValue`/`coinDrop` as a function of `scale`, not hardcoded

`Boss` constructor currently hardcodes `xpValue: 40, coinDrop: [12, 18]`
regardless of the tier-scaled `hp`/`dmg` it receives via `opts`. Fix — treat
40/[12,18] as the **Tier-0 baseline** and scale them the same way Skeleton
now does:

```js
const BOSS_BASE_XP = 40;
const BOSS_BASE_COIN = [12, 18];

export class Boss extends Skeleton {
  constructor(x, y, opts = {}) {
    const scale = opts.scale || 1;
    const xpValue = opts.xpValue ?? Math.round(BOSS_BASE_XP * scale);
    const coinDrop = opts.coinDrop ?? [
      Math.round(BOSS_BASE_COIN[0] * scale),
      Math.round(BOSS_BASE_COIN[1] * scale),
    ];
    super(x, y, { big: true, faction: opts.faction, hp: opts.hp ?? 70,
      speed: 55, dmg: opts.dmg ?? 2, xpValue, coinDrop,
      roomId: opts.roomId, frozen: opts.frozen });
    ...
```

`spawnFloorEntities()`'s `Boss` call (the `rm.type === "boss"` branch in
`js/run.js`) needs one added field: `scale: cfg.scale` alongside the existing
`hp: cfg.bossHp, dmg: cfg.bossDmg, ...`.

Catacombs result: tier0 `scale=1.0` → xp 40, coin [12,18] (**unchanged from
today** — no regression at the tier the numbers were already tuned for);
tier1 `scale=3.0` → xp 120, coin [36,54]; tier2 `scale=6.0` → xp 240, coin
[72,108].

### Boss slam: route through `this.dmg`, not the literal `2`

`Boss.update()`'s telegraphed slam (`this.slamT <= 0` branch) calls
`p.damage(2, this.x, this.y, game)` — hardcoded regardless of tier. Change to
`p.damage(this.dmg, this.x, this.y, game)`. `this.dmg` is already the
tier-scaled `cfg.bossDmg` (Skeleton's constructor sets `this.dmg = opts.dmg ??
...` and `Boss` always passes `opts.dmg` non-null), so no other change is
needed — the boss's other melee-contact damage (inherited `windup` state)
already uses `this.dmg` correctly today; only the slam was the outlier.
(Do not touch the *other* hardcoded `2`/`3` in `Skeleton.explodeNow` — that's
the bomber-kind self-destruct, a different enemy, out of scope here.)

**Touch points:** `js/entities.js` (`Skeleton` constructor, `Boss`
constructor, `Boss.update`), `js/run.js` (`spawnFloorEntities`'s `boss`
branch — add `scale: cfg.scale`).

---

## 2. `effDmg()` rounding dead zones

**Where:** `Player.effDmg()`, `js/entities.js`.

Today: `Math.max(1, Math.round(this.stats.dmg))` — every other point of
flat-`+0.5`-per-point investment (might, or a `×1.3`-style upgrade at low
base) rounds away to nothing.

Fix: replace the single `round()` with a **fractional carry accumulator**
(Bresenham-style error diffusion) on the `Player` instance, so damage output
converges to the true fractional value over consecutive hits instead of
snapping every single one:

```js
// Player constructor: add
this._dmgAcc = 0;

effDmg() {
  const raw = this.stats.dmg;
  this._dmgAcc += raw;
  let dealt = Math.floor(this._dmgAcc);
  if (dealt < 1) dealt = 1;                 // never 0 or negative, by construction
  this._dmgAcc = Math.max(0, this._dmgAcc - dealt);
  // crit multiplier layer — see §3 (Rogue) and the "Lucky Strikes" upgrade in §4
  let crit = false;
  if (this.dashCritT > 0) { crit = true; this.dashCritT = 0; }
  else if (this.stats.critChance && Math.random() < this.stats.critChance) crit = true;
  if (crit) dealt *= 2;
  return dealt;
}
```

Worked check against the audit's own example, `raw = 3.5` (Warrior base 3 +
one might point): sequence of `dealt` across successive hits is
`3, 4, 3, 4, 3, 4, ...` — average **3.5**, exactly matching `raw`. Compare to
today's flat `round(3.5) = 4` every time (over-delivers) or the *next* point,
`raw = 4.0` → flat `4` forever with the *previous* point having contributed
nothing (the audit's literal dead-zone case) — the accumulator no longer has
that discontinuity: investment is smoothed rather than gated on hitting the
next whole number.

**Correctness of the "never 0/negative" guarantee:** `dealt` is explicitly
clamped to `Math.max(dealt, 1)` before it is ever returned or used to update
the accumulator — there is no code path that returns the raw `Math.floor`
result. The clamp fires only when `_dmgAcc < 1`, which self-corrects on the
next call (adds `raw ≥ 2`, since no class/upgrade combination in `CLASSES` or
`UPGRADES` can currently produce `stats.dmg < 2`); note in code that this
invariant (`stats.dmg` never near-zero) is what keeps the accumulator from
drifting into permanent debt, in case a future debuff-type upgrade is added.

This function is the single choke point for all player damage (melee cone
loop and both projectile kinds already call `this.effDmg()`), so this is a
one-function fix. Note for multi-target melee cleaves: `effDmg()` is called
once per enemy hit inside `performAttack`'s cone loop, so a single swing that
cleaves 3 enemies advances the accumulator 3 times in one frame (and, if the
Rogue's dash-crit window is active, only the *first* enemy resolved in that
loop consumes it) — this is intended, not a bug: the smoothing is per damage
instance, and "next attack" for a cleave naturally means "the first target
you connect with."

**Touch points:** `js/entities.js` — `Player` constructor (add `_dmgAcc`,
`dashCritT` fields), `Player.effDmg()`, `Player.recompute()` (add
`this.stats.critChance = r.critChance;`, unconditional — see §4).

---

## 3. Sharpened Edge vs. Quick Hands

**Where:** `UPGRADES` array, `js/entities.js`.

DPS ≈ `effDmg / cooldown`. Per stack: Sharpened Edge multiplies the numerator
by `1.3`; Quick Hands multiplies the attack rate by `1/0.8 = 1.25`. `1.3 >
1.25` on every stack, with no offsetting downside for damage, while cooldown
additionally hits a hard floor (`Math.max(0.08, ...)` in
`Player.recompute()`) — dmg has no comparable ceiling. Fix: **retune
Sharpened Edge's multiplier from `×1.3` to `×1.25`**, exactly matching Quick
Hands' per-stack DPS multiplier.

```js
{ id: "dmg", name: "Sharpened Edge", desc: "+25% damage",
  apply: (pl) => { pl.runBuffs.dmg *= 1.25; pl.recompute(); } },
```

**DPS-ratio proof of parity:**
- Dmg stack: `DPS' = (effDmg × 1.25) / cooldown = 1.25 × DPS`.
- Cooldown stack: `DPS' = effDmg / (cooldown × 0.8) = (1/0.8) × DPS = 1.25 × DPS`.

Identical instantaneous per-stack value — neither strictly dominates. What
remains is a legitimate (not accidental) asymmetry: cooldown stacking hits a
hard wall (`0.5 × 0.8^n ≥ 0.08 → n ≤ 8`, so roughly 8 stacks from a 0.5s base
before Quick Hands literally does nothing), while damage keeps compounding
indefinitely. That's a real tradeoff a player can reason about (front-load
cooldown, then switch to damage), not a silent trap — leave as-is; it's the
kind of differentiation decision 14/§4 below is trying to create elsewhere,
not a defect to also fix here.

**Touch points:** `js/entities.js` — `UPGRADES[0]` (`id: "dmg"`) `desc` and
`apply`.

---

## 4. Widening the upgrade pool

**Decision:** widen the shared pool (add 2 universal upgrades) **and** add 4
class-gated upgrades (one per class), filtering the *draw* by
`game.players[0].classKey`. This crosses the fewest co-op wires: the host
still draws exactly 3 ids and sends `{ t: "lvl", ids }` unchanged
(`openLevelUp` in `js/overlays.js`); the guest still resolves those same ids
via `UPGRADES.find(u => u.id === id)` unchanged (`js/coop.js`'s `"lvl"`
handler) and applies to its own `Player`. No new message type, no schema
change.

The one thing that must hold for this to be safe: a class-gated upgrade's
`apply()` must never throw or corrupt state if applied to a *different*
class's `Player` (this can only happen in the already-accepted co-op edge
case where the host is class A and the guest is class B and somehow receives
an id gated to A — see below for why this is inert, not a new defect).
`Player.recompute()` already only writes a derived field when the class's
`baseStats` defines the underlying key (`if (b.range !== undefined) ...`) —
the same pattern the existing "reach" upgrade relies on to be safe across
attack types. Every class-gated upgrade below is written to the same rule:
it only ever writes a `runBuffs` field that either (a) exists unconditionally
on every `Player` (e.g. `armor`, `dashCritWindowBonus`, `pierce`), or (b) is
only read by `recompute()`/gameplay code when the *matching* class field is
present — so a mismatched apply is a harmless, silent no-op, never a crash.
This is an accepted quirk of the parked co-op feature (per decision 3/12),
not something to design further around.

```js
export function openLevelUp() {
  game.state = "levelup";
  audio.levelup();
  const pl = game.players[0];
  const pool = UPGRADES.filter((u) => !u.classKey || u.classKey === pl.classKey);
  const picks = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  ...
}
```

### New universal upgrades (no `classKey`, added to every draw)

| id | name | desc | apply |
|---|---|---|---|
| `crit` | Lucky Strikes | +15% chance to deal double damage | `pl.runBuffs.critChance = Math.min(0.9, (pl.runBuffs.critChance ?? 0) + 0.15); pl.recompute();` |
| `evade` | Evasive Reflexes | +0.15s invulnerability after being hit | `pl.runBuffs.iframeBonus = (pl.runBuffs.iframeBonus ?? 0) + 0.15; pl.recompute();` |

Requires: `runBuffs` init object (`Player` constructor) gains
`critChance: 0, iframeBonus: 0`. `recompute()` gains
`this.stats.critChance = r.critChance;` and `this.iframeBonus = r.iframeBonus;`
(same section as `this.maxHp`/`this.killHeal`). `effDmg()` consults
`this.stats.critChance` (spec'd in §2). `Player.damage()`'s
`this.iframes = 0.9;` becomes `this.iframes = 0.9 + this.iframeBonus;`.

### New class-gated upgrades (one per class, `classKey` field added to the upgrade object)

| id | name | classKey | desc | apply |
|---|---|---|---|---|
| `warriorArmor` | Shield Wall | `warrior` | Take 1 less damage from every hit (min 1 dealt) | `pl.runBuffs.armor = (pl.runBuffs.armor ?? 0) + 1; pl.recompute();` |
| `rogueOpener` | Extended Reflexes | `rogue` | +0.3s to the post-dash strike window | `pl.runBuffs.dashCritWindowBonus = (pl.runBuffs.dashCritWindowBonus ?? 0) + 0.3; pl.recompute();` |
| `mageOverload` | Volatile Bolts | `mage` | +50% splash radius | `pl.runBuffs.splash *= 1.5; pl.recompute();` |
| `rangerBroadhead` | Broadhead Arrows | `ranger` | +2 pierce | `pl.runBuffs.pierce += 2; pl.recompute();` |

`Shield Wall` gives Warrior's "heavy armor" flavor (`CLASSES.warrior.desc`)
an actual mechanical payoff it doesn't have today (per audit finding #5:
player damage taken is flat subtraction with no mitigation stat at all).
Requires: `runBuffs` init gains `armor: 0`; `recompute()` gains
`this.armor = r.armor ?? 0;`; `Player.damage(n, ...)` becomes
`const dealt = Math.max(1, n - this.armor); this.hp -= dealt;` (keep the
`-${n}` particle text showing the post-armor `dealt` value, not the raw `n`).

`rogueOpener` is defined jointly with §5 below (it stacks the post-dash
window's duration, not its multiplier).

### Pool-size / convergence math

Per class, eligible pool size is now 6 (universal, existing ids) + 2
(universal, new) + 1 (that class's own gated card) = **9**, up from 6.
`P(dmg NOT drawn in a 3-of-N draw) = C(N-1,3)/C(N,3)`:
- Before: `C(5,3)/C(6,3) = 10/20 = 50%` → dmg offered 50% of level-ups.
- After: `C(8,3)/C(9,3) = 56/84 = 66.7%` → dmg offered **33.3%** of level-ups.

Over a 29-level-up career, expected "Sharpened Edge is on the table" count
drops from ~14.5 to **~9.7**, and per §3 it's no longer the strictly-correct
pick even when offered — between the dilution and the DPS-tie, a 30-level
run should no longer read as "did I see Sharpened Edge" for half its choices.

**Touch points:** `js/entities.js` (`UPGRADES` array — 6 new entries, plus
the `classKey` field convention), `js/overlays.js` (`openLevelUp`'s pool
line only — `chooseUpgrade`, `guestUpgradePicked`, and the `"lvl"`/`"pick"`
wire messages in `js/coop.js` are unchanged).

---

## 5. Rogue identity (decision 14)

**Where:** `Player` class, `js/entities.js` — the dash-trigger and
dash-movement blocks inside `update()`, plus `effDmg()` (§2).

**Mechanic chosen: post-dash crit window** (decision log's option (b)).
Rationale: a bigger i-frame number is "a number retune" (Rogue's dash
already grants 0.3s of i-frames against a 0.16s dash duration — there's
already a small, un-intentional 0.14s trailing grace baked in; just growing
that number doesn't read as a new mechanic). A crit window is a genuinely new
state machine (a timer that arms on dash-end and is consumed on the next
hit) and converts "I used my mobility to close distance" directly into
"my next strike lands harder" — matching Rogue's "lightning-fast stabs" /
hit-and-run fantasy better than more passive survivability would.

### Exact spec

New `Player` field: `this.dashCritT = 0;` (constructor).

In `update()`'s existing dash-movement block (`if (this.dashT > 0) { ... }`),
add an end-of-dash trigger:

```js
if (this.dashT > 0) {
  this.dashT -= dt;
  room.moveEntity(this, this.dashDir.x * 620 * dt, this.dashDir.y * 620 * dt);
  particles.burst(...);                 // existing
  if (this.dashT <= 0 && this.stats.dash) {
    this.dashCritT = 0.6 + (this.dashCritWindowBonus || 0); // window to land the bonus
  }
}
```

Decrement alongside the other per-frame timers (`attackCd`, `iframes`,
`swingT`, `dashCd`): `if (this.dashCritT > 0) this.dashCritT -= dt;`.

`effDmg()` consumes it (already spec'd in §2): if `this.dashCritT > 0` at the
moment of a hit, that hit is doubled and `this.dashCritT` is zeroed
immediately — a one-shot "opener strike" bonus, not a sustained buff, so it
doesn't scale unpredictably with attack-speed upgrades. Base window: **0.6s**
from dash-end to land a hit (roughly one Rogue attack at retuned cooldown —
see below — with margin for travel/aim). `rogueOpener` (§4) extends the
window by `+0.3s` per stack (more reaction time, not more damage — bounded,
no runaway).

This is additive to the existing 0.3s dash i-frames (`this.iframes =
Math.max(this.iframes, 0.3)`) — unchanged, left alone. The two mechanics
now read as: dash grants brief safety *through* the mobility use, and reward
*after* it lands.

### Base numbers: yes, retune cooldown; leave damage alone

Flag from the audit: Rogue's `cooldown: 0.51` is *slower* than Warrior's
`0.50` despite "Lightning-fast stabs" flavor — a ~2% miss that reads as a
typo, not a deliberate tradeoff (unlike `dmg: 2` vs Warrior's `3`, which *is*
a legitimate power-for-speed trade and should stay). Retune:

```js
rogue: { ..., dmg: 2, cooldown: 0.42, ... }   // was cooldown: 0.51
```

**DPS sanity check** (no crit factored in): Warrior `3/0.5 = 6.0 DPS`;
Rogue `2/0.42 ≈ 4.76 DPS` — still lower baseline than Warrior (consistent
with Warrior's higher per-hit power and wide cleave arc), but now genuinely
faster-attacking as the flavor claims, and the higher attack frequency also
means more rolls per second against any per-hit-chance effect (Lucky
Strikes, Soul Siphon), which is a real, class-appropriate synergy Warrior
doesn't get as much of.

**With the dash-crit window factored in** (one doubled hit roughly every
dash cooldown, 1.6s): average bonus ≈ `+2 dmg / 1.6s ≈ +1.25 DPS`, bringing
sustained Rogue DPS to **≈6.0**, on par with Warrior's 6.0 — parity on
raw output, achieved through an active mechanic instead of a passive stat,
while Rogue still trails on HP (8 vs 12), melee range (34 vs 46) and cone
width (1.5 vs 2.4 rad) — a real mobility/burst-vs-durability/cleave
tradeoff instead of the current "worse at everything" spread.

**Touch points:** `js/entities.js` — `CLASSES.rogue.cooldown` (0.51 → 0.42),
`Player` constructor (`dashCritT` field), `Player.update()` (dash-end
trigger + decrement), `Player.effDmg()` (already spec'd in §2),
`UPGRADES` (`rogueOpener`, §4).

---

## 6. Boss escalation (decision 13) — joint with level-design (geometry/HP-pullback) and narrative (names)

**Where:** `DUNGEONS` table and `dungeonFloorCfg()`, `js/state.js`.

Today `bossHp`/`bossDmg`/`bossName` live on `tiers[]` only — every floor of a
dungeon+tier fights the numerically and nominally identical boss. Un-key
them to `floors[]` while keeping `tiers[]`'s existing (already-tuned) values
meaningful, so this is a low-regression change:

### Data shape

- **Keep `tiers[t].bossHp` exactly as it is today** (70/160/280 for
  Catacombs, etc.) — reinterpret it as *floor 2's* (the dungeon's final
  floor) boss HP at that tier, since floor 2 was always what got fought
  hardest/last anyway. **Remove `tiers[t].bossDmg`** — damage moves to
  `floors[]` (see below; the numbers are too small/coarse for a clean ratio
  formula to survive rounding without collapsing floors together).
- Add a module-level constant, `js/state.js`:
  `const BOSS_HP_RATIO = [0.6, 0.8, 1.0];` (indexed by floor index 0/1/2) —
  shared across all dungeons; a dungeon can override with its own
  `d.bossHpRatios` array if it ever needs a different shape.
- Add to each `floors[i]` entry: `bossDmg: [d0, d1, d2]` (one literal integer
  per tier — hand-set, see the worked table below) and `bossName: null`
  (placeholder; narrative fills in per floor; falls back to `tier.bossName`
  until then, so nothing breaks pre-narrative-pass).

```js
export function dungeonFloorCfg() {
  const d = DUNGEONS[game.dungeonId] || DUNGEONS.catacombs;
  const floorIdx = Math.min(game.floor, d.floors.length - 1);
  const tierIdx  = Math.min(game.tier, d.tiers.length - 1);
  const flr = d.floors[floorIdx];
  const tier = d.tiers[tierIdx];
  const ratio = (d.bossHpRatios || BOSS_HP_RATIO)[floorIdx];
  return {
    ...flr, ...tier,
    faction: d.faction, enemyLabel: d.enemyLabel, id: d.id,
    multiFaction: !!d.multiFaction, bossFaction: d.bossFaction || null,
    bossHp: Math.round(tier.bossHp * ratio),
    bossDmg: flr.bossDmg[tierIdx],
    boss: flr.bossName || tier.bossName, // narrative fills flr.bossName per floor
  };
}
```

Note the explicit `bossHp`/`bossDmg`/`boss` keys are listed *after* the
`...tier` spread in the object literal, so they correctly win over the raw
(now floor-2-only-meaningful) `tier.bossHp` value. No other call site
changes: `spawnFloorEntities()`'s `new Boss(cx, cy, { hp: cfg.bossHp, dmg:
cfg.bossDmg, name: cfg.boss, ... })` in `js/run.js` reads the same property
names it already does today (plus the `scale: cfg.scale` addition from §1).

### Worked numbers — Catacombs (today: flat 70/160/280 HP, 2/4/7 dmg per tier, all 3 floors identical)

**bossHp** = `round(tier.bossHp × BOSS_HP_RATIO[floor])`:

| | Floor 0 (×0.6) | Floor 1 (×0.8) | Floor 2 (×1.0, unchanged anchor) |
|---|---|---|---|
| Tier 0 (`bossHp:70`) | 42 | 56 | **70** (= today) |
| Tier 1 (`bossHp:160`) | 96 | 128 | **160** (= today) |
| Tier 2 (`bossHp:280`) | 168 | 224 | **280** (= today, satisfies "keep the endgame number") |

Escalation is now visible both floor-to-floor within a tier (42→56→70 at
Tier 0) and tier-to-tier for a fixed floor (42→96→168 at floor 0), and the
previously-tuned endpoint of *every* tier (not just Tier 2) is preserved
exactly, since floor 2's ratio is 1.0 by construction — this is a
low-regression-risk change: nothing that was already tuned moves.

**bossDmg** (hand-set per floor per tier; too coarse for the ratio formula):

| | Floor 0 | Floor 1 | Floor 2 (anchor, = today) |
|---|---|---|---|
| Tier 0 (today: 2) | 1 | 2 | **2** |
| Tier 1 (today: 4) | 3 | 3 | **4** |
| Tier 2 (today: 7) | 5 | 6 | **7** |

`floors[]` entries become:
```js
floors: [
  { name: "Upper Catacombs", ..., bossDmg: [1, 3, 5], bossName: null },
  { name: "Deep Catacombs",  ..., bossDmg: [2, 3, 6], bossName: null },
  { name: "Catacombs Core",  ..., bossDmg: [2, 4, 7], bossName: null },
],
tiers: [
  { tier: 0, ..., bossHp: 70,  bossName: "SKELETON KING" },   // bossDmg removed
  { tier: 1, ..., bossHp: 160, bossName: "SKELETON KING" },
  { tier: 2, ..., bossHp: 280, bossName: "SKELETON KING" },
],
```

**Same recipe, other two dungeons** (bossHp via the shared ratio formula —
no hand-tuning needed; bossDmg hand-set the same way, anchored at floor 2 =
today's flat per-tier value):

Goblin Mines bossHp (today 80/175/300): floor0 = 48/105/180, floor1 =
64/140/240, floor2 = 80/175/300 (unchanged). bossDmg: floor0 `[1,3,6]`,
floor1 `[2,4,7]`, floor2 `[2,5,8]` (today's values).

Crypt bossHp (today 90/190/320): floor0 = 54/114/192, floor1 = 72/152/256,
floor2 = 90/190/320 (unchanged). bossDmg: floor0 `[1,3,6]`, floor1
`[2,4,7]`, floor2 `[3,5,9]` (today's values).

**Narrative placeholder:** `floors[i].bossName` is left `null` above on
purpose — narrative supplies the actual per-floor names (e.g. floor 0/1 of
Catacombs might be "lesser" named threats, floor 2 keeps "SKELETON KING").
Do not invent names here.

→ level-design: this HP/dmg shape assumes `tiers[].scale` (used for regular
enemies, §1) is unchanged; if the Tier-3 HP-sponge pullback changes `scale`,
the `tiers[].bossHp` anchor values above may want a joint revisit — they were
*not* derived from `scale` (bosses already had their own hand-tuned,
gentler ratio across tiers, e.g. Catacombs boss HP goes ×4 across tiers
while `scale` goes ×6), so a `scale` change doesn't automatically break this
table, but it's worth eyeballing together once geometry lands.

**Touch points:** `js/state.js` — `DUNGEONS` (`floors[]` gains `bossDmg`
array + `bossName` placeholder per floor; `tiers[]` loses `bossDmg`),
`dungeonFloorCfg()`, new `BOSS_HP_RATIO` constant.

---

## 7. Side rooms (decision 9) — joint with level-design (writes the `spawnFloorEntities` branches)

**Where:** definitions below are written to be dropped directly into
`spawnFloorEntities()` in `js/run.js`, alongside the existing `treasure`/
`trap` branches (same `room.randomFloorInRect(rm.rect)` positioning
pattern already used there). `SIDE_TYPES` in `js/floor.js` already includes
`shrine`/`storage`/`dining`; nothing there needs to change — only the
missing `spawnFloorEntities` branches and (for shrine) one small `Chest`
extension in `js/entities.js`.

Design goal: each of the three gives a **distinct payoff type**, all
noticeably smaller than treasure's 3-chest jackpot (treasure stays the
premium side room — that's intentional, not a gap), so no side room strictly
dominates another (players can't choose which they get, so rough parity of
"a detour was worth it" matters more than exact numeric balance).

### Shrine — permanent-for-the-run stat buff

Spawn exactly one buff-flavored chest via a small `Chest` extension:

```js
// entities.js — Chest constructor gains an optional third param
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
      () => { pl.runBuffs.dmg *= 1.15; },
      () => { pl.runBuffs.speed *= 1.10; },
      () => { pl.runBuffs.maxHp += 4; pl.hp = pl.maxHp; },  // set after recompute below
      () => { pl.runBuffs.cd *= 0.9; },
    ];
    SHRINE_BUFFS[Math.floor(Math.random() * SHRINE_BUFFS.length)]();
    pl.recompute();
    audio.chest();
    particles.burst(...);       // existing chest-open VFX, reused
    return;
  }
  // ...existing coin/heart/item logic, unchanged, runs when !this.shrine
}
```

`js/draw.js`'s one call site (`ch.open(game)` in the chest-proximity loop)
needs updating to `ch.open(game, p)` so the acting player is known — the
loop already has `p` in scope.

`spawnFloorEntities()` shrine branch: `game.chests.push(new Chest(pos.x,
pos.y, { shrine: true }))` (one per shrine room) + `game.addXP(4)` on room
spawn (matches the small per-side-room XP trickle below).

Buff magnitudes (15%/10%/+4hp/10%) are deliberately smaller than the
matching level-up `UPGRADES` picks (25%/15%/+3hp-heal-3/20%) — a shrine is a
free bonus on top of the level-up system, not a replacement for it.

### Storage — guaranteed gold, no chest ritual

Mirrors the existing `trap` room's scattered-`Pickup` pattern (no `Chest`
needed — storage reads as "already-open crates," distinct from treasure's
"chests to open"):

```js
} else if (rm.type === "storage") {
  for (let i = 0; i < 8; i++) {
    const pp = room.randomFloorInRect(rm.rect);
    game.pickups.push(new Pickup("coin", pp.x, pp.y));
  }
  game.addXP(6);
}
```

8 guaranteed coins (no RNG on count, unlike treasure's per-chest 4-7 roll) +
6 XP. Smaller than treasure's ~16-21 coins, but guaranteed and instant.

### Dining — guaranteed healing

```js
} else if (rm.type === "dining") {
  for (let i = 0; i < 4; i++) {
    const pp = room.randomFloorInRect(rm.rect);
    game.pickups.push(new Pickup("heart", pp.x, pp.y));
  }
  game.addXP(4);
}
```

4 hearts (`Pickup("heart", ...)` already heals `+2 HP` on collect, capped at
`maxHp`, in `Pickup.collect()`) = up to +8 HP if the player is missing that
much, +4 XP. The only side room that trades gold/power for sustain — useful
specifically when a player is low, situationally the best of the three.

**Rough value comparison** (so none dominates): treasure ≈ 16-21 coin + 1-2
hearts + 3 guaranteed item rolls + 12 XP (unchanged, stays the jackpot);
storage ≈ 8 coin + 6 XP; dining ≈ up to 8 HP + 4 XP; shrine ≈ one permanent
run buff + 4 XP. Each of the three is worth roughly the same "small but
real" tier, differentiated by type (gold / healing / build power) rather
than by magnitude, so whichever one the generator hands the player reads as
a fair, distinct detour instead of a lottery for the one good room.

**Touch points:** `js/run.js` (`spawnFloorEntities` — new `shrine`/
`storage`/`dining` branches), `js/entities.js` (`Chest` constructor + `open`
gain the `shrine` branch and a `player` param), `js/draw.js` (one call site,
`ch.open(game)` → `ch.open(game, p)`).

---

## Summary of touch points by file

- `js/entities.js` — `Skeleton` ctor (§1 scale xp/coin), `Boss` ctor (§1
  scale, §6 no change needed beyond §1), `Boss.update` (§1 slam → `this.dmg`),
  `Player` ctor (§2 `_dmgAcc`, §5 `dashCritT`, §4 runBuffs fields), `Player.
  effDmg` (§2, crit layer), `Player.recompute` (§4 new stat passthroughs),
  `Player.update` (§5 dash-end trigger), `Player.damage` (§4 armor, iframe
  bonus), `CLASSES.rogue.cooldown` (§5), `UPGRADES` (§3 retune, §4 six new
  entries), `Chest` (§7 shrine variant).
- `js/state.js` — `DUNGEONS` (§6 `floors[].bossDmg`/`bossName`,
  `tiers[].bossDmg` removed), `dungeonFloorCfg()` (§6), new `BOSS_HP_RATIO`.
- `js/run.js` — `spawnFloorEntities` (§1 `scale` on Boss opts, §7 three new
  branches).
- `js/overlays.js` — `openLevelUp` (§4 classKey filter only).
- `js/draw.js` — one call site (§7 `ch.open(game, p)`).

No changes needed in `js/coop.js`, `js/net.js`, or the `"lvl"`/`"pick"` wire
protocol for any of the above.

## Hand-offs

→ level-design: §6's boss-HP ratio table assumes today's `tiers[].scale`
values; revisit together once the Tier-3 HP-sponge pullback lands.
→ level-design: §7's three `spawnFloorEntities` branches are fully specified
above (primitives, counts, exact code) — ready to write directly, no new
primitives needed.
→ narrative: §6 leaves `floors[i].bossName` as a placeholder (`null`) on
every floor of every dungeon — needs 9 names (3 dungeons × 3 floors) or a
smaller set if floor 0/1 reuse a "herald" naming pattern before the tier-2
name; either way, don't leave the fallback (`tier.bossName`, i.e. today's
single reused name) as the shipped state.
