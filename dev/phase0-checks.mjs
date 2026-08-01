// Phase 0 acceptance harness. This refactor has no unit tests, so the bar is
// "it still boots and plays": every class, every dungeon, a full floor through
// a boss, every screen, save/resume, raid, finale, WebGL context loss, and the
// production dev-flag gate.
//
// Needs a static server on :8123 (python3 -m http.server 8123) and playwright.
// Run it the same way as dev/room-checks.mjs - from a directory that has
// playwright installed, with an absolute path to this file.
//
// Companion to dev/room-checks.mjs, which covers decor/draw budgets instead.
const pw = await import("playwright").catch(() =>
  import(new URL(`file://${process.cwd()}/node_modules/playwright/index.mjs`)));
const { chromium } = pw;
const { existsSync } = await import("node:fs");

const BASE = process.env.BASE_URL || "http://localhost:8123";
const CHROME = process.env.CHROMIUM_PATH ||
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : null);
// Software GL: CI runners and this sandbox have no real GPU.
const LAUNCH = {
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
};

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// Console/page errors, minus the known-benign favicon 404.
function watch(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + (e && e.message ? e.message : String(e))));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon/i.test(t) || /404 \(File not found\)/.test(t)) return;
    if (/WebGL context (lost|restored)/i.test(t)) return; // our own deliberate log
    // GLB/texture fetches racing a reload against the single-process dev server.
    // The renderer log-and-drops these by design (pieceFailed) and falls back;
    // they are dev-server contention, not a code fault. Narrow on purpose.
    if (/GLTFLoader: (Couldn't load texture|Failed to load buffer)/.test(t)) return;
    if (/^decor piece load failed:/.test(t)) return;
    errs.push("console: " + t);
  });
  return errs;
}

// ?floors holds on the menu for up to 6s waiting for the hero model, so the
// boot predicate must key off the game actually being in play, not merely on
// game3d.active() (which is truthy for the menu backdrop too).
async function boot(page, url, predicate = () =>
  window.DD && DD.render3d && DD.render3d.proto && DD.game.state === "play") {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(predicate, null, { timeout: 45000 });
  await page.waitForTimeout(1200); // let GLB models settle
}

// ---- 1. every class x every dungeon boots into a playable combat room ----
async function classDungeonMatrix(browser) {
  const classes = ["warrior", "rogue", "mage", "ranger"];
  const dungeons = ["catacombs", "goblinMines", "crypt"];
  for (const cls of classes) {
    for (const dng of dungeons) {
      const page = await browser.newPage();
      const errs = watch(page);
      try {
        await boot(page, `/?floors&class=${cls}&dungeon=${dng}`);
        const st = await page.evaluate(() => ({
          state: DD.game.state,
          cls: DD.game.players[0] && DD.game.players[0].classKey,
          dungeon: DD.game.dungeonId,
          floorMode: !!DD.game.floorMode,
          isFloor: !!DD.room.isFloor,
          enemies: DD.game.skeletons.length,
          rooms: (DD.room.rooms || []).length,
          calls: DD.render3d.renderer.info.render.calls,
        }));
        const ok = st.state === "play" && st.cls === cls && st.dungeon === dng &&
          st.floorMode && st.isFloor && st.enemies > 0 && st.rooms > 0 &&
          st.calls > 0 && errs.length === 0;
        check(`boot ${cls}/${dng}`, ok, JSON.stringify(st) + (errs.length ? " ERRS " + errs.join(" | ") : ""));
      } catch (e) {
        check(`boot ${cls}/${dng}`, false, String(e).slice(0, 300) + (errs.length ? " ERRS " + errs.join(" | ") : ""));
      }
      await page.close();
    }
  }
}

