"use strict";
// Deterministic room-decoration planner, composition-grammar edition.
//
// Modeled on the KayKit Dungeon Remastered sample scenes (see Samples/*.png):
// ONE uniform floor tile with deliberate accents (organic dirt patches, a
// plank aisle to the door), rhythmic walls (corner caps, evenly spaced
// support beams, one featured element per wall run, banner pairs flanking the
// door, symmetric torches) and authored prop VIGNETTES instead of scatter.
//
// Still a pure function of desc: one mulberry32 stream consumed in a fixed
// pass order, so co-op guests re-derive identical rooms from the synced room
// data. The seed picks AMONG authored options; it never rolls per-cell noise.
//
// All output in GRID coordinates. Placement schema (consumed by render3d):
//   { piece, gx, gy, ox, oz, rot, mount, up, fit }
//   ox/oz: sub-cell offsets in cell units; up: fraction of wallH (4u);
//   mount: hug the N/S/E/W wall face of the cell; fit: auto-scale to cell.

const FLOOR = 0, WALL = 1, DOOR = 2, OBSTACLE = 3;

export const PIECE_DIR = "KayKit Dungeon Remastered/Assets/gltf/";

// mulberry32 — identical to DD.makeRng but importable without window.DD.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, table) {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = rng() * total;
  for (const [p, w] of table) {
    r -= w;
    if (r <= 0) return p;
  }
  return table[table.length - 1][0];
}

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Theme palettes. base = the uniform floor; patch = the organic accent
// family; features = wall-run centerpieces; vignettes = weighted picks from
// the VIGNETTES library for corner/wallMid anchors; obstacle2x = vignettes
// stamped onto solid obstacle clusters by footprint; obstacleSingles = 1x1
// cluster props.
const PALETTES = {
  catacombs: {
    base: "floor_tile_large",
    patch: {
      fill: "floor_dirt_large", fillAlt: "floor_dirt_large_rocky",
      quarters: ["floor_dirt_small_A", "floor_dirt_small_B", "floor_dirt_small_C", "floor_dirt_small_D"],
      weeds: "floor_dirt_small_weeds", pebble: "rubble_half",
    },
    aisle: "floor_wood_large", aisleChance: 0.45,
    wall: "wall", corner: "wall_corner", beam: "wall_pillar", beamEvery: 4,
    features: [["sword_shield", 30], ["wall_window_closed", 40], ["wall_shelves", 30]],
    banner: "banner_patternA_red",
    torch: "torch_mounted",
    vignettes: { storageCorner: 3, hoardSmall: 2, candleShrine: 1, rubbleNest: 2, dining: 1 },
    intents: { storage: 3, ruin: 3, shrine: 1, messHall: 1 },
    obstacle2x: { crateFort: 3, dining: 1 },
    obstacleSingles: [["pillar", 45], ["crates_stacked", 30], ["barrel_large", 25]],
    atmosphere: { bgTop: 0x2c1c42, bgBottom: 0x0a0614, hemiSky: 0xcfe0ff, hemiGround: 0x40384f, sun: 0xfff1d0 },
  },
  goblinMines: {
    base: "floor_dirt_large",
    patch: {
      fill: "floor_tile_large", fillAlt: "floor_tile_large_rocks",
      quarters: ["floor_tile_small", "floor_tile_small_broken_A", "floor_tile_small_broken_B", "floor_tile_small"],
      weeds: "floor_tile_small_weeds_A", pebble: "rubble_half",
    },
    aisle: "floor_wood_large_dark", aisleChance: 0.4,
    wall: "wall", corner: "wall_corner", beam: "wall_pillar", beamEvery: 5,
    features: [["wall_gated", 40], ["wall_window_closed", 30], ["wall_shelves", 30]],
    banner: "banner_patternB_green",
    torch: "torch_mounted",
    vignettes: { storageCorner: 4, bar: 3, rubbleNest: 3, hoardSmall: 1 },
    intents: { storage: 4, messHall: 2, ruin: 2 },
    obstacle2x: { crateFort: 4, bar: 2 },
    obstacleSingles: [["crates_stacked", 35], ["barrel_large", 35], ["box_stacked", 30]],
    atmosphere: { bgTop: 0x38241a, bgBottom: 0x0c0705, hemiSky: 0xffe0b8, hemiGround: 0x4a3a28, sun: 0xffd9a0 },
  },
  crypt: {
    base: "floor_tile_large",
    patch: {
      fill: "floor_tile_large_rocks", fillAlt: "floor_dirt_large",
      quarters: ["floor_tile_small_broken_A", "floor_tile_small_broken_B", "floor_tile_small", "floor_tile_small_weeds_A"],
      weeds: "floor_tile_small_weeds_B", pebble: "rubble_half",
    },
    aisle: "floor_wood_large_dark", aisleChance: 0.25,
    wall: "wall", corner: "wall_corner", beam: "wall_pillar", beamEvery: 4,
    features: [["sword_shield", 30], ["wall_gated", 35], ["wall_window_closed", 35]],
    banner: "banner_patternC_white",
    torch: "candle_triple", torchOnFloor: true,
    vignettes: { candleShrine: 4, bedNook: 2, hoardSmall: 2, storageCorner: 1 },
    intents: { shrine: 4, ruin: 2, den: 2 },
    obstacle2x: { crateFort: 1, candleShrine: 2 },
    obstacleSingles: [["pillar_decorated", 60], ["pillar", 40]],
    atmosphere: { bgTop: 0x1c1c48, bgBottom: 0x060612, hemiSky: 0x9fb4ff, hemiGround: 0x2c2a4a, sun: 0xcfd8ff },
  },
  town: {
    base: "floor_wood_large",
    patch: {
      fill: "floor_tile_large", fillAlt: "floor_tile_large",
      quarters: ["floor_wood_small", "floor_wood_small_dark", "floor_wood_small", "floor_wood_small"],
      weeds: "floor_wood_small_dark", pebble: null,
    },
    aisle: "floor_tile_large", aisleChance: 0.85,
    wall: "wall", corner: "wall_corner", beam: "wall_pillar", beamEvery: 4,
    features: [["wall_shelves", 45], ["wall_window_closed", 55]],
    banner: "banner_patternA_yellow",
    torch: "torch_mounted",
    vignettes: { bar: 4, dining: 4, storageCorner: 2, bedNook: 1 },
    intents: { messHall: 5, storage: 2, den: 1 },
    obstacle2x: { dining: 3, bar: 3 },
    obstacleSingles: [["table_medium", 40], ["keg_decorated", 30], ["barrel_large_decorated", 30]],
    atmosphere: { bgTop: 0x33202c, bgBottom: 0x0c0810, hemiSky: 0xffe8c0, hemiGround: 0x4a3c30, sun: 0xffe0b0 },
  },
  lobby: {
    base: "floor_tile_large",
    patch: null, // pristine entry hall
    aisle: "floor_wood_large", aisleChance: 0,
    wall: "wall", corner: "wall_corner", beam: "wall_pillar", beamEvery: 4,
    features: [["sword_shield", 100]],
    banner: "banner_triple_red",
    torch: "torch_mounted",
    vignettes: { candleShrine: 2, library: 2 },
    intents: { shrine: 1 },
    obstacle2x: {},
    obstacleSingles: [["pillar_decorated", 100]],
    atmosphere: { bgTop: 0x2c1c42, bgBottom: 0x0a0614, hemiSky: 0xcfe0ff, hemiGround: 0x40384f, sun: 0xfff1d0 },
  },
};

