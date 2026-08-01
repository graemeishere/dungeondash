# Dungeon Dash — Execution Roadmap

Handoff document. Produced 2026-08-01, after the seven specialist audits in this
directory and the producer's `audit-summary.md` and `rewrite-decision-brief.md`.

**Read the seven audits directly.** This file does not summarize them. It
records what was decided, who owns what, and in what order — the things that
exist nowhere else.

---

## 1. Decision log

These came from a user interview on 2026-08-01 and are **settled**. A future
session may raise a *new* problem with one of them; it must not silently
re-litigate a closed question.

| # | Question | Decision |
|---|---|---|
| 0 | Is the core loop right, or just badly executed? | **Execution; the concept is sound.** Dungeon run → loot → town → upgrade → harder dungeon is the right game. The audits were answering the right question. |
| 1 | Overall direction | **Hybrid.** Keep the repo, art packs, render/decor stack, stat pipeline, floor generator, co-op protocol, persistence and input layers. Rebuild in place: `js/game.js` structure and the duplicate traversal system. Build fresh: onboarding and music. |
| 2 | Build step | **Native ES modules, no bundler.** Retire `window.DD` and the fixed script order; extend the importmap the 3D layer already uses. Deploy stays a `sed` and a push. |
| 3 | Co-op | **Parked entirely.** No feature work this cycle. It gets modularized with everything else, nothing more. |
| 4 | Traversal | **One system — port, then retire.** Obstacles, room shapes and trap spikes into floor mode *first*; then route raids and the finale; then delete the classic path. |
| 5 | Enemy visuals | **Grade → HUD signal. Faction → new texture assets, later. Material tint retired as a mechanism** in favour of swatches. |
| 6 | Asset philosophy | **Vendored CC0 assets.** Music and ambience ship as real files, matching the precedent the 3D art packs already set. |
| 7 | Difficulty | **Both levers, level-design leads.** Geometry is primary; HP multipliers pull back once space is doing work. |
| 8 | Sequencing | **Structure first.** The audits' `file:line` citations go stale once — accepted. |
| 9 | Side rooms | **Populate them.** Shrine, storage and dining all get real payoffs. |
| 10 | Shop room | **Delete it and fix the README.** Town-only shopping is already the design. |
| 11 | NPC prompts | **Write the dialogue.** Needs the overlay CSS fix first. |
| 12 | qa's guest-hero fix vs. parked co-op | **Hold the park.** Recorded as a real defect left knowingly unfixed — see §4. |
| 13 | Boss escalation | **Names *and* stats per floor.** Un-key `bossName`/`bossHp`/`bossDmg` from tier to floor. |
| 14 | Rogue identity | **Give it a real mechanic** — a post-dash window converting speed into damage avoidance. Retuning numbers alone was rejected. |

**One routine call not put to the user:** gate `?safe` and `?dev` out of the
production build. qa reproduced `?safe` disabling enemy AI while leaving player
attacks live on the deployed site. `?classic` disappears with the classic path.

### Two facts checked during the interview that make decisions 5 and 14 cheaper

- All four skeleton character GLBs share a **single** `skeleton_texture.png`
  atlas (`KayKit Skeletons/texture/`). Per-faction reskins are one texture
  variant each, bound at load — no new geometry, no re-rigging.
- Two unused hero models already sit in the pack: `Barbarian.glb` and
  `Rogue_Hooded.glb` (`KayKit Adventurers/Characters/gltf/`).

---

## 2. Working model

- **One phase at a time. Do not run seven agents concurrently against the same
  files.** That was safe for a read-only audit; it is not safe for edits.
- Per phase: the owning specialist produces a change spec in its lane → the main
  session implements → `qa` verifies against the running build.
- Serve with `python3 -m http.server 8123`; drive headless with Playwright
  against `/opt/pw-browsers/chromium`. `.claude/skills/verify/SKILL.md` has the
  dev URLs, boot-wait predicates and room-navigation tricks.
- Re-run `producer` at each phase boundary to catch new cross-domain conflicts.
- Specialists keep lane discipline: hand off as `→ [owner]: [symptom]` rather
  than solving across the boundary.

---

## 3. Phases

### Phase 0 — Structure (`qa` leads)

**Ship first, on its own, before the refactor.** qa's #1 priority, and
independent of everything else: `webglcontextlost` / `webglcontextrestored`
handling. Context loss currently blanks the only gameplay-visible surface
permanently while the game keeps running underneath. Pause the render loop and
show a message on loss; re-upload assets or prompt a reload on restore.

**Then the refactor.** Split `js/game.js` (2,567 lines) along its real seams —
run lifecycle, world map, town/NPCs, overlays, draw loop. Convert to native ES
modules, extending the importmap already in `index.html:191-193`; retire
`window.DD` and the fixed 15-script load order.

