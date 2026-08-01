# Audio Spec — Dungeon Dash

Implementation-ready spec for Phase 4's audio work (see `docs/design/roadmap.md`
Phase 4 and the coverage-matrix `audio` rows). Written against `audit-audio.md`'s
findings and Decision 6 (vendored CC0 music/ambience, synthesized one-shot SFX via
the existing `tone()`/`noise()` helpers in `js/audio.js`) — that decision is taken
as given, not re-argued here.

This document specifies **what to build**. It does not implement it — `js/audio.js`,
`js/entities.js`, `js/game.js` and `js/input.js` are untouched by this spec and
should be edited only by the implementing session, once Phase 0's module split has
landed (those are exactly the files Phase 0 is rewriting concurrently).

---

## 1. Mix architecture

### 1.1 Why this is needed

The current graph has **zero bus structure**: every `tone()`/`noise()` call creates
its own `GainNode` and connects straight to `ac.destination`. The instrumented
busy-fight run in `audit-audio.md` measured 8 concurrent one-shots (`swing` 0.08 +
`hurt` 0.16 + 5× `bones` 0.22 + `coin` 0.14) summing to **1.48 linear gain** hitting
the destination node directly, with no limiter anywhere in the graph. That is a
reachable in-game moment (an AoE/crowd kill), not a contrived edge case, and it is
past the point where `AudioDestinationNode` clips.

### 1.2 Node graph

```
tone()/noise() individual voice gain nodes
        |
        v
  [bus gain: sfxWorld]  [bus gain: sfxUI]  [bus gain: music]  [bus gain: ambience]
        \___________________|___________________|________________/
                             |
                             v
                    [masterGain]  (GainNode)
                             |
                             v
                    [masterLimiter]  (DynamicsCompressorNode)
                             |
                             v
                       ac.destination
```

Four buses, one master gain stage, one limiter, in that order. This is the minimum
split that lets a future settings UI (Phase 3) offer independent sliders without a
second refactor — see §4 for the exact contract.

**Bus definitions and what routes to each:**

| Bus | Routes | Current `DD.audio` methods |
|---|---|---|
| `sfxWorld` | Combat/world one-shots — attacks, damage, deaths, pickups, environmental cues | `swing, shoot, bolt, hit, splash, hurt, dash, bones, spawn, coin, heal, chest, slam` |
| `sfxUI` | Menu/HUD feedback — not tied to a position in the dungeon | `door` (post-split, see §2), `levelup`, `win`, `lose`, plus new menu-hover/nav cues |
| `music` | Vendored looping music beds (new, §3) | none yet |
| `ambience` | Vendored looping ambience beds (new, §3) | none yet |

`unlock()` does not route through any bus — it only calls `ensure()`, no audio node.

### 1.3 Node creation and lifecycle

- Create all four bus `GainNode`s, `masterGain`, and `masterLimiter` **once**,
  inside `ensure()`, at the same point the `AudioContext` itself is lazily created
  — not per-call. Store them alongside `ctx` in the module's closure (e.g. `ctx`,
  `busSfxWorld`, `busSfxUI`, `busMusic`, `busAmbience`, `masterGain`,
  `masterLimiter`).
- Wire the chain once at creation: each bus → `masterGain` → `masterLimiter` →
  `ac.destination`.
- `tone()` and `noise()` gain a new parameter, `bus` (one of `"sfxWorld"`,
  `"sfxUI"`), defaulting to `"sfxWorld"` for backward compatibility if omitted.
  Every existing `DD.audio.*` call site keeps working unmodified except for the two
  UI-flavoured methods (`levelup`, `win`, `lose`, `door`-split) which should pass
  `bus: "sfxUI"`.
- Music/ambience playback is new code (not `tone()`/`noise()`) — a simple
  `<audio>`-backed or `AudioBufferSourceNode`-backed looping player, connected to
  `busMusic` or `busAmbience` respectively. Spec for that player is out of scope
  here beyond "it connects to the matching bus"; implementation detail (loop via
  `loop = true` on an `AudioBufferSourceNode`, or seamless-loop via source
  re-triggering for intro+loop tracks) is left to the implementer per §3's loop
  notes.