export function paletteFor(desc) {
  if (desc.isLobby) return PALETTES.lobby;
  return PALETTES[desc.theme] || PALETTES.catacombs;
}

// ---------------------------------------------------------------------------
// Authored prop groups. dx/dz are cell units in the vignette's local frame
// (+z = the anchor's facing); up is a fraction of wallH (table top 1.0u ->
// 0.25). anchors lists where the group may be stamped. Probe-verified
// heights: table top 1.0u, keg top 2.05u, chair faces +Z at rot 0.
const VIGNETTES = {
  dining: {
    anchors: ["obstacle2x2", "corner"],
    elements: [
      { piece: "table_medium_tablecloth", dx: 0, dz: 0, rot: 0 },
      { piece: "chair", dx: -0.38, dz: 0, rot: Math.PI / 2 },
      { piece: "chair", dx: 0.38, dz: 0.06, rot: -Math.PI / 2 },
      { piece: "plate_food_A", dx: 0.06, dz: 0.03, up: 0.25 },
      { piece: "candle_lit", dx: -0.1, dz: -0.05, up: 0.25, flame: true },
    ],
  },
  crateFort: {
    anchors: ["obstacle2x2", "obstacle2x1"],
    elements: [
      { piece: "crates_stacked", dx: -0.22, dz: -0.2, rot: 0 },
      { piece: "barrel_large", dx: 0.28, dz: 0.18 },
      { piece: "box_stacked", dx: 0.26, dz: -0.26, rot: 0.35 },
      { piece: "box_small", dx: -0.25, dz: 0.3, rot: -0.4 },
    ],
  },
  storageCorner: {
    anchors: ["corner", "obstacle2x1", "obstacle1x1"],
    elements: [
      { piece: "crates_stacked", dx: -0.18, dz: -0.08 },
      { piece: "barrel_small", dx: 0.24, dz: 0.08, rot: 0.5 },
      { piece: "box_small", dx: 0.22, dz: -0.26, rot: -0.3 },
    ],
  },
  hoard: {
    anchors: ["obstacle2x2", "corner"],
    elements: [
      { piece: "chest_gold", dx: 0, dz: 0, rot: Math.PI },
      { piece: "coin_stack_large", dx: -0.3, dz: 0.15 },
      { piece: "coin_stack_medium", dx: 0.3, dz: 0.2 },
      { piece: "coin_stack_medium", dx: -0.2, dz: -0.28 },
      { piece: "coin_stack_small", dx: 0.28, dz: -0.2 },
      { piece: "coin_stack_small", dx: 0.05, dz: 0.32 },
    ],
  },
  hoardSmall: {
    anchors: ["corner", "obstacle1x1"],
    elements: [
      { piece: "trunk_small_B", dx: 0, dz: -0.05, rot: 0.2 },
      { piece: "coin_stack_medium", dx: -0.26, dz: 0.18 },
      { piece: "coin_stack_small", dx: 0.24, dz: 0.14 },
    ],
  },
  candleShrine: {
    anchors: ["corner", "obstacle1x1", "wallMid"],
    elements: [
      { piece: "candle_triple", dx: 0, dz: 0, flame: true },
      { piece: "candle_melted", dx: 0.22, dz: 0.12 },
      { piece: "candle", dx: -0.2, dz: 0.16 },
      { piece: "candle_melted", dx: -0.08, dz: -0.22, rot: 1.1 },
    ],
  },
  bar: {
    anchors: ["obstacle2x1", "corner"],
    elements: [
      { piece: "keg", dx: -0.22, dz: 0 },
      { piece: "barrel_large", dx: 0.28, dz: 0.05 },
      { piece: "bottle_B_brown", dx: -0.22, dz: 0, up: 0.51 },
      { piece: "bottle_A_green", dx: -0.15, dz: 0.08, up: 0.51 },
    ],
  },
  bedNook: {
    anchors: ["corner"],
    elements: [
      { piece: "bed_floor", dx: 0, dz: 0, rot: 0 },
      { piece: "trunk_small_A", dx: 0.42, dz: -0.3, rot: Math.PI / 2 },
      { piece: "candle_lit", dx: -0.35, dz: -0.3, flame: true },
    ],
  },
  rubbleNest: {
    anchors: ["corner", "obstacle1x1", "obstacle2x1"],
    elements: [
      { piece: "rubble_large", dx: 0, dz: 0, rot: 0.3 },
      { piece: "rubble_half", dx: 0.3, dz: 0.18, rot: 1.2 },
      { piece: "rubble_half", dx: -0.26, dz: -0.15, rot: -0.7 },
    ],
  },
  library: {
    anchors: ["wallMid"],
    elements: [
      { piece: "shelves", dx: 0, dz: -0.28, rot: 0 },
      { piece: "stool", dx: 0.34, dz: 0.05, rot: 0.4 },
      { piece: "bottle_C_green", dx: -0.28, dz: 0.12 },
    ],
  },
  shopStall: {
    anchors: ["shopfront"],
    elements: [
      { piece: "table_long_tablecloth", dx: 0, dz: 0, rot: 0 },
      { piece: "shelf_large", dx: -2, dz: 0, rot: 0 },
      { piece: "keg_decorated", dx: 2, dz: 0, rot: 0 },
      { piece: "plate_stack", dx: 0.3, dz: 0, up: 0.25 },
      { piece: "bottle_A_labeled_brown", dx: -0.35, dz: 0.05, up: 0.25 },
    ],
  },
};

