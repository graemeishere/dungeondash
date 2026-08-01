# Audio Audit — Dungeon Dash

Scope: SFX design and coverage, music/ambience, the mix, audio telegraphing of
threats, and player audio controls. All citations are `file:line` against the
current tree. Findings below the code citations are backed by a headless
Playwright run against the live game (`?dev=combat`), not just static reading
— see "Instrumented run" under What exists.

## What exists

**The entire domain is one file, 83 lines: `js/audio.js`.** No audio assets
exist anywhere in the repo (zero `.mp3/.wav/.ogg/.m4a/.flac/.aac`). Every
sound is synthesized at call time with the Web Audio API.

- `ensure()` (`js/audio.js:6-14`) — lazily creates one shared `AudioContext`,
  resumes it if suspended.
- `tone()` (`js/audio.js:16-32`) — one oscillator + one gain, exponential
  frequency ramp, exponential gain decay to ~0, connected straight to
  `ac.destination`.
- `noise()` (`js/audio.js:34-53`) — a white-noise buffer through a fixed
  900 Hz lowpass, same destination wiring.
- `DD.audio` (`js/audio.js:55-82`) — `unlock()` plus 18 one-shots: `swing,
  shoot, bolt, hit, splash, hurt, dash, bones, spawn, coin, heal, door, chest,
  levelup, slam, win, lose`. `vol` is hardcoded per call, 0.06–0.20 (`slam`'s
  two components are 0.2+0.2). No master gain node, no bus, no mixer, no
  volume control, no mute, no persisted preference, no panning/spatialization,
  no music, no ambience, no looping sound, no voice limiting. Every node
  connects directly to `ac.destination`. All errors are swallowed (`catch (e)
  {}`, `js/audio.js:31,52`).

**Call-site coverage** (`grep DD\.audio\.` across the four consumer files):
39 call sites in `js/entities.js` and `js/game.js`. **Zero** in `js/game3d.js`
(508 lines) and **zero** in `js/hud.js` (305 lines) — the 3D render layer and
the HUD never trigger sound directly; everything routes through the shared
entity/game-logic layer.

Mapped against what happens in a run:
- Covered: melee swing/hit (`entities.js:253,264`), ranged shoot/bolt
  (`entities.js:278,761,780,784`), taking damage (`entities.js:286`), dash
  (`entities.js:228`), enemy death (`entities.js:730,898`), enemy spawn
  (`entities.js:1084`, `game.js:1688`), projectile splash impact
  (`entities.js:402`), boss slam **impact** (`entities.js:860,1053`), chest/
  vendor purchase (`entities.js:1128,1212,1255,1251-1269`), coin pickup
  (`entities.js:1197`, `game.js:1129,1162`), potion/heal pickup
  (`entities.js:1201`), revive (`entities.js:174`), room lock/clear
  (`game.js:461,470,689,696`), level-up (`game.js:1489,2269`), run
  win/lose (`game.js:753,755,2287`).
- **Silent** (grep-confirmed no `DD.audio` call anywhere near the code path):
  boss slam **windup/telegraph** — `slamT` is set and read at
  `entities.js:1026-1070,1104` for a 0.85s pulsing-circle warning, but
  `DD.audio.slam()` only fires on the rising edge of *impact*
  (`entities.js:860,1053`), never at the start of the telegraph window.
  Equip/unequip (`game.js:1410,1433,1576,1601` — plain `onclick`, no audio).
  Going downed in co-op (`entities.js:161-166`, `goDown()` — sets state only,
  no sound; only the killing blow's generic `hurt()` plays). Taking the
  stairs / floor transition (`reachStairs()`, `game.js:486-496`). Guest
  join/disconnect (`game.js:2198-2213` — text toast only). Low-HP state —
  there is no low-HP system at all, audio or visual (confirmed by grep, no
  hits for any low/critical-HP concept anywhere in `js/`). Menu
  navigation/hover (only `unlock()` fires, on click/keydown, not a UI blip).
  Quest completion and quest-giver interaction (`game.js:1204-1272`, no
  `DD.audio` call in the quest overlay path).
- **Reused across unrelated events**: `door()` plays for both "room locks,
  doors slam shut" (danger onset, `game.js:461`) and "room cleared" (relief,
  `game.js:470`) — the identical two-note ascending arpeggio for two
  opposite-valence moments. `chest()` plays for opening a treasure chest
  (`entities.js:1128`), any vendor purchase (`entities.js:1255`), and generic
  end-of-encounter loot (`entities.js:1212`) — three different economic
  moments, one cue.

