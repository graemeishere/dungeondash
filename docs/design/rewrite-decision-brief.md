# Rewrite Decision Brief

Synthesis of the seven `## Salvage or rebuild?` verdicts. Each specialist
judged **their own domain only**. Read their sections directly; this document
exists to say whether their verdicts are compatible with each other.

---

## The seven verdicts

| Domain | Verdict | Their reasoning, in their terms |
|---|---|---|
| Narrative | **Salvage, additively** | "The gap is almost entirely *absence*, not *wrongness*." The naming scaffold (`QUEST_DEFS`, `ELITE_NAMES`, floor/elite/item names) is coherent and reusable; a rebuild would reinvent it "for no benefit". The one thing to unwind is the boss-name reuse pattern — "a content decision, not a technical one". |
| Level design | **Keep and improve** | The macro-grid + biased-walk generator "already produces a floor that reads correctly and plays correctly end to end (verified live)". Rebuilding "would very likely reproduce something close to what's already here". **Exception:** would not carry forward two parallel traversal systems — pick the floor generator, port the classic path's obstacle carving, room-shape variety, and working trap spikes into it. |
| Systems design | **Keep and tune — do not rebuild** | "None of the problems found here are structural." Every finding is "a data or formula fix in a handful of well-isolated tables". The biggest one (rewards not following tier scale) is "a two-line change per call site once you know to look for it". Rogue's spread and the 6-upgrade pool need real rework — "still numbers-only fixes, just bigger ones". |
| UX/UI | **Keep and improve** | The hybrid DOM-overlay + canvas-HUD + 3D architecture is "a normal, well-executed pattern"; `js/hud.js` and `js/input.js` read as "software written by someone who actually tested on a touch device". The CSS overlay-clipping bug is called "the strongest single argument that a fix pass, not a rewrite, is right" — the team already diagnosed and fixed that exact bug once and just didn't apply it everywhere. **Exception:** would genuinely redo the world map's rendering path. **Onboarding doesn't exist**, so it's additive either way and "isn't a factor in the keep/rebuild decision". |
| Graphics | **Keep and improve — strongest domain in the repo** | Art packs: "keep, unconditionally" — 151 MB of legally-clear CC0 content that a restart would have to re-source "for no visual upside". `render3d.js`/`decor3d.js` are "the best-engineered code I read anywhere in this audit". `char3d.js`/`fx3d.js`: "keep the architecture, fix the data" — the enemy monoculture is "a content/data problem layered on a good system". |
| Audio | **Neither word fits** | "This domain hasn't been built yet, not built badly." 83 lines is "a sketch, not an implementation with debt" — little to lose by starting clean, little to gain by insisting on a rewrite. The `tone()`/`noise()` helpers are worth keeping regardless. The real question is procedural-vs-vendored, "a call for whoever owns the project's overall art direction". |
| QA | **Keep and improve — "the verdict is not close"** | The hard part is already **debugged**, not just written: gating/lock/unlock semantics, the co-op snapshot protocol with object-identity reuse, save-mode-mismatch defense — "accumulated fix-up for edge cases that only shows up after the naive version was built and broke". **But:** "what should change is structure, not substance" — split `js/game.js` (2,567 lines), replace `window.DD` + fixed `<script>` order with real ES modules and a minimal build step. "This is a codebase with real, hard-won behavior worth keeping, wrapped in a file/module structure that's actively working against maintaining it." |

**Lean salvage: all seven. Lean rebuild: none.** Genuinely mixed: qa
(substance salvage / structure rebuild), level design (generator keep /
duplicate-path retire), audio (neither category applies), graphics (code keep
/ enemy asset data gap).

---

## Do the disagreements matter?

Mostly no — and understanding *why* is the point.

