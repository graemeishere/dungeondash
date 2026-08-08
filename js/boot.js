"use strict";
// Composition root. index.html loads this one module; the import graph below is
// the load order, declared by the files themselves rather than by <script> tag
// position in the HTML.
//
// This is deliberately the ONLY module that runs code at import time. Several
// of the modules below import each other in cycles (a run ends -> the world map
// shows -> the town opens -> a run starts), which native ES modules resolve
// fine via live bindings as long as no module *calls* a sibling's export while
// that sibling is still evaluating. Keeping every top-level call here - the DOM
// wiring and the boot sequence - is what guarantees that: by the time this file
// body runs, every import has finished evaluating.

import { rt } from "./runtime.js?v=__BUILD__";
import { devFlagsAllowed, safeMode } from "./env.js?v=__BUILD__";
import { params, devBoot, floorsBoot } from "./env.js?v=__BUILD__";
import { canvas, continueBtn, hubEl, menuEl, resultEl } from "./dom.js?v=__BUILD__";
import { sprites } from "./sprites.js?v=__BUILD__";
import { audio } from "./audio.js?v=__BUILD__";
import { input } from "./input.js?v=__BUILD__";
import { net } from "./net.js?v=__BUILD__";
import { room } from "./room.js?v=__BUILD__";
import { particles } from "./particles.js?v=__BUILD__";
import { profile } from "./profile.js?v=__BUILD__";
import { game3d } from "./game3d.js?v=__BUILD__";
import { CLASSES, Boss } from "./entities.js?v=__BUILD__";
import { TILE, WIDTH, HEIGHT, view } from "./util.js?v=__BUILD__";
import { game, uiFlags, DUNGEONS, usableSave } from "./state.js?v=__BUILD__";
import { startFloorRun, resumeRun } from "./run.js?v=__BUILD__";
import {
  backToMenu, buildClassCards, closeInventory, openInventory, playAgain,
  refreshContinueButton, setMenuMode, showHub,
} from "./overlays.js?v=__BUILD__";
import {
  closeQuestGiverOverlay, closeStatsOverlay, closeTraderOverlay, handleTownTap,
  showTownRoom, startRaid,
} from "./town.js?v=__BUILD__";
import { handleMapTap, showMap } from "./worldmap.js?v=__BUILD__";
import { hostWithClass, joinWithClass, tryJoin } from "./coop.js?v=__BUILD__";
import { codeIn } from "./overlays.js?v=__BUILD__";
import { fitCanvas, onResize, startLoop } from "./draw.js?v=__BUILD__";

document.getElementById("btn-inv-close").addEventListener("click", closeInventory);

// ---- onboarding (one-time, shown on a player's first-ever class pick) ----

document.getElementById("ob-line1").textContent =
  "Fight through dungeon rooms, grab loot, and reach the stairs.";
document.getElementById("ob-line2").textContent =
  "Back in Town, spend gold with the Barkeep, Trader, and Quest Giver.";
document.getElementById("ob-line3").textContent =
  "The World Map is home base — pick a dungeon, or head back to Town.";
document.getElementById("ob-line4").textContent =
  "Town isn't always safe — raids happen. Fight back, or flee to the map.";

document.getElementById("btn-onboarding-done").addEventListener("click", () => {
  profile.setOnboarded();
  document.getElementById("onboarding").classList.add("hidden");
  showMap();
});

// ---- settings (volume) ----
// Four sliders per docs/design/audio-spec.md §4.1: Master, SFX, Music,
// Ambience. Master keeps its legacy home in profile.data.settings.volume;
// the other three live in the audio module's own persisted settings
// (localStorage "dd-audio-settings", written by each set*Volume call).

