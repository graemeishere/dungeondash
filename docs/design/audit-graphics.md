# Graphics Audit — Dungeon Dash

Scope: art direction, 3D model/rig usage, animation, particle effects,
lighting, and in-world combat readability. Assessed by reading the render
stack and by driving the live game headless (Playwright against
`/opt/pw-browsers/chromium`, server already up on `:8123`) across all three
dungeon themes and four classes. Screenshot-sourced claims are marked
explicitly; everything else is `file:line` against the current tree.

## What exists

**Render stack** — five ES modules, no build step, importmap resolves `three`
to the vendored r160 at `js/lib/three/`:

- `js/render3d.js` (782 lines) — `class DungeonRenderer`. Instanced dungeon
  architecture keyed on the KayKit kit's single shared colormap material
  (`js/render3d.js:24-35` defines two swappable kits, `ACTIVE_KIT = "kaykit"`
  at `js/render3d.js:35` — the Kenney kit, ~20 MB, is fully wired but dead
  code in production). ACES filmic tone mapping + PCF soft shadows
  (`js/render3d.js:70-74`), per-theme gradient background + hemi/sun light
  colors (`setAtmosphere`, `js/render3d.js:494-517`), a fixed 2-point-light
  pool to avoid shader recompiles on room change (`js/render3d.js:103-110`).
  Camera is a diorama-style 35°-FOV perspective at ~37° elevation tuned to
  match the KayKit sample shots (`js/render3d.js:80-88`), with independent
  "fixed" (whole-room) and "follow" (player-tracking, aspect-adaptive zoom)
  modes (`_followDist`, `js/render3d.js:547-567`).
- `js/decor3d.js` (814 lines) — deterministic per-room decor planner, one
  `mulberry32` RNG stream per room consumed in a fixed pass order
  (`js/decor3d.js:24-32`), three theme palettes (`catacombs`, `goblinMines`,
  `crypt`, plus `town`) each with its own floor/patch/aisle/wall/banner/torch
  choices and atmosphere colors (`js/decor3d.js:59-113`).
- `js/char3d.js` (297 lines) — `RIG` registry, `classModelKey`/
  `enemyModelKey`, `CharacterFactory`/`CharacterManager`. All hero and enemy
  models retarget onto one shared 23-joint `Rig_Medium` clip library
  (`js/char3d.js:1-21`), loaded once and shared across every character.
- `js/fx3d.js` (306 lines) — GPU-particle system: one `THREE.Points` draw
  call for bursts/sparks/embers (`js/fx3d.js:27-52`), pooled meshes for
  impact rings, boss-slam telegraphs (outline + closing fill disc,
  `js/fx3d.js:130-153`), melee swing-trail arcs (`js/fx3d.js:173-186`), and a
  persistent boss aura sprite (`js/fx3d.js:155-168`).
- `js/game3d.js` (508 lines) — bridges game entities to 3D: builds the
  per-frame character/item/projectile/billboard lists, drives attack-clip
  selection via combo/sequence logic (`comboAttack`, `js/game3d.js:58-78`),
  and falls back to 2D-sprite billboards (`captureEntity`,
  `js/game3d.js:22-41`) for anything without a 3D model or not yet loaded.
- `js/particles.js` (44 lines) — thin trigger layer; `DD.particles.burst/
  ring/text` route into `fx3d` (confirmed by reading in full).
- `js/sprites.js` (890 lines) — legacy procedural pixel-art generator. Still
  runs at boot and produces distinct 2D art per enemy kind — `skeleton`,
  `skeletonArcher`, `skeletonBomber`, `skeletonShade`, `goblin`,
  `goblinArcher`, `goblinBerserker`, `goblinShaman`, `goblinBomber`,
  `zombie`, `warlock`, `necromancer`, and four boss variants (`skeleton`,
  `goblin`, `undead` "lich", `finale`) — at `js/sprites.js:799-814`. This
  output now only serves as pre-load/fallback billboards and 2D map/UI icons.

**Vendored CC0 art**: `KayKit Adventurers` (23 MB), `KayKit Character
Animations` (42 MB), `KayKit Dungeon Remastered` (49 MB, the active kit),
`KayKit Skeletons` (17 MB), `Kenney Modular Dungeon Kit` (20 MB, unused).
Working tree is 213 MB; only the `gltf`/`glb` variants are ever loaded by
code (`grep` for `.fbx`/`.obj`/`Textures/`/`Samples/`/`Previews/` in `js/`
returns nothing), yet `.github/workflows/pages.yml:35`'s
`exclude_assets: ".github,docs,DungeonDash_DesignBrief.md"` does not exclude
any of those subtrees — they all ship to GitHub Pages.

