import { TILE, WIDTH, HEIGHT, ROOM_W, ROOM_H, dist, randi, setRoomSize } from "./util.js?v=ec23b270";
import { sprites } from "./sprites.js?v=ec23b270";

// OBSTACLE cells are solid like walls but render as props (pillars, crates,
// barrels) instead of wall blocks.
const FLOOR = 0, WALL = 1, DOOR = 2, OBSTACLE = 3;
let tiles = [];

function tileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= ROOM_W || ty >= ROOM_H) return WALL;
  return tiles[ty * ROOM_W + tx];
}

// Spike traps cycle: safe -> warning tips -> up (damaging).
const SPIKE_PERIOD = 2.2;

export const room = {
  doorOpen: false,
  doorCols: [14, 15],
  spikes: [], // [{tx, ty, offset}]
  theme: "catacombs",
  tierDoorCols: null, // legacy lobby doorways (unused; pads replace them)
  tierPads: null,     // lobby: [{ti,x,y,r,label,sub,color,locked,req}]
  isLobby: false,
  isTown: false,

  setTheme(id) {
    this.theme = (sprites.themes && sprites.themes[id]) ? id : "catacombs";
  },

  // Install a whole floor (js/floor.js spec) as the live world: one large
  // tiles grid of small rooms + corridors. Collision/movement/decor all
  // operate on `tiles` unchanged; `rooms` metadata drives per-room decor,
  // combat gating and the minimap.
  setFloor(f) {
    setRoomSize(f.w, f.h);
    tiles = f.tiles;
    this.isFloor = true;
    this.isLobby = false;
    this.isTown = false;
    this.spikes = f.spikes || []; // trap-room hazards, in absolute floor tile coords
    this.doorCols = [];
    this.doorOpen = true;         // floors gate per-room (see room.locked)
    this.rooms = f.rooms;
    this.edges = f.edges;
    this.floorDoors = f.doors || [];
    this.floorWalls = f.walls || [];
    this.floorStairs = f.stairs || null;
    this.stairsRoomId = f.stairsRoomId;
    this.seed = f.seed;
    this.roomType = "floor";
    this.exit = "door";
    // per-room combat gating: rooms start unlocked + uncleared; entering an
    // uncleared combat room locks it until its enemies are down.
    for (const r of this.rooms) { r.locked = false; r.cleared = !!r.cleared; }
    this._buildDoorBarriers();
    this._buildEdgeWalls();
    this.prerender();
  },

  // Each door sits on a seam between two floor cells, so it can't be a tile —
  // precompute a thin solid barrier (world px) per door cell. The barrier only
  // blocks while the door is CLOSED (see doorClosed), so an open door is
  // freely passable.
  _buildDoorBarriers() {
    const T = 2; // barrier thickness (px), just past the seam
    const barFor = (c, dir) => {
      const cx = c.x * TILE, cy = c.y * TILE;
      if (dir === "E") return { x0: cx + TILE, y0: cy, x1: cx + TILE + T, y1: cy + TILE };
      if (dir === "W") return { x0: cx - T, y0: cy, x1: cx, y1: cy + TILE };
      if (dir === "S") return { x0: cx, y0: cy + TILE, x1: cx + TILE, y1: cy + TILE + T };
      return { x0: cx, y0: cy - T, x1: cx + TILE, y1: cy }; // "N"
    };
    this._doorBars = (this.floorDoors || []).map((d) => {
      const bars = d.cells.map((c) => barFor(c, d.dir));
      return { door: d, bars };
    });
  },

  // The wall half of a corridor mouth sits on a floor|floor edge (both flanking
  // cells are FLOOR), so it can't be a tile — turn each into a thin solid
  // barrier (world px) that boxHitsWall always blocks. Unlike a door, it never
  // opens.
  _buildEdgeWalls() {
    const T = 2; // barrier thickness (px), just past the seam
    this._edgeWalls = (this.floorWalls || []).map((wl) => {
      const cx = wl.x * TILE, cy = wl.y * TILE;
      if (wl.dir === "E") return { x0: cx + TILE, y0: cy, x1: cx + TILE + T, y1: cy + TILE };
      if (wl.dir === "W") return { x0: cx - T, y0: cy, x1: cx, y1: cy + TILE };
      if (wl.dir === "S") return { x0: cx, y0: cy + TILE, x1: cx + TILE, y1: cy + TILE + T };
      return { x0: cx, y0: cy - T, x1: cx + TILE, y1: cy }; // "N"
    });
  },

  // A floor door is closed (solid) while either room it connects is locked.
  doorClosed(d) {
    return (d.rooms || []).some((id) => { const r = this.roomById(id); return r && r.locked; });
  },

  // The room whose interior rect contains this world-space point (or null in
  // corridors / the void). Used for combat-gating room-entry detection.
  roomAt(x, y) {
    if (!this.isFloor || !this.rooms) return null;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    for (const r of this.rooms) {
      const rc = r.rect;
      if (tx >= rc.x && tx < rc.x + rc.w && ty >= rc.y && ty < rc.y + rc.h) return r;
    }
    return null;
  },

  roomById(id) { return this.rooms && this.rooms.find((r) => r.id === id); },

  // A themed entry room with three glowing floor pads, one per dungeon tier.
  // tierInfo (optional): [{ sub, color, locked, req }] per tier, from the caller.
  generateLobby(tierInfo) {
    this.spikes = [];
    this.isLobby = true;
    this.isTown = false;
    this.isFloor = false;
    this.roomType = null;
    this.doorOpen = false;
    this.seed = (Math.random() * 0x7fffffff) | 0;
    tiles = new Array(ROOM_W * ROOM_H).fill(FLOOR);
    for (let x = 0; x < ROOM_W; x++) {
      tiles[x] = WALL;
      tiles[(ROOM_H - 1) * ROOM_W + x] = WALL;
    }
    for (let y = 0; y < ROOM_H; y++) {
      tiles[y * ROOM_W] = WALL;
      tiles[y * ROOM_W + ROOM_W - 1] = WALL;
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
    const padY = Math.round(ROOM_H * 0.46) * TILE + TILE / 2;
    this.tierPads = [0.25, 0.5, 0.75].map((f, ti) => {
      const t = info[ti] || dflt[ti];
      return {
        ti, x: Math.round(ROOM_W * f) * TILE, y: padY, r: TILE * 0.95,
        label: `TIER ${ti + 1}`, sub: t.sub, color: t.color,
        locked: !!t.locked, req: t.req || 0, cleared: !!t.cleared,
      };
    });
    this.prerender();
  },

  // A walkable town: warm theme, a single exit door, a tavern corner.
  generateTown() {
    this.spikes = [];
    this.isLobby = false;
    this.isTown = true;
    this.isFloor = false;
    this.roomType = null;
    this.doorOpen = true;
    this.tierDoorCols = null;
    this.tierPads = null;
    this.seed = (Math.random() * 0x7fffffff) | 0;
    tiles = new Array(ROOM_W * ROOM_H).fill(FLOOR);
    for (let x = 0; x < ROOM_W; x++) {
      tiles[x] = WALL;
      tiles[(ROOM_H - 1) * ROOM_W + x] = WALL;
    }
    for (let y = 0; y < ROOM_H; y++) {
      tiles[y * ROOM_W] = WALL;
      tiles[y * ROOM_W + ROOM_W - 1] = WALL;
    }
    this.doorCols = [Math.floor(ROOM_W / 2) - 1, Math.floor(ROOM_W / 2)];
    for (const c of this.doorCols) tiles[c] = DOOR;

    // tavern corner: a few solid cells rendered as tables/kegs/crates by the
    // town obstacle palette (NPCs stand along the 0.45H row, so stay above it)
    for (const [tx, ty] of [[2, 2], [3, 2], [2, 3], [ROOM_W - 3, 2], [ROOM_W - 4, 2]]) {
      tiles[ty * ROOM_W + tx] = OBSTACLE;
    }
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
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.spikes.some((s) => s.tx === tx && s.ty === ty && this.spikeStage(s, time) === 2);
  },

  isSolid(tx, ty) {
    const t = tileAt(tx, ty);
    if (t === DOOR) return !this.doorOpen; // single-room door (floors gate via seam barriers)
    return t === WALL || t === OBSTACLE;
  },

  // Is this world-space point standing in the doorway?
  inDoorway(x, y) {
    const tx = Math.floor(x / TILE);
    return tileAt(tx, Math.floor(y / TILE)) === DOOR ||
           (this.doorCols.includes(tx) && y < TILE * 1.6);
  },

  // Is this world-space point on the floor's descent staircase (its own cell
  // or the one just in front)? Used to trigger the walk-onto-stairs descent.
  onStairs(x, y) {
    const s = this.floorStairs;
    if (!s) return false;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return tx === s.x && (ty === s.y || ty === s.y + 1);
  },

  // Does an axis-aligned box (in world px) overlap any solid tile or seam wall?
  boxHitsWall(x, y, w, h) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 1) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 1) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.isSolid(tx, ty)) return true;
      }
    }
    if (this._doorBars) {
      for (const db of this._doorBars) {
        if (!this.doorClosed(db.door)) continue; // open door: passable
        for (const e of db.bars) {
          if (x < e.x1 && x + w > e.x0 && y < e.y1 && y + h > e.y0) return true;
        }
      }
    }
    if (this._edgeWalls) {
      for (const e of this._edgeWalls) { // seam walls: always solid
        if (x < e.x1 && x + w > e.x0 && y < e.y1 && y + h > e.y0) return true;
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
    return this.isSolid(Math.floor(x / TILE), Math.floor(y / TILE));
  },

  // Random open-floor position inside a room rect (floor mode per-room spawns).
  randomFloorInRect(rect, tries = 80) {
    for (let i = 0; i < tries; i++) {
      const tx = randi(rect.x, rect.x + rect.w - 1);
      const ty = randi(rect.y, rect.y + rect.h - 1);
      if (tileAt(tx, ty) === FLOOR) return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
    }
    return { x: (rect.x + rect.w / 2) * TILE, y: (rect.y + rect.h / 2) * TILE };
  },

  // Random open-floor position at least minDist away from (fx, fy).
  randomFloorPos(fx, fy, minDist) {
    for (let tries = 0; tries < 200; tries++) {
      const tx = randi(2, ROOM_W - 3);
      const ty = randi(2, ROOM_H - 3);
      if (tileAt(tx, ty) !== FLOOR) continue;
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      if (dist(x, y, fx, fy) >= minDist) return { x, y };
    }
    return { x: WIDTH / 2, y: HEIGHT / 2 };
  },

  // serialize / restore the layout for co-op guests
  getData() {
    return {
      w: ROOM_W, h: ROOM_H, tiles: tiles.join(","),
      doorCols: this.doorCols, doorOpen: this.doorOpen, spikes: this.spikes,
      // decor inputs: guests re-derive identical room dressing from these
      seed: this.seed || 1, theme: this.theme, roomType: this.roomType || "combat",
      isLobby: this.isLobby ? 1 : 0, isTown: this.isTown ? 1 : 0, exit: this.exit || "door",
      // floor mode: per-room rects/intents drive the decor planner + minimap;
      // floorDoors (shared-wall openings) drive the gate meshes + gating.
      isFloor: this.isFloor ? 1 : 0,
      stairsRoomId: this.isFloor ? this.stairsRoomId : null,
      edges: this.isFloor ? this.edges : null,
      floorDoors: this.isFloor ? this.floorDoors : null,
      floorWalls: this.isFloor ? this.floorWalls : null,
      floorStairs: this.isFloor ? this.floorStairs : null,
      rooms: this.isFloor ? this.rooms.map((r) => ({
        id: r.id, type: r.type, intent: r.intent, rect: r.rect, seed: r.seed,
        doors: r.doors, doorCells: r.doorCells,
        locked: !!r.locked, cleared: !!r.cleared,
      })) : null,
    };
  },

  setData(d) {
    setRoomSize(d.w, d.h);
    tiles = d.tiles.split(",").map(Number);
    this.doorCols = d.doorCols;
    this.doorOpen = d.doorOpen;
    this.spikes = d.spikes || [];
    this.seed = d.seed || 1;
    if (d.theme) this.setTheme(d.theme);
    this.roomType = d.roomType || "combat";
    this.isLobby = !!d.isLobby;
    this.isTown = !!d.isTown;
    this.exit = d.exit || "door";
    // co-op guest: reconstruct a connected floor from the host's serialized
    // getData() (mirrors setFloor, but the layout arrives over the wire rather
    // than from generateFloor). Per-room lock/clear/seen then track the host
    // via the snapshot; the 3D layer + minimap read straight off these.
    if (d.isFloor) {
      this.isFloor = true;
      this.rooms = (d.rooms || []).map((r) => ({
        ...r, locked: !!r.locked, cleared: !!r.cleared, seen: !!r.seen,
      }));
      this.edges = d.edges || [];
      this.floorDoors = d.floorDoors || [];
      this.floorWalls = d.floorWalls || [];
      this.floorStairs = d.floorStairs || null;
      this.stairsRoomId = d.stairsRoomId;
      this._buildDoorBarriers();
      this._buildEdgeWalls();
    } else {
      this.isFloor = false;
    }
    this.prerender();
  },

  // The room has no 2D render of its own anymore — the 3D layer assembles
  // the dungeon from tiles[]. Bump the version on every (re)build so it
  // knows to reassemble the mesh.
  prerender() {
    this.version = (this.version || 0) + 1;
  },
};
