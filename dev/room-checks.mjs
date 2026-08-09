// Room-decor regression checks: draw-call/triangle budgets per theme and
// planner determinism (same desc -> same plan; guest setData round-trip).
//
// Needs a static server on :8123 (python3 -m http.server 8123) and playwright
// (run from any dir that has it installed, e.g. `node dev/room-checks.mjs`
// after `npm i playwright`; CI/dev containers keep chromium at
// /opt/pw-browsers/chromium or set CHROMIUM_PATH).
// playwright resolves from this file's dir if installed there, else from cwd
const pw = await import("playwright").catch(() =>
  import(new URL(`file://${process.cwd()}/node_modules/playwright/index.mjs`)));
const { chromium } = pw;
const { existsSync } = await import("node:fs");

// This sandbox keeps a prebuilt chromium at /opt/pw-browsers; a stock CI runner
// has whatever `playwright install` fetched, and passing a nonexistent
// executablePath there fails the launch. Prefer the env var, then the sandbox
// path if it actually exists, else let playwright resolve its own browser.
const CHROME = process.env.CHROMIUM_PATH ||
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : null);
const BASE = process.env.BASE_URL || "http://localhost:8123";
// Phase 1 routed `?dev=combat` through the connected-floor generator (the
// classic single-room path it used to boot into is gone), so every check
// below that boots via ?dev=combat is now measuring a whole floor's draw
// calls, not one room's - compare against the floor budget the bottom
// block already established, not a single-room one.
const FLOOR_CALL_BUDGET = 240, TRI_BUDGET = 400_000;

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

// These are DECOR budgets. Characters are dynamic and their preload timing
// varies, so exclude them from the count: hide the character meshes and clear
// the entity/item/projectile billboards, then render. Keeps the budget a stable
// measure of the room's decor regardless of how fast models stream in.
const DECOR_ONLY = `window.decorOnlyRender = () => {
  DD.render3d.setEntities([]); DD.render3d.setItems([]); DD.render3d.setProjectiles([]);
  if (DD.charMgr) for (const ch of DD.charMgr.chars.values()) ch.root.visible = false;
  return DD.render3d.render();
};`;
// Room layout + decor both draw on Math.random, so an unseeded page renders a
// different room every run and the draw-call budgets flap. Pin Math.random to a
// deterministic LCG before any game code runs, so each dungeon renders the same
// room every time and the budgets are a stable, meaningful measure.
const SEED_RNG = `(() => {
  let s = 0x9e3779b1 >>> 0;
  Math.random = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s & 0x7fffffff) / 0x7fffffff; };
})();`;
async function newPage(opts) {
  const page = await browser.newPage(opts);
  await page.addInitScript(SEED_RNG);
  await page.addInitScript(DECOR_ONLY);
  return page;
}