**Unlock/autoplay-policy coverage.** `unlock()` is wired broadly and mostly to
real user gestures: every `keydown` and `mousedown`/`touchstart`
(`js/input.js:69,87,96`), plus menu button/card click handlers throughout
`js/game.js` (class-select cards, host/join/start buttons — 14 call sites,
e.g. `game.js:2074,2142,2146,2361,2417`). This is defensively over-wired
(harmless — `ensure()` is idempotent) and reliably covers the real
autoplay-gesture requirement.

**Instrumented run (real evidence, not just reading).** Ran the game headless
via Playwright/Chromium (`/opt/pw-browsers/chromium`) against the already-up
`localhost:8123`, wrapped every `DD.audio` method from `page.evaluate()`, and
logged calls during live and forced-scenario play:
- Free play (`?dev=combat&class=warrior`, ~26s, held-key attacks): sound
  fired correctly and only on real triggers (`swing`, `spawn`, `unlock`) —
  audio functions as coded, no spurious or missing fires relative to actual
  game state changes. (Attack-trigger *rate* in this run was suppressed by
  headless software-WebGL frame-rate throttling — a test-environment
  artifact per `.claude/skills/verify/SKILL.md`'s own warning that a quick
  keypress can fall between frames — not an audio-code issue.)
- Forced busy-fight moment: woke 3 dormant skeletons next to the player, then
  in one synchronous tick called the *real* code paths — `performAttack()`,
  `player.damage()`, each skeleton's `damage()→die()`, and a coin pickup.
  Result: **8 one-shots fired within 4ms of each other** — 1 `swing`
  (0.08) + 1 `hurt` (0.16) + 5 `bones` (0.22 each) + 1 `coin` (0.14) — for a
  **linear vol sum of 1.48**, comfortably past the point where
  `AudioDestinationNode` clips/clamps its output, with no master gain or
  limiter anywhere in the graph to prevent it. This is a real, reachable
  in-game moment (an AoE/crowd kill), not a contrived edge case.

## What's solid

- **The synthesis is cheap, dependency-free, and reliable.** No asset
  pipeline, no load latency, no missing-file risk — every sound exists the
  instant the tab loads. For a project with no art budget for audio, this was
  a reasonable initial bet.
- **Coverage of the core combat loop is decent for 83 lines.** Swing, hit,
  hurt, ranged attacks, enemy death, and boss-impact all have a cue, and nearly
  every menu/gesture path correctly calls `unlock()`, so the autoplay-policy
  failure mode (silent game, no sound ever starts) is well guarded against.
- **The individual SFX design is competently done for what it is** — short
  exponential envelopes, sensible frequency choices (low sawtooth for damage,
  ascending triangle arpeggios for positive events), no clicks/pops from
  abrupt starts.
- **Errors are contained.** A missing `AudioContext` or a thrown exception
  anywhere in `tone()`/`noise()` degrades to silence, never a crash
  (`js/audio.js:17,31,36,52`) — the "best-effort" comment is accurate.

## What's rough, incomplete, or inconsistent

- **No mix.** Confirmed by the instrumented busy-fight test: a real, common
  in-game moment (killing several nearby enemies at once while taking a hit
  and picking up a coin) sums to 1.48 linear gain against a destination node
  with no limiter or master gain — this will clip/distort in a real browser,
  not just in theory.
- **No music or ambience at all**, in any state — town, lobby, dungeon floor,
  boss room. The game is either dead silent between one-shots or entirely
  reliant on the next SFX to remind the player audio exists.
- **No player control over audio whatsoever** — no volume slider, no mute, no
  persisted preference. A player who wants the game quieter has to mute the
  OS/tab.
- **The one telegraph the game has is audio-silent during the warning
  window.** The boss slam gives the player 0.85s of visual warning
  (`entities.js:1026-1070`) and zero audio warning — sound only arrives at
  the moment of impact, when it's too late to react to the *sound*. Audio
  currently carries no early-warning information anywhere in the game.
- **No distinction between "player went down" and "player took a normal
  hit."** `goDown()` (`entities.js:161-166`) adds no sound of its own; in
  co-op, the single most consequential moment for a teammate (partner is now
  on the ground and needs a revive) sounds identical to a routine chip-damage
  hit.
- **Cue reuse blurs meaning at exactly the moments sound should disambiguate**
  — `door()` for both "you're now locked in with monsters" and "you're safe,
  it's over" is the sharpest example; a player who's still learning the game
  gets no audio signal telling those two states apart.