// Characters and props both render at native KayKit size (1x), matching the
// pack's own sample-scene proportions.
const PROP_SCALE = 1.0;

// Composition intents: one per room, so its vignettes agree with each other
// (a storage room is crates everywhere, a mess hall is tables and kegs)
// instead of each anchor rolling independently.
const INTENTS = {
  storage:  { vignettes: { storageCorner: 4, crateFort: 3, hoardSmall: 1 }, obstacle2x: { crateFort: 5 } },
  messHall: { vignettes: { dining: 4, bar: 3, storageCorner: 1 }, obstacle2x: { dining: 3, bar: 2 } },
  shrine:   { vignettes: { candleShrine: 5, library: 2 }, obstacle2x: { candleShrine: 3, crateFort: 1 } },
  den:      { vignettes: { bedNook: 3, storageCorner: 2, rubbleNest: 1 }, obstacle2x: { crateFort: 2 } },
  ruin:     { vignettes: { rubbleNest: 5, hoardSmall: 2 }, obstacle2x: { crateFort: 1 } },
  hoardRoom: { vignettes: { hoard: 3, hoardSmall: 3, storageCorner: 1 }, obstacle2x: { crateFort: 1 } },
};

// Stamp a vignette's elements at an anchor (planner-side rotation into ox/oz
// so the renderer needs no new machinery). Offsets and heights scale with
// PROP_SCALE so arrangements stay proportional (plates stay ON tables).
function stampVignette(v, anchor, props, flames) {
  const c = Math.cos(anchor.rot), s = Math.sin(anchor.rot);
  const S = PROP_SCALE;
  for (const el of v.elements) {
    const ox = (anchor.ox || 0) + ((el.dx || 0) * c - (el.dz || 0) * s) * S;
    const oz = (anchor.oz || 0) + ((el.dx || 0) * s + (el.dz || 0) * c) * S;
    props.push({
      piece: el.piece, gx: anchor.gx, gy: anchor.gy, ox, oz,
      rot: anchor.rot + (el.rot || 0), up: (el.up || 0) * S, fit: el.fit,
      scale: el.fit ? undefined : S,
    });
    if (el.flame) flames.push({ gx: anchor.gx, gy: anchor.gy, ox, oz, up: ((el.up || 0) + 0.28) * S });
  }
}

// Corner-cap rotation, keyed by the corner's OPEN quadrant (probe-calibrated:
// at rot 0 the L's legs run west + south, capping a room's NE corner whose
// open quadrant is SW).
const CORNER_ROT = { SW: 0, SE: Math.PI / 2, NE: Math.PI, NW: -Math.PI / 2 };

