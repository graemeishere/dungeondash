// Dev harness: measure decor pieces (bbox, origin, submeshes) and render an
// orientation contact sheet — each piece at rot 0/90/180/270 in a small test
// room — so placement rotation constants are calibrated from evidence, not
// guesswork. Usage: server on :8123, then `node dev/piece-probe.mjs [names…]`
// (playwright resolved like dev/room-checks.mjs).
const pw = await import("playwright").catch(() =>
  import(new URL(`file://${process.cwd()}/node_modules/playwright/index.mjs`)));
const { chromium } = pw;

const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const BASE = process.env.BASE_URL || "http://localhost:8123";
const OUT = process.env.PROBE_OUT || ".";
const names = process.argv.slice(2).length ? process.argv.slice(2) : [
  "wall_corner", "wall_corner_small", "wall_half", "wall_half_endcap",
  "wall_endcap", "table_medium_tablecloth", "chair", "bed_floor",
  "coin_stack_small", "candle_lit", "plate_food_A", "keg", "shelf_small_candles",
];

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${BASE}/?dev=combat&cam=fixed&safe`, { waitUntil: "load" });
await page.waitForFunction(() => window.DD && DD.render3d && DD.render3d.proto, null, { timeout: 20000 });
await page.waitForTimeout(800);

// 1. measurements
const info = await page.evaluate(async (names) => {
  const { GLTFLoader } = await import("./js/lib/three/GLTFLoader.js");
  const THREE = await import("three");
  const loader = new GLTFLoader();
  const out = {};
  for (const n of names) {
    try {
      const g = await loader.loadAsync(encodeURI("KayKit Dungeon Remastered/Assets/gltf/" + n + ".gltf"));
      const b = new THREE.Box3().setFromObject(g.scene);
      let meshes = 0; g.scene.traverse((o) => { if (o.isMesh) meshes++; });
      const f = (v) => +v.toFixed(2);
      out[n] = { min: [f(b.min.x), f(b.min.y), f(b.min.z)], max: [f(b.max.x), f(b.max.y), f(b.max.z)], meshes };
    } catch (e) { out[n] = "LOAD FAILED"; }
  }
  return out;
}, names);
for (const [n, d] of Object.entries(info)) console.log(n.padEnd(26), JSON.stringify(d));

// 2. orientation contact sheet: replace the live room with a probe layout —
// each piece at rot 0 / 90 / 180 / 270 in a row (one piece per row).
await page.evaluate(async (names) => {
  const dr = DD.render3d;
  await dr.ensurePieces(names);
  await new Promise((r) => setTimeout(r, 1500));
  const w = 14, h = names.length * 3 + 3;
  const tiles = new Array(w * h).fill(0);
  const plan = {
    floors: [], walls: [], props: [], flames: [], spikes: [], lights: [],
    door: { cells: [] }, atmosphere: null, pieces: [],
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) plan.floors.push({ piece: "floor_tile_large", gx: x, gy: y, rot: 0 });
  names.forEach((n, i) => {
    const gy = 1 + i * 3;
    [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((rot, j) => {
      plan.props.push({ piece: n, gx: 1 + j * 3, gy, rot });
    });
  });
  // build the probe scene directly with the renderer's own instancer
  dr.W = w; dr.H = h;
  if (dr.dungeon) { dr.scene.remove(dr.dungeon); dr.dungeon = null; }
  const THREE = await import("three");
  const g = new THREE.Group();
  const groups = new Map();
  const put = (piece, placement) => {
    if (!dr.pieceProtos.has(piece)) return;
    let l = groups.get(piece); if (!l) groups.set(piece, (l = []));
    l.push(placement);
  };
  for (const f of plan.floors) put(f.piece, f);
  for (const p of plan.props) put(p.piece, p);
  for (const [piece, placements] of groups) {
    const proto = dr.pieceProtos.get(piece);
    for (const sub of (proto.meshes || [proto])) g.add(dr._instancePlaced(sub, placements, proto));
  }
  dr.scene.add(g); dr.dungeon = g;
  dr._frameCamera();
  dr.setCameraMode("fixed");
  // stop game3d from rebuilding over our probe scene
  DD.game3d.draw = () => { dr.render(); };
}, names);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/probe-sheet.png`, fullPage: false });
console.log("contact sheet ->", `${OUT}/probe-sheet.png  (rows top-to-bottom = piece order; cols = rot 0, 90deg, 180deg, 270deg)`);
await browser.close();
