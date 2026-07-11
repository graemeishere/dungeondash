"use strict";
// Floor generator: a whole floor is one large tile grid of small rooms joined
// by corridors, explored continuously. Produces a spec that DD.room.setFloor()
// installs as the live world; collision/movement/decor all operate on the
// resulting tiles grid unchanged.
//
// Door model is being rebuilt incrementally. Step 1 (current): each corridor
// has an OPEN doorway at one room and a solid WALL at the other end — you walk
// out of a room, into a corridor, and reach a wall. The door that goes IN that
// wall comes next.
//
// The tiles grid syncs to co-op guests as a string, so the LAYOUT uses
// Math.random freely; only the DECOR is seeded (via floor.seed).
(function (DD) {
  const FLOOR = 0, WALL = 1;

  // Macro cell holds one small room plus the corridor gap around it. Rooms are
  // uniform + centred so neighbours line up and corridors run dead straight.
  const MACRO_W = 10, MACRO_H = 9;
  const ROOM_W = 5, ROOM_H = 4;

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
  DD.generateFloor = function (opts = {}) {
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
    const ox = Math.floor((MACRO_W - ROOM_W) / 2), oy = Math.floor((MACRO_H - ROOM_H) / 2);
    for (const rm of rooms) {
      const gx = (rm.mc - minC) * MACRO_W, gy = (rm.mr - minR) * MACRO_H;
      rm.rect = { x: gx + ox, y: gy + oy, w: ROOM_W, h: ROOM_H };
      carveRect(tiles, W, rm.rect.x, rm.rect.y, rm.rect.w, rm.rect.h, FLOOR);
    }

    // corridors: 2-wide, dead straight (rooms are aligned). The corridor floor
    // runs FLUSH up to the destination room; a single door sits on the seam
    // (the room's own border). The door is closed while EITHER room it connects
    // is locked, so a locked room is sealed on every corridor that touches it.
    const doors = []; // { cells:[{x,y}], dir, rooms:[aId,bId] }
    for (const [ai, bi] of edges) {
      const open = rooms[ai], walled = rooms[bi]; // corridor opens from `open`, door at `walled`'s border
      carveCorridor(tiles, W, open, walled, doors);
    }

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
      x: (entryRoom.rect.x + entryRoom.rect.w / 2) * DD.TILE,
      y: (entryRoom.rect.y + entryRoom.rect.h - 1.5) * DD.TILE,
    };
    const stairsRoom = rooms.find((r) => r.type === "stairs" || r.type === "boss") || rooms[rooms.length - 1];

    return {
      tiles, w: W, h: H, rooms, edges, doors,
      entry, stairsRoomId: stairsRoom.id,
      seed: (Math.random() * 0x7fffffff) | 0,
    };
  };

  // Carve a straight 2-wide corridor between two aligned rooms. The `open` room
  // gets an opening in its facing wall (a doorway); the corridor floor runs
  // FLUSH up to the `walled` room's border, and a door sits on that border seam.
  // Records one door (its 2 seam cells + facing dir + the two rooms it joins).
  function carveCorridor(tiles, W, open, walled, doors) {
    const A = open.rect, B = walled.rect;
    const cells = [];
    let dir;
    if (open.mr === walled.mr) {
      // horizontal neighbours -> a 1-wide corridor along the centre row, so the
      // seam holds a single door
      const y0 = A.y + Math.floor((A.h - 1) / 2);
      const openLeft = open.mc < walled.mc;
      const openWall = openLeft ? A.x + A.w : A.x - 1;     // open room's doorway column
      const border = openLeft ? B.x - 1 : B.x + B.w;       // walled room's border column
      const lo = Math.min(openWall, border), hi = Math.max(openWall, border);
      // carve the whole span INCLUDING the border cell -> flush to the room
      for (let x = lo; x <= hi; x++) tiles[y0 * W + x] = FLOOR;
      dir = openLeft ? "E" : "W"; // door faces the room interior
      cells.push({ x: border, y: y0 });
    } else {
      // vertical neighbours -> a 1-wide corridor along the centre column
      const x0 = A.x + Math.floor((A.w - 1) / 2);
      const openTop = open.mr < walled.mr;
      const openWall = openTop ? A.y + A.h : A.y - 1;
      const border = openTop ? B.y - 1 : B.y + B.h;
      const lo = Math.min(openWall, border), hi = Math.max(openWall, border);
      for (let y = lo; y <= hi; y++) tiles[y * W + x0] = FLOOR;
      dir = openTop ? "S" : "N";
      cells.push({ x: x0, y: border });
    }
    doors.push({ cells, dir, rooms: [open.id, walled.id] });
  }

  function shuffleArr(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
})(window.DD);
