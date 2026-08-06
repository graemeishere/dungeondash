# Phase 5 kickoff prompt

Dungeon Dash — Phase 5: cleanup and settings completion.

**Note before starting:** `docs/design/roadmap.md` does not define a Phase 5 —
its phase list ends at Phase 4, which is now merged to master. This document
is not sourced from that roadmap; it's a punch-list assembled from (a) two of
the roadmap's own "cross-cutting corrections" that were never actually fixed
despite being marked "fold into whichever phase touches the file," and (b)
real gaps Phase 4's `narrative`/`graphics`/`audio`/`qa` passes surfaced and
explicitly handed off rather than fixed themselves. It's a smaller, single-
sweep phase, not a new audit cycle — don't re-run the seven specialist audits.

Prerequisites: Phase 4 is merged to master (`f2e4a61`). Confirm before
starting.

IMPORTANT — stale citations. Locate everything below by symbol/function name,
not by trusting any file:line number in this doc or in older docs it
references — the codebase has changed since those were written.

## 1. `qa` (first — these are confirmed, reproducible bugs, not judgment calls)

- **NPC sprite-key mismatch, still live.** `js/town.js`'s NPC table declares
  `sprite: "npcQuestGiver"` (capital G in "Giver"), but `js/sprites.js`'s NPC
  sprite generator builds keys as `"npc" + kind[0].toUpperCase() + kind.slice(1)`
  over `["barkeep","innkeeper","trader","questgiver"]` — for `"questgiver"`
  that produces `"npcQuestgiver"` (lowercase g). `js/town.js`'s draw code
  (`sprites[npc.sprite] || sprites.npcBarkeep`) silently falls back to the
  Barkeep sprite, so the Quest Giver renders as the Barkeep in the live town.
  Fix by making the two sides agree (either change the generator's casing for
  this one kind, or change the declared sprite key to match what's actually
  generated) — confirm visually in town afterward, not just by reading code.
- **`bossKill`/`clearDungeon` quest goals still indistinguishable.** `js/run.js`
  (~line 316-317) passes the identical `clearedDungeon` value to both
  `bossKill:` and `clearDungeon:` in the same event object. Any quest gated on
  one type completes identically to the other with no way to tell them apart
  from the emitted event — this was flagged in the original roadmap as a
  cross-cutting correction and never landed. Give them independent, correct
  semantics (bossKill fires when *the dungeon's boss* dies; clearDungeon fires
  when *every floor* is cleared — these are different moments in a run, work
  out which call site actually knows which one just happened).
- **Doc staleness, both confirmed still wrong:**
  - `.claude/skills/verify/SKILL.md`'s "jump to a specific room" trick
    (`game.floor = F; game.roomIndex = I - 1; state = "transition"; ...`)
    claims "the transition machinery calls `advanceRoom()` next frame" — no
    `advanceRoom` function exists anywhere in the repo. The actual call is
    `advanceFloor()` (`js/run.js`), which generates an entirely new floor, not
    a jump within the current one. This misled Phase 4's own qa pass; fix the
    doc (either restore real room-jump behavior worth documenting, or correct
    the doc to describe what actually happens and how to reach a specific room
    type today).
  - `README.md`'s "Code layout" section still describes `js/game.js` as "state
    machine, main loop, wiring" — that file was split apart in Phase 0's
    module refactor and no longer holds that role. Update the section to
    describe the current module layout (`js/run.js`, `js/draw.js`, `js/town.js`,
    etc. — check current responsibilities by reading each file's top comment
    rather than guessing from name alone).

## 2. `narrative` — one open decision, not a defect

