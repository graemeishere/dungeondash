"use strict";
window.DD = window.DD || {};
(function (DD) {
  DD.TILE = 32;

  // Room dimensions are recomputed per room so the dungeon fills any screen,
  // portrait or landscape. These are just the boot defaults.
  DD.ROOM_W = 30;
  DD.ROOM_H = 18;
  DD.WIDTH = DD.TILE * DD.ROOM_W;
  DD.HEIGHT = DD.TILE * DD.ROOM_H;

  // Letterbox transform used when the window changes size mid-room.
  DD.view = { scale: 1, ox: 0, oy: 0 };

  DD.setRoomSize = (tw, th) => {
    DD.ROOM_W = tw;
    DD.ROOM_H = th;
    DD.WIDTH = DD.TILE * tw;
    DD.HEIGHT = DD.TILE * th;
  };

  DD.roomSizeForCanvas = (canvas) => ({
    tw: DD.clamp(Math.floor(canvas.width / DD.TILE), 12, 44),
    th: DD.clamp(Math.floor(canvas.height / DD.TILE), 11, 30),
  });

  DD.updateView = (canvas) => {
    // may upscale: a co-op guest mirrors the host's room, which can be smaller
    // than the guest's screen
    const s = Math.min(canvas.width / DD.WIDTH, canvas.height / DD.HEIGHT);
    DD.view.scale = s;
    DD.view.ox = (canvas.width - DD.WIDTH * s) / 2;
    DD.view.oy = (canvas.height - DD.HEIGHT * s) / 2;
  };

  DD.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  DD.rand = (a, b) => a + Math.random() * (b - a);
  DD.randi = (a, b) => Math.floor(DD.rand(a, b + 1));
  DD.choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
  DD.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  DD.angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
  DD.lerp = (a, b, t) => a + (b - a) * t;

  // Smallest signed difference between two angles, in [-PI, PI].
  DD.angleDiff = (a, b) => {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
})(window.DD);
