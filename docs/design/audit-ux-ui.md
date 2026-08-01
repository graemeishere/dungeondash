# UX/UI Audit — Dungeon Dash

Scope: screens, flow, HUD, controls (keyboard/mouse and touch), onboarding,
co-op join flow, and interaction accessibility. Assessed by reading
`index.html`, `css/style.css`, `js/game.js`, `js/hud.js`, `js/input.js`,
`js/game3d.js`, `js/util.js`, `js/entities.js`, and by driving the live game
headless (Playwright against `/opt/pw-browsers/chromium`, server already up
on `:8123`) at desktop (1280×800) and mobile-portrait (390×844, 360×640)
viewports, as Warrior and Rogue, through menu → co-op host attempt → combat →
level-up → inventory → town → Barkeep/Trader/Quest Giver → dungeon lobby →
world map → hub → raid-warning → result. Screenshot- or runtime-sourced
claims are marked explicitly; everything else is `file:line` against the
current tree.

## What exists

**Hybrid UI, three layers**, confirmed by reading and by runtime inspection:

- **DOM overlays** (`index.html`, 256 lines; styled `css/style.css`, 532
  lines): `#menu`, `#lobby`, `#levelup`, `#result`, `#hub`, `#raid-warning`,
  `#stats-overlay` (Barkeep), `#trader`, `#questgiver`, `#inventory`,
  `#inv-tooltip`. Each is populated imperatively from `js/game.js`:
  `buildHub` (`js/game.js:799`), `buildTraderOverlay` (`:1097`),
  `buildQuestGiverOverlay` (`:1204`), `buildStatsOverlay` (`:1353`),
  `renderInventory` (`:1566`). Critically, **DOM overlays are shown/hidden by
  dedicated functions, not by `game.state`** — e.g. `openLevelUp()`
  (`js/game.js:1487`) and `finishLevelUp()` (`:1501`) toggle
  `levelupEl.classList`; setting `game.state = "levelup"` alone does nothing
  visually. Confirmed by runtime: forcing state directly left the canvas
  scene unchanged while later overlay calls stacked their DOM on top of it
  (see "What's rough" #6).
- **Canvas HUD** (`js/hud.js`, 305 lines), a transparent 2D canvas drawn in
  *screen* space (`ctx.canvas.width/height`, not the world-space
  `DD.WIDTH/HEIGHT`, per the comment at `js/hud.js:8-10`) over the 3D scene:
  HP/XP bars with per-HP segment ticks (`:13-29`), class/level/gold/kills
  (`:38-46`), room-progress label with a `narrow` (`SW < 720`) branch that
  stacks text to avoid overlap on phones (`:48,64-75`), teammate HP bars
  (`:78-92`), boss HP bar / room-objective box (`:94-153`), a fading controls
  hint that swaps wording based on `DD.input.touchSeen` (`:160-168`), dash
  cooldown pip (`:172-178`), twin-stick + DASH/BAG touch controls
  (`:180-230`), and `drawMinimap` (`:235-303`).
- **Pure 2D canvas**: the world map, `drawMap` (`js/game.js:1904-2349`),
  drawn through the *old* 2D letterbox transform (`DD.view`, see below) —
  the only peaceful screen not on the 3D path (see bug #1 below).
- **In-world screen-space text**: `drawPeacefulOverlay` (`js/game3d.js:344`)
  — title bar + subtitle for lobby/town, and a dynamic `[E] Talk to <NPC>` /
  `Tap to talk to <NPC>` prompt that appears above the NPC's head only while
  in range (`js/game3d.js:367-375`, `DD.input.touchSeen`-aware); floating
  damage numbers (`js/game3d.js:380+`).

**State machine**: 15 values of `game.state`
(`menu,play,levelup,transition,won,lost,map,hub,lobby,town,stats,trader,quests,inventory,raid-warn`).
12 of these route through the 3D renderer (`ROOM_3D_STATES`,
`js/game3d.js:459-462`); `map` is the one peaceful state left on the legacy
2D path.

**Input** (`js/input.js`, 188 lines): WASD/arrows move, mouse aim + click or
Space attack, Shift dash, `E` interact (edge-triggered, `:64`), `I`
inventory; twin-stick touch (left half = move, right half = aim/attack,
`:110`), with DASH (`invBtn`/`dashBtn` screen-space hit circles, `:57-58`)
and BAG buttons drawn only once `touchSeen` flips true on first real touch
event. **Dash is gated on `player.stats.dash`**, true only for Rogue
(`js/entities.js:25` vs. `:19,30,36` for the other three classes), checked at
`js/entities.js:223`, and the touch DASH button is itself gated on
`pl.cfg.dash` (`js/hud.js:200`). Runtime-confirmed at both viewports: a
Warrior's touch HUD shows only the BAG button; a Rogue's shows DASH + BAG.
**README.md:33's control table already says "Dash (Rogue only)" correctly**
— this does not turn out to be a discrepancy (see Discrepancies).

**Co-op**: PeerJS/WebRTC, host-authoritative, 4-character manual room code
(`hostWithClass`/`joinWithClass`, `js/game.js:2119-2139`). Per
`docs/GAME_DESIGN.md:167` and confirmed by the state list above, only `play`,
`levelup`, `won`, `lost` are shared multiplayer states — town, lobby, map,
hub, trader, quest-giver, and raid are host/single-player-only. Runtime: a
`Host Co-op` attempt in this sandbox failed at the PeerJS broker
(`wss://0.peerjs.com` — proxy tunnel refused), surfacing a clear, actionable
in-UI error ("Could not create a room: Lost connection to server — the free
matchmaking server may be busy. Tap Host again.") with a working Back button
— see the qa hand-off for whether this is sandbox-only.

**Timing/proximity mechanics**: the 0.7s dwell to enter a dungeon tier from
the lobby (`game.padDwell >= 0.7`, `js/game.js:1812`) renders a filling
progress ring on the pad while dwelling (`js/game3d.js:320-322`, `frac =
padDwell/0.7`) — not a blind timer. `E`-interact proximity uses a generous
radius (`npc.r + pl.r + 18`, `js/game.js:1794`) and always shows the overhead
prompt first.

## What's solid

- **Class-gated controls are correctly wired and correctly documented.**
  Dash's Rogue-only gating is consistent across the class config
  (`js/entities.js:25`), the movement code (`:223`), the touch button
  (`js/hud.js:200`), and README.md's control table — checked because the
  audit brief flagged this as a likely discrepancy; it isn't one.
- **Level-up and inventory both work fully by keyboard or mouse/touch**:
  upgrade cards are real `<button>`s with click handlers *and* a `1/2/3` key
  shortcut (`js/game.js:1470-1481`, `:2338`); inventory opens/closes via `I`
  or a touch BAG button (`js/hud.js:216-229`, `js/game.js:2327-2328`).
- **The dwell-to-enter tier door and the interact prompt both give upfront,
  legible feedback** rather than pure hidden timers — see above.
- **Touch target sizing is reasonable**: DASH button r=32 (64px diameter),
  BAG r=26 (52px), interaction hit-test padded `+12px` beyond the drawn
  radius (`js/input.js:101,106`) — comfortably above the ~44px touch-target
  guideline.
- **HUD narrow-mode handling is genuinely responsive**, not just
  reflowed CSS: `js/hud.js` computes a `narrow` flag from the live canvas
  width and re-lays-out text position, box widths, and abbreviates labels
  (`"Doors locked — foes: N"` → `"Locked · N"`, `:123,128`) to avoid overlap
  on phones — confirmed visually at 390×844.
- **Co-op failure UX is good**: when the matchmaking round-trip fails, the
  player gets a specific, non-technical reason and a concrete retry action,
  not a silent hang or a raw stack trace.
- **NPC talk prompts are context-aware**: the overhead prompt swaps its
  verb/hint text for touch (`Tap to talk to X`) vs. keyboard (`[E] Talk to
  X`) automatically (`js/game3d.js:373`).

## What's rough, incomplete, or inconsistent

1. **World Map severely pillarboxes on portrait phones — the one peaceful
   screen not on the 3D path.** `ROOM_3D_STATES` (`js/game3d.js:459-462`)
   lists every peaceful/menu state (`menu, hub, lobby, town, stats, trader,
   quests, ...`) as 3D-rendered (which fills the screen properly) *except*
   `map`. The map instead falls back to the legacy 2D canvas, letterboxed
   into a **fixed 22×13-tile landscape aspect ratio** (`DD.FIXED_ROOM`,
   `js/util.js:26-27`) via a contain-fit transform
   (`DD.updateView`, `js/util.js:59-66`: `scale = min(canvas.w/704,
   canvas.h/416)`). On a 390×844 viewport this computes `scale ≈ 0.554`,
   i.e. the map renders in a ~390×230px landscape strip vertically centered
   in an 844px-tall canvas — **over 70% of the screen height is empty black
   space**, top and bottom. Runtime-confirmed: screenshot shows map nodes
   and the "‹ Hub" button confined to a ~220px band from y≈308 to y≈528.
   Town/lobby/hub/menu, by contrast, are 3D-rendered and correctly fill the
   whole viewport (confirmed side-by-side). This is the single most
   visible violation of the design brief's "mobile-first... from day one"
   mandate (`DungeonDash_DesignBrief.md:136`) still present in the game.
2. **Quest Giver (and any sufficiently long overlay) clips its own title and
   Close button off-screen at ordinary desktop window heights** — not just
   small phones. `.overlay` defaults to `justify-content: center` with
   `overflow-y: auto` (`css/style.css:44-59`); the devs already identified
   and fixed the resulting "centered flex content taller than the viewport
   clips at the top and can't be scrolled to" bug (their own comment,
   `css/style.css:487-489`), but scoped the fix (`justify-content:
   flex-start`) to `#stats-overlay`, `#trader`, `#questgiver` **only under
   `@media (max-width: 720px)`** (`css/style.css:486-506`). `#questgiver`
   currently lists ~8 unpaginated available quests
   (`buildQuestGiverOverlay`, `js/game.js:1204-1253`, `index.html:149-163`);
   measured live at
   1280×800 its `scrollHeight` is 1017px against an 800px `clientHeight` —
   **217px of overflow that the centered layout hides symmetrically above
   *and* below the visible band**, so even at `scrollTop = 0` (the top of
   the *scrollable range*) the "QUEST GIVER" title, subtitle, and "ACTIVE"
   header are not visible and cannot be scrolled to; only at max scroll does
   the Close button become reachable. Reproduced at 720, 800, and 900px
   window heights (overflow of 257px, 217px, 167px respectively) — this is
   not an edge case, it's the default behavior on a large fraction of real
   desktop/laptop window sizes.
3. **The Hub overlay has the identical bug and wasn't included in the mobile
   fix at all.** `#hub` is absent from the `@media (max-width: 720px)` block
   (`css/style.css:486-506` lists only `#stats-overlay`, `#trader`,
   `#questgiver`); it keeps `justify-content: center` (the `#hub` rule has no
   override anywhere). Measured live: fits with 0 overflow at 390×844 and at
   1280×800, but overflows by 61px at 360×640 (a common small-Android
   viewport). Screenshot at 360×640 confirms the hero portrait/name — the
   very first thing on the *home base* screen every returning player
   lands on — is clipped above the reachable scroll range.
4. **Enemy difficulty (`grade`) is communicated by color alone, and only
   after the enemy has already been hit once.** `showHpBar` requires
   `this.big || this.elite || grade==="veteran" || grade==="elite"`, and the
   bar itself is only drawn once `maxHp > hp` (`js/entities.js:975-976`) —
   so a fresh, undamaged veteran/elite enemy looks pixel-identical to a
   regular one. Once damaged, the sole differentiator is bar color: `#ffd95e`
   (elite) / `#a06ce8` (veteran) / `#e8484f` (regular, implicit) —
   `js/entities.js:977-979`. There is no separate model scale, tint, icon,
   or text label tied to `grade` (confirmed: `grade` only modifies
   `maxHp/dmg/xpValue/coinDrop`, `js/entities.js:626-638`, nothing visual).
   A colorblind player, or anyone who doesn't stop to read a thin 4px bar
   mid-fight, has no way to recognize a harder enemy before committing to
   the engagement.
5. **Text-contrast failures on two label classes.** `.hub-attr-desc`
   (`css/style.css:388`, the attribute-effect text like "DMG +0.5") and
   `.hub-quest-reward` (`css/style.css:520`) both set `color: #6b5e96` at
   10px on the near-opaque `rgba(14,11,22,0.88)` overlay backdrop —
   measured contrast ratio **≈3.25:1**, below the WCAG AA 4.5:1 threshold
   for normal-size text (10px is well under the "large text" 18pt/14pt-bold
   exemption that would allow 3:1).
6. **Overlay-hide inconsistency exists, but is not player-reachable in normal
   play** — worth noting for robustness, not urgency. `hideAllOverlays()`
   (`js/game.js:957-965`) hides `hub/result/menu/stats-overlay/raid-warning/
   trader/questgiver` but not `levelup` or `inventory`; those two are only
   ever closed by their own dedicated functions. In normal play the state
   machine prevents this from mattering (you can't reach town/NPCs while a
   level-up is pending). I hit it only by driving `game.state` directly in
   headless testing.
7. **Onboarding is effectively absent in-game.** Across every screen
   exercised (menu, combat HUD, level-up, inventory, town, Barkeep, Trader,
   Quest Giver, lobby, map, hub) the only in-game teaching is the one-line
   control hint on the menu (`index.html:27-28`) and the fading combat hint
   (`js/hud.js:160-168`). Nothing in-game explains: what attributes do
   beyond the one-line description already on the Barkeep screen (only
   visible *after* finding the Barkeep), what a tier is or why doors are
   locked until you walk up to one, what the raid mechanic is before the
   first raid warning fires, or that the world map exists at all before a
   player stumbles into the "‹ Hub" → "Choose Dungeon" → map path. README.md
   carries all of this framing; a first-time player who never opens the repo
   sees none of it. No first-run tutorial, tooltip-on-first-encounter, or
   guided first town visit exists in the code I read.
8. **Co-op guest access is extremely narrow, and it visibly shapes the
   partner's experience, not just a roadmap footnote.** A guest can only
   ever be in `play/levelup/won/lost` — no town, no lobby, no world map, no
   inventory, no attribute spending, no trading, no quests. Practically:
   a joined friend cannot manage their own gear or spend attribute points at
   all (that's Barkeep-only, town-only, host-only), cannot see the world map
   to know what's next, and every return to town between runs happens
   without them. `docs/GAME_DESIGN.md:167` already flags this as a roadmap
   gap; I confirm it's a first-class UX limitation, not a minor parity gap —
   for a co-op-forward game this materially changes what "playing together"
   means outside of active combat.
9. **World map hint text doesn't adapt for touch**, unlike the HUD and the
   town/lobby overlay text. `"Click a location to travel there"`
   (`js/game.js:1937`) is static regardless of `DD.input.touchSeen`, while
   the equivalent town subtitle correctly branches
   (`js/game3d.js:359-361`). Minor, but an inconsistency in an otherwise
   touch-aware copy pattern.
10. **Two overlapping "home base" surfaces** (Hub DOM overlay and the
    walkable Town scene) both expose stats/switch-class/co-op entry points
    with different layouts and different reachable NPCs, and
    `docs/GAME_DESIGN.md:78` calls `hub` "legacy... reachable via map Esc" —
    but the actual boot path lands *every* returning player there first
    (`js/game.js:2476-2482`, comment at `:2479-2481` explicitly says the hub
    is "the home base with Host/Join Co-op, gear and Choose Dungeon"). Two
    screens doing overlapping jobs, one of them mis-described as incidental
    in the design doc, is worth resolving even if neither is currently
    broken (see Discrepancies).

## Next steps

1. **Fix the World Map's rendering path.** Either add `map` to
   `ROOM_3D_STATES` (routing it through the same full-screen 3D peaceful
   path as town/lobby/hub) or give `drawMap` its own canvas-filling
   transform instead of `DD.view`'s `FIXED_ROOM` letterbox. This is the
   highest-impact, most reachable-by-real-players issue found, and it
   directly contradicts the design brief's mobile-first mandate on the
   screen most players use to navigate the entire game.
2. **Generalize the overlay top-align fix the team already wrote.** Drop the
   `@media (max-width: 720px)` scoping (or widen it to cover the actual
   failure condition — content taller than viewport — rather than a fixed
   breakpoint) and add `#hub` to it. This is a small, mechanical CSS change
   that closes three separate clipping bugs (#2, #3 above) at once, since
   the fix and the root-cause comment already exist in the codebase.
3. **Give enemy grade a non-color signal** (a small icon/pip, a name-tag
   prefix, or a distinct silhouette/tint on the model itself) and fix the
   two sub-AA-contrast label colors. Both are small, contained changes with
   outsized accessibility payoff.

## Salvage or rebuild?

**Keep and improve — nothing found here justifies a rebuild.** Every issue
above is a contained, mechanical fix, not evidence of a broken approach:

- **The hybrid DOM-overlay + canvas-HUD + 3D-scene architecture is sound and
  worth keeping.** It's a normal, well-executed pattern for this genre —
  cheap DOM for text-heavy menus, canvas for the fast-updating HUD, 3D for
  the world. `js/hud.js` in particular is genuinely good work: the narrow/wide
  branching is real responsive logic, not an afterthought, and it was
  clearly built and tested at multiple viewport widths.
- **The screen flow and state machine are legible and worth keeping.** 15
  states in one string is a bit flat/sprawling as it grows, but it maps
  cleanly onto the documented flow in `docs/GAME_DESIGN.md` and every
  transition I drove behaved predictably. This is refactor-later territory,
  not rebuild territory.
- **The touch input layer (`js/input.js`) is solid and should be kept as-is.**
  Twin-stick with deadzone, correctly-sized touch targets, class-correct
  DASH gating, `touchSeen`-based UI switching — this reads as software
  written by someone who actually tested on a touch device, which is the
  opposite of what you'd rebuild.
- **The one piece I'd genuinely redo rather than patch is the World Map's
  rendering path** (item #1 above) — not because the *design* of the map
  screen is bad (the node layout, dashed paths, hub button, and tap
  interaction model are all fine and worth keeping), but because it's the
  one screen still wired to a legacy 2D transform everything else has moved
  past. That's a routing fix, still cheaper than a rewrite.
- **The CSS overlay-clipping bug (items #2/#3) is the strongest single
  argument that a fix pass, not a rewrite, is right for this domain**: the
  team already correctly diagnosed and fixed this exact bug once (the
  comment at `css/style.css:487-489` proves it) and simply didn't apply it
  everywhere. That's a five-minute fix sitting in an already-good codebase,
  not a sign of a broken foundation.
- **Onboarding needs to be built, not salvaged** — there's nothing to keep
  or discard because it doesn't exist. This is additive work regardless of
  whether the rest of the repo is kept or the project restarts, so it isn't
  a factor in the keep/rebuild decision either way.

## Discrepancies

- `docs/GAME_DESIGN.md:140-141`'s NPC table marks **Trader** and **Quest
  Giver** as `stub ("coming soon")`, but `docs/GAME_DESIGN.md:184-186`'s own
  roadmap section marks both "✅ Shipped," and the code confirms shipped:
  `buildTraderOverlay` (`js/game.js:1097`) and `buildQuestGiverOverlay`
  (`:1204`) are fully wired to their NPCs (`openTraderMenu`/
  `openQuestGiverMenu`, `:1084,1176`) with working buy/sell and
  accept/track flows, confirmed live in this audit. The NPC table is stale
  and should be corrected or removed.
- `docs/GAME_DESIGN.md:78` describes `hub` as a "Legacy hero panel
  (reachable via map Esc)," which undersells it: the normal boot path for
  any returning player lands there directly and it's the only route to
  Host/Join Co-op for an existing hero (`js/game.js:2476-2482`, with the
  inline comment at `:2479-2481` explicitly explaining why it was made the
  landing screen instead of the map). It's a primary screen, not an
  Esc-only fallback.
- **README.md:33's "Dash (Rogue only)" is correct, not a discrepancy** —
  called out here only because the audit brief flagged it as a likely one;
  verified against `js/entities.js:25,223` and `js/hud.js:200` and found
  consistent.

## Hand-offs

- → graphics: enemy `grade` (veteran/elite) has no visual distinction on the
  model itself — no scale, tint, or marker change, only a post-damage HUD
  bar color (`js/entities.js:626-638` vs. `:975-979`).
- → systems-design: the Quest Giver's "available quests" list shows the
  entire pool (~8 quests) at once, unpaginated, which is what drives the
  overlay overflow in item #2 — whether to cap/paginate/filter that list is
  a systems call; I only own the layout consequence.
- → qa: confirm whether the PeerJS host failure seen in this sandbox
  ("Establishing a tunnel via proxy server failed" / "Lost connection to
  server") is a sandbox network restriction or reproducible against the real
  public broker in production — I could not complete a live co-op pairing
  test either way.
