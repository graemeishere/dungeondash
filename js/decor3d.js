"use strict";
// Deterministic room-decoration planner. Pure function of its inputs: given
// the same desc (tiles + seed + theme + roomType) it always produces the same
// plan, so co-op guests re-derive identical rooms from the synced room data
// without any prop list on the wire.
//
// Everything here is in GRID coordinates (gx/gy, dir N/S/E/W, rot radians).
// js/render3d.js turns the plan into InstancedMeshes; this module never
// imports three.js and stays trivially testable.

const FLOOR = 0, WALL = 1, DOOR = 2, OBSTACLE = 3;

// All pieces come from the KayKit Dungeon Remastered pack (single-mesh gltf
// files sharing one 17KB atlas — cheap to instance).
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

// Weighted pick from [[piece, weight], ...].
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

// Per-theme piece palettes. floor/wall are weighted mixes; wallDecor drives
// torch spacing and banner rolls; atmosphere feeds render3d.setAtmosphere.
// floor.large are full-cell (4u) pieces; floor.small are quarter-cell (2u)
// pieces laid as a 2x2 quad when a cell rolls the small style (smallChance).
// Wall lists deliberately avoid see-through pieces (arches / open windows) —
// on the perimeter they read as holes into the void.
const PALETTES = {
  catacombs: {
    floor: {
      large: [["floor_tile_large", 82], ["floor_tile_large_rocks", 18]],
      smallChance: 0.2,
      small: [
        ["floor_tile_small", 55], ["floor_tile_small_broken_A", 15],
        ["floor_tile_small_broken_B", 15], ["floor_tile_small_weeds_A", 10],
        ["floor_tile_small_decorated", 5],
      ],
    },
    wall: [["wall", 70], ["wall_cracked", 18], ["wall_pillar", 8], ["wall_broken", 4]],
    obstacle: [["pillar", 30], ["crates_stacked", 22], ["rubble_large", 20], ["trunk_medium_A", 14], ["barrel_small_stack", 14]],
    banner: "banner_patternA_red", bannerChance: 0.10,
    torch: "torch_mounted", torchEvery: 5,
    atmosphere: { bg: 0x0a0812, hemiSky: 0xcfe0ff, hemiGround: 0x40384f, sun: 0xfff1d0 },
  },
  goblinMines: {
    floor: {
      large: [["floor_dirt_large", 58], ["floor_dirt_large_rocky", 26], ["floor_tile_large", 16]],
      smallChance: 0.22,
      small: [
        ["floor_dirt_small_A", 30], ["floor_dirt_small_B", 25], ["floor_dirt_small_C", 20],
        ["floor_dirt_small_D", 15], ["floor_dirt_small_weeds", 10],
      ],
    },
    wall: [["wall", 56], ["wall_cracked", 24], ["wall_broken", 10], ["wall_sloped", 10]],
    obstacle: [["crates_stacked", 28], ["barrel_large", 24], ["box_stacked", 20], ["rubble_large", 18], ["keg", 10]],
    banner: "banner_patternB_green", bannerChance: 0.08,
    torch: "torch_mounted", torchEvery: 4,
    atmosphere: { bg: 0x0d0a06, hemiSky: 0xffe0b8, hemiGround: 0x4a3a28, sun: 0xffd9a0 },
  },
  crypt: {
    floor: {
      large: [["floor_tile_large", 74], ["floor_tile_large_rocks", 26]],
      smallChance: 0.28,
      small: [
        ["floor_tile_small", 40], ["floor_tile_small_broken_A", 20],
        ["floor_tile_small_broken_B", 20], ["floor_tile_small_weeds_A", 12],
        ["floor_tile_small_weeds_B", 8],
      ],
    },
    wall: [["wall", 56], ["wall_cracked", 20], ["wall_broken", 8], ["wall_pillar", 8], ["wall_window_closed", 8]],
    obstacle: [["pillar_decorated", 34], ["pillar", 18], ["rubble_large", 24], ["trunk_large_A", 24]],
    banner: "banner_patternC_white", bannerChance: 0.12,
    torch: "candle_triple", torchEvery: 4, torchOnFloor: true,
    atmosphere: { bg: 0x070812, hemiSky: 0x9fb4ff, hemiGround: 0x2c2a4a, sun: 0xcfd8ff },
  },
  town: {
    floor: {
      large: [["floor_wood_large", 60], ["floor_wood_large_dark", 25], ["floor_tile_large", 15]],
      smallChance: 0.16,
      small: [["floor_wood_small", 60], ["floor_wood_small_dark", 40]],
    },
    wall: [["wall", 50], ["wall_window_closed", 20], ["wall_shelves", 16], ["wall_pillar", 14]],
    obstacle: [["table_medium", 28], ["barrel_large_decorated", 24], ["keg_decorated", 24], ["crates_stacked", 24]],
    banner: "banner_patternA_yellow", bannerChance: 0.10,
    torch: "torch_mounted", torchEvery: 4,
    atmosphere: { bg: 0x0c0a10, hemiSky: 0xffe8c0, hemiGround: 0x4a3c30, sun: 0xffe0b0 },
  },
  lobby: {
    floor: {
      large: [["floor_tile_large", 100]],
      smallChance: 0.12,
      small: [["floor_tile_small", 70], ["floor_tile_small_decorated", 30]],
    },
    wall: [["wall", 70], ["wall_pillar", 16], ["wall_cracked", 14]],
    obstacle: [["pillar_decorated", 70], ["pillar", 30]],
    banner: "banner_triple_red", bannerChance: 0.14,
    torch: "torch_mounted", torchEvery: 4,
    atmosphere: { bg: 0x0a0812, hemiSky: 0xcfe0ff, hemiGround: 0x40384f, sun: 0xfff1d0 },
  },
};

