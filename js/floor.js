// Floor generator: a whole floor is one large tile grid of small rooms joined
// by corridors, explored continuously. Produces a spec that room.setFloor()
// installs as the live world; collision/movement/decor all operate on the
// resulting tiles grid unchanged.
//
// Door model: corridors are 2 tiles wide the whole way. Where a corridor meets
// a room the 2-tile mouth is one door tile + one permanent thin seam wall, both
// on the room's own border. The corridor never funnels to 1 tile, and the seam
// sits on a floor|floor edge (not a WALL tile) so there's no void gap.
//
// The tiles grid syncs to co-op guests as a string, so the LAYOUT uses
// Math.random freely; only the DECOR is seeded (via floor.seed).

import { TILE } from "./util.js?v=__BUILD__";
import { room } from "./room.js?v=__BUILD__";

const FLOOR = 0, WALL = 1;

// Macro cell holds one small room plus the corridor gap around it. Rooms are
// centred in their cell so neighbours line up and corridors run dead straight
// — the boss chamber is bigger but stays centred, so its middle row/col still
// aligns with its neighbour's and the corridor connects unchanged.
const MACRO_W = 10, MACRO_H = 9;
const ROOM_W = 5, ROOM_H = 4;
const BOSS_W = 8, BOSS_H = 7; // climactic chamber (fits 10x9 with a 1-cell margin)
const roomDims = (rm) => rm.type === "boss" ? { w: BOSS_W, h: BOSS_H } : { w: ROOM_W, h: ROOM_H };

// type -> composition intent for the decor planner
const INTENT = {
  entry: "storage", combat: null, elite: "storage", trap: "ruin",
  treasure: "hoardRoom", shrine: "shrine", storage: "storage",
  dining: "messHall", stairs: "storage", boss: "ruin",
};
const SIDE_TYPES = ["treasure", "shrine", "storage", "dining"];

const key = (c, r) => c + "," + r;

function carveRect(tiles, W, x0, y0, w, h, val) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) tiles[y * W + x] = val;
  }
}

// Build the room graph on a macro-grid, then realize it as a tiles grid.
// opts: { plan: [roomType...], boss: bool }
export function generateFloor(opts = {}) {
  const plan = opts.plan || ["combat", "combat", "combat", "combat", "stairs"];
  const critTypes = ["entry", ...plan];
  critTypes[critTypes.length - 1] = opts.boss ? "boss" : "stairs";

  const cols = 5, rows = 5;
  const occupied = new Map();
  const rooms = [];
  const edges = [];

  // random walk for the critical path, starting bottom-centre
  let cc = Math.floor(cols / 2), cr = rows - 1;
  const inBounds = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
  let prev = null;
  for (let i = 0; i < critTypes.length; i++) {
    const type = critTypes[i];
    const room = {
      id: rooms.length, type, intent: INTENT[type] != null ? INTENT[type] : null,
      mc: cc, mr: cr, cleared: false, seed: (Math.random() * 0x7fffffff) | 0,
    };
    occupied.set(key(cc, cr), room);
    rooms.push(room);
    if (prev) edges.push([prev.id, room.id]);
    prev = room;
    if (i < critTypes.length - 1) {
      const up = [[cc, cr - 1], [cc - 1, cr], [cc + 1, cr], [cc, cr - 1]]
        .filter(([c, r]) => inBounds(c, r) && !occupied.has(key(c, r)));
      if (!up.length) {
        const any = [[cc, cr - 1], [cc - 1, cr], [cc + 1, cr], [cc, cr + 1]]
          .filter(([c, r]) => inBounds(c, r) && !occupied.has(key(c, r)));
        if (!any.length) break;
        [cc, cr] = any[(Math.random() * any.length) | 0];
      } else {
        [cc, cr] = up[(Math.random() * up.length) | 0];
      }
    }
  }

  // side rooms: hang 1-3 detours off random non-terminal critical rooms
  const sideCount = 1 + ((Math.random() * 3) | 0);
  const critRooms = rooms.slice(1, rooms.length - 1);
  let placed = 0;
  for (const base of shuffleArr(critRooms)) {
    if (placed >= sideCount) break;
    const free = [[base.mc, base.mr - 1], [base.mc - 1, base.mr], [base.mc + 1, base.mr], [base.mc, base.mr + 1]]
      .filter(([c, r]) => inBounds(c, r) && !occupied.has(key(c, r)));
    if (!free.length) continue;
    const [c, r] = free[(Math.random() * free.length) | 0];
    const type = SIDE_TYPES[(Math.random() * SIDE_TYPES.length) | 0];
    const room = {
      id: rooms.length, type, intent: INTENT[type] != null ? INTENT[type] : null,
      mc: c, mr: r, cleared: false, side: true, seed: (Math.random() * 0x7fffffff) | 0,
    };
    occupied.set(key(c, r), room);
    rooms.push(room);
    edges.push([base.id, room.id]);
    placed++;
  }

  // realize: uniform rooms centred in their macro cell (so corridors align)
  let minC = cols, minR = rows, maxC = 0, maxR = 0;
  for (const rm of rooms) {
    minC = Math.min(minC, rm.mc); maxC = Math.max(maxC, rm.mc);
    minR = Math.min(minR, rm.mr); maxR = Math.max(maxR, rm.mr);
  }
  const usedCols = maxC - minC + 1, usedRows = maxR - minR + 1;
  const W = usedCols * MACRO_W, H = usedRows * MACRO_H;
  const tiles = new Array(W * H).fill(WALL);
  for (const rm of rooms) {
    const gx = (rm.mc - minC) * MACRO_W, gy = (rm.mr - minR) * MACRO_H;
    const { w, h } = roomDims(rm);
    // centre each room in its macro cell (keeps corridor centrelines aligned)
    const ox = Math.floor((MACRO_W - w) / 2), oy = Math.floor((MACRO_H - h) / 2);
    rm.rect = { x: gx + ox, y: gy + oy, w, h };
    carveRect(tiles, W, rm.rect.x, rm.rect.y, rm.rect.w, rm.rect.h, FLOOR);
  }

  // corridors: 2-wide, dead straight (rooms are aligned). Where a corridor
  // meets a room the seam spans the full 2-tile mouth: one tile is a door,
  // the tile beside it a permanent thin seam wall. Both rooms get their own
  // door+wall, so a locked room is sealed at its own edges.
  const doors = []; // door half: { cells:[{x,y}], dir, rooms:[ownerId] }
  const walls = []; // wall half: { x, y, dir } — a thin seam on a floor|floor edge
  for (const [ai, bi] of edges) carveCorridor(tiles, W, rooms[ai], rooms[bi], doors, walls);

  // per-room door lists (for the minimap / HUD / gating)
  for (const rm of rooms) { rm.doors = []; rm.doorCells = []; }
  for (const dr of doors) {
    for (const rid of dr.rooms) {
      const rm = rooms.find((r) => r.id === rid);
      if (!rm) continue;
      rm.doors.push(dr);
      for (const c of dr.cells) rm.doorCells.push(c);
    }
  }

  const entryRoom = rooms[0];
  const entry = {
    x: (entryRoom.rect.x + entryRoom.rect.w / 2) * TILE,
    y: (entryRoom.rect.y + entryRoom.rect.h - 1.5) * TILE,
  };
  const stairsRoom = rooms.find((r) => r.type === "stairs" || r.type === "boss") || rooms[rooms.length - 1];
  // stairs sit at the back-centre of the boss chamber — the player walks onto
  // them to descend once the boss falls (game.js gates on this).
  const stairs = {
    x: stairsRoom.rect.x + Math.floor(stairsRoom.rect.w / 2),
    y: stairsRoom.rect.y,
  };

  return {
    tiles, w: W, h: H, rooms, edges, doors, walls,
    entry, stairsRoomId: stairsRoom.id, stairs,
    seed: (Math.random() * 0x7fffffff) | 0,
  };
};

