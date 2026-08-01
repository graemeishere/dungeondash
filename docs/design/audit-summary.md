# Cross-Audit Summary — conflicts and open questions

Producer pass over the seven specialist audits. This document does **not**
summarize their findings — read them directly. It only covers the seams
*between* them: where they contradict, where they overlap, where one silently
depends on another, and what only you can decide.

Headline: the seven audits are unusually consistent on facts. There are three
real contradictions, all small and two now resolved against the repo. The
substantive seams are ownership gaps and unstated dependencies, not disputes.

---

## 1. Direct contradictions

**a. How many enemy kinds are dead code.** `audit-narrative.md:140` says
`shade` is the dead kind. `audit-systems.md:19` and `audit-qa.md:8` both say
`shade` **and** skeleton `bomber`. Resolved in repo: systems and qa are
correct. `js/game.js:57-101,1337` lists `goblinBomber` but never bare
`"bomber"` or `"shade"`; both have full stat/AI/sprite branches
(`js/entities.js:578-624,670-671,821-830`). Narrative's list is incomplete,
not wrong.

**b. Asset and deploy numbers.** `audit-graphics.md:59` cites
`.github/workflows/pages.yml:35` for `exclude_assets` and says "working tree
is 213 MB"; `audit-qa.md:201` cites `pages.yml:28` and "214 MB repo /
105.5 MB unreferenced". Resolved: `exclude_assets` is at **pages.yml:35**
(graphics correct). `du`: **214 MB with `.git`, 151 MB working tree**
(qa's 214 is the repo, graphics' 213 is not the working tree). Since the five
art packs total 151 MB by graphics' own count, the packs are effectively the
entire working tree. Both agree on the actionable part — ~105 MB of
`.fbx`/`.obj`/`Textures/`/`Samples/` ships to Pages unreferenced.

**c. The `[E] Talk to <NPC>` prompt gets opposite verdicts.**
`audit-narrative.md:116-120` calls it the domain's largest gap — "'Talk to'
promises a conversation; what happens is a stats/shop/quest-list panel opens"
— and hands ux-ui the choice. `audit-ux-ui.md:113-115` lists "NPC talk
prompts are context-aware" under **What's solid** and never addresses the
hand-off. Not a factual conflict (ux-ui is praising the touch/keyboard
adaptivity, narrative is faulting the semantic promise), but it is the one
artifact in the repo two specialists graded in opposite directions. See open
question 5.

**d. Asset philosophy points two ways.** `audit-audio.md:190-199` argues the
project has already moved from "everything is code-generated" toward
"authored assets, vendored in", and that music/ambience should follow that
path as vendored CC0 files rather than extending `tone()`/`noise()`.
`audit-graphics.md:234-239` keeps the procedural `sprites.js` and notes it
"already has the per-kind art variety the 3D path lacks — worth knowing if
the fastest path to faction distinctness turns out to be leaning on these 2D
representations more". A recommendation conflict, not a factual one, and
audio explicitly declines to settle it. See open question 4.

### Not conflicts — same fact, different lane

Listed so you don't read these as disagreement: the same-boss-three-times-per-tier
finding appears in narrative (naming), systems (values), and level-design's
inbox (pacing); the dead `shop` room in level-design, systems, and qa; inert
`shrine`/`storage`/`dining` in level-design and qa; raids/finale on the
classic generator in level-design and qa; the ~105 MB unreferenced asset ship
in graphics and qa; and `docs/GAME_DESIGN.md:140-141`'s self-contradiction
about Trader/Quest Giver stubs, found independently by **four** specialists.
Convergence, not friction.

---

## 2. Overlapping ownership