### 1.4 Gain values and headroom

**Target ceiling:** design so that a *typical* busy-combat moment (3–4 concurrent
`sfxWorld` one-shots, the realistic common case, not the 8-voice worst case) sums
to **≤0.5 linear gain at the bus output**, leaving the `masterLimiter` as a safety
net for the worst case rather than the primary control — a limiter that is doing
constant heavy work sounds squashed; it should be a ceiling, not a compressor doing
the job of a mix.

**Concrete numbers:**

- `masterGain.gain.value = 0.8` (leaves 20% headroom below 1.0 for the limiter to
  work with cleanly; this is the value the Phase 3 master slider scales, see §4).
- `busSfxWorld.gain.value = 0.9`, `busSfxUI.gain.value = 1.0`, `busMusic.gain.value
  = 0.55`, `busAmbience.gain.value = 0.35`. Music and ambience sit well under SFX
  by default because they are continuous beds, not transient cues — a continuous
  0.55 reads as loud as a 0.15 transient.
- **Per-voice attenuation curve for `sfxWorld` polyphony.** Rather than relying on
  the limiter alone to catch stacked one-shots, scale new-voice gain down as
  concurrent `sfxWorld` voice count rises. Track an integer `activeSfxWorldVoices`
  count (increment on voice start, decrement on the gain-decay envelope's `stop()`
  or via a `setTimeout` matched to `dur`). Apply a multiplier to each new voice's
  base `vol` at creation time:

  | Concurrent `sfxWorld` voices at trigger time | Gain multiplier |
  |---|---|
  | 1–2 | 1.0 (no attenuation) |
  | 3–4 | 0.75 |
  | 5–6 | 0.55 |
  | 7+ | 0.4 |

  Applied to the audit's measured worst case (8 voices, pre-attenuation linear sum
  1.48): the 7th and 8th voices land in the 0.4 bracket, the 5th–6th in 0.55, etc.
  — this alone brings the summed total from 1.48 down to roughly 0.75–0.85 *before*
  the bus/master gain stages (0.9 × 0.8 ≈ 0.72 combined) are applied, landing the
  realistic worst case comfortably under the 0.8 masterGain ceiling with the
  limiter catching any residual peak rather than doing the whole job.
- `sfxUI` and `music`/`ambience` do not need the polyphony curve — UI cues are
  rarely concurrent by design (menu interactions are sequential), and only one
  music + one ambience bed should ever play at once (crossfade on track/floor
  change, not stack).

### 1.5 Limiter

`masterLimiter` = a single `DynamicsCompressorNode`, positioned after
`masterGain`, before `ac.destination`. Suggested starting parameters (tune by ear
once implemented, these are a reasonable brickwall-ish starting point, not gospel):

- `threshold: -6` dB
- `knee: 6` dB (soft knee — avoid audibly pumping on transients)
- `ratio: 12` (aggressive enough to act as a safety ceiling, not a musical
  compressor)
- `attack: 0.003` s (fast — catches short percussive one-shot transients)
- `release: 0.15` s (fast enough to recover between rapid attacks in a busy fight,
  slow enough not to introduce audible pumping)

### 1.6 Summary for the implementer

One `masterGain` + one `masterLimiter`, four named bus gains upstream of it
(`sfxWorld`, `sfxUI`, `music`, `ambience`), a `bus` parameter threaded through
`tone()`/`noise()`, and a voice-count-based per-voice attenuation table for
`sfxWorld` specifically. All four buses and the master/limiter nodes are created
once inside `ensure()`, not per-call.

---

## 2. Cue map

Full roster (18 existing effects) plus every gap `audit-audio.md` identified.
Status legend: **COVERED** (works as-is, bus assignment noted), **SILENT** (no cue
exists, needs one), **COLLIDING** (one cue currently serves two-plus distinct
events, needs a split).

