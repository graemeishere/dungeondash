# Scope: Moving Dungeon Dash to 3D (Kenney Modular Dungeon Kit)

*Scoping only — no code committed yet. Drafted 2026-06-20.*

## Decisions locked in

| Question | Answer |
|---|---|
| Goal | **Path A — truly 3D** via a WebGL renderer (three.js). Keep gameplay logic, rewrite the view layer. |
| Characters | **Billboard the existing 2D pixel sprites in the 3D scene now**; move to real 3D character models as a *later* step. |
| Constraints | **Mobile + LAN/WebRTC co-op stay mandatory.** Forces lightweight 3D, payload/perf budgeting, touch-friendly camera. |
| Camera | **Top-down angled** (Diablo/Hades), closest to the current game and twin-stick controls. |

## The core strategy

The single most important idea: **we replace the *view*, not the *simulation*.**

The game today runs entirely on a 2D tile grid — movement, collision, enemy AI,
items, spikes, doors, and the co-op netcode all operate on `x/y` pixel
coordinates derived from `DD.TILE` (see `js/room.js`, `js/entities.js`,
`js/net.js`). None of that needs to know about 3D.

So we keep the grid simulation as the source of truth and add a 3D renderer that
*draws* that grid: assemble the dungeon from GLB modular pieces snapped to grid
cells, place billboarded character sprites at each entity's `x/y`, and point a
fixed top-down-angled camera at it. The Z axis is presentation only.

This keeps the diff bounded and de-risks netcode (positions stay 2D, so co-op is
untouched by the visual change).

## The assets

`Kenney Modular Dungeon Kit` v2.1, **CC0** (commercial OK, no attribution required).
- 39 GLB modular pieces (use the **GLB format** dir — three.js loads it natively
  via `GLTFLoader`): floors, walls (+corner/half/top), corridors
  (straight/corner/junction/intersection/wide), rooms (small/wide/large +
  variations), stairs, gates, doors.
- All pieces share **one ~28KB `colormap.png`** atlas → one material, cheap to batch.
- **No characters/enemies/props** — architecture only. Characters remain our 2D
  sprites until the later 3D-character step.

## What changes vs. what stays

**Stays (logic — do not touch):**
- `js/room.js` grid model: `tiles[]`, `isSolid`, `boxHitsWall`, `moveEntity`,
  `randomFloorPos`, `getData/setData`. Collision stays 2D.
- `js/entities.js` AI/behavior, `js/items.js`, `js/stats.js`, `js/profile.js`,
  `js/net.js` (still syncs 2D x/y), `js/input.js` logical intent.
- Game loop, run/floor/room progression, lobby/town/tier-pad logic in `js/game.js`.

**Changes (view — the bulk of the work):**
- **New `js/render3d.js`** (three.js scene, camera, lights, GLB loading, the
  per-frame draw). Becomes the new render path.
- `js/room.js` **`prerender()`/`draw()`** — today these bake/blit a 2D floor
  canvas. Replaced by "build a 3D mesh layout from `tiles[]`" (instanced GLB
  pieces) and "update animated bits."
- `js/entities.js` **draw calls** and `js/sprites.js` consumption — sprites become
  textures on camera-facing billboard quads instead of `ctx.drawImage`.
- `js/particles.js`, spikes, decorations, doors — need 3D equivalents (can start
  as billboards/simple meshes).
- `js/hud.js` and the inventory/menus in `js/game.js` — **stay 2D**, rendered as a
  DOM/canvas overlay on top of the WebGL canvas (standard, low-risk).
- `index.html` — add the three.js + GLTFLoader includes and the WebGL canvas.

## Conflicts with current project identity (call these out)

- **"Zero-dependency" breaks.** three.js (tree-shaken/minified core + GLTFLoader)
  is ~150–600KB depending on build. Vendor it into `js/lib/` like `peerjs.min.js`
  to preserve "no npm/build step at runtime."
- **Payload grows.** GLBs + colormap on top of three.js. Budget and lazy-load;
  the kit itself is small (largest GLB ~900KB, most are 2–84KB; one shared 28KB
  texture), so this is manageable for mobile if we don't add heavy character models yet.

## Phased task breakdown (rough)

**Phase 0 — Spike / go-no-go — ✅ DONE & PASSED (2026-06-20).**
- Built `spike3d.html` (standalone, importmap, no build step): vendored three.js +
  GLTFLoader in `js/lib/three/`, real GLBs assembled into a 24×16 room (perimeter
  walls, top-centre gate-door, four 2×2 pillars) under the angled top-down camera.
- Cell size is **asset-derived** from the floor piece's bbox (4.0 units; wallH 4.15).
- **Result: locked 60 FPS with no variation on both desktop and phone.** Headless
  render confirmed the full module → GLB-parse → WebGL chain. Naive worst case
  (clones, no instancing) was 476 pieces / **438 draw calls** / 35.7k triangles and
  still ran at vsync cap → comfortable mobile headroom.