**Enemy model collapse.** `enemyModelKey()` (`js/char3d.js:95-101`) maps
every enemy `kind` string onto one of four `enemy:*` rig keys by regex:
`mage|warlock|necromancer|shaman` → mage rig, `arch|bow|ranger|rogue` →
archer rig, `zombie|berserker|brute|warrior|goblin` → warrior rig, everything
else → minion rig. The game actually spawns nine gameplay-distinct enemy
kinds across three factions (`melee`/`archer`/`zombie`/`warlock` for
Catacombs, `goblin`/`goblinArcher`/`goblinBomber`/`goblinBerserker`/
`goblinShaman` for Goblin Mines, `zombie`/`warlock`/`necromancer` for the
Crypt — `js/game.js:57-107`) plus five named bosses (`SKELETON KING`,
`GOBLIN WARLORD`, `THE LICH`, `RAID CAPTAIN`, `THE WORLD-EATER` — cross-
referenced from `docs/design/audit-narrative.md:38-41`). Every one of them
resolves to one of `Skeleton_Minion.glb`, `Skeleton_Warrior.glb`,
`Skeleton_Rogue.glb`, or `Skeleton_Mage.glb` (`js/char3d.js:50-74`), and
every boss specifically to `Skeleton_Warrior.glb` two-handing an axe
(`js/char3d.js:77-82`, `js/game3d.js:92`). The repo contains no goblin or
non-skeleton undead GLB — confirmed by directory listing, only `KayKit
Skeletons` has a `characters/gltf/` folder.

**Regression coverage**: `dev/room-checks.mjs` (203 lines) asserts, per
theme, draw-call ≤70 and triangle ≤400,000 budgets, decor-planner
determinism (same `desc` → same plan) and guest `setData(getData())`
round-trip identity, banner-flanks-door and no-prop-on-door-cell composition
sanity, and a floor-mode variant with a 240 draw-call budget
(`dev/room-checks.mjs:15,194`). Nothing in `.github/workflows/` runs it —
`pages.yml` only stamps the cache-bust token and deploys.

## What's solid

- **Decor composition is genuinely good.** Screenshot evidence: whole-room
  shots across all three themes (`?dev=combat&cam=fixed&dungeon=catacombs|
  goblinMines|crypt`) show distinct floor materials (grey hex stone,
  packed-dirt tan, blue-grey slate), organic dirt/rubble patches, a wood
  aisle to the door, symmetric torch/banner pairs, and authored prop
  vignettes (crate stacks, barrel clusters, a candle shrine in the crypt) —
  not generic scatter. The `mulberry32`-seeded planner
  (`js/decor3d.js:24-32`) plus the room-checks determinism assertions back
  this with code-level evidence, not just a good-looking screenshot.
- **Per-theme atmosphere reads clearly at a glance.** Catacombs is
  purple-grey and torchlit, Goblin Mines is warm brown/orange, the Crypt is
  cold blue-violet — confirmed by screenshot and by the `atmosphere` blocks
  in `js/decor3d.js:76,94,112`.
- **Hero models are crisp and readable at combat distance.** Screenshot
  evidence (`?dev=combat&class=warrior|ranger`, close follow camera): the
  Knight (grey armor, red cape) and Ranger (blue tunic, visible bow) read as
  distinct silhouettes with good material shading and soft ACES-toned
  lighting. The animation retarget system genuinely works — same clip
  library drives visibly different attack poses per weapon (sword slice vs.
  bow draw/release).
- **Instancing architecture is disciplined.** One `InstancedMesh` per piece
  type keeps whole-room draw calls low regardless of room size
  (`js/render3d.js:250-259`); the room-checks budgets (≤70 calls/room, ≤240
  for a full floor) are real, checked numbers, not aspirations.
- **Fixed light-pool + tuned shadow frustum shows real engineering care**
  against a known three.js cost (shader recompiles on light-count change),
  `js/render3d.js:103-110`; shadow window narrows for follow mode and widens
  for fixed mode (`_fitShadow`, `js/render3d.js:533-545`).
- **Effects are cheap and consistent**: the whole particle system is one
  `THREE.Points` draw call plus a handful of pooled meshes (`js/fx3d.js:
  27-52`), so combat visual noise doesn't add draw calls linearly with hit
  count.
- **Graceful degradation.** The billboard fallback (`captureEntity`,
  `js/game3d.js:22-41`) means a missing/slow-loading model never breaks the
  scene — it reuses the entity's existing 2D `draw()`, captured to an
  offscreen canvas. `?noshadow` is a real mobile escape hatch, verified by
  `room-checks.mjs:103-116` asserting the same draw-call budget holds with
  shadows off.