// ---- 2. actually play: move, attack, kill something ----
async function playCombat(browser) {
  const page = await browser.newPage();
  const errs = watch(page);
  try {
    await boot(page, "/?dev=combat&class=warrior&cam=fixed");
    const before = await page.evaluate(() => DD.game.skeletons.length);
    // wake everything in the room, then swing until one dies
    await page.evaluate(() => {
      for (const s of DD.game.skeletons) { s.frozen = false; if (s.state === "inactive") s.state = "chase"; }
    });
    await page.keyboard.down(" ");
    await page.waitForTimeout(500);
    await page.keyboard.up(" ");
    // deterministic kill: damage one skeleton to death through the real path
    const killed = await page.evaluate(() => {
      const s = DD.game.skeletons.find((x) => !x.dead && !x.dying);
      if (!s) return false;
      s.state = "chase";
      s.damage(99999, s.x, s.y, DD.game);
      return true;
    });
    await page.waitForTimeout(600);
    const st = await page.evaluate(() => ({
      state: DD.game.state, time: DD.game.time, kills: DD.game.kills,
      alive: DD.game.players[0].alive(), hp: DD.game.players[0].hp,
    }));
    check("combat: swing + kill", killed && st.kills > 0 && st.state === "play" && st.alive && errs.length === 0,
      JSON.stringify(st) + (errs.length ? " ERRS " + errs.join(" | ") : ""));

    // movement moves the player (try each direction — the spawn corner may be
    // flush against a wall on any one axis)
    let moved = 0, detail = "";
    for (const key of ["d", "a", "w", "s"]) {
      const p0 = await page.evaluate(() => ({ x: DD.game.players[0].x, y: DD.game.players[0].y }));
      await page.keyboard.down(key);
      await page.waitForTimeout(400);
      await page.keyboard.up(key);
      await page.waitForTimeout(80);
      const p1 = await page.evaluate(() => ({ x: DD.game.players[0].x, y: DD.game.players[0].y }));
      const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      detail += `${key}:${d.toFixed(1)} `;
      moved = Math.max(moved, d);
    }
    check("combat: movement", moved > 4, detail);
  } catch (e) {
    check("combat: swing + kill", false, String(e).slice(0, 300));
  }
  await page.close();
}

// ---- 3. a full floor: clear every room, take the stairs, reach + kill a boss ----
async function fullFloor(browser) {
  const page = await browser.newPage();
  const errs = watch(page);
  try {
    await boot(page, "/?floors&class=warrior&dungeon=catacombs&cam=fixed");
    const plan = await page.evaluate(() => (DD.room.rooms || []).map((r) => r.type));
    // Walk the floor room by room via the transition machinery, clearing as we go.
    const trace = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = [];
      // clearing rooms levels the hero up, which opens a blocking overlay —
      // take the first upgrade so the walk continues
      const dismissLevelUp = async () => {
        for (let i = 0; i < 12 && DD.game.state === "levelup"; i++) {
          const card = document.querySelector("#upgrade-cards .upgrade-card");
          if (card) card.click(); else break;
          await sleep(120);
        }
      };
      const clearRoom = (id) => {
        DD.game.spawnQueue.length = 0;
        for (const s of DD.game.skeletons) {
          if (s.roomId !== id || s.dead || s.dying) continue;
          s.frozen = false;
          s.state = "chase";
          s.damage(999999, s.x, s.y, DD.game);
        }
      };
      for (const rm of DD.room.rooms) {
        await dismissLevelUp();
        // teleport the player into the room centre, let gating run
        const p = DD.game.players[0];
        p.x = (rm.rect.x + rm.rect.w / 2) * DD.TILE;
        p.y = (rm.rect.y + rm.rect.h / 2) * DD.TILE;
        await sleep(250);
        const locked = !!rm.locked;
        clearRoom(rm.id);
        await sleep(400);
        await dismissLevelUp();
        await sleep(200);
        out.push({ type: rm.type, id: rm.id, lockedOnEntry: locked, cleared: !!rm.cleared, stillLocked: !!rm.locked });
        if (DD.game.state !== "play") break;
      }
      await dismissLevelUp();
      out.push({ stairsReady: !!DD.game.stairsReady, state: DD.game.state });
      return out;
    });
    const bossRow = trace.find((t) => t.type === "boss");
    const last = trace[trace.length - 1];
    check("floor: boss room locked on entry and cleared", !!bossRow && bossRow.lockedOnEntry && bossRow.cleared && !bossRow.stillLocked,
      JSON.stringify(bossRow));
    check("floor: stairs revealed after boss", last.stairsReady === true, JSON.stringify(last));

    // walk onto the stairs -> descend to floor 2
    const descended = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const f0 = DD.game.floor;
      const st = DD.room.floorStairs;
      if (!st) return { ok: false, why: "no stairs" };
      const p = DD.game.players[0];
      for (let i = 0; i < 60 && DD.game.floor === f0 && DD.game.state !== "won"; i++) {
        if (DD.game.state === "levelup") {
          const card = document.querySelector("#upgrade-cards .upgrade-card");
          if (card) card.click();
        }
        p.x = (st.x + 0.5) * DD.TILE; p.y = (st.y + 0.5) * DD.TILE;
        await sleep(100);
      }
      return { ok: DD.game.floor > f0 || DD.game.state === "won", floor: DD.game.floor, state: DD.game.state };
    });
    check("floor: descend via stairs", descended.ok, JSON.stringify(descended));
    check("floor: no console errors", errs.length === 0, errs.join(" | "));
    check("floor: plan generated", plan.length > 0, plan.join(","));
  } catch (e) {
    check("floor: full run", false, String(e).slice(0, 400));
  }
  await page.close();
}

