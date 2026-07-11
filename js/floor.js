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
  // cells. Cell size leaves room for the largest template plus a corridor gap.
  const MACRO_W = 12, MACRO_H = 10;

  // Room templates by type: interior size in tiles (walls are the uncarved
  // border around each). Combat/elite/boss rooms lock their doors, so they need
  // room to fight in; side rooms stay small for the tight KayKit feel.
  const TEMPLATES = {
    entry:    { w: 6, h: 4, intent: "storage" },
    combat:   { w: 7, h: 5, intent: null },   // intent null -> theme default roll
    elite:    { w: 8, h: 6, intent: "storage" },
    trap:     { w: 8, h: 5, intent: "ruin" },
    treasure: { w: 5, h: 4, intent: "hoardRoom" },
    shrine:   { w: 5, h: 4, intent: "shrine" },
    storage:  { w: 6, h: 4, intent: "storage" },
    dining:   { w: 7, h: 5, intent: "messHall" },
    stairs:   { w: 6, h: 4, intent: "storage" },
    boss:     { w: 9, h: 7, intent: "ruin" },
  };
  // only these room types lock (get real doors); others open with archways
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

  // Connect two adjacent rooms with a clean 2-wide corridor: each room exits
  // perpendicular from the centre of its facing wall, and the two legs meet with
  // one bend in the mid-gap between the rooms — so a corridor never clips a room
  // corner (which used to spawn stray side-wall doorways). Returns the 2-cell
  // door opening on each room's facing side.
  function connect(tiles, W, ra, rb) {
    const A = ra.rect, B = rb.rect;
    const doorsA = [], doorsB = [];
    if (rb.mr !== ra.mr) {
      // vertical neighbour: exits on the top/bottom walls
      const down = rb.mr > ra.mr;
      const aCol = A.x + Math.floor((A.w - 2) / 2);
      const bCol = B.x + Math.floor((B.w - 2) / 2);
      const aRing = down ? A.y + A.h : A.y - 1;
      const bRing = down ? B.y - 1 : B.y + B.h;
      const mid = Math.round((aRing + bRing) / 2);
      carveRect(tiles, W, aCol, Math.min(aRing, mid), 2, Math.abs(mid - aRing) + 1, FLOOR);
      carveRect(tiles, W, bCol, Math.min(bRing, mid), 2, Math.abs(mid - bRing) + 1, FLOOR);
      const cx0 = Math.min(aCol, bCol), cx1 = Math.max(aCol, bCol) + 1;
      carveRect(tiles, W, cx0, mid, cx1 - cx0 + 1, 2, FLOOR);
      for (let i = 0; i < 2; i++) {
        doorsA.push({ x: aCol + i, y: aRing, side: down ? "S" : "N" });
        doorsB.push({ x: bCol + i, y: bRing, side: down ? "N" : "S" });
      }
    } else {
      // horizontal neighbour: exits on the left/right walls
      const right = rb.mc > ra.mc;
      const aRow = A.y + Math.floor((A.h - 2) / 2);
      const bRow = B.y + Math.floor((B.h - 2) / 2);
      const aRing = right ? A.x + A.w : A.x - 1;
      const bRing = right ? B.x - 1 : B.x + B.w;
      const mid = Math.round((aRing + bRing) / 2);
      carveRect(tiles, W, Math.min(aRing, mid), aRow, Math.abs(mid - aRing) + 1, 2, FLOOR);
      carveRect(tiles, W, Math.min(bRing, mid), bRow, Math.abs(mid - bRing) + 1, 2, FLOOR);
      const ry0 = Math.min(aRow, bRow), ry1 = Math.max(aRow, bRow) + 1;
      carveRect(tiles, W, mid, ry0, 2, ry1 - ry0 + 1, FLOOR);
      for (let i = 0; i < 2; i++) {
        doorsA.push({ x: aRing, y: aRow + i, side: right ? "E" : "W" });
        doorsB.push({ x: bRing, y: bRow + i, side: right ? "W" : "E" });
      }
    }
    return { doorsA, doorsB };
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

    // corridors + door openings: each edge carves a clean corridor and yields
    // the 2-cell opening on each room's facing side.
    for (const rm of rooms) rm._openings = [];
    for (const [a, b] of edges) {
      const ra = rooms[a], rb = rooms[b];
      const { doorsA, doorsB } = connect(tiles, W, ra, rb);
      ra._openings.push({ side: doorsA[0].side, cells: doorsA });
      rb._openings.push({ side: doorsB[0].side, cells: doorsB });
    }

    // Only gated rooms (combat/elite/boss) get real doors: stamp DOOR tiles and
    // record the openings so they can lock. Other rooms keep open archways
    // (their opening cells stay FLOOR), which reads as a corridor mouth.
    for (const rm of rooms) {
      if (GATED[rm.type]) {
        rm.doors = rm._openings;
        rm.doorCells = [];
        for (const op of rm._openings) {
          for (const c of op.cells) {
            if (c.x > 0 && c.y > 0 && c.x < W - 1 && c.y < H - 1) {
              tiles[c.y * W + c.x] = DOOR;
              rm.doorCells.push(c);
            }
          }
        }
      } else {
        rm.doors = [];
        rm.doorCells = [];
      }
      delete rm._openings;
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