// ---------------------------------------------------------------------------
// desc: { tiles, w, h, seed, theme, roomType, doorCols?, spikes?, exit?,
//         isLobby?, isTown? }
export function planRoomDecor(desc) {
  const { tiles, w, h, seed = 1 } = desc;
  const rng = makeRng(seed || 1);
  const pal = paletteFor(desc);

  const floors = [], walls = [], props = [], flames = [];
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? WALL : tiles[y * w + x];
  const solid = (x, y) => at(x, y) === WALL;
  const idx = (x, y) => y * w + x;

  // ---- geometry shared by several passes --------------------------------
  const doorCells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) === DOOR) doorCells.push({ gx: x, gy: y });
  const doorXs = doorCells.map((c) => c.gx);

  // exclusion mask: cells decor must keep clear (door apron, entry band,
  // spikes, lobby pads, shop row); aisle cells join after the aisle roll
  const mask = new Set();
  for (const c of doorCells) { mask.add(idx(c.gx, c.gy)); mask.add(idx(c.gx, c.gy + 1)); }
  const ex0 = Math.floor(w / 2) - 2;
  for (let x = ex0; x < ex0 + 4; x++) for (let y = h - 4; y < h - 1; y++) mask.add(idx(x, y)); // entry band
  for (const s of (desc.spikes || [])) mask.add(idx(s.tx, s.ty));
  if (desc.isLobby) {
    const padY = Math.round(h * 0.46);
    for (const f of [0.25, 0.5, 0.75]) {
      const px = Math.round(w * f);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mask.add(idx(px + dx, padY + dy));
    }
  }
  if (desc.roomType === "shop") {
    const cy = Math.floor(h / 2);
    for (let x = 1; x < w - 1; x++) { mask.add(idx(x, cy)); mask.add(idx(x, cy - 1)); mask.add(idx(x, cy - 2)); }
  }

  // floor mode has many per-room doors, not one top-center door, so the
  // single-door dressing (aisle to the door, flanking banner pair, exit frame)
  // is scoped to single-room mode; floors get their own door pass below.
  const floorMode = !!desc.rooms;

  // ---- pass 1: aisle roll + the room's composition intent ------------------
  const wantAisle = !floorMode && doorXs.length &&
    (desc.roomType === "treasure" || rng() < (pal.aisleChance || 0));
  // one intent per room: all its vignettes tell the same story
  const intentName = desc.roomType === "treasure"
    ? "hoardRoom"
    : pick(rng, Object.entries(pal.intents || { storage: 1 }));
  const intent = INTENTS[intentName] || null;
  const vigTableSrc = (intent && intent.vignettes) || pal.vignettes || {};
  const obstacle2xSrc = (intent && intent.obstacle2x) || pal.obstacle2x || {};

  // floor mode: each room resolves its own intent from its type/seed, so a
  // storeroom is crates and a dining hall is tables — the grid isn't one
  // global intent. Single-room mode keeps the vigTableSrc/obstacle2xSrc above.
  const floorRooms = desc.rooms || null;
  const _roomTables = new Map();
  const roomAt = (gx, gy) => {
    if (!floorRooms) return null;
    for (const r of floorRooms) {
      const R = r.rect;
      if (gx >= R.x && gx < R.x + R.w && gy >= R.y && gy < R.y + R.h) return r;
    }
    return null;
  };
  const tablesAt = (gx, gy) => {
    if (!floorRooms) return { vig: vigTableSrc, obs: obstacle2xSrc };
    const r = roomAt(gx, gy);
    const id = r ? r.id : -1;
    if (_roomTables.has(id)) return _roomTables.get(id);
    let name;
    if (r && r.type === "treasure") name = "hoardRoom";
    else if (r && r.intent) name = r.intent;
    else name = pick(makeRng((((r ? r.seed : seed) ^ 0x9e3779b9) >>> 0)), Object.entries(pal.intents || { storage: 1 }));
    const it = INTENTS[name] || null;
    const t = { vig: (it && it.vignettes) || pal.vignettes || {}, obs: (it && it.obstacle2x) || pal.obstacle2x || {} };
    _roomTables.set(id, t);
    return t;
  };
  const aisle = new Set();
  if (wantAisle) {
    for (const x of doorXs) {
      for (let y = doorCells[0].gy + 1; y < h - 1; y++) {
        if (at(x, y) === FLOOR) aisle.add(idx(x, y));
      }
    }
  }

  // ---- pass 2: organic patches (random-walk blobs) ------------------------
  const patch = new Set();
  const patchOk = (x, y) => at(x, y) === FLOOR && !aisle.has(idx(x, y)) && !mask.has(idx(x, y));
  if (pal.patch) {
    const area = w * h;
    const K = Math.max(1, Math.min(3, Math.round(area / 45)));
    for (let k = 0; k < K; k++) {
      // seed cell: a handful of rejection-sampled tries
      let sx = -1, sy = -1;
      for (let t = 0; t < 12; t++) {
        const x = 1 + Math.floor(rng() * (w - 2)), y = 1 + Math.floor(rng() * (h - 2));
        if (patchOk(x, y) && !patch.has(idx(x, y))) { sx = x; sy = y; break; }
      }
      if (sx < 0) continue;
      const target = 4 + Math.floor(rng() * 9); // 4..12 cells
      const blob = [idx(sx, sy)];
      patch.add(idx(sx, sy));
      let frontier = [[sx, sy]];
      while (blob.length < target && frontier.length) {
        const fi = Math.floor(rng() * frontier.length);
        const [cx, cy] = frontier[fi];
        const nbs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]
          .filter(([x, y]) => patchOk(x, y) && !patch.has(idx(x, y)));
        if (!nbs.length) { frontier.splice(fi, 1); continue; }
        const [nx, ny] = nbs[Math.floor(rng() * nbs.length)];
        patch.add(idx(nx, ny));
        blob.push(idx(nx, ny));
        frontier.push([nx, ny]);
      }
    }
  }
  // trap rooms: grates form their own cluster near the middle band
  const grate = new Set();
  if (desc.roomType === "trap") {
    for (let t = 0, made = 0; t < 20 && made < 2; t++) {
      const x = 2 + Math.floor(rng() * (w - 4)), y = 2 + Math.floor(rng() * (h - 4));
      if (!patchOk(x, y) || patch.has(idx(x, y)) || grate.has(idx(x, y))) continue;
      grate.add(idx(x, y));
      if (patchOk(x + 1, y) && !patch.has(idx(x + 1, y))) grate.add(idx(x + 1, y));
      if (patchOk(x, y + 1) && !patch.has(idx(x, y + 1)) && rng() < 0.5) grate.add(idx(x, y + 1));
      made++;
    }
  }

  // ---- pass 3: floor emission (fixed scan order) ---------------------------
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at(x, y);
      if (t === WALL) continue;
      const i = idx(x, y);
      if (t === DOOR || t === OBSTACLE) {
        floors.push({ piece: pal.base, gx: x, gy: y, rot: 0 });
        continue;
      }
      if (aisle.has(i)) {
        floors.push({ piece: pal.aisle, gx: x, gy: y, rot: 0 });
        continue;
      }
      if (grate.has(i)) {
        floors.push({ piece: "floor_tile_big_grate", gx: x, gy: y, rot: 0 });
        continue;
      }
      if (patch.has(i)) {
        // rim cells (any non-patch floor neighbour) become quarter-tile quads
        const rim = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
          .some(([nx, ny]) => at(nx, ny) === FLOOR && !patch.has(idx(nx, ny)));
        if (rim) {
          for (const [ox, oz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
            const q = rng() < 0.15 ? pal.patch.weeds : pal.patch.quarters[Math.floor(rng() * pal.patch.quarters.length)];
            floors.push({ piece: q, gx: x, gy: y, ox, oz, rot: 0 });
          }
        } else {
          floors.push({ piece: rng() < 0.8 ? pal.patch.fill : pal.patch.fillAlt, gx: x, gy: y, rot: 0 });
        }
        // pebbles live only inside patches
        if (pal.patch.pebble && rng() < 0.3) {
          props.push({
            piece: pal.patch.pebble, gx: x, gy: y,
            ox: (rng() - 0.5) * 0.5, oz: (rng() - 0.5) * 0.5,
            rot: rng() * Math.PI * 2, fit: 0.3,
          });
        }
        continue;
      }
      floors.push({ piece: pal.base, gx: x, gy: y, rot: 0 });
    }
  }

  // ---- pass 4: wall runs ---------------------------------------------------
  const edges = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at(x, y);
      if (t === WALL || t === DOOR) continue;
      if (solid(x, y - 1)) edges.push({ gx: x, gy: y, dir: "N" });
      if (solid(x, y + 1)) edges.push({ gx: x, gy: y, dir: "S" });
      if (solid(x + 1, y)) edges.push({ gx: x, gy: y, dir: "E" });
      if (solid(x - 1, y)) edges.push({ gx: x, gy: y, dir: "W" });
    }
  }
  // group into maximal collinear runs (deterministic order)
  const runs = [];
  const byLine = new Map(); // "N:3" -> edges
  for (const e of edges) {
    const key = (e.dir === "N" || e.dir === "S") ? `${e.dir}:${e.gy}` : `${e.dir}:${e.gx}`;
    let l = byLine.get(key);
    if (!l) byLine.set(key, (l = []));
    l.push(e);
  }
  for (const key of [...byLine.keys()].sort()) {
    const l = byLine.get(key);
    const horiz = key[0] === "N" || key[0] === "S";
    l.sort((a, b) => horiz ? a.gx - b.gx : a.gy - b.gy);
    let run = [l[0]];
    for (let i = 1; i <= l.length; i++) {
      const prev = run[run.length - 1], cur = l[i];
      const contiguous = cur && (horiz ? cur.gx === prev.gx + 1 : cur.gy === prev.gy + 1);
      if (contiguous) { run.push(cur); continue; }
      runs.push({ dir: run[0].dir, edges: run, len: run.length });
      if (cur) run = [cur];
    }
  }

  const doorAdjacent = (e) =>
    at(e.gx - 1, e.gy) === DOOR || at(e.gx + 1, e.gy) === DOOR ||
    at(e.gx, e.gy - 1) === DOOR || at(e.gx, e.gy + 1) === DOOR;

  // per-edge claims: piece per edge, default plain wall
  const edgePiece = new Map(); // edge -> piece
  // 4a. banner pair flanking the doorway (single-room only)
  if (!floorMode && doorXs.length) {
    const dy = doorCells[0].gy + 1; // the floor row below the top-wall door
    const lo = Math.min(...doorXs) - 1, hi = Math.max(...doorXs) + 1;
    for (const e of edges) {
      if (e.dir === "N" && e.gy === dy && (e.gx === lo || e.gx === hi)) {
        const piece = desc.isLobby
          ? ["banner_triple_green", "banner_triple_yellow", "banner_triple_red"][Math.min(2, Math.floor((e.gx / w) * 3))]
          : (desc.roomType === "boss" ? pal.banner.replace("banner_", "banner_triple_").replace(/pattern[A-C]_/, "") : pal.banner);
        // banners are modeled to stand at floor level (cloth spans 0.5..3.7u),
        // so up stays 0 — lifting them pokes the pole above the wall cap
        props.push({ piece, gx: e.gx, gy: e.gy, rot: 0, mount: "N", up: 0 });
      }
    }
  }
  // 4b. beams with centered phase; 4c. features at run midpoints; 4d. torches
  let featuresLeft = 2;
  const featureRuns = [...runs].sort((a, b) => b.len - a.len);
  const featureEdges = new Set();
  for (const run of featureRuns) {
    if (featuresLeft <= 0 || run.len < 5) continue;
    let mid = Math.floor(run.len / 2);
    const e = run.edges[mid];
    if (doorAdjacent(e)) continue;
    const isSide = run.dir === "E" || run.dir === "W";
    const piece = desc.roomType === "boss" && isSide ? "sword_shield" : pick(rng, pal.features);
    if (piece === "sword_shield") {
      // trophy: a prop hung on the wall, not a wall-panel replacement
      props.push({ piece, gx: e.gx, gy: e.gy, rot: 0, mount: e.dir, up: 0.42, scale: PROP_SCALE });
    } else {
      edgePiece.set(e, piece);
    }
    featureEdges.add(e);
    featuresLeft--;
  }
  for (const run of runs) {
    const every = pal.beamEvery || 4;
    if (run.len >= every) {
      const phase = Math.floor((run.len % every) / 2);
      run.edges.forEach((e, i) => {
        if ((i - phase) % every === 0 && !edgePiece.has(e) && !doorAdjacent(e)) {
          edgePiece.set(e, pal.beam);
        }
      });
    }
    // torches: symmetric pair at 25% / 75% (midpoint for short runs)
    const spots = run.len >= 6
      ? [Math.round(run.len * 0.25), Math.round(run.len * 0.75)]
      : (run.len >= 3 ? [Math.floor(run.len / 2)] : []);
    for (const i of spots) {
      const e = run.edges[i];
      if (!e || doorAdjacent(e) || featureEdges.has(e)) continue;
      if (pal.torchOnFloor) {
        props.push({ piece: pal.torch, gx: e.gx, gy: e.gy, rot: 0, mount: e.dir, up: 0, scale: PROP_SCALE });
        flames.push({ gx: e.gx, gy: e.gy, mount: e.dir, up: 0.25 });
      } else {
        props.push({ piece: pal.torch, gx: e.gx, gy: e.gy, rot: 0, mount: e.dir, up: 0.45, scale: PROP_SCALE });
        flames.push({ gx: e.gx, gy: e.gy, mount: e.dir, up: 0.68 });
      }
    }
  }
  for (const e of edges) walls.push({ piece: edgePiece.get(e) || pal.wall, gx: e.gx, gy: e.gy, dir: e.dir });

  // ---- pass 5: corner caps (lattice points; no rng) ------------------------
  // Each edge spans two lattice points; a point with two perpendicular edges
  // is a corner. Identify its open quadrant from the edge directions.
  const lattice = new Map(); // "x,y" -> [{e, side}]
  const addPt = (x, y, e) => {
    const k = `${x},${y}`;
    let l = lattice.get(k);
    if (!l) lattice.set(k, (l = []));
    l.push(e);
  };
  for (const e of edges) {
    if (e.dir === "N") { addPt(e.gx, e.gy, e); addPt(e.gx + 1, e.gy, e); }
    else if (e.dir === "S") { addPt(e.gx, e.gy + 1, e); addPt(e.gx + 1, e.gy + 1, e); }
    else if (e.dir === "W") { addPt(e.gx, e.gy, e); addPt(e.gx, e.gy + 1, e); }
    else { addPt(e.gx + 1, e.gy, e); addPt(e.gx + 1, e.gy + 1, e); }
  }
  const cornerAnchors = []; // reused by vignette pass
  for (const key of [...lattice.keys()].sort()) {
    const inc = lattice.get(key);
    if (inc.length !== 2) continue;
    const [a, b] = inc;
    const aH = a.dir === "N" || a.dir === "S", bH = b.dir === "N" || b.dir === "S";
    if (aH === bH) continue; // collinear
    const [Px, Py] = key.split(",").map(Number);
    // open quadrant: the floor lies south of an N edge, north of an S edge,
    // east of a W edge, west of an E edge. Combine the two half-planes.
    const hE = aH ? a : b, vE = aH ? b : a;
    const openS = hE.dir === "N"; // floor below the horizontal wall line
    const openE = vE.dir === "W"; // floor right of the vertical wall line
    const Q = (openS ? "S" : "N") + (openE ? "E" : "W");
    // No chunky corner cap: the two perpendicular wall panels already meet in
    // a clean L. The wall_corner piece overlaid on them protruded diagonally
    // into the room (read as a cross), so corners now come purely from the
    // panels. We still register the corner as a vignette anchor below.
    // corner vignette anchor: the floor cell diagonal into the open quadrant.
    // Facing snaps to the nearest cardinal (45° furniture reads dropped, not
    // placed) and the anchor hugs the corner's two walls instead of floating
    // at the cell center.
    const cx = openE ? Px : Px - 1, cy = openS ? Py : Py - 1;
    if (at(cx, cy) === FLOOR && !mask.has(idx(cx, cy))) {
      const diag = Math.atan2(openE ? 1 : -1, openS ? 1 : -1);
      const rot = Math.round(diag / (Math.PI / 2)) * (Math.PI / 2);
      cornerAnchors.push({
        gx: cx, gy: cy, rot, kind: "corner",
        ox: openE ? -0.2 : 0.2, oz: openS ? -0.2 : 0.2,
      });
    }
  }

  // ---- pass 6: obstacle clusters -> footprint vignettes --------------------
  const seen = new Set();
  const clusters = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) !== OBSTACLE || seen.has(idx(x, y))) continue;
      const cells = [];
      const stack = [[x, y]];
      seen.add(idx(x, y));
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (at(nx, ny) === OBSTACLE && !seen.has(idx(nx, ny))) { seen.add(idx(nx, ny)); stack.push([nx, ny]); }
        }
      }
      clusters.push(cells);
    }
  }
  for (const cells of clusters) {
    const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
    const cw = Math.max(...xs) - Math.min(...xs) + 1, ch = Math.max(...ys) - Math.min(...ys) + 1;
    const gx = (Math.min(...xs) + Math.max(...xs)) / 2, gy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const long = Math.max(cw, ch), rot = cw >= ch ? 0 : Math.PI / 2;
    if (cells.length === 1) {
      props.push({ piece: pick(rng, pal.obstacleSingles), gx, gy, rot: Math.floor(rng() * 4) * (Math.PI / 2), fit: 0.85 });
      continue;
    }
    const table = Object.entries(tablesAt(gx, gy).obs);
    const vName = table.length ? pick(rng, table) : null;
    const v = vName && VIGNETTES[vName];
    if (v) {
      // stretch the vignette across the cluster: scale local dx by its length
      const anchor = { gx, gy, rot: rot + (rng() < 0.5 ? 0 : Math.PI) };
      const stretched = {
        elements: v.elements.map((el) => ({ ...el, dx: (el.dx || 0) * (long / 2 + 0.4) })),
      };
      stampVignette(stretched, anchor, props, flames);
    } else {
      for (const [cx, cy] of cells) {
        props.push({ piece: pick(rng, pal.obstacleSingles), gx: cx, gy: cy, rot: Math.floor(rng() * 4) * (Math.PI / 2), fit: 0.85 });
      }
    }
  }

  // ---- pass 7: corner/wallMid vignettes ------------------------------------
  const wallMidAnchors = [];
  for (const run of runs) {
    if (run.len < 5) continue;
    const e = run.edges[Math.floor(run.len / 2)];
    if (featureEdges.has(e) || doorAdjacent(e)) continue;
    if (at(e.gx, e.gy) !== FLOOR || mask.has(idx(e.gx, e.gy))) continue;
    const rot = e.dir === "N" ? 0 : e.dir === "S" ? Math.PI : e.dir === "E" ? -Math.PI / 2 : Math.PI / 2;
    // hug the wall the anchor belongs to
    const ox = e.dir === "E" ? 0.24 : e.dir === "W" ? -0.24 : 0;
    const oz = e.dir === "N" ? -0.24 : e.dir === "S" ? 0.24 : 0;
    wallMidAnchors.push({ gx: e.gx, gy: e.gy, rot, ox, oz, kind: "wallMid" });
  }
  const anchors = shuffle(rng, [...cornerAnchors, ...wallMidAnchors]);
  const claimed = new Set();
  // mirrored twin of an anchor across the room's vertical center axis (single
  // room only — a floor mirrors within rooms, not across the whole grid)
  const mirrorOf = (a) => anchors.find((b) =>
    b !== a && b.kind === a.kind && b.gy === a.gy &&
    b.gx === (w - 1) - a.gx && !claimed.has(idx(b.gx, b.gy)));
  const stampAt = (v, a) => {
    stampVignette(v, a, props, flames);
    claimed.add(idx(a.gx, a.gy));
  };
  if (floorRooms) {
    // per-room budget: ~1-2 focal vignettes each, drawn from the room's intent
    const perRoom = new Map();
    for (const a of anchors) {
      if (claimed.has(idx(a.gx, a.gy))) continue;
      const room = roomAt(a.gx, a.gy);
      if (!room) continue;
      const cap = Math.max(1, Math.min(2, Math.round((room.rect.w * room.rect.h) / 45)));
      if ((perRoom.get(room.id) || 0) >= cap) continue;
      const vigTable = Object.entries(tablesAt(a.gx, a.gy).vig);
      if (!vigTable.length) continue;
      const name = pick(rng, vigTable);
      const v = VIGNETTES[name];
      if (!v || !v.anchors.includes(a.kind)) continue;
      stampAt(v, a);
      perRoom.set(room.id, (perRoom.get(room.id) || 0) + 1);
    }
  } else {
    let vigLeft = Math.max(1, Math.min(4, Math.round((w * h) / 36)));
    const stampG = (v, a) => { stampAt(v, a); vigLeft--; };
    if (desc.roomType === "treasure") {
      const a = anchors.find((a) => a.kind === "corner");
      if (a) stampG(VIGNETTES.hoard, a);
    }
    for (const a of anchors) {
      if (vigLeft <= 0) break;
      if (claimed.has(idx(a.gx, a.gy))) continue;
      const vigTable = Object.entries(vigTableSrc);
      const name = pick(rng, vigTable);
      const v = VIGNETTES[name];
      if (!v || !v.anchors.includes(a.kind)) continue;
      stampG(v, a);
      const m = vigLeft > 0 ? mirrorOf(a) : null;
      if (m && rng() < 0.75) stampG(v, m);
    }
  }
  if (desc.roomType === "shop") {
    stampVignette(VIGNETTES.shopStall, { gx: w / 2 - 0.5, gy: Math.floor(h / 2) - 3.2, rot: 0 }, props, flames);
  }

  // ---- pass 8: wall-top dressing -------------------------------------------
  if (rng() < 0.5) {
    const nRuns = runs.filter((r) => r.dir === "N" && r.len >= 5);
    let placed = 0;
    for (const run of nRuns) {
      if (placed >= 3) break;
      const i = 1 + Math.floor(rng() * (run.len - 2));
      const e = run.edges[i];
      if (edgePiece.get(e) === pal.beam || doorAdjacent(e)) continue;
      const piece = pick(rng, [["candle_lit", 45], ["coin_stack_small", 30], ["barrel_small", 25]]);
      props.push({ piece, gx: e.gx, gy: e.gy, oz: -0.5, up: 1.0, rot: rng() * Math.PI * 2, scale: PROP_SCALE });
      if (piece === "candle_lit") flames.push({ gx: e.gx, gy: e.gy, oz: -0.5, up: 1.0 + 0.28 * PROP_SCALE });
      placed++;
    }
  }

  // ---- pass 9: exit (doorway frames whose own leaves swing open) + stairs --
  const door = { cells: doorCells, frame: "wall_doorway" };
  if (!floorMode && doorCells.length && desc.exit === "stairs") {
    const cx = doorCells.reduce((s, c) => s + c.gx, 0) / doorCells.length;
    const gy = doorCells[0].gy;
    props.push({ piece: "stairs_wide", gx: cx, gy: gy - 0.85, rot: 0 });
    for (const c of doorCells) floors.push({ piece: pal.base, gx: c.gx, gy: gy - 1, rot: 0 });
  }

  // floor mode: one swinging doorway per corridor, sitting flush on the seam
  // where the corridor meets the room. The gate is closed while either room it
  // connects is locked. Plus a staircase centered in the stairs room.
  const doors = [];
  if (floorMode) {
    for (const d of (desc.floorDoors || [])) {
      doors.push({
        roomIds: d.rooms || [], side: d.dir, frame: "wall_doorway",
        cells: (d.cells || []).map((c) => ({ gx: c.x, gy: c.y })),
      });
    }
    for (const r of desc.rooms) {
      if (r.type === "stairs") {
        props.push({ piece: "stairs_wide", gx: r.rect.x + r.rect.w / 2 - 0.5, gy: r.rect.y + r.rect.h / 2 - 0.5, rot: 0 });
      }
    }
  }

  // ---- pass 10: scripted lights (no rng) -----------------------------------
  const lights = [];
  if (desc.roomType === "boss") {
    lights.push({ gx: w / 2 - 0.5, gy: h / 2 - 0.5, up: 0.6, color: 0xffb870, intensity: 1.6 });
  } else if (desc.isTown || desc.isLobby) {
    lights.push({ gx: w / 2 - 0.5, gy: h / 2 - 0.5, up: 0.7, color: 0xffd9a0, intensity: 1.1 });
  }

  const spikes = desc.spikes || [];
  const pieces = new Set();
  for (const f of floors) pieces.add(f.piece);
  for (const wl of walls) pieces.add(wl.piece);
  for (const p of props) pieces.add(p.piece);
  if (doorCells.length) pieces.add(door.frame);
  if (doors.length) pieces.add("wall_doorway");
  if (spikes.length) pieces.add("floor_tile_big_spikes");

  return { floors, walls, props, flames, door, doors, spikes, lights, atmosphere: pal.atmosphere, pieces: [...pieces] };
}
