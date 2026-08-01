"use strict";
// Entry point. index.html loads this one module instead of a hand-ordered list
// of 15 classic <script> tags; the import graph below is the load order, and it
// is declared by the files themselves rather than by tag position in the HTML.
import * as util from "./util.js?v=__BUILD__";
import { rt } from "./runtime.js?v=__BUILD__";
import { sprites } from "./sprites.js?v=__BUILD__";
import { audio } from "./audio.js?v=__BUILD__";
import { input } from "./input.js?v=__BUILD__";
import { particles } from "./particles.js?v=__BUILD__";
import { net, netSync, RemoteInput } from "./net.js?v=__BUILD__";
import { room } from "./room.js?v=__BUILD__";
import { generateFloor } from "./floor.js?v=__BUILD__";
import * as entities from "./entities.js?v=__BUILD__";
import { profile } from "./profile.js?v=__BUILD__";
import { ATTRS, deriveStats } from "./stats.js?v=__BUILD__";
import * as items from "./items.js?v=__BUILD__";
import { hud } from "./hud.js?v=__BUILD__";
import { game3d } from "./game3d.js?v=__BUILD__";

// ---- window.DD ----------------------------------------------------------
//
// TEMPORARY BRIDGE. js/game.js is still a classic IIFE reading window.DD for
// everything; it is the last file to convert, and it is split into modules in
// its own commit. Until then this object reproduces exactly the surface the old
// script order used to build up, so game.js needs no edits to keep working.
//
// The permanent, much narrower debug-only surface replaces this when game.js
// goes away. Nothing new should be added here.
//
// WIDTH/HEIGHT/ROOM_W/ROOM_H are getters, not copies: they change whenever a
// room of a different shape loads, and a plain copy would freeze them at their
// boot values. Same for the 3D handles, which js/boot3d.js fills in later.
const DD = {
  TILE: util.TILE,
  get WIDTH() { return util.WIDTH; },
  get HEIGHT() { return util.HEIGHT; },
  get ROOM_W() { return util.ROOM_W; },
  get ROOM_H() { return util.ROOM_H; },
  view: util.view,
  FIXED_ROOM: util.FIXED_ROOM,
  setRoomSize: util.setRoomSize,
  roomSizeFor: util.roomSizeFor,
  roomSizeForCanvas: util.roomSizeForCanvas,
  makeRng: util.makeRng,
  updateView: util.updateView,
  clamp: util.clamp, rand: util.rand, randi: util.randi, choice: util.choice,
  dist: util.dist, angleTo: util.angleTo, lerp: util.lerp, angleDiff: util.angleDiff,

  sprites, audio, input, particles, room, generateFloor, profile, hud, game3d,
  net, netSync, RemoteInput,
  ATTRS, deriveStats,

  CLASSES: entities.CLASSES, UPGRADES: entities.UPGRADES,
  KIND_FACTION: entities.KIND_FACTION, rollGrade: entities.rollGrade,
  Player: entities.Player, Skeleton: entities.Skeleton, Boss: entities.Boss,
  Chest: entities.Chest, Projectile: entities.Projectile,
  EnemyShot: entities.EnemyShot, Pickup: entities.Pickup,

  INV_CAP: items.INV_CAP, ITEM_RARITY: items.ITEM_RARITY,
  buyPrice: items.buyPrice, sellPrice: items.sellPrice,
  rollItem: items.rollItem, rollShopStock: items.rollShopStock,
  equip: items.equip, unequip: items.unequip,
  itemStatLines: items.itemStatLines, compareItems: items.compareItems,

  // Filled in by js/boot3d.js as each 3D subsystem finishes loading. Reading
  // through the runtime object keeps the staged availability the old inline
  // boot had (game code runs against 2D fallbacks until models arrive).
  get render3d() { return rt.render3d; },
  set render3d(v) { rt.render3d = v; },
  get charMgr() { return rt.charMgr; },
  set charMgr(v) { rt.charMgr = v; },
  get char3d() { return rt.char3d; },
  set char3d(v) { rt.char3d = v; },
  get fx3d() { return rt.fx3d; },
  set fx3d(v) { rt.fx3d = v; },
};
window.DD = DD;

// game.js still populates window.DD (DD.game) from an IIFE, so it must run
// after the bridge exists — a static import would hoist above it.
await import("./game.js?v=__BUILD__");
