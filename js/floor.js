"use strict";
// Floor generator: instead of one screen-sized room, a whole floor is one
// large tile grid of small purpose-built rooms joined by corridors, explored
// continuously (KayKit promo layout). Produces a spec that DD.room.setFloor()
// installs as the live world; collision/movement/decor all operate on the
// resulting tiles grid unchanged.
//
// The tiles grid itself syncs to co-op guests as a string, so the LAYOUT uses
// Math.random freely; only the DECOR is seeded (via floor.seed), matching how
// single rooms already work.
(function (DD) {
  const FLOOR = 0, WALL = 1, DOOR = 2, OBSTACLE = 3;

  // Macro-grid: each room lives in one macro cell; corridors bridge adjacent
  // cells. Cell size leaves room for the largest template plus wall margins.
  const MACRO_W = 8, MACRO_H = 7;

  // Room templates by type: interior size in tiles (walls are the uncarved
  // border around each). Small, tight rooms — tightened to ~2/3 again to hug the
  // KayKit sample scale. intent maps to the decor planner's composition intents.
  const TEMPLATES = {
    entry:    { w: 5, h: 4, intent: "storage" },
    combat:   { w: 5, h: 4, intent: null },   // intent null -> theme default roll
    elite:    { w: 6, h: 5, intent: "storage" },
    trap:     { w: 7, h: 4, intent: "ruin" },
    treasure: { w: 4, h: 3, intent: "hoardRoom" },
    shrine:   { w: 4, h: 4, intent: "shrine" },
    storage:  { w: 5, h: 4, intent: "storage" },
    dining:   { w: 6, h: 5, intent: "messHall" },
    stairs:   { w: 5, h: 4, intent: "storage" },
    boss:     { w: 7, h: 6, intent: "ruin" },
  };
  // side rooms hang off the critical path as optional detours
  const SIDE_TYPES = ["treasure", "shrine", "storage", "dining"];

  const key = (c, r) => c + "," + r;

  // Carve an axis-aligned rect of `val` into the grid.
  function carveRect(tiles, W, x0, y0, w, h, val) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) tiles[y * W + x] = val;
    }
  }

  // Carve a 2-wide L corridor between two points (ax,ay)->(bx,by), horizontal
  // leg first then vertical (or vice-versa, chosen by `hFirst`).
  function carveCorridor(tiles, W, H, ax, ay, bx, by, hFirst) {
    const wide = (x, y) => {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1) {
            const i = ny * W + nx;
            if (tiles[i] === WALL) tiles[i] = FLOOR;
          }
        }
      }
    };
    if (hFirst) {
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) wide(x, ay);
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) wide(bx, y);
    } else {
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) wide(ax, y);
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) wide(x, by);
    }
  }

  // Build the room graph on a macro-grid, then realize it as a tiles grid.
  // opts: { plan: [roomType...], boss: bool, seed?: number }
  DD.generateFloor = function (opts = {}) {
    const plan = opts.plan || ["combat", "combat", "combat", "combat", "stairs"];
    // critical path = entry + the plan rooms; final plan room is stairs/boss
    const critTypes = ["entry", ...plan];
    // ensure the last room is the exit (stairs, or boss on boss floors)
    critTypes[critTypes.length - 1] = opts.boss ? "boss" : "stairs";

    // macro grid sized to hold the critical path as a random walk + side rooms
    const cols = 5, rows = 5;
    const occupied = new Map(); // "c,r" -> room
    const rooms = [];
    const edges = [];

    // random walk for the critical path, starting bottom-center
    let cc = Math.floor(cols / 2), cr = rows - 1;
    const inBounds = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
    let prev = null;
    for (let i = 0; i < critTypes.length; i++) {
      const type = critTypes[i];
      const tpl = TEMPLATES[type] || TEMPLATES.combat;
      const room = {
        id: rooms.length, type, intent: tpl.intent, mc: cc, mr: cr,
        tw: tpl.w, th: tpl.h, doorCells: [], cleared: false,
        seed: (Math.random() * 0x7fffffff) | 0,
      };
      occupied.set(key(cc, cr), room);
      rooms.push(room);
      if (prev) edges.push([prev.id, room.id]);
      prev = room;
      if (i < critTypes.length - 1) {
        // step to a random free orthogonal neighbour (prefer moving up/away)
        const opts2 = [[cc, cr - 1], [cc - 1, cr], [cc + 1, cr], [cc, cr - 1]]
          .filter(([c, r]) => inBounds(c, r) && !occupied.has(key(c, r)));
        if (!opts2.length) {
          // fallback: any free neighbour
          const any = [[cc, cr - 1], [cc - 1, cr], [cc + 1, cr], [cc, cr + 1]]
            .filter(([c, r]) => inBounds(c, r) && !occupied.has(key(c, r)));
          if (!any.length) break;
          [cc, cr] = any[(Math.random() * any.length) | 0];
        } else {
          [cc, cr] = opts2[(Math.random() * opts2.length) | 0];
        }
      }
    }

    // side rooms: hang 1-3 detours off random non-terminal critical rooms
    const sideCount = 1 + ((Math.random() * 3) | 0);
    const critRooms = rooms.slice(1, rooms.length - 1);
    let sidesPlaced = 0;
    for (const base of shuffleArr(critRooms)) {
      if (sidesPlaced >= sideCount) break;
      const free = [[base.mc, base.mr - 1], [base.mc - 1, base.mr], [base.mc + 1, base.mr], [base.mc, base.mr + 1]]
        .filter(([c, r]) => inBounds(c, r) && !occupied.has(key(c, r)));
      if (!free.length) continue;
      const [c, r] = free[(Math.random() * free.length) | 0];
      const type = SIDE_TYPES[(Math.random() * SIDE_TYPES.length) | 0];
      const tpl = TEMPLATES[type];
      const room = {
        id: rooms.length, type, intent: tpl.intent, mc: c, mr: r,
        tw: tpl.w, th: tpl.h, doorCells: [], cleared: false, side: true,
        seed: (Math.random() * 0x7fffffff) | 0,
      };
      occupied.set(key(c, r), room);
      rooms.push(room);
      edges.push([base.id, room.id]);
      sidesPlaced++;
    }

    // realize: tiles grid sized to the used macro-cell bounding box + margins
    let minC = cols, minR = rows, maxC = 0, maxR = 0;
    for (const rm of rooms) {
      minC = Math.min(minC, rm.mc); maxC = Math.max(maxC, rm.mc);
      minR = Math.min(minR, rm.mr); maxR = Math.max(maxR, rm.mr);
    }
    const usedCols = maxC - minC + 1, usedRows = maxR - minR + 1;
    const W = usedCols * MACRO_W, H = usedRows * MACRO_H;
    const tiles = new Array(W * H).fill(WALL);

    // place each room's rect centered in its (shifted) macro cell
    for (const rm of rooms) {
      const ox = (rm.mc - minC) * MACRO_W, oy = (rm.mr - minR) * MACRO_H;
      rm.rect = {
        x: ox + Math.floor((MACRO_W - rm.tw) / 2),
        y: oy + Math.floor((MACRO_H - rm.th) / 2),
        w: rm.tw, h: rm.th,
      };
      rm.cx = rm.rect.x + rm.rect.w / 2; // room center (tiles)
      rm.cy = rm.rect.y + rm.rect.h / 2;
      carveRect(tiles, W, rm.rect.x, rm.rect.y, rm.rect.w, rm.rect.h, FLOOR);
    }

    // corridors between connected rooms (L from center to center; the wide
    // carve punches through the shared walls, forming natural mouths)
    for (const [a, b] of edges) {
      const ra = rooms[a], rb = rooms[b];
      carveCorridor(tiles, W, H,
        Math.round(ra.cx), Math.round(ra.cy),
        Math.round(rb.cx), Math.round(rb.cy),
        Math.random() < 0.5);
    }

    // entry spawn: center-bottom of the entry room's interior
    const entryRoom = rooms[0];
    const entry = {
      x: (entryRoom.rect.x + entryRoom.rect.w / 2) * DD.TILE,
      y: (entryRoom.rect.y + entryRoom.rect.h - 1.5) * DD.TILE,
    };
    const stairsRoom = rooms.find((r) => r.type === "stairs" || r.type === "boss") || rooms[rooms.length - 1];

    return {
      tiles, w: W, h: H, rooms, edges,
      entry, stairsRoomId: stairsRoom.id,
      seed: (Math.random() * 0x7fffffff) | 0,
    };
  };

  function shuffleArr(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
})(window.DD);
