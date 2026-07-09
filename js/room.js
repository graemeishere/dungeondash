"use strict";
(function (DD) {
  const FLOOR = 0, WALL = 1, DOOR = 2;
  let tiles = [];

  function tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= DD.ROOM_W || ty >= DD.ROOM_H) return WALL;
    return tiles[ty * DD.ROOM_W + tx];
  }

  // Spike traps cycle: safe -> warning tips -> up (damaging).
  const SPIKE_PERIOD = 2.2;

  DD.room = {
    doorOpen: false,
    doorCols: [14, 15],
    spikes: [], // [{tx, ty, offset}]
    theme: "catacombs",
    decorations: [],    // theme ambiance data (not yet rendered in 3D)
    staticDecor: [],    // static prop data (not yet rendered in 3D)
    tierDoorCols: null, // legacy lobby doorways (unused; pads replace them)
    tierPads: null,     // lobby: [{ti,x,y,r,label,sub,color,locked,req}]
    isLobby: false,
    isTown: false,

    setTheme(id) {
      this.theme = (DD.sprites.themes && DD.sprites.themes[id]) ? id : "catacombs";
    },

    themeSet() {
      return (DD.sprites.themes && DD.sprites.themes[this.theme]) || null;
    },

    // Sprinkle non-colliding ambiance for the current theme along the walls.
    addAmbiance() {
      const th = this.themeSet();
      if (!th) return;
      const topY = DD.TILE * 0.9;
      for (let tx = 3; tx < DD.ROOM_W - 3; tx += 6) {
        const x = tx * DD.TILE + DD.TILE / 2;
        if (th.torch) this.decorations.push({ frames: th.torch, x, y: topY, anim: true });
        else if (th.lantern) this.decorations.push({ frames: th.lantern, x, y: topY, anim: true });
      }
      if (th.bat) {
        for (let i = 0; i < 4; i++) {
          this.decorations.push({
            frames: th.bat, anim: true,
            bx: DD.rand(DD.TILE * 3, DD.WIDTH - DD.TILE * 3),
            by: DD.rand(DD.TILE * 2, DD.HEIGHT * 0.45),
            phase: Math.random() * Math.PI * 2, fly: true,
          });
        }
      }
    },

    generate(opts = {}) {
      this.doorOpen = false;
      this.spikes = [];
      this.decorations = [];
      this.staticDecor = [];
      this.tierDoorCols = null;
      this.tierPads = null;
      this.isLobby = false;
      this.isTown = false;
      this.roomType = null; // the caller stamps it after generate()
      // decoration seed: the 3D decor planner derives every visual choice from
      // this, so co-op guests rebuild identical rooms from {tiles, seed}
      this.seed = (Math.random() * 0x7fffffff) | 0;
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

      if (opts.spikes) {
        // horizontal spike bands across the room with random safe gaps,
        // each band on its own timing offset
        const bandYs = [0.3, 0.5, 0.7].map((f) => Math.round(DD.ROOM_H * f));
        bandYs.forEach((ty, band) => {
          const gaps = new Set();
          while (gaps.size < Math.max(2, Math.round(DD.ROOM_W / 10))) {
            gaps.add(DD.randi(1, DD.ROOM_W - 2));
          }
          for (let tx = 1; tx < DD.ROOM_W - 1; tx++) {
            if (gaps.has(tx) || tileAt(tx, ty) !== FLOOR) continue;
            this.spikes.push({ tx, ty, offset: band * 0.7 });
          }
        });
      }

      this.addAmbiance();
      // crypt-only ground props baked into the floor (purely visual)
      const th = this.themeSet();
      if (th && th.gravestone) {
        for (let i = 0; i < 3; i++) {
          const tx = DD.randi(2, DD.ROOM_W - 3), ty = DD.randi(2, DD.ROOM_H - 3);
          if (tileAt(tx, ty) !== FLOOR) continue;
          const img = Math.random() < 0.5 ? th.gravestone : (th.fence || th.gravestone);
          this.staticDecor.push({ img, x: tx * DD.TILE + DD.TILE / 2, y: ty * DD.TILE + DD.TILE });
        }
      }
      if (th && th.rail) {
        // one continuous mine-cart track running down a mostly-open column
        let col = Math.round(DD.ROOM_W * 0.5);
        for (let off = 0; off <= 4; off++) {
          const c = Math.round(DD.ROOM_W * 0.5) + (off % 2 === 0 ? off / 2 : -(off + 1) / 2);
          let open = 0;
          for (let ty = 1; ty < DD.ROOM_H - 1; ty++) if (tileAt(c, ty) === FLOOR) open++;
          if (open >= DD.ROOM_H - 4) { col = c; break; }
        }
        let lastFloorY = DD.ROOM_H - 3;
        for (let ty = 1; ty < DD.ROOM_H - 1; ty++) {
          if (tileAt(col, ty) !== FLOOR) continue;
          this.staticDecor.push({ img: th.rail, x: col * DD.TILE + DD.TILE / 2, y: ty * DD.TILE, anchorTop: true });
          lastFloorY = ty;
        }
        if (th.mineCart) {
          this.staticDecor.push({ img: th.mineCart, x: col * DD.TILE + DD.TILE / 2, y: lastFloorY * DD.TILE + DD.TILE });
        }
      }

      this.prerender();
    },

    // A themed entry room with three glowing floor pads, one per dungeon tier.
    // tierInfo (optional): [{ sub, color, locked, req }] per tier, from the caller.
    generateLobby(tierInfo) {
      this.spikes = [];
      this.decorations = [];
      this.staticDecor = [];
      this.isLobby = true;
      this.isTown = false;
      this.roomType = null;
      this.doorOpen = false;
      this.seed = (Math.random() * 0x7fffffff) | 0;
      tiles = new Array(DD.ROOM_W * DD.ROOM_H).fill(FLOOR);
      for (let x = 0; x < DD.ROOM_W; x++) {
        tiles[x] = WALL;
        tiles[(DD.ROOM_H - 1) * DD.ROOM_W + x] = WALL;
      }
      for (let y = 0; y < DD.ROOM_H; y++) {
        tiles[y * DD.ROOM_W] = WALL;
        tiles[y * DD.ROOM_W + DD.ROOM_W - 1] = WALL;
      }

      // no wall doorways — entry is via glowing floor pads (drawn + handled in game.js)
      this.doorCols = [];
      this.tierDoorCols = null;
      const dflt = [
        { sub: "1-10", color: "#9affb0", locked: false },
        { sub: "11-20", color: "#ffd95e", locked: false },
        { sub: "21-30", color: "#ff7a7a", locked: false },
      ];
      const info = tierInfo || dflt;
      const padY = Math.round(DD.ROOM_H * 0.46) * DD.TILE + DD.TILE / 2;
      this.tierPads = [0.25, 0.5, 0.75].map((f, ti) => {
        const t = info[ti] || dflt[ti];
        return {
          ti, x: Math.round(DD.ROOM_W * f) * DD.TILE, y: padY, r: DD.TILE * 0.95,
          label: `TIER ${ti + 1}`, sub: t.sub, color: t.color,
          locked: !!t.locked, req: t.req || 0, cleared: !!t.cleared,
        };
      });
      this.addAmbiance();
      this.prerender();
    },

    // A walkable town: warm theme, a single exit door, a bar counter prop.
    generateTown() {
      this.spikes = [];
      this.decorations = [];
      this.staticDecor = [];
      this.isLobby = false;
      this.isTown = true;
      this.roomType = null;
      this.doorOpen = true;
      this.tierDoorCols = null;
      this.tierPads = null;
      this.seed = (Math.random() * 0x7fffffff) | 0;
      tiles = new Array(DD.ROOM_W * DD.ROOM_H).fill(FLOOR);
      for (let x = 0; x < DD.ROOM_W; x++) {
        tiles[x] = WALL;
        tiles[(DD.ROOM_H - 1) * DD.ROOM_W + x] = WALL;
      }
      for (let y = 0; y < DD.ROOM_H; y++) {
        tiles[y * DD.ROOM_W] = WALL;
        tiles[y * DD.ROOM_W + DD.ROOM_W - 1] = WALL;
      }
      this.doorCols = [Math.floor(DD.ROOM_W / 2) - 1, Math.floor(DD.ROOM_W / 2)];
      for (const c of this.doorCols) tiles[c] = DOOR;

      const th = this.themeSet();
      if (th && th.barCounter) {
        this.staticDecor.push({ img: th.barCounter, x: DD.TILE * 3.5, y: DD.TILE * 2.4, anchorTop: true });
      }
      this.decorations.push({ sign: true, text: "TO THE MAP", sub: "▲ exit", color: "#ffd95e", x: (DD.ROOM_W / 2) * DD.TILE, y: DD.TILE * 2.2 });
      this.addAmbiance();
      this.prerender();
    },

    // 0 = safe, 1 = warning tips, 2 = spikes up
    spikeStage(spike, time) {
      const t = (time + spike.offset) % SPIKE_PERIOD;
      if (t > SPIKE_PERIOD - 0.55) return 2;
      if (t > SPIKE_PERIOD - 0.95) return 1;
      return 0;
    },

    spikeUpAt(x, y, time) {
      const tx = Math.floor(x / DD.TILE), ty = Math.floor(y / DD.TILE);
      return this.spikes.some((s) => s.tx === tx && s.ty === ty && this.spikeStage(s, time) === 2);
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

    // serialize / restore the layout for co-op guests
    getData() {
      return {
        w: DD.ROOM_W, h: DD.ROOM_H, tiles: tiles.join(","),
        doorCols: this.doorCols, doorOpen: this.doorOpen, spikes: this.spikes,
        // decor inputs: guests re-derive identical room dressing from these
        seed: this.seed || 1, theme: this.theme, roomType: this.roomType || "combat",
        isLobby: this.isLobby ? 1 : 0, isTown: this.isTown ? 1 : 0,
      };
    },

    setData(d) {
      DD.setRoomSize(d.w, d.h);
      tiles = d.tiles.split(",").map(Number);
      this.doorCols = d.doorCols;
      this.doorOpen = d.doorOpen;
      this.spikes = d.spikes || [];
      this.seed = d.seed || 1;
      if (d.theme) this.setTheme(d.theme);
      this.roomType = d.roomType || "combat";
      this.isLobby = !!d.isLobby;
      this.isTown = !!d.isTown;
      this.decorations = [];
      this.staticDecor = [];
      this.prerender();
    },

    // The room has no 2D render of its own anymore — the 3D layer assembles
    // the dungeon from tiles[]. Bump the version on every (re)build so it
    // knows to reassemble the mesh.
    prerender() {
      this.version = (this.version || 0) + 1;
    },
  };
})(window.DD);
