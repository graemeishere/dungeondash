// All sound effects are synthesized with the Web Audio API — no SFX files.
// Music and ambience beds ARE vendored files (assets/audio/), played through
// their own buses — see the node graph below and assets/audio/CREDITS.md.
//
// Node graph (built once, inside ensure(), on first use):
//
//   tone()/noise() per-voice gain
//           |
//           v
//   [busSfxWorld] [busSfxUI] [busMusic] [busAmbience]
//           \__________|__________|__________/
//                       |
//                       v
//                  [masterGain]
//                       |
//                       v
//                 [masterLimiter]  (DynamicsCompressorNode, safety ceiling)
//                       |
//                       v
//                 ac.destination

let ctx = null;
let busSfxWorld = null, busSfxUI = null, busMusic = null, busAmbience = null;
let masterGain = null, masterLimiter = null;

// Base bus gains (linear). Master is NOT scaled against a fixed base — the
// master multiplier itself IS masterGain.gain.value (default 0.8, per the
// audio spec's "20% headroom for the limiter" target).
const BASE = { sfxWorld: 0.9, sfxUI: 1.0, music: 0.55, ambience: 0.35 };

const SETTINGS_KEY = "dd-audio-settings";
const DEFAULT_SETTINGS = { master: 0.8, sfx: 1.0, music: 1.0, ambience: 1.0 };

function clamp01(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

// Read once at module init (best-effort, never throws — same posture as the
// rest of this file). Deliberately eager rather than gated behind the first
// ensure() call: some call sites (e.g. boot.js) call setMasterVolume() before
// any AudioContext-requiring user gesture, and need a real value to persist
// into immediately rather than a value that's discarded on next ensure().
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      master: clamp01(parsed.master ?? DEFAULT_SETTINGS.master),
      sfx: clamp01(parsed.sfx ?? DEFAULT_SETTINGS.sfx),
      music: clamp01(parsed.music ?? DEFAULT_SETTINGS.music),
      ambience: clamp01(parsed.ambience ?? DEFAULT_SETTINGS.ambience),
    };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = loadSettings();

function persistSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* best-effort */ }
}

function applyBusGains() {
  if (busSfxWorld) busSfxWorld.gain.value = BASE.sfxWorld * settings.sfx;
  if (busSfxUI) busSfxUI.gain.value = BASE.sfxUI * settings.sfx;
  if (busMusic) busMusic.gain.value = BASE.music * settings.music;
  if (busAmbience) busAmbience.gain.value = BASE.ambience * settings.ambience;
  if (masterGain) masterGain.gain.value = settings.master;
}

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    busSfxWorld = ctx.createGain();
    busSfxUI = ctx.createGain();
    busMusic = ctx.createGain();
    busAmbience = ctx.createGain();
    masterGain = ctx.createGain();
    masterLimiter = ctx.createDynamicsCompressor();
    masterLimiter.threshold.value = -6;
    masterLimiter.knee.value = 6;
    masterLimiter.ratio.value = 12;
    masterLimiter.attack.value = 0.003;
    masterLimiter.release.value = 0.15;

    busSfxWorld.connect(masterGain);
    busSfxUI.connect(masterGain);
    busMusic.connect(masterGain);
    busAmbience.connect(masterGain);
    masterGain.connect(masterLimiter);
    masterLimiter.connect(ctx.destination);

    applyBusGains();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function busNode(name) {
  if (name === "sfxUI") return busSfxUI;
  if (name === "music") return busMusic;
  if (name === "ambience") return busAmbience;
  return busSfxWorld; // default, and the only bus with the polyphony curve
}

// ---- sfxWorld polyphony attenuation (see docs/design/audio-spec.md §1.4) ----
// Scales new-voice gain down as concurrent sfxWorld voice count rises, so a
// busy fight doesn't rely on the limiter alone to avoid clipping/mush.
let activeSfxWorldVoices = 0;
function sfxWorldAttenuation(n) {
  if (n <= 2) return 1.0;
  if (n <= 4) return 0.75;
  if (n <= 6) return 0.55;
  return 0.4;
}
function trackSfxWorldVoice(lifeSec) {
  activeSfxWorldVoices++;
  const mult = sfxWorldAttenuation(activeSfxWorldVoices);
  setTimeout(() => { activeSfxWorldVoices = Math.max(0, activeSfxWorldVoices - 1); }, Math.max(0, lifeSec) * 1000);
  return mult;
}