// Carve a straight 2-wide corridor between two aligned rooms, running flush
// into BOTH rooms' borders. Both corridor lanes stay open the whole way (no
// funnel); at each room's border the 2-tile mouth is one door tile + one
// permanent seam wall. Both sit on a floor|floor edge (not a WALL tile), so
// there's no tile-wide void gap. Records the door (owned by its room) and the
// seam wall (a thin edge, always solid) per room.
function carveCorridor(tiles, W, a, b, doors, walls) {
  const A = a.rect, B = b.rect;
  if (a.mr === b.mr) {
    // horizontal neighbours -> 2-wide corridor on the middle rows (y0, y0+1)
    const y0 = A.y + Math.floor((A.h - 2) / 2);
    const left = a.mc < b.mc ? a : b, right = a.mc < b.mc ? b : a;
    const lBorder = left.rect.x + left.rect.w;   // left room's east border cell
    const rBorder = right.rect.x - 1;            // right room's west border cell
    for (let x = lBorder; x <= rBorder; x++) { tiles[y0 * W + x] = FLOOR; tiles[(y0 + 1) * W + x] = FLOOR; }
    // door on the first lane, permanent seam wall on the second — both faces
    // toward that room's interior, so the mouth reads as one door beside a wall.
    doors.push({ cells: [{ x: lBorder, y: y0 }], dir: "W", rooms: [left.id] });
    doors.push({ cells: [{ x: rBorder, y: y0 }], dir: "E", rooms: [right.id] });
    walls.push({ x: lBorder, y: y0 + 1, dir: "W" });
    walls.push({ x: rBorder, y: y0 + 1, dir: "E" });
  } else {
    // vertical neighbours -> 2-wide corridor on the middle columns (x0, x0+1)
    const x0 = A.x + Math.floor((A.w - 2) / 2);
    const top = a.mr < b.mr ? a : b, bottom = a.mr < b.mr ? b : a;
    const tBorder = top.rect.y + top.rect.h;     // top room's south border cell
    const bBorder = bottom.rect.y - 1;           // bottom room's north border cell
    for (let y = tBorder; y <= bBorder; y++) { tiles[y * W + x0] = FLOOR; tiles[y * W + x0 + 1] = FLOOR; }
    doors.push({ cells: [{ x: x0, y: tBorder }], dir: "N", rooms: [top.id] });
    doors.push({ cells: [{ x: x0, y: bBorder }], dir: "S", rooms: [bottom.id] });
    walls.push({ x: x0 + 1, y: tBorder, dir: "N" });
    walls.push({ x: x0 + 1, y: bBorder, dir: "S" });
  }
}

function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
