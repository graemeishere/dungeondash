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
    const a = JSON.stringify(m.planRoomDecor(desc));
    const b = JSON.stringify(m.planRoomDecor(desc));
    // guest path: feeding getData back through setData must yield the same plan
    DD.room.setData(DD.room.getData());
    const d2 = DD.room.getData();
    const c = JSON.stringify(m.planRoomDecor({
      tiles: d2.tiles.split(",").map(Number), w: d2.w, h: d2.h, seed: d2.seed,
      theme: d2.theme, roomType: d2.roomType, exit: d2.exit, spikes: d2.spikes,
    }));
    return { calls: info.calls, triangles: info.triangles, deterministic: a === b, guestSame: a === c, failedPieces: [...DD.render3d.pieceFailed] };
  });

  check(`${dungeon}: draw calls ${r.calls} <= ${CALL_BUDGET}`, r.calls <= CALL_BUDGET);
  check(`${dungeon}: triangles ${r.triangles} <= ${TRI_BUDGET}`, r.triangles <= TRI_BUDGET);
  check(`${dungeon}: planner deterministic`, r.deterministic);
  check(`${dungeon}: guest setData round-trip identical`, r.guestSame);
  check(`${dungeon}: no failed piece loads`, r.failedPieces.length === 0, r.failedPieces.join(","));
  check(`${dungeon}: no page errors`, errors.length === 0, errors.join(" | "));
  await page.close();
}

await browser.close();
if (failed) { console.log(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log("\nall room checks passed");