| Event | Status | Current method / notes | Bus |
|---|---|---|---|
| Melee swing | COVERED | `swing()` | sfxWorld |
| Ranged shoot | COVERED | `shoot()` | sfxWorld |
| Bolt/projectile launch | COVERED | `bolt()` | sfxWorld |
| Melee hit landed | COVERED | `hit()` | sfxWorld |
| Projectile splash impact | COVERED | `splash()` | sfxWorld |
| Player takes damage | COVERED | `hurt()` | sfxWorld |
| Dash | COVERED | `dash()` | sfxWorld |
| Enemy death (skeleton) | COVERED | `bones()` | sfxWorld |
| Enemy spawn | COVERED | `spawn()` | sfxWorld |
| Coin pickup | COVERED | `coin()` | sfxWorld |
| Potion/heal pickup | COVERED | `heal()` | sfxWorld |
| Room lock (danger onset) | **COLLIDING** → split | see below | sfxUI |
| Room clear (relief) | **COLLIDING** → split | see below | sfxUI |
| Chest open | **COLLIDING** → split | see below | sfxWorld |
| Vendor purchase | **COLLIDING** → split | see below | sfxUI |
| Generic loot pickup | **COLLIDING** → split | see below | sfxWorld |
| Level-up | COVERED | `levelup()` | sfxUI |
| Boss slam impact | COVERED | `slam()` | sfxWorld |
| Run win | COVERED | `win()` | sfxUI |
| Run lose | COVERED | `lose()` | sfxUI |
| Boss slam **telegraph onset** | **SILENT** | see below | sfxWorld |
| Player/teammate goes downed (co-op) | **SILENT** | see below | sfxWorld |
| Low-HP state | **SILENT** | no low-HP system exists at all (visual or audio) — flagging for `systems-design`/`ux-ui` that this cue has no state to hook until one exists | sfxUI |
| Floor transition (stairs taken) | **SILENT** | see below | sfxUI |
| Quest completion | **SILENT** | see below | sfxUI |
| Quest-giver interaction (talk) | **SILENT** | see below | sfxUI |
| Equip/unequip | **SILENT** | see below | sfxUI |
| Menu hover | **SILENT** | see below | sfxUI |
| Menu navigation (confirm/back) | **SILENT** | see below | sfxUI |
| Guest join/disconnect (co-op) | **SILENT** | text toast only today; low priority, noted for completeness | sfxUI |

### 2.1 Collision splits

**`door()` → `roomLock()` + `roomClear()`.** Currently both play the identical
two-note ascending triangle arpeggio (`392→523 Hz`), for opposite-valence moments.
- `roomLock()` (danger onset, replaces `door()` at the lock call site): descending
  or static-then-thud character — two-note **falling** interval (e.g. `523→392 Hz`,
  triangle or square, short), read as "sealed in," not "reward." ~0.15s per note.
- `roomClear()` (relief, replaces `door()` at the clear call site): keep the
  existing **rising** two-note arpeggio (`392→523 Hz`) — it already reads correctly
  for this half of the split, it's only wrong for lock.

**`chest()` → `chestOpen()` + `purchase()` + `lootPickup()`.** Currently one rising
triangle tone (`440→880 Hz`) covers all three.
- `chestOpen()` (world event, physical object): keep close to the current tone but
  slightly heavier — add a short low-passed noise transient underneath (like
  `bones()`'s two-layer pattern) to read as a lid/mechanism, not a coin.
- `purchase()` (economic/UI transaction, town vendor): short double-blip in the
  `coin()` register (900–1400 Hz range, square) but with a distinct rhythm from
  `coin()` itself (e.g. two equal-length notes rather than `coin()`'s
  short-then-long) so a purchase doesn't sound identical to a battlefield pickup.
  Belongs on `sfxUI`, not `sfxWorld` — it's a menu transaction, not a world event.
- `lootPickup()` (generic end-of-encounter loot, world event): a short, simple
  single tone, lower-key than `chestOpen()` (no noise layer, it's a smaller
  moment) — e.g. a single triangle blip around 600 Hz, 0.08–0.1s.

### 2.2 New cues (SILENT rows)

- **Boss slam telegraph onset.** Trigger on the rising edge of `slamT`
  (`entities.js:1026-1070`, where `slamAnimAt` is already the rising-edge marker —
  cited so the implementer knows the hook exists without this doc claiming to have
  found it independently in code it must not touch). Sonic character: a low,
  **rising** sawtooth or sine sweep over the telegraph's visual duration (~0.85s,
  matching the pulsing-circle warning), low register (60–150 Hz range), sustained
  rather than percussive — the opposite envelope shape from `slam()`'s impact
  (which is a short decay). This is the one cue in the whole map that should be
  long instead of short, because its job is to fill the warning window, not punctuate
  a moment.
