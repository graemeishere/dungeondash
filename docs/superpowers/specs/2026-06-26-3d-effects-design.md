# 3D combat effects — design

## Context
`?3d` combat currently has no hit feedback: the 2D particle system
(`DD.particles` — hit/death bursts, dash puffs, floating damage numbers) draws
to the 2D canvas, which is now a HUD-only overlay, so none of it shows. The mage
bolt is still a flat billboard and there are no weapon trails. We're building a
real 3D effects system (user chose full real-3D over projecting the 2D layer).

## Components

### 1. 3D particle engine — `js/fx3d.js` (new, ESM)
- A pooled set of **additive, camera-facing glowing sprites** in the 3D scene.
  Each particle: world position, velocity (3D), life, size, colour, gravity, fade.
- One shared `THREE.SpriteMaterial` (AdditiveBlending, depthWrite off) with a
  soft radial-glow texture generated to a canvas in code. Cartoon-punchy look.
- Capacity-capped (~400) for mobile; oldest reused when full.
- API: `burst(world, opts)`, `spawn(...)`, `update(dt)`. Lives under `DD.fx3d`.

### 2. Bridge the existing triggers (reuse ~46 call sites)
- `DD.particles.burst(x, y, opts)` gains a 3D branch: when `DD.use3d` and
  `DD.fx3d` exists, convert the 2D pixel pos → world via
  `DD.render3d.cellToWorld(x/TILE, y/TILE)`, raised to ~chest height, and spawn
  3D particles with the same params (count/colours/speed/life/size/gravity →
  mapped to 3D: horizontal spread + a little vertical pop, gravity on Y).
- Existing 2D particle update/draw still runs for 2D mode; in 3D the 2D draw is
  simply not shown (HUD overlay only), so no double-render.

### 3. Damage numbers — floating screen text
- `DD.particles.text` entries are rendered on the HUD overlay in `drawCombat3D`:
  project each text's world point to screen (`DD.render3d.projectToScreen`) and
  draw it as rising 2D text. (Inherently 2D UI; reuses existing text spawns.)

### 4. Marquee effects (real 3D)
- **Mage bolt** (`projectile.kind === "bolt"`): a glowing emissive orb (small
  sphere + additive glow sprite) with a short particle trail, in mage purple —
  replaces the billboard. Rendered/placed like the 3D arrow path.
- **Spell impact**: on bolt explode (`splash`), spawn an expanding additive ring
  + flash + particle burst at the impact point.
- **Melee weapon trail**: during a player swing (`lockT`/swing window), emit a
  brief curved additive arc/ribbon following the weapon (approximated from the
  aim direction + a short-lived trail of fading sprites).
- **Hit / muzzle flash**: a quick bright flash sprite at hit/shot points (via the
  burst bridge plus a one-frame flash).

### 5. Integration
- `DD.fx3d` created in the 3D boot (`index.html`), updated each frame in
  `game.js drawCombat3D` with `lastDt`, rendered in the 3D scene.
- Orb/impact/trail driven from existing projectile + swing state in
  `drawCombat3D` (same pattern as characters/items/arrows).
- 2D mode unchanged.

## Critical files
- `js/fx3d.js` (new) — particle engine + glow texture + marquee effect helpers.
- `js/particles.js` — `burst`/`text` gain the 3D bridge.
- `js/render3d.js` — bolt-orb model/mesh + impact ring helpers (or in fx3d using
  the renderer's scene + `cellToWorld`/`projectToScreen`).
- `js/game.js` — `drawCombat3D`: update fx3d, render bolt orbs, weapon trails,
  damage-number overlay.
- `index.html` — boot: create `DD.fx3d`.

## Reuse
- `DD.particles` call sites (~46) — bridged, not re-wired.
- `DD.render3d.cellToWorld` / `projectToScreen` for world↔screen.
- The arrow/item rendering pattern in `render3d.js`/`drawCombat3D` for the orb.

## Staging (each deployable)
1. Particle engine + burst bridge + damage numbers → restores all feedback in 3D.
2. Mage bolt orb + spell impact.
3. Melee weapon trail.

## Verification
- `?3d&dev=combat`: hitting enemies shows 3D sparks + floating damage numbers;
  deaths burst; dash puffs. `&class=mage` fires a glowing orb that bursts with a
  ring on impact. Melee classes show a swing trail. FPS holds on mobile.
- 2D mode (no `?3d`) unchanged.
- Redeploy to GitHub Pages; incognito for fresh cache.
