import { WIDTH, HEIGHT, angleTo, dist } from "./util.js?v=39980037";
import { audio } from "./audio.js?v=39980037";
import { rt } from "./runtime.js?v=39980037";

const keys = {};
// x/y are the world-ground point under the cursor (for aim); sx/sy are the
// raw canvas pixel position (kept so aim can be recomputed each frame as the
// follow camera moves).
const mouse = { x: WIDTH / 2, y: HEIGHT / 2, sx: 0, sy: 0, down: false };
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

// Raw canvas pixel coordinates of a pointer event.
function toScreen(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height),
  };
}

// Raw canvas pixel coordinates. Used for mouse.x/y, which the world map
// screen reads for hover (drawMap draws directly in canvas pixel space).
// Combat aim instead ray-casts through the live 3D camera (see aimAngle) so
// it's correct under the follow camera.
function toWorld(canvas, clientX, clientY) {
  return toScreen(canvas, clientX, clientY);
}

function stickVector(stick) {
  let dx = stick.x - stick.ox;
  let dy = stick.y - stick.oy;
  const len = Math.hypot(dx, dy);
  if (len < DEADZONE) return { dx: 0, dy: 0, len: 0 };
  const m = Math.min(1, len / STICK_RADIUS);
  return { dx: (dx / len) * m, dy: (dy / len) * m, len };
}

// Whether the local hero has a dash, pushed in by whoever spawns/rebuilds
// them. Reading it off the live player instead would make this low-level
// device module depend on run state, which is the wrong direction.
let dashable = false;

export const input = {
  keys,
  mouse,
  touch,
  touchSeen: false,
  STICK_RADIUS,

  // Touch buttons live in SCREEN space (canvas px), bottom-right corner.
  dashBtn() { const c = this._canvas; return { x: (c ? c.width : WIDTH) - 64, y: (c ? c.height : HEIGHT) - 76,  r: 32 }; },
  invBtn()  { const c = this._canvas; return { x: (c ? c.width : WIDTH) - 64, y: (c ? c.height : HEIGHT) - 152, r: 26 }; },

  // Called wherever the local player is created or rebuilt.
  setDashable(v) { dashable = !!v; },

  init(canvas) {
    this._canvas = canvas;
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k === "e" && !keys[k]) interactTap = true; // edge-triggered talk
      keys[k] = true;
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        e.preventDefault();
      }
      audio.unlock();
    });
    window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
    window.addEventListener("blur", () => {
      for (const k of Object.keys(keys)) keys[k] = false;
      mouse.down = false;
    });

    const onMouse = (e) => {
      const s = toScreen(canvas, e.clientX, e.clientY);
      mouse.sx = s.x; mouse.sy = s.y;      // for the 3D-camera aim raycast
      const p = toWorld(canvas, e.clientX, e.clientY);
      mouse.x = p.x; mouse.y = p.y;        // canvas pixels, for the world map's hover
    };
    canvas.addEventListener("mousemove", onMouse);
    canvas.addEventListener("mousedown", (e) => {
      onMouse(e);
      if (e.button === 0) mouse.down = true;
      audio.unlock();
    });
    window.addEventListener("mouseup", (e) => { if (e.button === 0) mouse.down = false; });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // ---- touch ----
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.touchSeen = true;
      audio.unlock();
      for (const t of e.changedTouches) {
        const p = toScreen(canvas, t.clientX, t.clientY); // screen px
        const ibtn = this.invBtn();
        if (dist(p.x, p.y, ibtn.x, ibtn.y) < ibtn.r + 12) {
          invTap = true;
          continue;
        }
        const btn = this.dashBtn();
        if (dashable && dist(p.x, p.y, btn.x, btn.y) < btn.r + 12) {
          dashTap = true;
          continue;
        }
        const stick = p.x < canvas.width / 2 ? touch.move : touch.aim;
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
        const p = toScreen(canvas, t.clientX, t.clientY);
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
  // The aim stick's vector is in screen space, whose axes align with the game
  // axes (screen-right = +x, screen-down = +y) regardless of camera pan/tilt,
  // so atan2 gives the facing directly. The mouse ray-casts through the live
  // 3D camera each call so it stays correct as the follow camera moves.
  aimAngle(player) {
    if (touch.aim.active) {
      const v = stickVector(touch.aim);
      if (v.len > 0) return Math.atan2(v.dy, v.dx);
      return player.aim || 0; // stick held at rest: keep the last facing
    }
    const dr = rt.render3d;
    if (dr && dr.proto) {
      let sx = mouse.sx, sy = mouse.sy;
      if (!sx && !sy) { sx = dr._w / 2; sy = dr._h / 2; } // before first move
      const g = dr.screenToGround(sx, sy);
      if (g) return angleTo(player.x, player.y, g.x, g.y);
    }
    return angleTo(player.x, player.y, mouse.x, mouse.y);
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
