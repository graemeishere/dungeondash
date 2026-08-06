# Audio credits

Every sound *effect* (`js/audio.js`, `swing`/`hit`/`coin`/etc.) is synthesized at
runtime with the Web Audio API — no files, no credits needed there.

The music and ambience beds under `assets/audio/music/` and
`assets/audio/ambience/` are vendored from third parties. Unlike the game's 3D
art packs (all CC0), audio licensing here is mixed — some tracks are CC0, some
are CC-BY and require attribution. This file is that attribution's home; the
exact strings below are the wording each author's license page specifies, kept
verbatim rather than paraphrased.

## Music (`assets/audio/music/`)

| File | Track | Author | Source | License | Attribution required |
|---|---|---|---|---|---|
| `catacombs.ogg` | "Dark Ambient Loop 13" | Lucas Calvo (MundoSound) | https://opengameart.org/content/dark-ambient-loop-13 | CC-BY 3.0 | **Yes** — "Lucas Calvo - mundosound.com" |
| `goblin-mines.ogg` | "Quirky Goblins (Looping)" | Eric Matyas | https://opengameart.org/content/quirky-goblins-looping | CC-BY 3.0 | **Yes** — `"Quirky Goblins" by Eric Matyas (www.soundimage.org)` |
| `crypt.mp3` | "Crypt" (file "Dark Loop.mp3") | Machine | https://opengameart.org/content/crypt | CC-BY 3.0 | **Yes** — "Crypt" by Machine, https://opengameart.org/content/crypt |
| `town.mp3` | "Town Theme RPG" | cynicmusic | https://opengameart.org/content/town-theme-rpg | CC0 | No (optional shout-out: cynicmusic.com / pixelsphere.org) |
| `menu.mp3` | "The Field Of Dreams" | Independent.nu (submitted by pauliuw) | https://opengameart.org/content/the-field-of-dreams | CC0 | No |

## Ambience (`assets/audio/ambience/`)

| File | Track | Author | Source | License | Attribution required |
|---|---|---|---|---|---|
| `catacombs.ogg` | "Loopable Dungeon Ambience" | JaggedStone | https://opengameart.org/content/loopable-dungeon-ambience | CC0 | No |
| `goblin-mines.ogg` | "Dripping water loop" | Independent.nu (submitted by qubodup) | https://opengameart.org/content/dripping-water-loop | CC0 | No |
| `crypt.ogg` | "Catacombs Chanting Loop" (file `catacombs_in_game.ogg`) | beardalaxy | https://opengameart.org/content/catacombs-chanting-loop | CC0 ("credit appreciated but not necessary") | No |

## Sourcing notes / deviations from the original candidate list

`docs/design/audio-spec.md` §3.1 named specific Freesound candidates for two of
the three ambience beds (`catacombs.ogg` and `goblin-mines.ogg` in this table).
Both were swapped for OpenGameArt CC0 alternatives found during implementation:

- **Catacombs ambience** — spec's pick was Freesound's
  `A_Dungeon_Ambience_Loop.wav` by Grubzyy (CC0). Freesound requires a logged-in
  account to download the actual file (confirmed: the download URL 302s to
  `/home/login/`); no login is available in this environment. Substituted with
  "Loopable Dungeon Ambience" by JaggedStone (OGA, CC0, tagged
  dungeon/cave/ambient) — same mood, same license tier, no attribution owed
  either way.
- **Goblin mines ambience** — spec's pick was Freesound's "Mining with Pick Axe
  in a group" by MiraclesHappen (CC0), same login wall (confirmed 302).
  Spec's own §3.1 flagged this pick as a clank-only partial solution regardless,
  with no full clank+dripping+chatter file existing anywhere it found. No
  substitute clank-loop was found on OGA either (only one-off non-loop rock/pickaxe
  hits, e.g. "Breaking Rock" — not usable as a bed). Shipped **"Dripping water
  loop" by Independent.nu (OGA, CC0) as a partial stand-in** — a quiet dripping
  texture only, no pickaxe/clank or goblin-chatter layer. This is a real, open
  gap: the goblin mines ambience bed is thinner than catacombs/crypt's. A human
  pass with Freesound access (or a purchased/CC-BY pack) would close it.
- **Crypt ambience** (`catacombs_in_game.ogg` by beardalaxy) ships as specced,
  with one caveat the spec itself raised: it contains actual (wordless) vocal
  chanting, not a purely textural bed. Listened through — it reads as an ambient
  chant loop, not a narrative/verbal moment, so it shipped as-is per the spec's
  own "listen and decide" guidance.

Two length shortfalls the spec flagged were resolved by looping (the spec
explicitly sanctions this over reworking the pick):

- **Goblin mines music** (`goblin-mines.ogg`, 40.0s master vs. a 90–150s
  target) loops multiple times per music-bus cycle.
- **Town music** (`town.mp3`, 97.5s vs. a 120–180s target) is close enough to
  loop with only a mildly perceptible repeat; shipped as-is rather than holding
  out for the two bundled-zip alternatives the spec mentions (Matthew Pablo's
  "Pleasant Creek"/"Snowland Town" — still unverified, a future follow-up if the
  repeat becomes noticeable in play).