for (const dungeon of ["catacombs", "goblinMines", "crypt"]) {
  const page = await newPage({ viewport: { width: 1024, height: 640 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/?dev=combat&cam=fixed&dungeon=${dungeon}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.DD && DD.game3d && DD.game3d.active(DD.game.state), null, { timeout: 20000 });
  await page.waitForTimeout(6000); // decor pieces stream in + one rebuild

  const r = await page.evaluate(async () => {
    const info = decorOnlyRender();
    const d = DD.room.getData();
    const desc = {
      tiles: d.tiles.split(",").map(Number), w: d.w, h: d.h, seed: d.seed,
      theme: d.theme, roomType: d.roomType, exit: d.exit, spikes: d.spikes,
    };
    const m = await import("./js/decor3d.js");
    const plan = m.planRoomDecor(desc);
    const a = JSON.stringify(plan);
    const b = JSON.stringify(m.planRoomDecor(desc));
    // guest path: feeding getData back through setData must yield the same plan
    DD.room.setData(DD.room.getData());
    const d2 = DD.room.getData();
    const c = JSON.stringify(m.planRoomDecor({
      tiles: d2.tiles.split(",").map(Number), w: d2.w, h: d2.h, seed: d2.seed,
      theme: d2.theme, roomType: d2.roomType, exit: d2.exit, spikes: d2.spikes,
    }));
    // composition sanity
    const tiles = desc.tiles;
    const corners = plan.props.filter((p) => p.piece.startsWith("wall_corner")).length;
    const banners = plan.props.filter((p) => p.piece.startsWith("banner")).length;
    const hasDoor = tiles.includes(2);
    const hasObstacles = tiles.includes(3);
    const propOnDoor = plan.props.some((p) => {
      const x = Math.round(p.gx), y = Math.round(p.gy);
      return !p.up && x >= 0 && y >= 0 && x < d.w && y < d.h && tiles[y * d.w + x] === 2;
    });
    return {
      calls: info.calls, triangles: info.triangles, deterministic: a === b, guestSame: a === c,
      failedPieces: [...DD.render3d.pieceFailed], shadows: DD.render3d.shadows,
      corners, banners, hasDoor, hasObstacles, props: plan.props.length, propOnDoor,
    };
  });

  check(`${dungeon}: draw calls ${r.calls} <= ${FLOOR_CALL_BUDGET}`, r.calls <= FLOOR_CALL_BUDGET);
  check(`${dungeon}: triangles ${r.triangles} <= ${TRI_BUDGET}`, r.triangles <= TRI_BUDGET);
  check(`${dungeon}: planner deterministic`, r.deterministic);
  check(`${dungeon}: guest setData round-trip identical`, r.guestSame);
  check(`${dungeon}: banner pair flanks the door`, !r.hasDoor || r.banners >= 2);
  check(`${dungeon}: obstacle clusters dressed`, !r.hasObstacles || r.props > 0);
  check(`${dungeon}: no ground prop on DOOR cells`, !r.propOnDoor);
  check(`${dungeon}: no failed piece loads`, r.failedPieces.length === 0, r.failedPieces.join(","));
  check(`${dungeon}: no page errors`, errors.length === 0, errors.join(" | "));
  await page.close();
}

// the ?noshadow fallback path must not rot: shadows off + same budgets
{
  const page = await newPage({ viewport: { width: 1024, height: 640 } });
  await page.goto(`${BASE}/?dev=combat&cam=fixed&noshadow`, { waitUntil: "load" });
  await page.waitForFunction(() => window.DD && DD.game3d && DD.game3d.active(DD.game.state), null, { timeout: 20000 });
  await page.waitForTimeout(6000);
  const r = await page.evaluate(() => {
    const info = decorOnlyRender();
    return { calls: info.calls, shadows: DD.render3d.shadows, mapOn: DD.render3d.renderer.shadowMap.enabled };
  });
  check(`noshadow: shadows disabled`, !r.shadows && !r.mapOn);
  check(`noshadow: draw calls ${r.calls} <= ${FLOOR_CALL_BUDGET}`, r.calls <= FLOOR_CALL_BUDGET);
  await page.close();
}

// connected-floor path: generation connectivity, per-room doors + gating,
// gate meshes, and draw budget for a whole floor of small rooms.
{
  const page = await newPage({ viewport: { width: 1024, height: 640 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/?floors&cam=fixed&dungeon=catacombs`, { waitUntil: "load" });
  await page.waitForFunction(() => window.DD && DD.room.isFloor && DD.game.state === "play", null, { timeout: 20000 });
  await page.waitForTimeout(5500); // decor + doorway pieces stream in, one rebuild

  const r = await page.evaluate(async () => {
    const info = decorOnlyRender();
    const rooms = DD.room.rooms, edges = DD.room.edges;
    // BFS from the entry room over the corridor graph
    const adj = new Map(rooms.map((rm) => [rm.id, []]));
    for (const [a, b] of edges) { adj.get(a).push(b); adj.get(b).push(a); }
    const seen = new Set([rooms[0].id]);
    const q = [rooms[0].id];
    while (q.length) { for (const n of adj.get(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); } }
    // boss chamber should be bigger than a combat room; a staircase prop should
    // sit inside it (the walk-onto descent point)
    const bossRm = DD.room.roomById(DD.room.stairsRoomId);
    const combatRm = rooms.find((rm) => rm.type === "combat");
    const bossArea = bossRm ? bossRm.rect.w * bossRm.rect.h : 0;
    const combatArea = combatRm ? combatRm.rect.w * combatRm.rect.h : 0;
    const st = DD.room.floorStairs;
    const stInBoss = st && bossRm && st.x >= bossRm.rect.x && st.x < bossRm.rect.x + bossRm.rect.w &&
      st.y >= bossRm.rect.y && st.y < bossRm.rect.y + bossRm.rect.h;
    const d = DD.room.getData();
    const m = await import("./js/decor3d.js");
    const plan = m.planRoomDecor({ tiles: d.tiles.split(",").map(Number), w: d.w, h: d.h, seed: d.seed,
      theme: d.theme, roomType: d.roomType, isFloor: true, rooms: d.rooms, floorDoors: d.floorDoors,
      floorWalls: d.floorWalls, stairs: d.floorStairs });
    // any staircase piece, not one specific model — the exit switched from
    // stairs_wide to stairs_walled when it was rebuilt to descend
    const hasStairsProp = plan.props.some((pr) => pr.piece.startsWith("stairs") && st && pr.gx === st.x && pr.gy === st.y);
    const pre = {
      rooms: rooms.length, doors: DD.room.floorDoors.length, walls: DD.room.floorWalls.length,
      edges: DD.room.edges.length, stairsRoomId: DD.room.stairsRoomId, stairs: JSON.stringify(st),
      enemiesFrozen: DD.game.skeletons.length > 0 && DD.game.skeletons.every((s) => s.frozen),
      enemiesTagged: DD.game.skeletons.every((s) => s.roomId != null),
      boss: DD.game.skeletons.some((s) => s instanceof DD.Boss),
      doorsStartOpen: !DD.room.floorDoors.some((dr) => DD.room.doorClosed(dr)),
      gates: DD.render3d.floorGates ? DD.render3d.floorGates.length : 0,
    };
    // co-op: the guest reconstructs the floor from getData() via setData() — must
    // round-trip the whole layout + rebuild collision (done last; mutates DD.room).
    const data = DD.room.getData();
    DD.room.isFloor = false; DD.room.rooms = null;
    DD.room.setData(data);
    const coopRoundTrip = !!DD.room.isFloor && DD.room.rooms.length === pre.rooms &&
      DD.room.floorDoors.length === pre.doors && DD.room.floorWalls.length === pre.walls &&
      DD.room.edges.length === pre.edges && DD.room.stairsRoomId === pre.stairsRoomId &&
      JSON.stringify(DD.room.floorStairs) === pre.stairs &&
      (DD.room._doorBars || []).length > 0 && (DD.room._edgeWalls || []).length > 0 &&
      typeof DD.room.doorClosed(DD.room.floorDoors[0]) === "boolean" &&
      DD.room.onStairs((DD.room.floorStairs.x + 0.5) * DD.TILE, (DD.room.floorStairs.y + 0.5) * DD.TILE) === true;
    return {
      calls: info.calls, triangles: info.triangles,
      roomCount: rooms.length,
      reachesAll: seen.size === rooms.length,
      reachesStairs: seen.has(pre.stairsRoomId),
      enemiesFrozen: pre.enemiesFrozen, enemiesTagged: pre.enemiesTagged, boss: pre.boss,
      doors: pre.doors, gates: pre.gates, doorsStartOpen: pre.doorsStartOpen,
      bossArea, combatArea, stInBoss, hasStairsProp, coopRoundTrip,
    };
  });
  check(`floor: room graph reaches every room`, r.reachesAll, `${r.roomCount} rooms`);
  check(`floor: room graph reaches the stairs room`, r.reachesStairs);
  check(`floor: doors + gates built`, r.doors > 0 && r.gates > 0, `doors=${r.doors} gates=${r.gates}`);
  check(`floor: doors start open (traversable)`, r.doorsStartOpen);
  check(`floor: enemies spawn frozen + room-tagged`, r.enemiesFrozen && r.enemiesTagged);
  check(`floor: boss chamber present`, r.boss);
  check(`floor: boss chamber bigger than a combat room`, r.bossArea > r.combatArea, `boss=${r.bossArea} combat=${r.combatArea}`);
  check(`floor: staircase sits in the boss chamber`, r.stInBoss && r.hasStairsProp);
  check(`floor: co-op guest reconstructs the floor (getData -> setData)`, r.coopRoundTrip);
  // a whole floor is many rooms + cloned gate frames, so it runs more draw
  // calls than a single room; per-room visibility culling lands in Phase 5.
  check(`floor: draw calls ${r.calls} <= ${FLOOR_CALL_BUDGET}`, r.calls <= FLOOR_CALL_BUDGET);
  check(`floor: triangles ${r.triangles} <= ${TRI_BUDGET}`, r.triangles <= TRI_BUDGET);
  check(`floor: no page errors`, errors.length === 0, errors.join(" | "));
  await page.close();
}

await browser.close();
if (failed) { console.log(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log("\nall room checks passed");