**Where they're compatible.** Four domains state outright that their
deliverable is stack-independent: narrative's text "carries over losslessly…
none of it is coupled to three.js, the canvas renderer, or any other technical
choice"; systems' tuning "would survive a full engine/stack rewrite with zero
loss — it's arithmetic on plain objects"; level design's `floor.js` algorithm
"is worth porting near-verbatim rather than redesigning from zero"; audio's
synth helpers "have no dependency on three.js/canvas/anything else being
reconsidered". The art packs are inert data. So qa's structural rebuild
proposal — the only rebuild-shaped verdict in the set — destroys none of what
the other six want preserved. Design intent, tuning values, assets, and code
have different lifetimes here, and that separation is real, not rhetorical.

**But the same fact cuts the other way, and this is the load-bearing point.**
If design intent and tuning survive a rewrite untouched, then a rewrite also
**does not fix them**. Every gameplay complaint in these seven audits is a
content, data, or tuning problem, not an architecture problem: rewards not
scaling with tier, Sharpened Edge dominating Quick Hands, coverless combat
boxes, inert trap and side rooms, nine enemy kinds rendering as one skeleton,
NPCs with no dialogue, no music, no onboarding. A new repo starts with all of
those still unfixed, plus zero of the debugged edge-case behavior qa
enumerates. That is the strongest single argument in the set, and it comes
from the two specialists with the least incentive to protect the code (qa and
level design) both independently reaching it.

**Where they are *not* compatible — three real collisions:**

1. **Retiring the classic path is a deletion with an ordering constraint.**
   Level design wants one traversal system; qa wants raids and the finale
   routed through the floor generator. Both are right and they are the same
   move — but floor mode currently lacks the obstacles and trap hazards the
   classic path has. Do it in the wrong order and the two biggest set-pieces
   regress. This is a rebuild of one subsystem living inside an
   otherwise-salvage plan.
2. **qa's module split is a one-way door for everyone else's citations.**
   Six audits are written against `file:line` in the current layout. Splitting
   `js/game.js` first makes those coordinates stale; doing the content fixes
   first means redoing them after the split. Sequencing has to be decided, not
   discovered.
3. **The material-tint channel is claimed twice** (graphics for faction
   identity, ux-ui for enemy grade). Detailed in `audit-summary.md` §2.

**One thing no audit answers.** These are seven verdicts on *craft within a
domain* — is this code, these numbers, this text well made. None of them is a
verdict on whether the core loop is fun. If your dissatisfaction with
"gameplay/design" is with the concept rather than its execution, nothing in
these seven documents speaks to it, and no salvage/rebuild answer derived from
them will either. That distinction is worth resolving before weighing anything
below.

---

## Recommendation — for you to decide on, not decided

**Hybrid: refactor in place, rebuild two subsystems.** Specifically —

- **Keep** the repo, the art packs, the render/decor stack, the stat pipeline,
  the floor generator, the co-op protocol, the persistence layer, the input
  layer, and all existing text and tuning tables. No specialist found a broken
  foundation in any of them, and the game ships and plays today.
- **Rebuild in place** the two things that actually were called out as
  structurally wrong: `js/game.js`'s 2,567-line concentration plus the
  `window.DD` + script-order coupling (qa), and the duplicate traversal system
  (level design) — with the classic path's obstacle carving, room-shape
  variety, and trap spikes ported into floor mode *before* raids and the
  finale are routed onto it.
- **Build fresh** the two domains that don't exist to salvage: onboarding
  (ux-ui: "needs to be built, not salvaged") and music/ambience (audio: "hasn't
  been built yet, not built badly").

**Reasoning.** The code-quality complaint maps precisely onto one finding with
a mechanical fix, and the gameplay complaint maps onto content and tuning that
a new repo would inherit unfixed while forfeiting the debugged behavior qa
documents. A full rewrite pays the cost of both complaints and resolves
neither by itself.

**What would change this.** If the answer to "is the core loop right?" is no,
this recommendation is answering the wrong question, and the salvage verdicts
below the design layer stop being the deciding input. That call is yours.