// ---- 4. town, lobby, world map, hub, menu ----
async function screens(browser) {
  const page = await browser.newPage();
  const errs = watch(page);
  try {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.DD && DD.render3d && DD.render3d.proto, null, { timeout: 45000 });
    await page.waitForTimeout(800);

    const menuState = await page.evaluate(() => DD.game.state);
    check("boot: lands on menu or hub", menuState === "menu" || menuState === "hub", menuState);

    // pick a class from the menu -> world map
    await page.evaluate(() => {
      document.querySelectorAll("#class-cards .class-card")[0].click();
    });
    await page.waitForTimeout(400);
    check("menu: class card -> world map", (await page.evaluate(() => DD.game.state)) === "map");

    // world map draws and its hub button works
    const mapOk = await page.evaluate(() => {
      const c = document.getElementById("game");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let nonBlack = 0;
      for (let i = 0; i < d.length; i += 4000) if (d[i] > 30 || d[i + 1] > 30 || d[i + 2] > 30) nonBlack++;
      return nonBlack;
    });
    check("map: renders content", mapOk > 5, `non-dark samples=${mapOk}`);

    // travel to town
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // showTownRoom has a 25% raid chance; retry until we land in town
      for (let i = 0; i < 20 && DD.game.state !== "town"; i++) {
        DD.__test_showTown ? DD.__test_showTown() : null;
        if (DD.game.state !== "town") {
          // click the town location on the map
          const c = document.getElementById("game");
          const r = c.getBoundingClientRect();
          const wx = 0.50 * DD.WIDTH, wy = 0.46 * DD.HEIGHT;
          const cx = wx * DD.view.scale + DD.view.ox, cy = wy * DD.view.scale + DD.view.oy;
          c.dispatchEvent(new MouseEvent("click", {
            clientX: r.left + cx * (r.width / c.width), clientY: r.top + cy * (r.height / c.height), bubbles: true,
          }));
        }
        await sleep(250);
        if (DD.game.state === "raid-warn") {
          document.getElementById("btn-flee").click();
          await sleep(250);
        }
      }
      return DD.game.state;
    });
    await page.waitForTimeout(600);
    const town = await page.evaluate(() => ({ state: DD.game.state, npcs: DD.game.townNpcs.length, isTown: !!DD.room.isTown }));
    check("town: reachable with NPCs", town.state === "town" && town.npcs === 4, JSON.stringify(town));

    // NPC overlays open and close
    const npcs = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      for (const npc of DD.game.townNpcs) {
        if (npc.id === "innkeeper") continue; // switches to the class-select screen
        npc.interact();
        await sleep(150);
        out[npc.id] = DD.game.state;
        const btn = { barkeep: "btn-stats-close", trader: "btn-trader-close", questgiver: "btn-quest-close" }[npc.id];
        if (btn) document.getElementById(btn).click();
        await sleep(150);
      }
      out.after = DD.game.state;
      return out;
    });
    check("town: NPC overlays open/close",
      npcs.barkeep === "stats" && npcs.trader === "trader" && npcs.questgiver === "quests" && npcs.after === "town",
      JSON.stringify(npcs));

    // lobby
    const lobby = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      DD.game.state = "map";
      const c = document.getElementById("game");
      const r = c.getBoundingClientRect();
      const wx = 0.22 * DD.WIDTH, wy = 0.27 * DD.HEIGHT; // catacombs
      const cx = wx * DD.view.scale + DD.view.ox, cy = wy * DD.view.scale + DD.view.oy;
      c.dispatchEvent(new MouseEvent("click", {
        clientX: r.left + cx * (r.width / c.width), clientY: r.top + cy * (r.height / c.height), bubbles: true,
      }));
      await sleep(500);
      return { state: DD.game.state, pads: (DD.room.tierPads || []).length, dungeon: DD.game.lobbyDungeonId };
    });
    check("lobby: reachable with 3 tier pads", lobby.state === "lobby" && lobby.pads === 3 && lobby.dungeon === "catacombs", JSON.stringify(lobby));

    // hub
    const hub = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // -> map
      await sleep(200);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // -> hub
      await sleep(300);
      return {
        state: DD.game.state,
        visible: !document.getElementById("hub").classList.contains("hidden"),
        name: document.getElementById("hub-hero-name").textContent,
      };
    });
    check("hub: reachable and populated", hub.state === "hub" && hub.visible && /Lv \d/.test(hub.name), JSON.stringify(hub));

    // inventory
    const inv = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      document.getElementById("btn-hub-inventory").click();
      await sleep(200);
      const open = DD.game.state === "inventory" && !document.getElementById("inventory").classList.contains("hidden");
      document.getElementById("btn-inv-close").click();
      await sleep(200);
      return { open, after: DD.game.state };
    });
    check("inventory: open/close", inv.open && inv.after === "hub", JSON.stringify(inv));
    check("screens: no console errors", errs.length === 0, errs.join(" | "));
  } catch (e) {
    check("screens", false, String(e).slice(0, 400));
  }
  await page.close();
}