function openSettings() {
  document.getElementById("settings-volume").value = Math.round((profile.data.settings.volume ?? 0.8) * 100);
  document.getElementById("settings-sfx").value = Math.round(audio.getSfxVolume() * 100);
  document.getElementById("settings-music").value = Math.round(audio.getMusicVolume() * 100);
  document.getElementById("settings-ambience").value = Math.round(audio.getAmbienceVolume() * 100);
  document.getElementById("settings").classList.remove("hidden");
}
document.getElementById("btn-menu-settings").addEventListener("click", openSettings);
document.getElementById("btn-hub-settings").addEventListener("click", openSettings);
document.getElementById("btn-settings-close").addEventListener("click", () => {
  document.getElementById("settings").classList.add("hidden");
});
document.getElementById("settings-volume").addEventListener("input", (e) => {
  const v = Number(e.target.value) / 100;
  audio.setMasterVolume(v);
  profile.data.settings.volume = v;
  profile.save();
});
document.getElementById("settings-sfx").addEventListener("input", (e) => {
  audio.setSfxVolume(Number(e.target.value) / 100);
});
document.getElementById("settings-music").addEventListener("input", (e) => {
  audio.setMusicVolume(Number(e.target.value) / 100);
});
document.getElementById("settings-ambience").addEventListener("input", (e) => {
  audio.setAmbienceVolume(Number(e.target.value) / 100);
});

// ---- menu hover / confirm / back cues ----
// The audio spec calls these the quietest, most-frequent cues in the roster,
// so they're deliberately sparse: hover fires once per pointer entry into any
// enabled button/card; confirm only on buttons that commit to something
// (start/resume a run, accept, fight); back only on close/cancel-flavored
// buttons. Plain "open a panel" clicks stay silent, and buttons with their
// own richer cue (Buy/Sell -> purchase(), equip/unequip) are not listed.
const MENU_CONFIRM_IDS = new Set([
  "btn-onboarding-done", "btn-again", "btn-continue", "btn-hub-continue",
  "btn-descend", "btn-fight-back", "btn-accept",
  "btn-host", "btn-join", "btn-hub-host", "btn-hub-join",
]);
const MENU_BACK_IDS = new Set([
  "btn-settings-close", "btn-stats-close", "btn-trader-close",
  "btn-quest-close", "btn-inv-close", "btn-lobby-back", "btn-flee",
]);
document.addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest("button, .class-card");
  if (!el || el.disabled) return;
  if (MENU_CONFIRM_IDS.has(el.id)) audio.menuConfirm();
  else if (MENU_BACK_IDS.has(el.id)) audio.menuBack();
  // picking a class commits to it (starts a run / switches class); the
  // level-up cards are excluded — mid-combat, and the levelup jingle already
  // owns that moment
  else if (el.classList.contains("class-card") && !el.classList.contains("upgrade-card")) audio.menuConfirm();
});
// Hover cue via delegation: pointerenter doesn't bubble, so track the last
// hovered control through pointerover/pointerout instead. Touch never hovers.
let hoveredMenuEl = null;
document.addEventListener("pointerover", (e) => {
  if (e.pointerType === "touch") return;
  const el = e.target.closest && e.target.closest("button, .class-card");
  if (!el || el.disabled || el === hoveredMenuEl) return;
  hoveredMenuEl = el;
  audio.menuHover();
});
document.addEventListener("pointerout", (e) => {
  if (hoveredMenuEl && !hoveredMenuEl.contains(e.relatedTarget)) hoveredMenuEl = null;
});


document.getElementById("btn-host").addEventListener("click", () => {
  audio.unlock();
  setMenuMode("host-pick", "HOSTING CO-OP — pick your class to create an invite code");
});
document.getElementById("btn-join").addEventListener("click", () => {
  audio.unlock();
  setMenuMode("join-pick", "JOINING CO-OP — pick your class first");
});
document.getElementById("btn-lobby-back").addEventListener("click", () => {
  net.reset();
  backToMenu();
});

document.getElementById("btn-accept").addEventListener("click", tryJoin);
codeIn.addEventListener("keydown", (e) => { if (e.key === "Enter") tryJoin(); });


