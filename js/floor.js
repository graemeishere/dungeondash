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

import { TILE } from "./util.js?v=f2e4a613";

// OBSTACLE matches room.js's tile encoding (FLOOR=0, WALL=1, DOOR=2,
// OBSTACLE=3) — a solid tile that decor3d/room.js render as a prop
// (pillar/crate/rubble) instead of a plain wall block.
const FLOOR = 0, WALL = 1, OBSTACLE = 3;

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

  // side rooms: hang 1-3 detours off random non-terminal critical rooms.
  // opts.sideRooms === false opts out entirely — the raid and finale
  // set-pieces want a tight, undiluted gauntlet straight to the boss rather
  // than the exploratory shrine/storage/dining/treasure spurs a normal floor
  // offers, so they pass this to keep their pacing distinct from an ordinary
  // dungeon floor.
  const sideCount = opts.sideRooms === false ? 0 : 1 + ((Math.random() * 3) | 0);
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

  // Interior dressing: corner notches + jittered obstacle clusters (ported
  // from the classic single-room generator's approach, scaled down to these
  // much smaller room footprints) plus trap-room spike bands. Both are BFS-
  // validated per room against that room's own door/entry/stairs anchors
  // before being committed, so a placement that would ever wall off a
  // required path is dropped rather than risking an unsolvable floor — the
  // classic generator never needed this because its one room was always a
  // simple top-door/bottom-entry box; a floor room's doors can be on any
  // side, so this check is the floor-mode-specific safety the port needs.
  const spikes = [];
  for (const rm of rooms) {
    const keep = doorAnchors(rm);
    if (rm === entryRoom) keep.push([Math.round(entry.x / TILE), Math.round(entry.y / TILE)]);
    if (rm.id === stairsRoom.id) keep.push([stairs.x, stairs.y]);
    carveRoomFeatures(tiles, W, rm, keep);
    if (rm.type === "trap") spikes.push(...trapSpikes(tiles, W, rm, keep));
  }

  return {
    tiles, w: W, h: H, rooms, edges, doors, walls,
    entry, stairsRoomId: stairsRoom.id, stairs, spikes,
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

// The interior cell (inside the room's own rect) bordering each of its door
// cells — these plus any extra required point (entry/stairs) must always
// stay mutually reachable; carveRoomFeatures/trapSpikes never touch them.
function doorAnchors(rm) {
  const R = rm.rect;
  const inRect = (x, y) => x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;
  const pts = [];
  for (const c of rm.doorCells) {
    const cand = [[c.x - 1, c.y], [c.x + 1, c.y], [c.x, c.y - 1], [c.x, c.y + 1]]
      .find(([x, y]) => inRect(x, y));
    if (cand) pts.push(cand);
  }
  if (!pts.length) pts.push([R.x + (R.w >> 1), R.y + (R.h >> 1)]);
  return pts;
}

// Corner-notch biting + jittered obstacle clusters, ported from the classic
// single-room generator's approach (js/room.js's old `generate()`) and scaled
// to these much smaller room footprints. `keep` cells (door/entry/stairs
// anchors) are never touched, and every candidate placement is BFS-checked
// against the room's own floor space before being committed — see the
// generateFloor comment above for why that check exists here and didn't in
// the classic path.
function carveRoomFeatures(tiles, W, rm, keep) {
  const R = rm.rect;
  const inRect = (x, y) => x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;
  const at = (x, y) => tiles[y * W + x];
  const keepSet = new Set(keep.map(([x, y]) => x + "," + y));

  // Can every keep-anchor still reach every other, treating `blocked` cells
  // (plus existing non-FLOOR cells) as impassable within this room's rect?
  function reachableAll(blocked) {
    const [sx, sy] = keep[0];
    const seen = new Set([sx + "," + sy]);
    const stack = [[sx, sy]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (!inRect(nx, ny)) continue;
        const k = nx + "," + ny;
        if (seen.has(k) || blocked.has(k)) continue;
        if (at(nx, ny) !== FLOOR && !keepSet.has(k)) continue;
        seen.add(k);
        stack.push([nx, ny]);
      }
    }
    return keep.every(([x, y]) => seen.has(x + "," + y));
  }

  const w = R.w, h = R.h;
  const roomy = w >= 6 && h >= 5; // only the boss chamber has room to spare

  // corner notches: bite a small walled rectangle out of a corner, skipped
  // wherever it would eat a keep-anchor or sever the room
  if (roomy) {
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (Math.random() > 0.35) continue;
      const nw = Math.max(1, Math.min(3, Math.floor(w * 0.22)));
      const nh = Math.max(1, Math.min(3, Math.floor(h * 0.22)));
      const x0 = cx ? R.x + w - nw : R.x, y0 = cy ? R.y + h - nh : R.y;
      const blocked = new Set();
      let hitsKeep = false;
      for (let y = y0; y < y0 + nh; y++) {
        for (let x = x0; x < x0 + nw; x++) {
          const k = x + "," + y;
          if (keepSet.has(k)) { hitsKeep = true; break; }
          blocked.add(k);
        }
        if (hitsKeep) break;
      }
      if (hitsKeep || !reachableAll(blocked)) continue;
      for (const k of blocked) {
        const [x, y] = k.split(",").map(Number);
        tiles[y * W + x] = WALL;
      }
    }
  }

  // obstacle clusters near the room quarters, jittered; shapes vary 1x1..2x2
  // in the boss chamber, single tiles only in the small standard rooms
  const qxs = [R.x + Math.round(w * 0.27), R.x + Math.round(w * 0.66)];
  const qys = [R.y + Math.round(h * 0.28), R.y + Math.round(h * 0.62)];
  const SHAPES = roomy ? [[1, 1], [2, 1], [1, 2], [2, 2]] : [[1, 1]];
  for (const qx of qxs) {
    for (const qy of qys) {
      if (Math.random() < 0.25) continue; // not every quarter gets one
      const [sw, sh] = SHAPES[(Math.random() * SHAPES.length) | 0];
      const jx = Math.round((Math.random() - 0.5) * 2), jy = Math.round((Math.random() - 0.5) * 2);
      const loX = R.x + 1, hiX = R.x + w - 2 - sw;
      const loY = R.y + 1, hiY = R.y + h - 2 - sh;
      if (hiX < loX || hiY < loY) continue; // room too small for this shape
      const px = Math.max(loX, Math.min(hiX, qx + jx));
      const py = Math.max(loY, Math.min(hiY, qy + jy));
      const blocked = new Set();
      let ok = true;
      for (let dy = 0; dy < sh && ok; dy++) {
        for (let dx = 0; dx < sw; dx++) {
          const x = px + dx, y = py + dy, k = x + "," + y;
          if (keepSet.has(k) || at(x, y) !== FLOOR) { ok = false; break; }
          blocked.add(k);
        }
      }
      if (!ok || !blocked.size || !reachableAll(blocked)) continue;
      for (const k of blocked) {
        const [x, y] = k.split(",").map(Number);
        tiles[y * W + x] = OBSTACLE;
      }
    }
  }
}