// ---- 5. WebGL context loss / restore ----
async function contextLoss(browser) {
  const page = await browser.newPage();
  const errs = watch(page);
  try {
    await boot(page, "/?dev=combat&class=mage&cam=fixed");
    const lost = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const gl = DD.render3d.renderer.getContext();
      const ext = gl.getExtension("WEBGL_lose_context");
      if (!ext) return { skip: true };
      window.__ext = ext;
      ext.loseContext();
      await sleep(600);
      return {
        contextLost: gl.isContextLost(),
        flag: DD.render3d.contextLost === true,
        overlayVisible: !document.getElementById("webgl-lost").classList.contains("hidden"),
        state: DD.game.state,
      };
    });
    if (lost.skip) { check("ctx loss: WEBGL_lose_context available", false, "extension missing"); }
    else {
      check("ctx loss: renderer flags lost context", lost.flag === true, JSON.stringify(lost));
      check("ctx loss: no uncaught errors during loss", errs.length === 0, errs.join(" | "));
      check("ctx loss: reload overlay shown", lost.overlayVisible === true, JSON.stringify(lost));
      // simulation must be frozen: game.time and hero HP unchanged over a second
      const frozen = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const a = { t: DD.game.time, hp: DD.game.players[0].hp, kills: DD.game.kills, gold: DD.game.gold };
        await sleep(1200);
        const b = { t: DD.game.time, hp: DD.game.players[0].hp, kills: DD.game.kills, gold: DD.game.gold };
        return { a, b, same: JSON.stringify(a) === JSON.stringify(b) };
      });
      check("ctx loss: simulation frozen", frozen.same, JSON.stringify(frozen));
      // frozen must mean "update() returns early", NOT "the rAF loop died" —
      // a dead loop is the permanent half of the original soft-lock
      const alive = await page.evaluate(() => new Promise((res) => {
        let n = 0;
        const tick = () => { if (++n < 3) requestAnimationFrame(tick); else res(n); };
        requestAnimationFrame(tick);
        setTimeout(() => res(n), 1000);
      }));
      check("ctx loss: rAF loop still alive", alive >= 3, `frames=${alive}`);
      // restore fires but we deliberately stay in the reload-prompt state
      const restored = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        window.__ext.restoreContext();
        await sleep(1500);
        return {
          stillFlagged: DD.render3d.contextLost === true,
          overlayVisible: !document.getElementById("webgl-lost").classList.contains("hidden"),
          reloadBtn: !!document.getElementById("btn-webgl-reload"),
        };
      });
      check("ctx restore: stays in reload-prompt state (by design)",
        restored.stillFlagged && restored.overlayVisible && restored.reloadBtn, JSON.stringify(restored));
      check("ctx restore: no uncaught errors", errs.length === 0, errs.join(" | "));
    }
  } catch (e) {
    check("ctx loss", false, String(e).slice(0, 400));
  }
  await page.close();
}

