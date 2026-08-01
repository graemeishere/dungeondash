"use strict";
// Constants, room sizing and small math helpers. The bottom layer: this module
// imports nothing.
//
// ROOM_W/ROOM_H/WIDTH/HEIGHT are `export let` on purpose — they change whenever
// a room of a different shape loads, and ES module live bindings mean every
// importer sees the new value without a getter or a shared mutable object.

export const TILE = 32;

// Room dimensions are recomputed per room so the dungeon fills any screen,
// portrait or landscape. These are just the boot defaults.
export let ROOM_W = 30;
export let ROOM_H = 18;
export let WIDTH = TILE * ROOM_W;
export let HEIGHT = TILE * ROOM_H;

// Letterbox transform used when the window changes size mid-room.
export const view = { scale: 1, ox: 0, oy: 0 };

export function setRoomSize(tw, th) {
  ROOM_W = tw;
  ROOM_H = th;
  WIDTH = TILE * tw;
  HEIGHT = TILE * th;
}

// Fixed landscape room (used for menus/town/lobby backdrops). Dungeon rooms
// draw a per-type shape from ROOM_SHAPES instead — the 3D camera frames
// whatever exists, so rooms are no longer screen-bound.
export const FIXED_ROOM = { tw: 22, th: 13 };
export const roomSizeForCanvas = () => ({ tw: FIXED_ROOM.tw, th: FIXED_ROOM.th });

// Room-size variety per room type: each room picks one of its type's shapes
// so runs stop feeling like the same box redressed. Sizes are tiles (w,h);
// the door sits top-center and players enter bottom-center, so height is the
// run direction. Kept host-rolled: w/h sync to co-op guests via room data.
const ROOM_SHAPES = {
  combat:   [[22, 13], [26, 12], [16, 16], [15, 11], [24, 16], [13, 18], [28, 10]],
  elite:    [[18, 14], [22, 13], [16, 16], [24, 15]],
  trap:     [[12, 20], [26, 11], [11, 24], [30, 9]],   // gauntlet corridors
  treasure: [[12, 9], [14, 10], [10, 12]],             // intimate vaults
  boss:     [[26, 16], [24, 18], [30, 14]],            // arenas
};
export function roomSizeFor(roomType) {
  const shapes = ROOM_SHAPES[roomType] || ROOM_SHAPES.combat;
  const s = shapes[Math.floor(Math.random() * shapes.length)];
  return { tw: s[0], th: s[1] };
}

// Deterministic RNG (mulberry32). Room decoration derives from a seed synced
// to co-op guests, so both sides must draw an identical stream.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function updateView(canvas) {
  // may upscale: a co-op guest mirrors the host's room, which can be smaller
  // than the guest's screen
  const s = Math.min(canvas.width / WIDTH, canvas.height / HEIGHT);
  view.scale = s;
  view.ox = (canvas.width - WIDTH * s) / 2;
  view.oy = (canvas.height - HEIGHT * s) / 2;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const lerp = (a, b, t) => a + (b - a) * t;

// Smallest signed difference between two angles, in [-PI, PI].
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