// Trap-room spike bands, ported from the classic gauntlet's spike logic and
// scaled to a floor room's fixed small height: one band per ~3 tiles of
// height (always 1 at today's ROOM_H), each with a couple of safe gap columns
// and its own timing offset. Skips keep-anchors and any cell an obstacle
// already claimed. Returns {tx,ty,offset} in absolute floor tile coords —
// room.setFloor() installs these directly into room.spikes.
function trapSpikes(tiles, W, rm, keep) {
  const R = rm.rect;
  const at = (x, y) => tiles[y * W + x];
  const keepSet = new Set(keep.map(([x, y]) => x + "," + y));
  const out = [];
  const bandCount = Math.max(1, Math.floor(R.h / 3));
  for (let band = 0; band < bandCount; band++) {
    const ty = R.y + Math.round(R.h * ((band + 1) / (bandCount + 1)));
    const gapCount = Math.max(2, Math.round(R.w / 3));
    const gaps = new Set();
    let tries = 0;
    while (gaps.size < Math.min(gapCount, Math.max(1, R.w - 2)) && tries < 50) {
      gaps.add(R.x + 1 + ((Math.random() * Math.max(1, R.w - 2)) | 0));
      tries++;
    }
    for (let tx = R.x; tx < R.x + R.w; tx++) {
      const k = tx + "," + ty;
      if (gaps.has(tx) || keepSet.has(k) || at(tx, ty) !== FLOOR) continue;
      out.push({ tx, ty, offset: band * 0.7 });
    }
  }
  return out;
}

function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