document.getElementById("btn-again").addEventListener("click", playAgain);
document.getElementById("btn-class").addEventListener("click", () => {
  if (net.role) net.reset();
  if (game.hero) showMap(); else backToMenu();
});
continueBtn.addEventListener("click", () => {
  const save = usableSave();
  if (save) { audio.unlock(); resumeRun(save); }
});
window.addEventListener("keydown", (e) => {
  // Settings/onboarding are transient modals layered over whatever screen is
  // behind them, not part of the game.state machine — guard them first so
  // Escape can't fall through to a state-changing branch while they're the
  // visibly topmost thing on screen.
  if (e.key === "Escape") {
    const settingsEl = document.getElementById("settings");
    if (!settingsEl.classList.contains("hidden")) { settingsEl.classList.add("hidden"); return; }
    if (!document.getElementById("onboarding").classList.contains("hidden")) return;
  }
  if (e.key === "i" || e.key === "I") {
    if (game.state === "play" || game.state === "hub") { openInventory(); return; }
    if (game.state === "inventory") { closeInventory(); return; }
  }
  if (game.state === "inventory" && e.key === "Escape") { closeInventory(); return; }
  if (game.state === "stats" && e.key === "Escape") { closeStatsOverlay(); return; }
  if (game.state === "trader" && e.key === "Escape") { closeTraderOverlay(); return; }
  if (game.state === "quests" && e.key === "Escape") { closeQuestGiverOverlay(); return; }
  if ((game.state === "town" || game.state === "lobby") && e.key === "Escape") { showMap(); return; }
  if (game.state === "raid-warn" && e.key === "Escape") { document.getElementById("raid-warning").classList.add("hidden"); showMap(); return; }
  if (game.state === "menu" && uiFlags.townSwitchClass && e.key === "Escape") { uiFlags.townSwitchClass = false; showTownRoom(true); return; }
  if (game.state === "map" && e.key === "Escape") { if (game.hero) showHub(game.hero); else backToMenu(); return; }
  if (game.state === "levelup" && ["1", "2", "3"].includes(e.key)) {
    const up = game.levelUpPicks[Number(e.key) - 1];
    if (up && game.lvlOnPick) game.lvlOnPick(up);
    return;
  }
  if (resultEl.classList.contains("hidden")) return;
  if (e.key === "Enter") { playAgain(); }
  if (e.key === "Escape") { if (net.role) net.reset(); if (game.hero) showMap(); else backToMenu(); }
});


canvas.addEventListener("click", (e) => {
  if (handleMapTap(e.clientX, e.clientY, canvas)) return;
  handleTownTap(e.clientX, e.clientY, canvas);
});

// touchstart in input.js calls preventDefault(), which swallows the click event
// on mobile — so we handle map/town taps via touchend directly.
canvas.addEventListener("touchend", (e) => {
  if (game.state !== "map" && game.state !== "town") return;
  const t = e.changedTouches[0];
  if (!t) return;
  if (handleMapTap(t.clientX, t.clientY, canvas) || handleTownTap(t.clientX, t.clientY, canvas)) {
    e.preventDefault();
  }
}, { passive: false });


// ---- hub buttons ----

document.getElementById("btn-descend").addEventListener("click", () => {
  audio.unlock();
  if (game.hero) showMap();
});

document.getElementById("btn-switch-class").addEventListener("click", () => {
  audio.unlock();
  hubEl.classList.add("hidden");
  menuEl.classList.remove("hidden");
  refreshContinueButton();
  setMenuMode(null, "");
  game.state = "menu";
});

document.getElementById("btn-hub-continue").addEventListener("click", () => {
  const sv = usableSave();
  if (sv) { audio.unlock(); resumeRun(sv); }
});

document.getElementById("btn-hub-host").addEventListener("click", () => {
  audio.unlock();
  if (game.hero) {
    game.classKey = game.hero.classKey;
    hostWithClass(game.hero.classKey);
  }
});

document.getElementById("btn-hub-join").addEventListener("click", () => {
  audio.unlock();
  if (game.hero) joinWithClass(game.hero.classKey);
});

document.getElementById("btn-hub-inventory").addEventListener("click", () => {
  audio.unlock();
  openInventory();
});

// ---- stats overlay + raid buttons ----

document.getElementById("btn-stats-close").addEventListener("click", closeStatsOverlay);
document.getElementById("btn-trader-close").addEventListener("click", closeTraderOverlay);
document.getElementById("btn-quest-close").addEventListener("click", closeQuestGiverOverlay);

document.getElementById("btn-fight-back").addEventListener("click", () => {
  audio.unlock();
  startRaid();
});