// ---- 6. production flag gating ----
async function flagGating(browser) {
  const page = await browser.newPage();
  try {
    await boot(page, "/?dev=combat&safe=1&class=warrior");
    const dev = await page.evaluate(() => ({ safe: DD.__debug && DD.__debug.safeMode, allowed: DD.__debug && DD.__debug.devFlagsAllowed }));
    check("flags: dev flags honoured on localhost", dev.allowed === true && dev.safe === true, JSON.stringify(dev));
  } catch (e) {
    check("flags: dev flags on localhost", false, String(e).slice(0, 300));
  }
  await page.close();
}

// ---- 7. flows the split moved across module boundaries ----
async function deepFlows(browser) {
  const page = await browser.newPage();
  const errs = watch(page);
  try {
    await boot(page, "/?floors&class=warrior&dungeon=catacombs");

    // resize while in a run must not throw (the handler moved to draw.js and is
    // registered from boot.js)
    await page.setViewportSize({ width: 900, height: 1200 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);
    check("resize: mid-run resize survives", (await page.evaluate(() => DD.game.state)) === "play");

    // die -> result screen -> Play Again restarts a run
    const died = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const p = DD.game.players[0];
      p.damage(99999, p.x, p.y, DD.game);
      for (let i = 0; i < 60 && DD.game.state !== "lost"; i++) await sleep(100);
      for (let i = 0; i < 40 && document.getElementById("result").classList.contains("hidden"); i++) await sleep(100);
      return { state: DD.game.state, resultShown: !document.getElementById("result").classList.contains("hidden") };
    });
    check("death: result screen appears", died.state === "lost" && died.resultShown, JSON.stringify(died));

    const again = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      document.getElementById("btn-again").click();
      await sleep(800);
      return { state: DD.game.state, alive: DD.game.players[0].alive(), floor: DD.game.floor };
    });
    check("result: Play Again starts a fresh run", again.state === "play" && again.alive, JSON.stringify(again));

    // raid: build one directly and fight back
    const raid = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      DD.game.state = "town";
      DD.game.raidFaction = "goblin";
      document.getElementById("raid-warning").classList.remove("hidden");
      document.getElementById("btn-fight-back").click();
      await sleep(1200);
      return {
        state: DD.game.state, dungeon: DD.game.dungeonId, raidMode: !!DD.game.raidMode,
        enemies: DD.game.skeletons.length + DD.game.spawnQueue.length,
      };
    });
    check("raid: fight back starts the raid run",
      raid.state === "play" && raid.dungeon === "townRaid" && raid.raidMode && raid.enemies > 0,
      JSON.stringify(raid));

    // finale: champion-only capstone
    const finale = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      DD.game.hero.victory = true;
      DD.game.state = "map";
      const c = document.getElementById("game");
      const r = c.getBoundingClientRect();
      const wx = 0.74 * DD.WIDTH, wy = 0.74 * DD.HEIGHT;
      const cx = wx * DD.view.scale + DD.view.ox, cy = wy * DD.view.scale + DD.view.oy;
      c.dispatchEvent(new MouseEvent("click", {
        clientX: r.left + cx * (r.width / c.width), clientY: r.top + cy * (r.height / c.height), bubbles: true,
      }));
      await sleep(1200);
      return { state: DD.game.state, dungeon: DD.game.dungeonId, enemies: DD.game.skeletons.length + DD.game.spawnQueue.length };
    });
    check("finale: The Last Stand is reachable and populated",
      finale.state === "play" && finale.dungeon === "finale" && finale.enemies > 0, JSON.stringify(finale));
    check("deep flows: no console errors", errs.length === 0, errs.join(" | "));
  } catch (e) {
    check("deep flows", false, String(e).slice(0, 400));
  }
  await page.close();
}