export function paletteFor(desc) {
  if (desc.isLobby) return PALETTES.lobby;
  return PALETTES[desc.theme] || PALETTES.catacombs;
}

// desc: { tiles:number[], w, h, seed, theme, roomType, isLobby, isTown }
// plan: {
//   floors: [{ piece, gx, gy, rot }],
//   walls:  [{ piece, gx, gy, dir }],
//   props:  [{ piece, gx, gy, rot, mount?, up? }],   // mount: wall dir to hug;
//                                                    // up: height as fraction of wallH
//   flames: [{ gx, gy, up }],                        // torch flame emitters (fx3d)
//   atmosphere: { bg, hemiSky, hemiGround, sun },
//   pieces: [names...]                               // every piece the plan uses
// }
export function planRoomDecor(desc) {
  const { tiles, w, h, seed = 1, theme = "catacombs" } = desc;
  const rng = makeRng(seed || 1);
  const pal = paletteFor({ ...desc, theme });

  const floors = [], walls = [], props = [], flames = [];
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? WALL : tiles[y * w + x];
  const solid = (x, y) => at(x, y) === WALL;

  // Pass 1 — floors: every non-wall cell gets either a full-cell piece or a
  // 2x2 quad of quarter-cell pieces, all seeded. Doorway and obstacle cells
  // stay plain (the threshold reads clean; props sit on a plain base). Trap
  // rooms mix rusty grates into the floor.
  const plainFloor = pal.floor.large[0][0];
  const largeTable = desc.roomType === "trap"
    ? pal.floor.large.concat([["floor_tile_grate", 16], ["floor_tile_big_grate", 8]])
    : pal.floor.large;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[y * w + x];
      if (t === WALL) continue;
      if (t === DOOR || t === OBSTACLE) {
        floors.push({ piece: plainFloor, gx: x, gy: y, rot: 0 });
        if (t === OBSTACLE) {
          // the solid prop standing on this cell, auto-fitted to the cell
          props.push({
            piece: pick(rng, pal.obstacle), gx: x, gy: y,
            rot: Math.floor(rng() * 4) * (Math.PI / 2), fit: 0.86,
          });
        }
        continue;
      }
      if (rng() < pal.floor.smallChance) {
        // quarter-cell quad: 4 small tiles at the cell's quadrant centers
        for (const [ox, oz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
          floors.push({
            piece: pick(rng, pal.floor.small), gx: x, gy: y, ox, oz,
            rot: Math.floor(rng() * 4) * (Math.PI / 2),
          });
        }
      } else {
        floors.push({
          piece: pick(rng, largeTable), gx: x, gy: y,
          rot: Math.floor(rng() * 4) * (Math.PI / 2),
        });
      }
    }
  }

  // Pass 2 — wall edges (same edge model the renderer used): a weighted wall
  // variant per edge. Also collects the edge list for the decor passes below.
  const edges = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[y * w + x];
      if (t === WALL || t === DOOR) continue;
      if (solid(x, y - 1)) edges.push({ gx: x, gy: y, dir: "N" });
      if (solid(x, y + 1)) edges.push({ gx: x, gy: y, dir: "S" });
      if (solid(x + 1, y)) edges.push({ gx: x, gy: y, dir: "E" });
      if (solid(x - 1, y)) edges.push({ gx: x, gy: y, dir: "W" });
    }
  }
  for (const e of edges) walls.push({ piece: pick(rng, pal.wall), ...e });

  // Pass 3 — torches: spaced along the wall edges (skip cells beside the
  // doorway so nothing crowds the exit). Crypt-style themes put candles on the
  // floor against the wall instead of a mounted torch.
  const doorAdjacent = (e) => at(e.gx - 1, e.gy) === DOOR || at(e.gx + 1, e.gy) === DOOR || at(e.gx, e.gy - 1) === DOOR || at(e.gx, e.gy + 1) === DOOR;
  let n = 0;
  for (const e of edges) {
    n++;
    if (n % pal.torchEvery !== 0 || doorAdjacent(e)) continue;
    if (pal.torchOnFloor) {
      props.push({ piece: pal.torch, gx: e.gx, gy: e.gy, rot: 0, mount: e.dir, up: 0 });
      flames.push({ gx: e.gx, gy: e.gy, mount: e.dir, up: 0.18 });
    } else {
      props.push({ piece: pal.torch, gx: e.gx, gy: e.gy, rot: 0, mount: e.dir, up: 0.45 });
      flames.push({ gx: e.gx, gy: e.gy, mount: e.dir, up: 0.62 });
    }
  }

  // Pass 4 — banners on north-facing top-wall edges (they hang flat against
  // the wall and read best facing the camera).
  for (const e of edges) {
    if (e.dir !== "N") continue;
    const roll = rng();
    if (roll < pal.bannerChance && !doorAdjacent(e)) {
      props.push({ piece: pal.banner, gx: e.gx, gy: e.gy, rot: 0, mount: "N", up: 0.55 });
    }
  }

  // Pass 5 — the exit: a doorway frame per DOOR cell plus a gate that the
  // renderer slides open on room clear. Boss/floor exits also get a staircase
  // rising behind the doorway (outside the grid — purely visual).
  const door = { cells: [], frame: "wall_doorway", gate: "wall_gated" };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] === DOOR) door.cells.push({ gx: x, gy: y });
    }
  }
  if (door.cells.length && desc.exit === "stairs") {
    const cx = door.cells.reduce((s, c) => s + c.gx, 0) / door.cells.length;
    const gy = door.cells[0].gy; // door row (top wall)
    props.push({ piece: "stairs_wide", gx: cx, gy: gy - 0.85, rot: 0 });
    // landing tiles so the staircase doesn't float on the void
    for (const c of door.cells) {
      floors.push({ piece: plainFloor, gx: c.gx, gy: gy - 1, rot: 0 });
    }
  }

  // Spike traps pass through for the renderer's animated spike layer.
  const spikes = desc.spikes || [];

  const pieces = new Set();
  for (const f of floors) pieces.add(f.piece);
  for (const wl of walls) pieces.add(wl.piece);
  for (const p of props) pieces.add(p.piece);
  if (door.cells.length) { pieces.add(door.frame); pieces.add(door.gate); }
  if (spikes.length) pieces.add("floor_tile_big_spikes");

  return { floors, walls, props, flames, door, spikes, atmosphere: pal.atmosphere, pieces: [...pieces] };
}
