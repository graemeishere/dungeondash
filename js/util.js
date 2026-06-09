"use strict";
window.DD = window.DD || {};
(function (DD) {
  DD.TILE = 32;
  DD.ROOM_W = 30;
  DD.ROOM_H = 18;
  DD.WIDTH = DD.TILE * DD.ROOM_W;
  DD.HEIGHT = DD.TILE * DD.ROOM_H;

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