**Then hygiene.** Gate `?safe`/`?dev` out of production. Wire the existing
`dev/room-checks.mjs` into CI — it is a real regression suite that nothing
currently runs. Add the unreferenced `fbx`/`obj`/`Textures`/`Samples` subtrees
(~105 MB) to `exclude_assets` in `pages.yml:35`.

### Phase 1 — Traversal unification (`level-design` leads, `qa` verifies)

**Strict order.** Reversing it regresses the two biggest set-pieces, because
floor mode currently lacks what the classic path has.

1. Port the classic path's obstacle carving and room-shape variety
   (`js/room.js:62-94`) into `js/floor.js`'s `carveRect` — currently `FLOOR`-only,
   so every combat room is a coverless box.
2. Make floor-mode trap rooms real: spike bands plus a `spawnFloorEntities`
   branch. Fix the decor planner keying off whole-grid `desc.roomType`
   (`js/decor3d.js:420`) instead of the per-room type, which is why the grate
   flourish can never fire.
3. Route raids and the finale through `DD.generateFloor` — they call `startRun`
   directly today and silently fall back to the single-room path.
4. Delete the classic path and `?classic`.

→ `graphics`: step 1 revives the dormant obstacle/crate-fort prop category at
`js/decor3d.js:644-652` the moment `OBSTACLE` tiles start being written.

### Phase 2 — Progression correctness (`systems-design` leads)

Difficulty is a **joint pass with `level-design`**. Both cleanly deferred to
each other during the audit and nobody owned the combination — systems has
Tier 3 as a 6× HP sponge, level-design has it as a coverless box, neither
modelled the two together. Geometry leads; HP multipliers pull back.

**Reward scaling is the headline.** `xpValue`/`coinDrop` never receive the tier
`scale` that HP does, and `Boss` hardcodes `xpValue:40`, its coin drop, and `2`
slam damage instead of `this.dmg`. Until this is fixed, farming Tier 1 is
strictly more efficient than progressing, forever.

Also in scope: `Math.round()` dead zones in `effDmg`; Sharpened Edge strictly
dominating Quick Hands; widening the 6-upgrade pool, or making a subset
class-specific, so a 29-level-up career doesn't converge on "always take damage".

**Rogue (decision 14).** Give it a post-dash damage-avoidance or crit window.
Dash is the only true ability in the game and only Rogue has it, so the class
identity gets built on the mechanic it already owns. It is currently dominated
by Warrior on damage, cooldown, range, arc and HP simultaneously.

**Boss escalation (decision 13) — joint with `narrative`.** Systems un-keys
`bossName`/`bossHp`/`bossDmg` from tier to floor so each floor's boss is a
distinct, escalating fight; narrative supplies the per-floor names. Neither half
works alone. This was the most-referred, least-owned issue in the audit set.

**Side rooms (decision 9) — joint with `level-design`.** Systems defines what
shrine, storage and dining each give; level-design writes the spawn branch,
since `spawnFloorEntities` handles only combat/elite/boss/treasure today. Both
in this phase — a definition with no spawn branch changes nothing.

### Phase 3 — Clarity (`ux-ui` leads)

Apply the team's own already-diagnosed centred-flex overflow fix
(`css/style.css:487-489`) to `#questgiver` and `#hub`, dropping the
`max-width:720px` scoping so it keys off content-taller-than-viewport rather
than a breakpoint. Measured clipping the Quest Giver title and Close button by
217 px at 1280×800.

Route the world map through the 3D renderer so it stops letterboxing to a fixed
landscape aspect — over 70% dead screen on a 390×844 phone, on the screen most
players use to navigate the whole game.

Add the non-colour enemy-grade signal that replaces tint (decision 5). Build
onboarding — it does not exist, so it is additive either way. Add a settings
surface, which audio's volume control needs somewhere to live. Fix the two
sub-AA text contrast failures. Render the minimap legibility verdict that both
level-design and graphics asked for and nobody gave.

### Phase 4 — Content and identity (`narrative`, `graphics`, `audio` — sequential)

**`narrative`** — one characterizing line per NPC on first interact, after
Phase 3's CSS fix (the `[E] Talk to…` prompt currently promises a conversation
and opens a stats panel). Quest descriptions rewritten with a requester's voice
and a reason, against the existing `desc` field — no data-model change. Faction
identity for skeleton, goblin and undead, which have none. Per-floor boss names
for decision 13.

**`graphics`** — per-faction variants of the shared `skeleton_texture.png`,
bound per faction in `enemyModelKey`, so three factions stop reading as one.
Plus the one item its audit could not settle: **re-verify swing-trail and
telegraph contrast against each theme's floor palette**, with a screenshot
method that reliably catches the effect mid-life. The pin trick was
inconclusive, so this is an open live-combat readability question, not a
cosmetic one.