- **Downed state (co-op).** Trigger on `goDown()` (`entities.js:161-166`).
  Distinct from `hurt()` — needs to read as more severe/final within a short cue.
  Suggest a falling two-tone descent an octave lower than `hurt()`'s register, with
  a longer decay (~0.3–0.4s) so it's audibly heavier without becoming a music-length
  event.
- **Low-HP state.** No low-HP system exists yet (confirmed no low/critical-HP
  concept anywhere in `js/` per the audit) — this row cannot be built as a one-shot
  because it's a *sustained* state, not an event. If/when `systems-design` defines
  a low-HP threshold, the audio treatment should be a periodic low heartbeat-style
  pulse (soft sine, low register, ~1 pulse/second) gated on/off by HP crossing the
  threshold, not a repeating one-shot fired every frame. Flagging the dependency
  rather than speccing sound for a state that doesn't exist yet.
- **Floor transition (stairs taken).** Trigger at `reachStairs()`
  (`game.js:486-496`). Sonic character: a short **descending** (going deeper)
  multi-note sweep, distinct from both `door()`-split cues and `levelup()` — 3 notes
  over ~0.3s, sine or triangle, mid-to-low register, evoking "descending a
  staircase" rather than an arpeggio-up "reward" feel.
- **Quest completion.** Trigger where quest state flips to complete
  (`game.js:1204-1272` region). Sonic character: closer to `levelup()`'s rising
  arpeggio family (positive, multi-note) but shorter (2 notes, not 4) and at a
  higher register, so it doesn't get confused with an actual level-up.
- **Quest-giver interaction (talk).** A short, single soft blip on opening the
  quest-giver overlay — low-priority polish, sine tone, ~0.05s, quiet (0.05–0.08
  vol) — just enough to confirm the interaction registered.
- **Equip/unequip.** Trigger at the plain `onclick` handlers
  (`game.js:1410,1433,1576,1601`). Equip: short percussive click/thunk (noise
  burst, very short, ~0.04s, low-passed). Unequip: same character, slightly lower
  pitched or shorter, to read as the inverse action without needing a fully
  distinct sound family.
- **Menu hover.** Very quiet, very short sine blip (~0.03s, vol ≤0.04) on
  interactive-element hover — the quietest cue in the whole roster, since it fires
  most often and must not fatigue.