**Difficulty (level-design × systems-design) — the canonical overlap did not
happen; a gap opened instead.** `audit-level-design.md:5-6` explicitly
disclaims enemy stats ("Not scored: enemy stats/HP/damage (systems-design)");
`audit-systems.md:53` explicitly defers pacing ("Whether that's fine pacing is
level-design's call"). Each deferred cleanly — so nobody produced a view of
where Tier 3's difficulty actually comes from. Systems has it as HP: enemy
`scale` 1.0→6.0, TTK growing 11× (`audit-systems.md:35-43`). Level-design has
it as space: every combat room is a coverless 5×4 box with no obstacles
(`audit-level-design.md:104-112`) and enemy count capped at
`clamp(3+floor+combatIdx, 3, 6)` (`js/game.js:381`, level-design's citation).
Neither models the combination.

**In-world readability (ux-ui × graphics) — genuine overlap, same visual
channel.** `audit-ux-ui.md:167-178` owns the finding that enemy `grade` is
color-only and post-damage-only, and its Next Step #3 proposes fixes spanning
both lanes ("a small icon/pip, a name-tag prefix, or a distinct
silhouette/tint on the model itself"). `audit-graphics.md:138-149` owns the
larger finding that all nine enemy kinds and five bosses collapse onto four
skeleton GLBs, and proposes a tint/texture-swap pass as the cheap fix
(`audit-graphics.md:191-197`). Both proposals claim **material tint** — one to
encode faction, one to encode grade. That channel can't carry both without a
decision.

**Side-room payoff — owned by nobody.** `audit-level-design.md:227-229` hands
systems "what should they give"; `audit-qa.md:356-359` hands level-design
"whether they're worth populating". `audit-systems.md` never mentions
`shrine`/`storage`/`dining` at all. Level-design's own Next Step #3 offers
"payoff or trim" but routes the *what* back to systems. Closed loop, no owner.

**Overall art direction — no such role among the seven.**
`audit-audio.md:200-203` ends by deferring to "whoever owns the project's
overall art direction". Graphics owns the 3D pipeline, not that question.

---

## 3. Hand-off traffic

The audits were produced in parallel, so **most hand-offs are structurally
unanswered** — the recipient's document was already written. Treat the list
below as routing, not as neglect. The signal worth reading is *convergence*.

**Two specialists independently routed the same issue to the same owner:**

- **Boss escalation floor-to-floor → level-design.** From
  `audit-narrative.md:223-225` (floor names promise depth the boss doesn't
  back up) and from `audit-systems.md:82` (`bossHp`/`bossDmg`/`bossName` are
  tier-keyed, `js/game.js:114-128`). `audit-level-design.md` does not discuss
  bosses anywhere. This is the most-referred, least-owned issue in the set.
- **Minimap / spatial awareness → ux-ui.** From
  `audit-level-design.md:244-247` (does the minimap distinguish critical path
  from side-room detour?) and from `audit-graphics.md:271-274` (does the
  HUD/minimap compensate for the tight follow camera's lack of approach
  warning?). `audit-ux-ui.md` inventories `drawMinimap` (`js/hud.js:235-303`)
  but renders no legibility verdict on it.
- **README's phantom boss roster → narrative.** From `audit-systems.md:85`
  and `audit-qa.md:364-367`. **Answered** — narrative covers it in
  Discrepancies and in its salvage verdict.

**Hand-offs that landed and were answered:** ux-ui→qa on the PeerJS broker
failure (qa confirms it's the sandbox proxy, `audit-qa.md:69-73`);
narrative→qa on `shade`; systems→qa on `item.levelReq`. All three answered by
qa, because qa's scope covered them anyway.

**Never answered, worth re-routing deliberately:** level-design→graphics
(obstacle prop clusters at `js/decor3d.js:644-652` are dead weight in floor
mode — graphics doesn't mention it); level-design→qa (the critical-path random
walk `js/floor.js:58-80` has no safeguard against an early break);
systems→ux-ui (nothing surfaces `effDmg` rounding breakpoints);
audio→ux-ui (there is no settings surface anywhere for a volume control to
live in); audio→graphics (chiptune SFX vs KayKit 3D read as two different
games); qa→systems (would risk-free farming still be a problem if `?safe`
were gated?); qa→ux-ui (is the Quest Giver silently rendering as the Barkeep
an acceptable stopgap?).

---

## 4. Unstated dependencies

Where one specialist's recommendation silently requires another's domain to
move first:

1. **qa's raid/finale fix inherits level-design's gaps.**
   `audit-qa.md:310-313` says route raids and the finale through the floor
   generator. But `audit-level-design.md:104-126` establishes that floor mode
   has *no interior obstacles* and *no working trap hazards*, while the classic
   path raids currently use *does* carve notches/obstacle clusters
   (`js/room.js:62-94`) and *does* have working spike bands
   (`js/game.js:636-643`). Routing first, carving second, makes the two
   advertised set-pieces blander than they are today.
2. **systems' highest-value fix presupposes a level-design pass that hasn't
   happened.** `audit-systems.md:83` says correcting reward scaling needs a
   matching encounter-density curve. That pass is not in `audit-level-design.md`.
3. **narrative's writing needs a surface that currently overflows.**
   `audit-narrative.md:157-159` adds quest framing text to
   `buildQuestGiverOverlay`; `audit-ux-ui.md:136-156` measured that overlay at
   1017 px `scrollHeight` against 800 px viewport, with the title and Close
   button unreachable. More text before the CSS fix makes it worse.
4. **audio's volume control has nowhere to live.** `audit-audio.md:154-158`
   makes the master `GainNode` "the prerequisite for a volume slider whenever
   ux-ui wants one" — but ux-ui's full screen inventory
   (`audit-ux-ui.md:18-24`) contains no settings screen at all. Someone has to
   build a surface first.
5. **graphics and ux-ui both spend the material-tint channel** (see §2).
6. **level-design's obstacle carving revives graphics' dead prop category.**
   The crate-fort/obstacle clusters at `js/decor3d.js:644-652` are keyed to
   existing `OBSTACLE` tiles; the moment `js/floor.js` writes them, that
   dormant prop code starts placing. Level-design flagged it; graphics did not
   plan for it.
7. **narrative's faction writing renders identically until graphics lands new
   GLBs.** `audit-graphics.md:276-277` says so explicitly; narrative's salvage
   verdict does not account for it.
8. **qa's module split invalidates everyone's coordinates.**
   `audit-qa.md:283-299` proposes splitting `js/game.js` (2,567 lines) and
   replacing `window.DD` + fixed `<script>` order with ES modules. Every one of
   the other six audits is written against `file:line` in the current layout.
   Sequencing, not substance — but it's a one-way door for the citations.

---

## 5. Open questions for you

Each of these trades one domain against another. No specialist can settle them
alone, and I am not settling them.

1. **One traversal system or two?** Retiring the classic path
   (`audit-level-design.md:189-196`, `audit-qa.md:310-313`) removes a whole
   duplicate surface, but raids and the finale lose their current
   single-large-room feel, and floor mode must first gain obstacles and trap
   hazards. Keeping both doubles what every future fix has to be tested
   against. **Trade: maintenance surface vs. set-piece variety, plus fix
   ordering.**
2. **Does difficulty scale through numbers or through space?** Systems'
   Tier-3 is a 6× HP sponge with flat rewards; level-design's rooms are
   coverless boxes where more HP is the only lever available. Fixing rewards
   without changing geometry makes Tier 3 pay properly for the same flat
   fight. **Trade: tuning-table work (cheap, systems) vs. generator work
   (deeper, level-design), and who owns the combined answer.**
3. **Where does enemy distinctness get encoded — the model or the HUD?**
   Graphics wants tint/GLB work so three factions stop reading as one; ux-ui
   wants a non-color grade signal for accessibility. If tint carries faction,
   grade needs an icon/name-tag; if tint carries grade, factions need new
   assets. **Trade: asset/pipeline cost vs. HUD clutter — and you can't spend
   tint twice.**
4. **Procedural or vendored, as a project philosophy?** Audio argues the 3D
   migration already chose "vendored authored assets" and music should follow;
   graphics keeps procedural `sprites.js` and floats leaning on it *more* for
   faction variety. **Trade: repo weight and asset-pipeline burden vs.
   production quality and genre fit.** Audio explicitly says this is not its
   call to default on.
5. **`[E] Talk to <NPC>` — write the dialogue, or change the verb?**
   Narrative wants one characterizing line per NPC; the cheaper fix is
   re-wording the prompt to match the menu it actually opens. **Trade: content
   work vs. lowering the promise.**
6. **Side rooms — populate or trim?** Three of four `SIDE_TYPES` are inert on
   every floor. Systems must define *what* a shrine/storage/dining room gives
   before level-design can keep them; trimming to `treasure` only is free
   today. **Trade: exploration incentive vs. scope.**
7. **The `shop` room — reschedule or delete?** Fully built, unreachable in
   both paths, still advertised in `README.md:79`. **Trade: a live economy
   beat between floors vs. deleting code and correcting the README.**
8. **Is co-op a first-class mode or a demo?** `audit-ux-ui.md:207-217` (guests
   have no town, gear, attributes, map, or quests) and `audit-qa.md:122-132`
   (guests get raw level-1 stats and nothing they earn is ever banked)
   describe the same second player from two angles. Fixing it is real work in
   net, persistence, and UI. **Trade: co-op parity vs. everything else on the
   list.**
9. **Strip the URL flags or keep them?** `audit-qa.md:109-120` wants
   `?safe`/`?dev`/`?classic` gated out of production (`?safe` lets anyone farm
   risk-free on the live build). But `?classic` is the only escape hatch if
   floor mode regresses. **Trade: exploit surface vs. debug/fallback access.**
10. **Build step or no build step?** `audit-qa.md:293-299` wants ES modules
    plus a minimal bundler as the structural fix for the code-quality
    complaint. The project's current no-build-step identity is exactly what
    makes deploy a `sed` and a push. **Trade: enforced module boundaries vs.
    zero-toolchain simplicity.**