- **`RAID CAPTAIN` name collision, still live and known.** `js/state.js`'s
  goblin elite-name pool includes `"RAID CAPTAIN"`, and `js/town.js`'s town-raid
  boss is hardcoded to the same string regardless of which faction is raiding
  — so a skeleton-faction raid is still nominally led by someone the game also
  calls a goblin mining elite, and the strings read as one reused label, not a
  connected character. This was explicitly left open by the Phase 2 narrative
  pass as an out-of-scope call, not missed. Decide and fix: either rename the
  raid boss per-faction (matching the per-floor boss-name pattern from
  decision 13), or rename the goblin elite, or give both a deliberate shared-
  identity explanation if that's actually the better story. Don't silently
  re-litigate decision 13's pattern — extend it consistently if that's the
  fix.

## 3. `ux-ui` — the audio settings surface is half-built

`docs/design/audio-spec.md` §4.1 specifies four sliders (Master, SFX, Music,
Ambience), each a `[0,1]` multiplier persisted via `js/audio.js`'s
`set/getSfxVolume()`, `set/getMusicVolume()`, `set/getAmbienceVolume()` — all
three of those setter/getter pairs exist and work, but only the Master slider
was ever wired to DOM (`index.html`'s `#settings-volume`, `js/boot.js`). Add
the three missing sliders to the existing `#settings` overlay, following the
same pattern as the Master one (range input, `input` event → the matching
`audio.set*Volume()` call). No mute toggle needed — per the spec, zero on a
slider already is mute.

- **Also wire the menu hover/nav SFX Phase 4's audio pass built but didn't
  attach.** `js/audio.js` has ready `menuHover()`/`menuConfirm()`/`menuBack()`
  methods, unused by any DOM element (explicit, documented scope cut in the
  Phase 4 audio pass — not a bug, just unfinished wiring). Attach `menuHover()`
  to interactive element hover and `menuConfirm()`/`menuBack()` to
  confirm/cancel-flavored buttons across the menu/settings/hub/overlay screens
  — use judgment on which buttons count as "confirm" vs. plain clicks (e.g. a
  primary action button vs. a Close button), the spec calls these the
  quietest, most-frequent cues in the roster, so don't over-fire them.

## 4. `systems-design` — one decision needed before anyone can build on it

- **No low-HP state exists anywhere in the game** (confirmed by grep — no
  low/critical-HP concept in any `.js` file). Both the original audio audit
  and Phase 4's audio pass flagged this as a dependency they can't build
  against: a low-HP audio cue and a low-HP visual signal both need a defined
  threshold and a way to read "is the player currently low" before either can
  exist. This phase's job is the **decision and the state**, not the cue/visual
  themselves — define the threshold (e.g. a % of max HP) and expose a
  queryable/eventable low-HP state on the player. Hand off to `audio` and
  `ux-ui` for the actual cue/indicator in a following pass once this lands.

## 5. `audio` — one documented, optional follow-up

- **Goblin-mines ambience bed is thinner than the catacombs/crypt beds** — it
  shipped as a dripping-water-only substitute with no clank/chatter layer
  (`assets/audio/CREDITS.md` has the full story). The blocker was Freesound's
  login wall, not network access (this environment now has general internet
  access, confirmed working). If a Freesound account is available this time,
  revisit `docs/design/audio-spec.md` §3.1's original goblin-mines ambience
  candidates; otherwise this is fine to leave as documented and skip.

## Verification

Serve on :8123, drive headless per `.claude/skills/verify/SKILL.md` (fix its
stale room-jump claim first per §1 above, or work around it as Phase 4's qa
pass did — teleport the player directly within the already-loaded floor
instead of trusting the documented trick). Confirm: the Quest Giver renders
with its own sprite in town, not the Barkeep's; a `bossKill`-gated and a
`clearDungeon`-gated quest complete at genuinely different moments in a run;
the raid-boss/goblin-elite name collision is resolved one way or the other;
all four settings sliders (Master/SFX/Music/Ambience) move their respective
audio buses independently; menu hover/confirm/back cues fire without being
obnoxious in normal menu navigation. Run `node dev/room-checks.mjs` and
`node dev/phase0-checks.mjs`.

Report back when done — this is a short, single-sweep phase; no further phase
is defined after it unless new work is found while doing this one.
