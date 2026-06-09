"use strict";
// All sound effects are synthesized with the Web Audio API — no audio files.
(function (DD) {
  let ctx = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone({ freq = 440, end = null, type = "square", dur = 0.1, vol = 0.15, delay = 0 }) {
    try {
      const ac = ensure();
      if (!ac) return;
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, end === null ? freq : end), t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* audio is best-effort */ }
  }

  function noise({ dur = 0.15, vol = 0.12, delay = 0 }) {
    try {
      const ac = ensure();
      if (!ac) return;
      const t0 = ac.currentTime + delay;
      const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      const filter = ac.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      src.connect(filter).connect(gain).connect(ac.destination);
      src.start(t0);
    } catch (e) { /* audio is best-effort */ }
  }

  DD.audio = {
    unlock() { ensure(); },
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
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: "square", dur: 0.16, vol: 0.1, delay: i * 0.13 }));
    },
    lose() {
      [330, 262, 196, 131].forEach((f, i) => tone({ freq: f, type: "sawtooth", dur: 0.3, vol: 0.1, delay: i * 0.2 }));
    },
  };
})(window.DD);
