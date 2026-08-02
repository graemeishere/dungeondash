# Phase 4 kickoff prompt

Dungeon Dash — Phase 4 of the execution roadmap: content and identity.

Prerequisites: Phase 0, 1, 2, and 3 are all merged to master. Confirm that
before starting — if any isn't landed, stop and say so.

Read docs/design/roadmap.md first — decision log, coverage matrix, Phase 4
section. Decisions there are settled; raise a NEW problem if you find one,
don't re-litigate a closed one. Also skim docs/design/audit-narrative.md,
docs/design/audit-graphics.md, and docs/design/audit-audio.md for this
phase's full context (Phase 4's roadmap section only summarizes them).

IMPORTANT — stale citations. All file:line references in the roadmap and
audits predate Phases 0-3's module split and UI/rendering changes. Locate
code by symbol name: NPC interact/dialogue plumbing (`js/town.js`,
`js/game3d.js`'s `drawPeacefulOverlay`), quest defs (`js/profile.js`'s
`QUEST_DEFS`), enemy faction/model keys (`enemyModelKey`, `js/game3d.js` /
`js/entities.js`), boss data (`bossName`/`bossHp`/`bossDmg`, wherever the
tier/floor keying now lives), swing-trail and telegraph effects
(`js/fx3d.js`, `js/game3d.js`), and all of `js/audio.js`.

This phase runs its three specialists **sequentially, not concurrently**
(the roadmap's explicit ordering) since later specialists build on earlier
ones' output:

## 1. `narrative` (first)

- One characterizing line per NPC on first interact — the `[E] Talk to…`
  prompt currently promises a conversation and opens a stats panel instead.
  This was blocked on Phase 3's overlay CSS fix (decision 11), which is now
  merged.
- Rewrite the ~10 quest descriptions with a requester's voice and a reason,
  against the existing `desc` field — no data-model change.
- Faction identity (naming/flavor) for skeleton, goblin, and undead, which
  currently have none.
- Per-floor boss names for decision 13 (systems un-keyed `bossName`/`bossHp`/
  `bossDmg` from tier to floor in Phase 2; narrative supplies the names —
  confirm that Phase 2 groundwork actually landed before writing to it).

## 2. `graphics` (second, after narrative's faction names exist)

- Per-faction texture variants of the shared `skeleton_texture.png`, bound
  per faction in `enemyModelKey`, so skeleton/goblin/undead stop reading as
  visually identical.
- Re-verify swing-trail and telegraph contrast against each theme's floor
  palette — the audit's own screenshot method (the "pin trick") was
  inconclusive, so find a screenshot method that reliably catches these
  short-lived effects mid-life (see `.claude/skills/verify/SKILL.md`'s note
  on pinning `t`/`life` on `DD.fx3d` effects) and render an actual verdict,
  not another "inconclusive."

## 3. `audio` (third)

- Master `GainNode` and limiter **first, before anything else in this
  block** — an instrumented fight measured 8 concurrent one-shots summing to
  1.48 linear gain straight into the destination node (real clipping risk).
  Note: Phase 3 added a provisional linear `masterVolume` multiplier in
  `js/audio.js` (`setMasterVolume`/`getMasterVolume`) to give the new
  Settings slider something to control ahead of this proper build — replace
  it with the real shared-GainNode/limiter architecture rather than stacking
  a second gain stage on top of it, keeping the `audio.setMasterVolume(v)`
  contract the Settings UI already calls into.
- Vendored CC0 music and ambience (decision 6 — real files, not procedural,
  matching the precedent the 3D art packs set).
- Coverage gaps: boss-slam telegraph audio on *onset*, not just impact (the
  `slamAnimAt` rising-edge hook already exists for this); a downed-state cue;
  a low-HP cue.
- Split the two cue collisions: `door()` currently plays for both room-lock
  and room-clear; `chest()` plays for chest-open, purchase, and loot.

## Verification

Serve on :8123, drive headless per `.claude/skills/verify/SKILL.md`. Confirm:
NPC dialogue lines actually render on first interact per NPC; quest
descriptions read in-voice in the Quest Giver overlay; each faction is
visually distinct in a live combat room; the swing-trail/telegraph contrast
verdict is backed by an actual screenshot, not a repeat of "inconclusive";
audio doesn't clip/distort in an 8-concurrent-one-shot fight (re-measure the
1.48 linear gain figure post-fix); music/ambience actually plays; boss-slam
telegraph audio fires on windup onset; downed and low-HP cues fire; door
lock vs. clear and chest vs. purchase vs. loot are now distinguishable sounds.
Run `node dev/room-checks.mjs` and `node dev/phase0-checks.mjs` — account for
any change (e.g. new audio files may need a load-settled predicate, or a new
boss-name/faction data shape may need a check-script update).

Use the `narrative`, `graphics`, and `audio` sub-agents in that sequence to
lead their sections. Use `qa` to verify after each, or once at the end if the
three sections don't touch overlapping files — check with `producer` if a
cross-domain conflict looks likely (e.g. graphics' faction textures and
narrative's faction naming touching the same enemy-identity surface).

Stop at the end of Phase 4 and report before starting Phase 5 (if the
roadmap defines one) — check docs/design/roadmap.md for whether Phase 4 is
the last phase or more remain.