document.getElementById("btn-flee").addEventListener("click", () => {
  document.getElementById("raid-warning").classList.add("hidden");
  showMap();
});


// ---- boot ----

sprites.init();
fitCanvas();
input.init(canvas);
buildClassCards();
audio.setMasterVolume(profile.data.settings.volume ?? 0.8);
// Menu/hub share one music context (see js/audio.js's MUSIC_TRACKS map — the
// design spec only defines 5 contexts: menu, town, catacombs, goblinMines,
// crypt; the hub screen is menu-adjacent chrome, not the walkable town).
audio.setContext("menu");
const _bootHero = profile.getActiveHero();
if (_bootHero) {
  game.hero = _bootHero;
  game.classKey = _bootHero.classKey;
  // Land on the hub, not the world map: the hub is the home base with
  // Host/Join Co-op, gear and Choose Dungeon. Booting to the map hid co-op
  // behind the Esc key (desktop only), leaving mobile players with no way in.
  showHub(_bootHero);
} else {
  refreshContinueButton();
}

// Dev shortcut for verifying the 3D path: ?dev=combat jumps straight into a
// run (skips menus). Not wired to any UI. Phase 1 retired the classic
// single-room path this used to boot into; it now boots the same connected
// floor a normal run would (equivalent to ?floors, kept as its own flag for
// existing bookmarks/scripts).
if (devBoot === "combat") {
  document.querySelectorAll(".overlay").forEach((el) => el.classList.add("hidden"));
  const cls = params.get("class"); // ?class=mage|ranger|rogue|warrior
  // ?dungeon=crypt (warlocks/necromancers) | goblinMines (shamans) | catacombs
  const dng = params.get("dungeon");
  startFloorRun(CLASSES[cls] ? cls : "warrior", DUNGEONS[dng] ? dng : "catacombs", 0);
}

// ?floors boots a connected-floor run with per-room combat gating + descent.
if (floorsBoot) {
  const cls = CLASSES[params.get("class")] ? params.get("class") : "warrior";
  const dng = DUNGEONS[params.get("dungeon")] ? params.get("dungeon") : "catacombs";
  const boot = () => {
    document.querySelectorAll(".overlay").forEach((el) => el.classList.add("hidden"));
    startFloorRun(cls, dng, 0);
  };
  // A direct ?floors link boots straight into a floor, skipping the menus that
  // normally cover the character preload — so hold on the menu until the
  // player's 3D model is ready, then reveal the floor already-3D instead of
  // flashing a 2D billboard. Capped so a slow/failed load can't hang the boot.
  const mk = "class:" + cls;
  const ready = () => rt.charMgr && rt.charMgr.factory && rt.charMgr.factory.spawnable(mk);
  if (ready()) boot();
  else {
    const t0 = performance.now();
    const iv = setInterval(() => {
      if (ready() || performance.now() - t0 > 6000) { clearInterval(iv); boot(); }
    }, 60);
  }
}

window.addEventListener("resize", onResize);

// ---- debug surface -------------------------------------------------------
//
// NOT how the game talks to itself - every module above uses imports. This is a
// deliberate, narrow handle for Playwright: dev/room-checks.mjs and
// .claude/skills/verify/SKILL.md drive the live game through window.DD, and the
// phase's acceptance bar is "drive it headless per SKILL.md".
//
// Adding to this list is a reviewed decision, made when a dev script needs it.
// If a first-party module ever reaches for window.DD, that module is the bug.
// The 3D handles stay getters so they reflect boot3d.js's staged loading.
window.DD = {
  game, room, net, particles, game3d, input, sprites, profile, audio, TILE,
  Boss,   // room-checks does `instanceof DD.Boss`
  view,   // letterbox transform: world coords -> canvas px, for driving taps
  // env.js's dev-flag gate, so a headless check can assert on it directly
  __debug: { devFlagsAllowed, safeMode },
  get WIDTH() { return WIDTH; },
  get HEIGHT() { return HEIGHT; },
  get render3d() { return rt.render3d; },
  get charMgr() { return rt.charMgr; },
  get char3d() { return rt.char3d; },
  get fx3d() { return rt.fx3d; },
};

startLoop();