- **Dev tooling exists in-lane**: `anim3d.html` and `combat3d.html` are
  standalone harnesses for animation/timing iteration outside the full game,
  and `?camtest` gives a live camera-tuning HUD (`js/game3d.js:429-451`) —
  evidence this pipeline was tuned deliberately, not guessed at.

## What's rough, incomplete, or inconsistent

- **Every enemy in the game is visually a skeleton, always.** This is the
  single biggest problem in the domain. Screenshot evidence is unambiguous:
  a `dungeon=goblinMines` combat room labeled "Goblins: 5" in the HUD shows
  four pale bone-white humanoid models identical in silhouette and material
  to the "Skeletons: 6" catacombs room and the "Undead: 5" crypt room — only
  the floor/wall dressing changes. Nine written-distinct enemy kinds and
  five named bosses collapse onto four shared GLBs
  (`js/char3d.js:95-101,77-82`). The game's own README markets "melee
  skeletons, tanky brutes, hooded archers... and bombers", plus three named
  dungeon bosses (Skeleton King, Bone Emperor, Deathless per the README;
  Skeleton King/Goblin Warlord/The Lich in the actual code) as distinct
  content — none of it is visually distinguishable in play.
- **Default follow camera is very tight.** Screenshot evidence
  (`?dev=combat&class=warrior`, no `cam=` override): the player's back and
  helmet fill roughly a third of the frame, and the near wall consumes
  another third, leaving a narrow band to spot approaching enemies. In a
  crowded fight (screenshot: 4 skeletons pulled to melee range) this
  resolves fine because they're close, but it means the player has very
  little advance warning of enemies approaching from most of the room —
  this is a game-feel tradeoff, not a bug, but it's aggressive.
- **Palette-driven telegraph/trail contrast is untested against warm floors.**
  Attempting to pin a melee swing arc (`js/fx3d.js:173-186`, near-white
  `#fff8e0`, additive) mid-life via the verify skill's trick produced only
  the leading-edge spark burst clearly visible in both a grey-floor
  (catacombs) and warm tan-floor (goblinMines) screenshot — the arc mesh
  itself was not clearly distinguishable from the floor in either capture.
  This may be a timing artifact of the pin (the render loop can advance past
  the pinned frame before the screenshot lands) rather than a real contrast
  problem, so treat this as a flag to re-check, not a confirmed defect.
- **Two full alternate render kits, one only ever used.** `DUNGEON_KITS`
  defines a `kenney` variant alongside the active `kaykit` one
  (`js/render3d.js:24-34`); `ACTIVE_KIT` is a hardcoded literal
  (`js/render3d.js:35`) with no runtime switch. The Kenney pack (20 MB) is
  fully live code (`firstMesh`, wall-fill logic, `door` piece) that never
  executes in production.
- **Self-shadowing is deliberately off** (`js/char3d.js:180-182`, comment:
  "self-shadowing on toon models looks muddy") — a reasonable call, but it
  means multi-limb overlap (e.g. a raised weapon arm) has no internal
  shading cue, relying entirely on the base material's flat shading. Not
  visible as a problem in the screenshots taken, but worth knowing as a
  constraint if character silhouettes get more complex.
- **~100 MB of vendored assets are dead weight in the deployed build** — the
  `fbx`, `obj`/`mtl`, `Textures/`, `Samples/`, `Previews/` subtrees across
  all five packs are unreferenced by any `js/` code but ship anyway (see
  "What exists" above). This is a build-hygiene problem, not an art-quality
  one, but it inflates every Pages deploy and clone.
- **`dev/room-checks.mjs` isn't wired into CI.** The budgets it checks
  (draw calls, triangles, decor determinism) are real regression coverage
  for this domain but nothing runs it automatically — `.github/workflows/
  pages.yml` only stamps a cache-bust token and deploys.

## Next steps

1. **Get non-skeleton enemy GLBs into the two non-Catacombs factions**, even
   coarse ones (a re-skinned/recolored variant is cheaper than a fresh rig
   since everything already retargets onto the shared `Rig_Medium` — a
   tinted-material or texture-swap pass on the existing skeleton meshes would
   at minimum give goblins a distinct color identity without new rigging
   work). This is the highest-leverage fix in the domain: three factions
   currently read as one.
2. **Re-verify swing-trail/telegraph contrast against each theme's floor
   palette** with a screenshot method that reliably catches the effect
   mid-life (the pin trick was inconclusive here), and bump opacity/color if
   it's genuinely washing out — this is a live-combat readability question,
   not a cosmetic one.
