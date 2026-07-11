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

const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const BASE = process.env.BASE_URL || "http://localhost:8123";
const CALL_BUDGET = 70, TRI_BUDGET = 400_000;

const browser = await chromium.launch({ executablePath: CHROME });
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

for (const dungeon of ["catacombs", "goblinMines", "crypt"]) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/?dev=combat&cam=fixed&dungeon=${dungeon}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.DD && DD.game3d && DD.game3d.active(DD.game.state), null, { timeout: 20000 });
  await page.waitForTimeout(2500); // decor pieces stream in + one rebuild

  const r = await page.evaluate(async () => {
    const info = DD.render3d.render();
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

  check(`${dungeon}: draw calls ${r.calls} <= ${CALL_BUDGET}`, r.calls <= CALL_BUDGET);
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
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  await page.goto(`${BASE}/?dev=combat&cam=fixed&noshadow`, { waitUntil: "load" });
  await page.waitForFunction(() => window.DD && DD.game3d && DD.game3d.active(DD.game.state), null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const info = DD.render3d.render();
    return { calls: info.calls, shadows: DD.render3d.shadows, mapOn: DD.render3d.renderer.shadowMap.enabled };
  });
  check(`noshadow: shadows disabled`, !r.shadows && !r.mapOn);
  check(`noshadow: draw calls ${r.calls} <= ${CALL_BUDGET}`, r.calls <= CALL_BUDGET);
  await page.close();
}

await browser.close();
if (failed) { console.log(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log("\nall room checks passed");