**`audio`** — master `GainNode` and limiter first; an instrumented fight
measured 8 concurrent one-shots summing to 1.48 linear gain straight into the
destination node. Then vendored CC0 music and ambience (decision 6). Then the
coverage gaps: boss-slam telegraph *onset* rather than impact only (the
`slamAnimAt` rising-edge hook already exists), downed state, low HP. Also split
the two cue collisions — `door()` plays for both room-lock and room-clear,
`chest()` for chest-open, purchase and loot.

### Cross-cutting corrections

Fold into whichever phase touches the file:

- Delete the dead `shop` room and correct `README.md:79` (decision 10).
- Fix the `npcQuestGiver` / `npcQuestgiver` sprite-key mismatch so the Quest
  Giver stops rendering as the Barkeep.
- Make `bossKill` and `clearDungeon` quest goals distinguishable —
  `js/game.js:732-733` passes both the same value.
- Remove the phantom "Bone Emperor" and "The Deathless" from the README; neither
  exists in `js/`.
- Resolve `docs/GAME_DESIGN.md`'s Trader/Quest-Giver self-contradiction
  (`:140-141` vs `:184-186`) and its stale "single HTML5 canvas, no image
  assets" framing.

---

## 4. Specialist next steps deliberately overridden

Recorded so the next session sees these were decided, not missed.

**qa next step #3 — "give guest co-op players a real hero."** Pass a `hero` into
the guest's `Player`; bank their gold and quest progress at `endRun`. Overridden
by decisions 3 and 12. This is a real, correctly-identified defect: the guest's
gear, attributes and level never apply, and nothing they earn persists past the
session. It stays open and unfixed **by choice**, not oversight.

**New faction GLB geometry — graphics next step #1, full version.** Deferred to
texture-variant reskins now, real assets later. The consequence, accepted
knowingly: the three factions keep reading as one until the assets land, and
narrative's faction writing lands against identical models in the meantime — the
dependency the producer flagged at `audit-summary.md` §4.7.

---

## 5. Coverage matrix

All 21 specialist next steps (7 audits × 3), each assigned to a phase or marked
overridden. Nothing silently dropped.

| Audit | # | Next step | Carried by |
|---|---|---|---|
| narrative | 1 | One characterizing line per NPC on first interact | Phase 4 |
| narrative | 2 | Rewrite 10 quest descriptions with a requester's voice | Phase 4 |
| narrative | 3 | Differentiate the three per-tier boss fights | Phase 2 (joint) + Phase 4 — decision 13 |
| level-design | 1 | Fix trap-room decor keying bug; give trap rooms real hazards | Phase 1 step 2 |
| level-design | 2 | Give floor-mode rooms interior geometry | Phase 1 step 1 |
| level-design | 3 | Decide shrine/storage/dining's fate | Phase 2 (joint) — decision 9, populate |
| systems | 1 | Scale enemy/boss rewards with the tier `scale` factor | Phase 2 (headline) |
| systems | 2 | Rebalance Quick Hands / Sharpened Edge; widen upgrade pool | Phase 2 |
| systems | 3 | Decide Rogue's identity on purpose | Phase 2 — decision 14, post-dash mechanic |
| ux-ui | 1 | Fix the world map's rendering path | Phase 3 |
| ux-ui | 2 | Generalize the overlay top-align fix; add `#hub` | Phase 3 |
| ux-ui | 3 | Non-colour grade signal + two sub-AA contrast colours | Phase 3 — decision 5 |
| graphics | 1 | Non-skeleton enemy identity for the two other factions | Phase 4 (texture variants); **new geometry overridden** — §4 |
| graphics | 2 | Re-verify swing-trail / telegraph contrast per theme | Phase 4 |
| graphics | 3 | Exclude unreferenced asset subtrees from the Pages deploy | Phase 0 |
| audio | 1 | Master `GainNode` every call routes through | Phase 4 (first) |
| audio | 2 | Boss-slam telegraph audio onset, not just impact | Phase 4 |
| audio | 3 | Settle procedural vs. vendored; split the two cue collisions | Decision 6 (vendored) + Phase 4 (cue split) |
| qa | 1 | Fix the WebGL context-loss soft-lock **first** | Phase 0 (ships standalone, ahead of the refactor) |
| qa | 2 | Gate `?safe`/`?dev`/`?classic` out of production | Phase 0 |
| qa | 3 | Give guest co-op players a real hero | **Overridden** — decisions 3 and 12, see §4 |

---

## 6. Out of scope

Co-op feature work. New faction GLB geometry. Any redesign of the core loop —
decision 0 settled that the concept is sound, so the next session builds on it
rather than reconsidering it.