// ---- 8. mid-run save survives a reload (Continue) ----
async function saveResume(browser) {
  const page = await browser.newPage();
  const errs = watch(page);
  try {
    await boot(page, "/?floors&class=mage&dungeon=crypt");
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const dismiss = () => {
        if (DD.game.state !== "levelup") return;
        const card = document.querySelector("#upgrade-cards .upgrade-card");
        if (card) card.click();
      };
      // The stairs only reveal when the *locked* boss chamber clears, so the
      // player has to actually enter each room — killing everything from
      // outside never sets game.activeRoomId and the descent never arms.
      for (const rm of DD.room.rooms) {
        dismiss();
        const p = DD.game.players[0];
        p.x = (rm.rect.x + rm.rect.w / 2) * DD.TILE;
        p.y = (rm.rect.y + rm.rect.h / 2) * DD.TILE;
        await sleep(250);
        DD.game.spawnQueue.length = 0;
        for (const s of DD.game.skeletons) {
          if (s.roomId !== rm.id || s.dead || s.dying) continue;
          s.frozen = false; s.state = "chase"; s.damage(999999, s.x, s.y, DD.game);
        }
        await sleep(400);
        dismiss();
      }
      for (let i = 0; i < 40 && DD.game.floor === 0; i++) {
        dismiss();
        const st = DD.room.floorStairs;
        if (st) { DD.game.players[0].x = (st.x + 0.5) * DD.TILE; DD.game.players[0].y = (st.y + 0.5) * DD.TILE; }
        await sleep(150);
      }
      return DD.game.floor;
    });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dungeondash_save_v1") || "null"));
    // reachStairs() writes the checkpoint before game.floor++, so the saved
    // floor is the one just cleared - resuming replays it. Pre-existing.
    check("save: checkpoint written at the stairs",
      !!saved && saved.classKey === "mage" && saved.floorMode === true && typeof saved.floor === "number",
      JSON.stringify(saved && { floor: saved.floor, cls: saved.classKey, mode: saved.floorMode }));

    // reload and resume through the Continue button
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.DD && DD.render3d && DD.render3d.proto, null, { timeout: 45000 });
    await page.waitForTimeout(800);
    const resumed = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const btn = document.getElementById("btn-hub-continue").classList.contains("hidden")
        ? document.getElementById("btn-continue") : document.getElementById("btn-hub-continue");
      const shown = !btn.classList.contains("hidden");
      btn.click();
      await sleep(2500);
      return { shown, state: DD.game.state, floor: DD.game.floor, cls: DD.game.players[0] && DD.game.players[0].classKey };
    });
    check("save: Continue resumes the run",
      resumed.shown && resumed.state === "play" && resumed.cls === "mage",
      JSON.stringify(resumed));
    check("save/resume: no console errors", errs.length === 0, errs.join(" | "));
  } catch (e) {
    check("save/resume", false, String(e).slice(0, 400));
  }
  await page.close();
}

// ---- 9. the dev-flag gate closes on the production hostname ----
// Same local server, but DNS-mapped so the page believes it is served from the
// real GitHub Pages host - which is what env.js's allowlist keys off.
async function flagGatingProd() {
  const prodBrowser = await chromium.launch({
    ...LAUNCH,
    args: [...LAUNCH.args, "--host-resolver-rules=MAP graemeishere.github.io 127.0.0.1"],
  });
  const page = await prodBrowser.newPage();
  const warns = [];
  page.on("console", (m) => { if (m.type() === "warning") warns.push(m.text()); });
  try {
    await page.goto("http://graemeishere.github.io:8123/?dev=combat&safe=1&class=warrior",
      { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.DD && window.DD.__debug, null, { timeout: 45000 });
    await page.waitForTimeout(3500);
    const r = await page.evaluate(() => ({
      host: location.hostname,
      allowed: DD.__debug.devFlagsAllowed,
      safe: DD.__debug.safeMode,
      state: DD.game.state,
    }));
    check("flags: ?safe/?dev refused on the production host",
      r.allowed === false && r.safe === false && r.state !== "play", JSON.stringify(r));
    check("flags: refusal is explained in the console",
      warns.filter((w) => /ignored/.test(w)).length >= 2, warns.join(" | "));
  } catch (e) {
    check("flags: production host gate", false, String(e).slice(0, 300));
  }
  await page.close();
  await prodBrowser.close();
}

const browser = await chromium.launch(LAUNCH);
await classDungeonMatrix(browser);
await playCombat(browser);
await fullFloor(browser);
await screens(browser);
await contextLoss(browser);
await deepFlows(browser);
await saveResume(browser);
await flagGating(browser);
await flagGatingProd();
await browser.close();

console.log("\n================ SUMMARY ================");
for (const r of results) console.log(r);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
