"use strict";
(function (DD) {
  const FLOOR = 0, WALL = 1, DOOR = 2;
  let tiles = [];
  let floorCanvas = null;

  function tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= DD.ROOM_W || ty >= DD.ROOM_H) return WALL;
    return tiles[ty * DD.ROOM_W + tx];
  }

  DD.room = {
    doorOpen: false,
    doorCols: [14, 15],

    generate() {
      this.doorOpen = false;
      tiles = new Array(DD.ROOM_W * DD.ROOM_H).fill(FLOOR);

      // border walls
      for (let x = 0; x < DD.ROOM_W; x++) {
        tiles[x] = WALL;
        tiles[(DD.ROOM_H - 1) * DD.ROOM_W + x] = WALL;
      }
      for (let y = 0; y < DD.ROOM_H; y++) {
        tiles[y * DD.ROOM_W] = WALL;
        tiles[y * DD.ROOM_W + DD.ROOM_W - 1] = WALL;
      }

      // exit door, top wall center
      this.doorCols = [Math.floor(DD.ROOM_W / 2) - 1, Math.floor(DD.ROOM_W / 2)];
      for (const c of this.doorCols) tiles[c] = DOOR;

      // 2x2 pillars near the room quarters, with jitter, keeping center open
      const qxs = [Math.round(DD.ROOM_W * 0.27), Math.round(DD.ROOM_W * 0.66)];
      const qys = [Math.round(DD.ROOM_H * 0.28), Math.round(DD.ROOM_H * 0.62)];
      for (const qx of qxs) {
        for (const qy of qys) {
          const px = DD.clamp(qx + DD.randi(-1, 1), 2, DD.ROOM_W - 4);
          const py = DD.clamp(qy + DD.randi(-1, 1), 3, DD.ROOM_H - 4);
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              tiles[(py + dy) * DD.ROOM_W + (px + dx)] = WALL;
            }
          }
        }
      }

      this.prerender();
    },

    isSolid(tx, ty) {
      const t = tileAt(tx, ty);
      if (t === DOOR) return !this.doorOpen; // door unlocks when the room is cleared
      return t === WALL;
    },

    // Is this world-space point standing in the doorway?
    inDoorway(x, y) {
      const tx = Math.floor(x / DD.TILE);
      return tileAt(tx, Math.floor(y / DD.TILE)) === DOOR ||
             (this.doorCols.includes(tx) && y < DD.TILE * 1.6);
    },

    // Does an axis-aligned box (in world px) overlap any solid tile?
    boxHitsWall(x, y, w, h) {
      const x0 = Math.floor(x / DD.TILE), x1 = Math.floor((x + w - 1) / DD.TILE);
      const y0 = Math.floor(y / DD.TILE), y1 = Math.floor((y + h - 1) / DD.TILE);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (this.isSolid(tx, ty)) return true;
        }
      }
      return false;
    },

    // Move an entity with radius r, sliding along walls. Mutates ent.x/ent.y.
    moveEntity(ent, dx, dy) {
      const r = ent.r;
      if (dx !== 0) {
        const nx = ent.x + dx;
        if (!this.boxHitsWall(nx - r, ent.y - r, r * 2, r * 2)) ent.x = nx;
      }
      if (dy !== 0) {
        const ny = ent.y + dy;
        if (!this.boxHitsWall(ent.x - r, ny - r, r * 2, r * 2)) ent.y = ny;
      }
    },

    pointHitsWall(x, y) {
      return this.isSolid(Math.floor(x / DD.TILE), Math.floor(y / DD.TILE));
    },

    // Random open-floor position at least minDist away from (fx, fy).
    randomFloorPos(fx, fy, minDist) {
      for (let tries = 0; tries < 200; tries++) {
        const tx = DD.randi(2, DD.ROOM_W - 3);
        const ty = DD.randi(2, DD.ROOM_H - 3);
        if (tileAt(tx, ty) !== FLOOR) continue;
        const x = tx * DD.TILE + DD.TILE / 2;
        const y = ty * DD.TILE + DD.TILE / 2;
        if (DD.dist(x, y, fx, fy) >= minDist) return { x, y };
      }
      return { x: DD.WIDTH / 2, y: DD.HEIGHT / 2 };
    },

    prerender() {
      floorCanvas = document.createElement("canvas");
      floorCanvas.width = DD.WIDTH;
      floorCanvas.height = DD.HEIGHT;
      const ctx = floorCanvas.getContext("2d");
      for (let ty = 0; ty < DD.ROOM_H; ty++) {
        for (let tx = 0; tx < DD.ROOM_W; tx++) {
          const t = tileAt(tx, ty);
          let img;
          if (t === WALL) img = DD.sprites.wallTile;
          else if (t === DOOR) img = DD.sprites.doorClosed;
          else img = DD.sprites.floorTiles[(tx * 7 + ty * 13) % DD.sprites.floorTiles.length];
          ctx.drawImage(img, tx * DD.TILE, ty * DD.TILE);
        }
      }
    },

    draw(ctx) {
      ctx.drawImage(floorCanvas, 0, 0);
      if (this.doorOpen) {
        for (const c of this.doorCols) ctx.drawImage(DD.sprites.doorOpen, c * DD.TILE, 0);
      }
    },
  };
})(window.DD);