- **Verdict: GO.** Proceed to Phase 1. Instancing (shared colormap material →
  ~handful of draw calls) is available as obvious headroom but wasn't even needed
  to pass.

**Phase 1 — Static dungeon from the grid (≈3–5 days). 🟡 IN PROGRESS.**
- ✅ `js/render3d.js` (`DungeonRenderer`): builds the dungeon from a `tiles[]`
  grid (same 0/1/2 model as `room.js`) using **InstancedMesh** on the shared
  colormap material. **Whole room = 3 draw calls** (floor+wall+door) vs 438 clones,
  size-independent. Lighting + angled camera done. Headless-verified identical render.
- ✅ `projectToScreen(gx,gy)` helper added as the Phase 2 billboard bridge.
- ✅ Wired into the live game behind a **`?3d`** toggle (done together with Phase 2
  billboarding so the game stays coherent — the chosen approach):
  - `index.html`: `#game3d` WebGL canvas behind a now-transparent `#game`; importmap
    + module boot that creates the renderer once the kit loads (`DD.render3d`).
  - `game.js`: `draw()` takes a 3D path for `state==="play"` — builds the dungeon
    from `DD.room.getData()` (rebuild keyed on the new `room.version`), billboards
    every entity, renders, and uses the 2D canvas purely as a screen-space HUD overlay.
  - `room.js`: bumps `version` in `prerender()` so the mesh rebuilds on room change.
  - `?dev=combat` jumps straight into a solo combat room for testing.
- Verified headless: live `?3d&dev=combat` renders dungeon + warrior billboard + HUD
  correctly, no errors. (The `e.includes` console line is pre-existing peerjs noise.)

**Phase 2 — Entities as billboards (≈3–5 days). 🟡 STARTED (with Phase 1).**
- ✅ `render3d.js` billboard layer: per-entity `THREE.Sprite` pool, nearest-filtered
  `CanvasTexture`. `game.js captureEntity()` reuses each entity's existing 2D
  `draw()` into an offscreen canvas → stood up on the floor via `setEntities()`.
  Reuses ALL existing sprite art (equipment, healthbars, swings) for free.
- ⬜ To confirm on a real device: enemy/projectile billboards (same code path as the
  player, but headless virtual-time doesn't advance spawn timers so they weren't
  visually captured). Depth-sort vs. wall occlusion, shadow-on-billboard polish.
- ⬜ Known caveat: pointer-aim screen→world mapping still uses the 2D transform, so
  mouse aiming is off under the 3D camera (movement/keys fine). Fix with the camera
  projection next.

**Phase 2 — Entities as billboards (≈3–5 days).**
- Render player/enemies/projectiles/items as camera-facing textured quads sourced
  from existing `sprites.js` frames, positioned from their 2D `x/y`.
- Depth sorting / draw order so sprites sit correctly on the 3D floor.

**Phase 3 — Effects & dressing (≈3–5 days).**
- Spikes, decorations, particles, open/closed doors, lobby tier-pads, town props →
  3D/billboard equivalents. Theme variation via colormap tint or piece selection.

**Phase 4 — Controls, HUD, co-op verification (≈2–4 days).**
- Confirm twin-stick touch still maps correctly under the angled camera.
- HUD/inventory overlay on the WebGL canvas. Re-test 2-player co-op (positions are
  unchanged, so this should be low-risk but must be verified on two devices).

**Later (separate effort): 3D character models** — rigging, animation, asset
sourcing/loading, replacing billboards. Deliberately deferred.

Rough total for the dungeon-rendering transition (excluding 3D characters):
**~2.5–4 weeks** of focused work, contingent on the Phase 0 perf result.

## Top risks

1. **Mobile WebGL performance** — the whole bet. Mitigated by Phase 0 spike + GLB
   instancing + the single shared material.
2. **Payload on mobile data** — vendor/minify three.js, lazy-load GLBs.
3. **Sprite/3D visual mismatch** — pixel-art billboards inside a smooth-shaded 3D
   kit may clash; validate the look early (part of Phase 2).
4. **Touch aiming under an angled camera** — screen→world mapping changes; verify in Phase 4.
5. **Scope creep into gameplay** — resist; this is a render-layer swap. Logic stays 2D.

## Open questions to resolve before Phase 1

- three.js build flavor to vendor (size vs. features).
- Camera: orthographic vs. slight perspective for the "angled top-down" look.
- How much vertical wall height reads well at this camera angle (kit has full-height
  and half walls).
- Theme system: reuse current theme IDs as colormap tints, or pick different kit
  pieces per theme?