- **Menu navigation (confirm/back).** Two short cues: confirm = short rising blip
  (distinct from hover, higher vol ~0.06), back/cancel = short falling blip. Keep
  both minimal — these are UI chrome, not combat feedback, and should read as
  clearly secondary to `sfxWorld` cues in the mix (hence living on `sfxUI` at a
  bus gain that's louder per-voice than `sfxWorld` but used far more sparingly).

---

## 3. Music and ambience requirements

Per Decision 6, these ship as vendored CC0 files (matching the KayKit/Kenney
precedent already in the repo), not synthesized. This is a sourcing shopping list.

| Context | Track count | Target length | Loop structure | Tempo/instrumentation/mood | Ambience |
|---|---|---|---|---|---|
| Catacombs (dungeon theme 1) | 1 music track | 90–150s | Seamless loop (single loop point, no intro/outro split needed at this scope) | Slow, sparse, low-register — sustained drones/pads, occasional low strings or choir stab, minimal percussion. Mood: cold, ancient, faintly ominous. ~60–70 BPM feel if pulse is present at all. | Separate always-on bed on `ambience` bus: distant dripping water, faint wind, occasional stone-settling creak. Independent loop from the music track (different length, no phase-locking needed since they're on separate buses). |
| Goblin mines (dungeon theme 2) | 1 music track | 90–150s | Seamless loop | Slightly more rhythmic than catacombs — light percussion (wood/metal clank), lower strings or plucked instrument motif, mood: scrappy, industrious-but-hostile. ~90–100 BPM feel. | Separate ambience bed: pickaxe/metal clank echoes, dripping, distant guttural chatter (non-verbal, textural). |
| Crypt (dungeon theme 3) | 1 music track | 90–150s | Seamless loop | Sparsest and darkest of the three — long pads, dissonant intervals, very low percussion presence if any. Mood: dread, the "hardest" theme, reserving intensity for later floors. ~50–60 BPM feel or no discernible pulse. | Separate ambience bed: faint chanting/whispering texture (non-verbal), wind through stone, occasional distant chain rattle. |
| Town | 1 music track | 120–180s (town is a dwell space, players spend real time there — longest loop of the set to reduce perceived repetition) | Loop-friendly; intro+loop segment structure is worth the extra sourcing effort here specifically, since it's the track players hear most often per session | Warmer, more melodic than any dungeon theme — acoustic-leaning instrumentation (strings, light woodwind or similar), moderate tempo (~85–110 BPM), mood: safe, a released-tension "hub" feel contrasting the dungeon themes. | Optional light bed on `ambience` bus: distant crowd murmur, birdsong — low priority, can ship without one if sourcing time is tight. |
| Menu/title | 1 music track | 45–90s (shorter is fine — menu dwell time is much lower than town) | Seamless loop, no intro/outro needed | Sets tone for the whole game on first load — should sit tonally between town's warmth and the dungeon themes' dread, since it's the very first thing a new player hears. Moderate-low tempo, thematic/atmospheric rather than driving. | None needed. |

**Totals:** 5 music tracks, 3 ambience beds (catacombs, goblin mines, crypt — town
and menu skip ambience per the table). Rough total running time across the 5 music
tracks: **7.5–12.5 minutes** of source audio (these are loops, not full
compositions, so this is genuinely the total sourcing/licensing effort, not a
lower bound requiring hours of unique material). Ambience beds are typically
sourced as shorter (20–40s) seamlessly-loopable textures, so add roughly another
1.5–2 minutes across the 3 beds. All 8 files should be sourced from the same CC0
pools already used for the 3D art (e.g. Kenney's audio packs, freesound.org CC0
filtered results, or similar) to keep licensing review in one place.

**Crossfade note for the implementer** (not this doc's job to spec the code, but
worth recording as a requirement): switching floors/contexts should crossfade
between music tracks on the `music` bus and between ambience beds on the
`ambience` bus, not hard-cut — a ~1–2s linear crossfade is standard and avoids an
audible pop given these are long sustained loops.

### 3.1 Candidate CC0 sources

Researched against the shopping list above. **Verification caveat first, because
it matters more than the list:** this environment's outbound network policy blocks
direct fetches to `opengameart.org`, `freesound.org`, `kenney.nl`, and `itch.io`
(gateway returns 403 on all four — confirmed, not a guess), so every candidate
below comes from search-result snippets only, not a page load that could confirm
the exact license text on the specific file. That distinction is not pedantic:
searching Alexandr Zhelanov's OpenGameArt catalogue for "dungeon/crypt/fantasy
music" surfaces his tracks prominently (they're a strong stylistic fit), but his
uploads are licensed **CC-BY 3.0/4.0, not CC0** — attribution-required, and a
mismatch with Decision 6 and this repo's existing CC0-only asset packs. Pack-level
collection pages can also mix licenses across individual files within the same
pack. **Before vendoring anything below, open the specific file's page and confirm
CC0 on that file**, the same diligence already visible in this repo's existing
`*/License.txt` files (e.g. `Kenney Modular Dungeon Kit/License.txt`, which cites
CC0 explicitly) — that's the bar every new vendored file should clear, and the one
this research pass could not clear by itself.

**Strongest starting point: stay inside the Kenney catalogue.** Three packs
already vendored in this repo (`KayKit Dungeon Remastered`, `Kenney Modular
Dungeon Kit`, and the `KayKit`/adventurer packs) are Kenney/KayKit CC0 releases
with a consistent, already-trusted license file format. Kenney's own audio
offerings (`kenney.nl/assets/rpg-audio`, `kenney.nl/assets/digital-audio`,
`kenney.nl/assets/music-jingles`) are stated CC0 by the same publisher and
convention, but they lean toward short jingles/stingers and SFX rather than
90–150s loopable ambient beds — worth checking first for consistency, but likely
insufficient alone for the music-track list below; expect to supplement from
OpenGameArt's CC0-tagged pool.

| Slot | Candidate | Source | License as found | Verification status |
|---|---|---|---|---|
| Catacombs music | "CC0 Fantasy Music & Sounds" collection (has cave/dungeon-leaning tracks) | OpenGameArt, `opengameart.org/content/cc0-fantasy-music-sounds` | Stated CC0 in listing title/summary | **Unverified** — page fetch blocked, confirm per-track license before use |
| Catacombs ambience | "Loopable Dungeon Ambience" — low-frequency wind + water drips, purpose-built loopable | OpenGameArt, `opengameart.org/content/loopable-dungeon-ambience` | Stated CC0 in listing | **Unverified** — same caveat |
| Catacombs ambience (alt.) | "Water Dripping in Cave.wav" by Sclolex | Freesound, `freesound.org/people/Sclolex/sounds/177958/` | Search snippet describes public-domain-equivalent terms ("copy, modify, distribute... without needing permission") | **Unverified** — Freesound mixes CC0 and CC-BY per-uploader; confirm the exact license badge on the file page, not the paraphrase |
| Goblin mines music | No confident CC0 candidate found | — | — | **Not found** — searches for "mining/goblin/cave dark music CC0" returned dungeon-generic results, nothing goblin/mining-specific and confirmed-CC0; needs a dedicated sourcing pass with page access |
| Goblin mines ambience | No confident CC0 candidate found (pickaxe/clank-specific) | — | — | **Not found** — same gap; likely sourceable from Freesound's CC0-filtered search once page access exists, search terms "pickaxe metal clank echo cc0" |
| Crypt music | "CC0 - Dark Music" collection — explicitly CC0-labelled, "dark, evil, creepy" | OpenGameArt, `opengameart.org/content/cc0-dark-music` | Stated CC0 in listing title | **Unverified** — confirm per-track |
| Crypt ambience | "Dark Atmosphere -Dungeon -Loop" by ClementPanchout | Freesound, `freesound.org/people/ClementPanchout/sounds/572683/` | Not confirmed CC0 from snippet alone | **Unverified, lower confidence** — re-check license badge specifically |
| Town music | "Town Theme RPG" — harps/recorders, RPG-typical | OpenGameArt, `opengameart.org/content/town-theme-rpg` | Search snippet states "CC0 Public Domain License" | **Unverified** — confirm on page |
| Menu music | "RPG Title Screen Music Pack" (19 tracks, pick one) | OpenGameArt, `opengameart.org/content/rpg-title-screen-music-pack` | Not confirmed CC0 from snippet alone | **Unverified, check license per track** — pack may be mixed-license |
| Menu music (alt.) | "Fantasy Game Music Tracks (CC0)" — 7 tracks, CC0 stated in listing title | itch.io, `kmontesdev.itch.io/7-fantasy-music-tracks` | Stated CC0 in listing title | **Unverified** — itch.io listings can bundle a non-CC0 "supporter" tier alongside a free CC0 tier; confirm which tier is actually CC0 |
| General fallback pool | "Fantasy Music Mega Pack" (100+ tracks, stated CC0/Public Domain) by Blacis | itch.io, via `itch.io/game-assets/free/tag-cc0/tag-music` | Stated CC0/Public Domain in listing | **Unverified** — large pack, worth a dedicated pass to pull catacombs/crypt/goblin-mines-fitting tracks from it in one sourcing session |

**Net assessment:** town, menu, catacombs, and crypt each have at least one
plausible CC0-labelled candidate to start verification from; goblin mines has no
candidate yet and needs a fresh, page-access-enabled search pass (Freesound and
OpenGameArt both plausibly have mining/pickaxe-specific CC0 content, it just didn't
surface from snippet-only search). Whoever does the sourcing pass should budget
time for that gap and for the per-file license re-confirmation this pass could not
complete.

---

## 4. Settings-surface dependency for Phase 3

This is the contract `ux-ui` should build the settings UI against in Phase 3, so
that Phase 4's audio implementation has a real surface to wire into rather than
inventing one itself late.

### 4.1 Controls needed

| Control | Type | Range | Default | Maps to |
|---|---|---|---|---|
| Master volume | Slider | 0.0–1.0 | 0.8 | `masterGain.gain.value` (§1.4) |
| SFX volume | Slider | 0.0–1.0 | 1.0 | Scales both `busSfxWorld` and `busSfxUI` together (a single "SFX" slider covering both — splitting world vs. UI SFX into two separate player-facing sliders is not warranted at this scale; keep it to one slider mapped to two internal buses) |
| Music volume | Slider | 0.0–1.0 | 1.0 | `busMusic.gain.value` (scaled against the base 0.55 in §1.4 — i.e. slider value × 0.55, not a replacement of it) |
| Ambience volume | Slider | 0.0–1.0 | 1.0 | `busAmbience.gain.value` (scaled against the base 0.35, same pattern) |

Four sliders total: Master, SFX, Music, Ambience. Each slider's stored value is a
**multiplier against the base gain values fixed in §1.4**, not an absolute
replacement — this keeps the mix balance from §1 intact regardless of where a
player sets each slider, and means the settings UI never needs to know the actual
base gain numbers, only that it's producing a 0.0–1.0 multiplier per bus.

### 4.2 Mute

**No separate mute toggle.** Mute is the zero position on each slider (multiplier
× 0 = silence on that bus). This keeps the persisted state shape to four numbers
with no extra boolean, and matches how the master slider alone already gives a
one-control "make it quiet" affordance. If `ux-ui` wants a quick global mute button
as a UX convenience (e.g. for a "mute" icon that doesn't require opening a
settings panel), that button should just set the Master multiplier to 0 and
remember the prior value to restore on unmute — no new state field needed for it,
that's a UI-layer detail on top of this contract, not a new persisted value.

### 4.3 Persistence

- **Storage:** `localStorage`.
- **Key:** `dd-audio-settings`.
- **Shape:**

```json
{
  "master": 0.8,
  "sfx": 1.0,
  "music": 1.0,
  "ambience": 1.0
}
```

- All four values are floats in `[0, 1]`. Missing key or malformed JSON falls back
  to the defaults in §4.1 (do not throw — same best-effort posture as the rest of
  `js/audio.js`).
- Read once at audio-module init (inside `ensure()`'s first-call path, alongside
  bus creation), applied to the four `GainNode.gain.value`s at creation time.
  Write on every settings-UI change event (slider `input`/`change`), not
  debounced — these are infrequent, low-cost writes.
- No versioning/migration scheme needed at this scale (four flat floats); if the
  bus structure ever changes, a missing key naturally falls back to default rather
  than needing an explicit migration step.

---

## Scope note

This is a small domain — 83 lines of source, 18 existing effects, no assets on
disk — so this spec is deliberately short and concrete rather than padded. Sections
1–4 above are sufficient for an implementing session to build the mix graph, wire
the cue map, source the music/ambience list, and hand a real contract to `ux-ui`'s
Phase 3 settings surface, without needing to re-derive any of it from
`audit-audio.md` or the roadmap directly.
