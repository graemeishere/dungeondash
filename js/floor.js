"use strict";
// Floor generator: a whole floor is one large tile grid of small rooms, tiled
// edge-to-edge on a macro-grid so adjacent rooms SHARE a single wall (Binding
// of Isaac layout). Each connection punches one door in that shared wall — no
// corridors, no double walls, no paired doors. Produces a spec that
// DD.room.setFloor() installs as the live world; collision/movement/decor all
// operate on the resulting tiles grid unchanged.
//
// The tiles grid syncs to co-op guests as a string, so the LAYOUT uses
// Math.random freely; only the DECOR is seeded (via floor.seed).
(function (DD) {
  const FLOOR = 0, WALL = 1, DOOR = 2;

  // Macro cell = one room's footprint including the walls it shares with its
  // neighbours. Every room fills its cell, so rooms are uniform and tile the
  // grid with single shared walls between them.
  const MW = 9, MH = 7;

  // type -> composition intent for the decor planner (rooms are uniform now, so
  // variety comes from per-room decor + intent, not footprint).
  const INTENT = {
    entry: "storage", combat: null, elite: "storage", trap: "ruin",
    treasure: "hoardRoom", shrine: "shrine", storage: "storage",
    dining: "messHall", stairs: "storage", boss: "ruin",
  };
  // only these room types lock (get real doors); the rest keep open archways
  const GATED = { combat: 1, elite: 1, boss: 1 };
  // side rooms hang off the critical path as optional detours
  const SIDE_TYPES = ["treasure", "shrine", "storage", "dining"];

  const key = (c, r) => c + "," + r;

  // Carve an axis-aligned rect of `val` into the grid.
  function carveRect(tiles, W, x0, y0, w, h, val) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) tiles[y * W + x] = val;
    }
  }

  // Build the room graph on a macro-grid, then realize it as a tiles grid.
  // opts: { plan: [roomType...], boss: bool }
  DD.generateFloor = function (opts = {}) {
    const plan = opts.plan || ["combat", "combat", "combat", "combat", "stairs"];
    // critical path = entry + the plan rooms; final plan room is stairs/boss
    const critTypes = ["entry", ...plan];
    critTypes[critTypes.length - 1] = opts.boss ? "boss" : "stairs";

    const cols = 5, rows = 5;
    const occupied = new Map(); // "c,r" -> room
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
        // prefer stepping up/away, else any free orthogonal neighbour
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

    // realize: uniform rooms tiling the macro grid, sharing single walls. A room
    // in macro cell (mc,mr) fills grid cols [mc*MW+1 .. mc*MW+MW-1]; the column
    // mc*MW is the wall it shares with its left neighbour.
    let minC = cols, minR = rows, maxC = 0, maxR = 0;
    for (const rm of rooms) {
      minC = Math.min(minC, rm.mc); maxC = Math.max(maxC, rm.mc);
      minR = Math.min(minR, rm.mr); maxR = Math.max(maxR, rm.mr);
    }
    const usedCols = maxC - minC + 1, usedRows = maxR - minR + 1;
    const W = usedCols * MW + 1, H = usedRows * MH + 1;
    const tiles = new Array(W * H).fill(WALL);
    for (const rm of rooms) {
      const gx = (rm.mc - minC) * MW, gy = (rm.mr - minR) * MH;
      rm.rect = { x: gx + 1, y: gy + 1, w: MW - 1, h: MH - 1 };
      carveRect(tiles, W, rm.rect.x, rm.rect.y, rm.rect.w, rm.rect.h, FLOOR);
    }

    // doors: one single-tile door in each pair's shared wall. A door is owned by
    // whichever of the two rooms is gated (combat/elite/boss) — it turns solid
    // while any owner is locked. A door between two non-gated rooms is an
    // always-open archway (its cell stays FLOOR).
    const doors = [];
    for (const rm of rooms) { rm.doors = []; rm.doorCells = []; }
    for (const [ai, bi] of edges) {
      const a = rooms[ai], b = rooms[bi];
      let cell, side, sideA, sideB;
      if (a.mc !== b.mc) {
        // horizontal neighbours -> shared vertical wall
        const left = a.mc < b.mc ? a : b, right = a.mc < b.mc ? b : a;
        cell = { x: right.rect.x - 1, y: a.rect.y + Math.floor(a.rect.h / 2) };
        side = "E"; // vertical wall -> E/W-oriented gate
        sideA = a === left ? "E" : "W"; sideB = b === left ? "E" : "W";
      } else {
        // vertical neighbours -> shared horizontal wall
        const bottom = a.mr < b.mr ? b : a;
        cell = { x: a.rect.x + Math.floor(a.rect.w / 2), y: bottom.rect.y - 1 };
        side = "N"; // horizontal wall -> N/S-oriented gate
        sideA = a.mr < b.mr ? "S" : "N"; sideB = b.mr < a.mr ? "S" : "N";
      }
      const owners = [];
      if (GATED[a.type]) owners.push(a.id);
      if (GATED[b.type]) owners.push(b.id);
      doors.push({ cell, side, owners });
      tiles[cell.y * W + cell.x] = owners.length ? DOOR : FLOOR;
      if (GATED[a.type]) { a.doors.push({ side: sideA, cells: [cell] }); a.doorCells.push(cell); }
      if (GATED[b.type]) { b.doors.push({ side: sideB, cells: [cell] }); b.doorCells.push(cell); }
    }

    // entry spawn: centre-bottom of the entry room's interior
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

  function shuffleArr(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
})(window.DD);