3. **Exclude the unreferenced asset subtrees from the Pages deploy**
   (`fbx`, `obj`, `Textures/`, `Samples/`, `Previews/` across all five packs)
   via the existing `exclude_assets` mechanism in `pages.yml:35` — a
   near-zero-risk change that meaningfully shrinks every deploy and clone
   without touching any loaded asset.

## Salvage or rebuild?

**Keep and improve — this is the strongest domain in the repo, verdict
differs by piece:**

- **Vendored CC0 art packs (KayKit ×4, Kenney): keep, unconditionally.**
  This is exactly the "sunk asset worth preserving" the brief calls out.
  151 MB of paid-quality CC0 3D content, already legally clear, already
  fitting a coherent low-poly diorama aesthetic. Re-sourcing this in a
  restart would cost real time for no visual upside — the actual room and
  hero screenshots look good today.
- **Renderer (`render3d.js`) and decor planner (`decor3d.js`): keep.** This
  is the best-engineered code I read anywhere in this audit: disciplined
  instancing, a real determinism contract backed by an actual regression
  script, tuned lighting/shadow budgets, and decor output that matches the
  source pack's own sample-scene quality (screenshot evidence). Nothing here
  needs a rewrite; it needs the enemy-variety gap filled and the dead-weight
  Kenney kit either activated or deleted.
- **Character/animation driver (`char3d.js`) and effects (`fx3d.js`): keep
  the architecture, fix the data.** The retarget-onto-shared-rig approach
  and the combo/sequence attack-clip system are sound engineering; the
  problem is entirely in `RIG`'s enemy entries and `enemyModelKey`'s regex
  — a content/data problem layered on a good system, not a systemic flaw.
  Don't rewrite this file; extend its `RIG` table.
- **Legacy sprite generator (`sprites.js`, 890 lines): keep as-is, don't
  invest further.** It already does its one remaining job (preload
  billboards, 2D map/UI icons) and is explicitly demoted in the charter.
  Notably it already has the per-kind art variety (goblin/undead/boss
  sprites) that the 3D path lacks — worth knowing if the fastest path to
  faction distinctness turns out to be leaning on these 2D representations
  more, rather than only chasing new GLBs.
- **Net verdict: no case for starting the graphics domain over.** The
  render/decor engineering is ahead of the rest of the repo, the art assets
  are a real sunk investment worth keeping, and the flagship problem (enemy
  model monoculture) is a scoped data-and-asset gap in an otherwise sound
  pipeline, not evidence the pipeline itself is wrong.

## Discrepancies

- `docs/GAME_DESIGN.md:3-4`: "A browser action-roguelite built in vanilla JS
  on a single HTML5 canvas, with no build step and no image assets (all
  sprites are procedurally drawn at boot)" — false since the 3D migration;
  the game renders a WebGL scene via three.js with GLB models and a second
  canvas layered as a transparent HUD overlay (`js/game3d.js:14-16`).
- `DungeonDash_DesignBrief.md:133`: "**Art style:** 2D top-down, cartoon —
  consider free asset packs for prototyping" — describes an abandoned
  direction; the shipped game is an isometric-diorama 3D perspective camera
  (`js/render3d.js:82-88`), not top-down.
- `README.md:6,73,75`: markets "hooded archers that kite and shoot bones,
  and bombers that sprint in and explode" and three distinct dungeon bosses
  ("Skeleton King → Bone Emperor → The Deathless") as content variety;
  visually none of it is distinguishable in play (see "What's rough" above).
  Note the boss names here don't even match the code's own naming
  (`SKELETON KING`/`GOBLIN WARLORD`/`THE LICH`, `js/game.js:68-107`) — a
  second, narrative-lane discrepancy layered on the same rendering gap.
- The actual current 3D intent lives in `docs/plans/2026-06-20-3d-dungeon-
  transition-scope.md` and `docs/superpowers/specs/2026-06-24-attack-facing-
  model-design.md` / `2026-06-26-3d-effects-design.md` — these are accurate
  and worth trusting over the two files above.

## Hand-offs

→ ux-ui: default follow camera's tight framing leaves little of the room
visible around the player; confirm whether the HUD/minimap compensates for
approach warning, since the in-world view alone gives little lead time
(screenshot evidence, `?dev=combat` default camera).
→ narrative: five boss names and nine enemy-kind names promise variety the
render layer can't currently deliver — worth knowing when writing more
faction-specific content, since it will render identically regardless.
→ systems-design: confirm whether `swingArc`'s trail duration
(`(p.swingDur || 0.4) * 0.6`, `js/game3d.js:189`) is meant to be legible as
a hit-confirmation cue or is purely decorative — affects whether the
possible low-contrast issue above is worth chasing.