function tone({ freq = 440, end = null, type = "square", dur = 0.1, vol = 0.15, delay = 0, bus = "sfxWorld" }) {
  try {
    const ac = ensure();
    if (!ac) return;
    const mult = bus === "sfxWorld" ? trackSfxWorldVoice(delay + dur) : 1;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end === null ? freq : end), t0 + dur);
    gain.gain.setValueAtTime(vol * mult, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(busNode(bus));
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch (e) { /* audio is best-effort */ }
}

function noise({ dur = 0.15, vol = 0.12, delay = 0, bus = "sfxWorld" }) {
  try {
    const ac = ensure();
    if (!ac) return;
    const mult = bus === "sfxWorld" ? trackSfxWorldVoice(delay + dur) : 1;
    const t0 = ac.currentTime + delay;
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(vol * mult, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    src.connect(filter).connect(gain).connect(busNode(bus));
    src.start(t0);
  } catch (e) { /* audio is best-effort */ }
}

// ---- music / ambience: looping vendored beds with crossfade on switch ----

const MUSIC_TRACKS = {
  menu: "assets/audio/music/menu.mp3",
  town: "assets/audio/music/town.mp3",
  catacombs: "assets/audio/music/catacombs.ogg",
  goblinMines: "assets/audio/music/goblin-mines.ogg",
  crypt: "assets/audio/music/crypt.mp3",
};
const AMBIENCE_TRACKS = {
  catacombs: "assets/audio/ambience/catacombs.ogg",
  goblinMines: "assets/audio/ambience/goblin-mines.ogg",
  crypt: "assets/audio/ambience/crypt.ogg",
  // town/menu intentionally have no ambience bed (see audio-spec.md §3).
};

// One of these per bus (music, ambience). Each holds at most one playing
// <audio> element at a time; play() crossfades from whatever was playing
// into the new track rather than stacking or hard-cutting.
function makeBedPlayer(getBus) {
  let el = null, gainNode = null, url = null;
  return {
    get current() { return url; },
    play(nextUrl, { fadeMs = 1500 } = {}) {
      try {
        if (!nextUrl || nextUrl === url) return;
        const ac = ensure();
        if (!ac) return;
        const bus = getBus();
        const nextEl = new Audio(nextUrl);
        nextEl.loop = true;
        nextEl.crossOrigin = "anonymous";
        const src = ac.createMediaElementSource(nextEl);
        const g = ac.createGain();
        g.gain.value = 0;
        src.connect(g).connect(bus);
        nextEl.play().catch(() => { /* pre-gesture autoplay block; unlock() retries */ });
        const now = ac.currentTime;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(1, now + fadeMs / 1000);
        if (el) {
          const oldEl = el, oldGain = gainNode;
          oldGain.gain.setValueAtTime(oldGain.gain.value, now);
          oldGain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
          setTimeout(() => { try { oldEl.pause(); } catch (e) {} }, fadeMs + 60);
        }
        el = nextEl; gainNode = g; url = nextUrl;
      } catch (e) { /* audio is best-effort */ }
    },
    stop(fadeMs = 800) {
      try {
        if (!el) return;
        const ac = ensure();
        const oldEl = el, oldGain = gainNode;
        if (ac && oldGain) {
          const now = ac.currentTime;
          oldGain.gain.setValueAtTime(oldGain.gain.value, now);
          oldGain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
        }
        setTimeout(() => { try { oldEl.pause(); } catch (e) {} }, fadeMs + 60);
        el = null; gainNode = null; url = null;
      } catch (e) { /* audio is best-effort */ }
    },
    // Re-attempt playback of whatever's current — browsers block <audio>.play()
    // called before a user gesture, so the very first setContext() at boot
    // typically fails silently; unlock() calls this on every real interaction.
    resume() {
      try { if (el && el.paused) el.play().catch(() => {}); } catch (e) {}
    },
  };
}

let musicPlayer = null, ambiencePlayer = null;
function players() {
  if (!musicPlayer) musicPlayer = makeBedPlayer(() => busMusic);
  if (!ambiencePlayer) ambiencePlayer = makeBedPlayer(() => busAmbience);
  return { musicPlayer, ambiencePlayer };
}

export const audio = {
  unlock() {
    ensure();
    const { musicPlayer: mp, ambiencePlayer: ap } = players();
    mp.resume();
    ap.resume();
  },

  // Settings-surface contract (docs/design/audio-spec.md §4). Four flat
  // floats in localStorage["dd-audio-settings"], each a multiplier against
  // the base gain values above. setMasterVolume/getMasterVolume keep their
  // pre-existing name/contract (Settings UI already calls these); they now
  // drive masterGain instead of a per-call linear scalar.
  setMasterVolume(v) { settings.master = clamp01(v); persistSettings(); applyBusGains(); },
  getMasterVolume() { return settings.master; },
  setSfxVolume(v) { settings.sfx = clamp01(v); persistSettings(); applyBusGains(); },
  getSfxVolume() { return settings.sfx; },
  setMusicVolume(v) { settings.music = clamp01(v); persistSettings(); applyBusGains(); },
  getMusicVolume() { return settings.music; },
  setAmbienceVolume(v) { settings.ambience = clamp01(v); persistSettings(); applyBusGains(); },
  getAmbienceVolume() { return settings.ambience; },

  // Switch the music+ambience bed for a context ("menu" | "town" | "catacombs"
  // | "goblinMines" | "crypt"). Crossfades; no-ops if already on that context.
  setContext(name) {
    try {
      ensure();
      const { musicPlayer: mp, ambiencePlayer: ap } = players();
      const m = MUSIC_TRACKS[name];
      if (m) mp.play(m, { fadeMs: 1500 });
      const a = AMBIENCE_TRACKS[name];
      if (a) ap.play(a, { fadeMs: 1500 });
      else ap.stop(1000);
    } catch (e) { /* audio is best-effort */ }
  },

  // ---- sfxWorld (default bus; combat/world one-shots) ----
  swing()  { tone({ freq: 240, end: 90, type: "sawtooth", dur: 0.09, vol: 0.08 }); },
  shoot()  { tone({ freq: 640, end: 220, type: "square", dur: 0.1, vol: 0.07 }); },
  bolt()   { tone({ freq: 320, end: 760, type: "triangle", dur: 0.12, vol: 0.1 }); },
  hit()    { tone({ freq: 170, end: 60, type: "square", dur: 0.08, vol: 0.13 }); },
  splash() { noise({ dur: 0.18, vol: 0.14 }); },
  hurt()   { tone({ freq: 120, end: 50, type: "sawtooth", dur: 0.25, vol: 0.16 }); },
  dash()   { tone({ freq: 500, end: 1100, type: "sine", dur: 0.1, vol: 0.08 }); },
  bones()  { noise({ dur: 0.12, vol: 0.1 }); tone({ freq: 300, end: 60, type: "triangle", dur: 0.25, vol: 0.12 }); },
  spawn()  { tone({ freq: 90, end: 220, type: "sawtooth", dur: 0.3, vol: 0.06 }); },
  coin()   { tone({ freq: 920, type: "square", dur: 0.06, vol: 0.07 }); tone({ freq: 1380, type: "square", dur: 0.12, vol: 0.07, delay: 0.06 }); },
  heal()   { tone({ freq: 520, end: 780, type: "sine", dur: 0.2, vol: 0.12 }); },
  slam()   { noise({ dur: 0.3, vol: 0.2 }); tone({ freq: 70, end: 30, type: "sawtooth", dur: 0.35, vol: 0.2 }); },

  // chest()'s old collision (chest-open vs. generic-loot-pickup) split in two.
  // chestOpen: physical object — the old tone plus a short low-passed noise
  // transient underneath, to read as a lid/mechanism rather than a coin.
  chestOpen() {
    noise({ dur: 0.1, vol: 0.08 });
    tone({ freq: 440, end: 880, type: "triangle", dur: 0.2, vol: 0.12 });
  },
  // lootPickup: smaller end-of-encounter moment — single low-key blip, no
  // noise layer, so it doesn't compete with chestOpen()'s weight.
  lootPickup() {
    tone({ freq: 600, type: "triangle", dur: 0.09, vol: 0.09 });
  },

  // Boss slam telegraph onset: the one long/sustained cue in the roster —
  // fills the ~0.85s warning window rather than punctuating a moment, so the
  // window itself is audible (the audit's top-priority SILENT gap).
  slamTelegraph() {
    tone({ freq: 60, end: 150, type: "sawtooth", dur: 0.85, vol: 0.12 });
  },

  // Co-op downed state: falling two-tone descent an octave below hurt()'s
  // register, longer decay, so it reads as more severe/final than a hit.
  downed() {
    tone({ freq: 90, end: 60, type: "sawtooth", dur: 0.18, vol: 0.16 });
    tone({ freq: 55, end: 30, type: "sawtooth", dur: 0.35, vol: 0.16, delay: 0.15 });
  },

  // ---- sfxUI (menu/HUD feedback, not tied to a world position) ----

  // door()'s old collision (room-lock vs. room-clear) split in two: lock is
  // now a falling interval ("sealed in"), clear keeps door()'s original
  // rising interval (it already read correctly for that half).
  roomLock()  { [523, 392].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.15, vol: 0.1, delay: i * 0.1, bus: "sfxUI" })); },
  roomClear() { [392, 523].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.18, vol: 0.1, delay: i * 0.1, bus: "sfxUI" })); },

  // coin()'s spec-undocumented collision (real pickup vs. vendor buy/sell)
  // split in two: purchase is a menu transaction on sfxUI, with two EQUAL
  // length notes (vs. coin()'s short-then-long) so it doesn't read identical
  // to a battlefield pickup.
  purchase() {
    tone({ freq: 1000, type: "square", dur: 0.08, vol: 0.07, bus: "sfxUI" });
    tone({ freq: 1300, type: "square", dur: 0.08, vol: 0.07, delay: 0.09, bus: "sfxUI" });
  },

  levelup() {
    [440, 554, 659, 880].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.14, vol: 0.11, delay: i * 0.09, bus: "sfxUI" }));
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: "square", dur: 0.16, vol: 0.1, delay: i * 0.13, bus: "sfxUI" }));
  },
  lose() {
    [330, 262, 196, 131].forEach((f, i) => tone({ freq: f, type: "sawtooth", dur: 0.3, vol: 0.1, delay: i * 0.2, bus: "sfxUI" }));
  },

  // Floor transition (stairs taken): short descending 3-note sweep — distinct
  // from both door()-split cues and levelup()'s rising arpeggio.
  floorTransition() {
    [660, 550, 440].forEach((f, i) => tone({ freq: f, type: "sine", dur: 0.12, vol: 0.09, delay: i * 0.1, bus: "sfxUI" }));
  },

  // Quest completion: levelup()'s rising-arpeggio family, but shorter (2
  // notes) and higher register, so it doesn't get confused with an actual
  // level-up.
  questComplete() {
    [880, 1174].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.13, vol: 0.1, delay: i * 0.1, bus: "sfxUI" }));
  },

  // Quest-giver talk: quiet single confirmation blip.
  questTalk() {
    tone({ freq: 700, type: "sine", dur: 0.05, vol: 0.06, bus: "sfxUI" });
  },

  // Equip/unequip: short percussive click/thunk; unequip is the shorter of
  // the pair, reading as the inverse action without a separate sound family.
  equip()   { noise({ dur: 0.045, vol: 0.09, bus: "sfxUI" }); },
  unequip() { noise({ dur: 0.03, vol: 0.08, bus: "sfxUI" }); },

  // Menu hover/nav — lowest-priority polish, quietest cues in the roster.
  menuHover()   { tone({ freq: 900, type: "sine", dur: 0.03, vol: 0.03, bus: "sfxUI" }); },
  menuConfirm() { tone({ freq: 700, end: 1000, type: "sine", dur: 0.06, vol: 0.06, bus: "sfxUI" }); },
  menuBack()    { tone({ freq: 700, end: 450, type: "sine", dur: 0.06, vol: 0.06, bus: "sfxUI" }); },
};