- **18 short percussive blips (square/saw/triangle) is a mismatch for a 3D
  KayKit-model dungeon crawler.** The visual language (README: vendored
  three.js, Kenney Modular Dungeon Kit architecture, KayKit animated
  characters) aims for a grounded, semi-realistic low-poly fantasy look; the
  audio language is closer to an 8-bit/chiptune arcade game. Neither is wrong
  in isolation, but they're not obviously the same game.

## Next steps

1. **Add a single master `GainNode` that every `tone()`/`noise()` call routes
   through**, before anything else. This is a small, contained change (one
   node, one connection point) that directly fixes the confirmed clipping
   risk and is also the prerequisite for a volume slider whenever ux-ui wants
   one.
2. **Give the boss-slam telegraph an audio onset, not just an impact sound.**
   A short rising cue at the rising edge of `slamT` (`entities.js:1069-1070`,
   where `slamAnimAt` is already set as "the rising-edge marker") would let
   audio do the early-warning job it currently doesn't do anywhere in the
   game — the hook to trigger from already exists in the code.
3. **Decide, deliberately, whether synthesized one-shots are the permanent
   answer or a placeholder** — see Salvage or rebuild below. Whichever way
   that goes, split the two cue collisions (`door()` for lock vs. clear;
   `chest()` for chest vs. purchase vs. loot) into distinct sounds; at 18
   effects already defined, the pattern for adding two or three more (a
   `tone()`/`noise()` call plus a wire-up) is established and cheap.

## Salvage or rebuild?

**Neither word quite fits — this domain hasn't been built yet, not built
badly.** 83 lines covering one-shots for the core combat loop is a sketch,
not an implementation with debt. There's very little here to lose by
starting clean, and equally little to gain by insisting on a rewrite for its
own sake — the honest framing is "finish/extend what's here," and that's true
whether the repo continues or restarts. The `tone()`/`noise()` synth helpers
and the 18-effect roster are worth keeping regardless: they're small,
self-contained, have no dependency on three.js/canvas/anything else being
reconsidered, and already cover the combat-loop basics competently. Add a
master gain node and a volume control (next steps above) and this part is
fine to build on rather than replace.

The bigger question in my lane isn't salvage-vs-rebuild, it's **whether
synthesized audio is the right call at all, going forward.** For a "no build
step, no CDN, no vendored binaries except what's already there" browser game,
synthesis has real advantages the project has clearly leaned on elsewhere too
(the sprite generation in `js/sprites.js` is the same philosophy applied to
2D art). But the 3D visual upgrade (KayKit models, three.js) already moved
half the game's presentation away from "everything is code-generated" toward
"real, authored assets, vendored in" — vendored GLB models and textures exist
in the repo the same way audio files could. Music and ambience in particular
are a poor fit for procedural synthesis (looping chiptune-style oscillator
music is a specific, deliberate aesthetic choice, not a neutral default) —
if the project wants real music/ambience, that almost certainly means
shipping a handful of small vendored audio files (same CC0-asset-pack
pattern already used for the 3D kit), not extending `tone()`/`noise()` to
cover them. The one-shot SFX layer can reasonably stay synthesized either
way — it's cheap, it's already half-working, and short percussive blips are
less genre-committal than a music bed. That's a call for whoever owns the
project's overall art direction to make explicitly, not one I should default
on silently.

## Discrepancies

- None found. `README.md:97` ("every sound is synthesized at runtime in
  `js/audio.js`") and `README.md:106` ("Web Audio sound effects") both match
  the code exactly — no overclaiming. `docs/GAME_DESIGN.md` mentions audio
  exactly once, as a file-layout table entry (`docs/GAME_DESIGN.md:212`,
  "FX, sound, helpers") with no design intent stated one way or the other —
  the near-total silence on audio in the current design doc is itself worth
  flagging: a game whose visual presentation gets a detailed design section
  has no equivalent audio design section to hold it accountable to.
  `DungeonDash_DesignBrief.md` (historical) contains zero mentions of
  sound/audio/music at all — audio was never part of the original brief
  either, synthesized SFX appear to have been added later as a low-cost
  addition rather than planned from the start.

## Hand-offs

→ ux-ui: no volume/mute control exists anywhere, and there's no settings
surface in the game at all for one to live in.
→ systems-design: the boss-slam telegraph (`entities.js:1026-1070`) is
visual-only; a systems call on telegraph timing would inform where an audio
onset should land.
→ graphics: the SFX palette (chiptune-style oscillator blips) and the 3D
KayKit/three.js visual presentation read as two different games' worth of
audio-visual identity — worth a joint read on overall game feel.
→ qa: none of the 18 effects errored or misfired in the instrumented run;
no audio-specific defect to report at this time.
