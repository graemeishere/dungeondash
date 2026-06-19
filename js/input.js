"use strict";
(function (DD) {
  const keys = {};
  const mouse = { x: DD.WIDTH / 2, y: DD.HEIGHT / 2, down: false };
  // Twin-stick touch: left half of the screen moves, right half aims/attacks.
  const touch = {
    move: { id: null, active: false, ox: 0, oy: 0, x: 0, y: 0 },
    aim: { id: null, active: false, ox: 0, oy: 0, x: 0, y: 0 },
  };
  let dashTap = false;
  let invTap  = false;
  let interactTap = false;

  const STICK_RADIUS = 48;
  const DEADZONE = 9;

  function toWorld(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const cx = (clientX - rect.left) * (canvas.width / rect.width);
    const cy = (clientY - rect.top) * (canvas.height / rect.height);
    return {
      x: (cx - DD.view.ox) / DD.view.scale,
      y: (cy - DD.view.oy) / DD.view.scale,
    };
  }

  function stickVector(stick) {
    let dx = stick.x - stick.ox;
    let dy = stick.y - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len < DEADZONE) return { dx: 0, dy: 0, len: 0 };
    const m = Math.min(1, len / STICK_RADIUS);
    return { dx: (dx / len) * m, dy: (dy / len) * m, len };
  }

  DD.input = {
    keys,
    mouse,
    touch,
    touchSeen: false,
    STICK_RADIUS,

    dashBtn() { return { x: DD.WIDTH - 64, y: DD.HEIGHT - 76,  r: 32 }; },
    invBtn()  { return { x: DD.WIDTH - 64, y: DD.HEIGHT - 152, r: 26 }; },

    init(canvas) {
      window.addEventListener("keydown", (e) => {
        const k = e.key.toLowerCase();
        if (k === "e" && !keys[k]) interactTap = true; // edge-triggered talk
        keys[k] = true;
        if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
          e.preventDefault();
        }
        DD.audio.unlock();
      });
      window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
      window.addEventListener("blur", () => {
        for (const k of Object.keys(keys)) keys[k] = false;
        mouse.down = false;
      });

      const onMouse = (e) => {
        const p = toWorld(canvas, e.clientX, e.clientY);
        mouse.x = p.x;
        mouse.y = p.y;
      };
      canvas.addEventListener("mousemove", onMouse);
      canvas.addEventListener("mousedown", (e) => {
        onMouse(e);
        if (e.button === 0) mouse.down = true;
        DD.audio.unlock();
      });
      window.addEventListener("mouseup", (e) => { if (e.button === 0) mouse.down = false; });
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());

      // ---- touch ----
      canvas.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this.touchSeen = true;
        DD.audio.unlock();
        for (const t of e.changedTouches) {
          const p = toWorld(canvas, t.clientX, t.clientY);
          const pl = DD.game && DD.game.localPlayer;
          const ibtn = this.invBtn();
          if (DD.dist(p.x, p.y, ibtn.x, ibtn.y) < ibtn.r + 12) {
            invTap = true;
            continue;
          }
          const btn = this.dashBtn();
          if (pl && pl.cfg.dash && DD.dist(p.x, p.y, btn.x, btn.y) < btn.r + 12) {
            dashTap = true;
            continue;
          }
          const stick = p.x < DD.WIDTH / 2 ? touch.move : touch.aim;
          if (stick.id !== null) continue;
          stick.id = t.identifier;
          stick.active = true;
          stick.ox = stick.x = p.x;
          stick.oy = stick.y = p.y;
        }
      }, { passive: false });

      canvas.addEventListener("touchmove", (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          const p = toWorld(canvas, t.clientX, t.clientY);
          for (const stick of [touch.move, touch.aim]) {
            if (stick.id === t.identifier) { stick.x = p.x; stick.y = p.y; }
          }
        }
      }, { passive: false });

      const endTouch = (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          for (const stick of [touch.move, touch.aim]) {
            if (stick.id === t.identifier) { stick.id = null; stick.active = false; }
          }
        }
      };
      canvas.addEventListener("touchend", endTouch, { passive: false });
      canvas.addEventListener("touchcancel", endTouch, { passive: false });
    },

    moveVector() {
      let dx = 0, dy = 0;
      if (keys.w || keys.arrowup) dy -= 1;
      if (keys.s || keys.arrowdown) dy += 1;
      if (keys.a || keys.arrowleft) dx -= 1;
      if (keys.d || keys.arrowright) dx += 1;
      if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
      if (!dx && !dy && touch.move.active) {
        const v = stickVector(touch.move);
        return { dx: v.dx, dy: v.dy };
      }
      return { dx, dy };
    },

    // Where the player should face: aim stick if active, otherwise the mouse.
    aimAngle(player) {
      if (touch.aim.active) {
        const v = stickVector(touch.aim);
        if (v.len > 0) return Math.atan2(v.dy, v.dx);
        return DD.angleTo(player.x, player.y, touch.aim.ox, touch.aim.oy);
      }
      return DD.angleTo(player.x, player.y, mouse.x, mouse.y);
    },

    attacking() {
      return mouse.down || keys[" "] || touch.aim.active;
    },

    dashing() {
      return keys.shift;
    },

    consumeDashTap() { const v = dashTap; dashTap = false; return v; },
    consumeInvTap()  { const v = invTap;  invTap  = false; return v; },
    consumeInteract() { const v = interactTap; interactTap = false; return v; },
  };
})(window.DD);
