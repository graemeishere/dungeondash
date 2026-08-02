"use strict";
// Every DOM overlay: the hero hub, the barkeep sheet, the level-up picker, the
// inventory, the class-select cards and the co-op lobby panel.

import { audio } from "./audio.js?v=__BUILD__";
import { CLASSES, Player, UPGRADES } from "./entities.js?v=__BUILD__";
import { input } from "./input.js?v=__BUILD__";
import { ITEM_RARITY, compareItems, equip, itemStatLines, unequip } from "./items.js?v=__BUILD__";
import { net } from "./net.js?v=__BUILD__";
import { particles } from "./particles.js?v=__BUILD__";
import { profile } from "./profile.js?v=__BUILD__";
import { room } from "./room.js?v=__BUILD__";
import { sprites } from "./sprites.js?v=__BUILD__";
import { ATTRS, deriveStats } from "./stats.js?v=__BUILD__";
import { HEIGHT, TILE, WIDTH } from "./util.js?v=__BUILD__";
import { menuEl, resultEl, levelupEl, upgradeCardsEl, continueBtn, hubEl } from "./dom.js?v=__BUILD__";
import { game, DUNGEONS, uiFlags, usableSave } from "./state.js?v=__BUILD__";
import { beginRun, resumeRun } from "./run.js?v=__BUILD__";
import { showMap } from "./worldmap.js?v=__BUILD__";
import { showTownRoom, switchClass } from "./town.js?v=__BUILD__";
import { hostWithClass, joinWithClass } from "./coop.js?v=__BUILD__";

export function refreshContinueButton() {
  const save = usableSave();
  if (save && CLASSES[save.classKey]) {
    const dungeonName = save.dungeonId && DUNGEONS[save.dungeonId] ? DUNGEONS[save.dungeonId].name : "Dungeon";
    continueBtn.textContent =
      `Continue — ${dungeonName} Fl.${save.floor + 1}, ${CLASSES[save.classKey].name} Lv ${save.level}`;
    continueBtn.classList.remove("hidden");
  } else {
    continueBtn.classList.add("hidden");
  }
}

// ---- hero hub ----

const ATTR_LABELS = { might: "Might", agility: "Agility", focus: "Focus", vitality: "Vitality" };
const ATTR_DESCS  = { might: "DMG +0.5", agility: "SPD +5", focus: "Range +2", vitality: "HP +1.5" };

export function buildHub(hero) {
  const cls = CLASSES[hero.classKey];
  document.getElementById("hub-portrait").src = sprites.players[hero.classKey][0].toDataURL();
  document.getElementById("hub-hero-name").textContent = `${cls.name} · Lv ${hero.level}`;
  document.getElementById("hub-hero-meta").textContent =
    `${hero.gold || 0} gold  •  ${hero.kills || 0} kills  •  ${hero.deaths || 0} deaths`;

  // XP bar
  const xpNext = 25 + (hero.level - 1) * 15;
  document.getElementById("hub-xp-fill").style.width = (Math.min(1, (hero.xp || 0) / xpNext) * 100) + "%";
  document.getElementById("hub-xp-label").textContent = `${hero.xp || 0} / ${xpNext} XP to next level`;

  // Derived stats
  const s = deriveStats(hero);
  const statsEl = document.getElementById("hub-stats");
  statsEl.innerHTML = [
    ["DMG",    s.dmg.toFixed(1)],
    ["SPD",    Math.round(s.speed)],
    ["MAX HP", Math.floor(s.hp)],
    s.range !== undefined ? ["RANGE", Math.round(s.range)] : null,
  ].filter(Boolean).map(([k, v]) =>
    `<div class="hub-stat-row"><span class="hub-stat-key">${k}</span><span class="hub-stat-val">${v}</span></div>`
  ).join("");

  // Attribute allocation
  const pts = hero.attrPoints || 0;
  const attrHdr = document.getElementById("hub-attr-hdr");
  attrHdr.textContent = pts > 0 ? `ATTRIBUTES  (${pts} to spend)` : "ATTRIBUTES";
  attrHdr.style.color = pts > 0 ? "#ffd95e" : "";
  const attrsEl = document.getElementById("hub-attrs");
  attrsEl.innerHTML = "";
  for (const attr of ATTRS) {
    const row = document.createElement("div");
    row.className = "hub-attr-row";
    const val = hero.attrs[attr] || 0;
    row.innerHTML =
      `<span class="hub-attr-name">${ATTR_LABELS[attr]}</span>` +
      `<span class="hub-attr-val">${val}</span>` +
      `<span class="hub-attr-desc">${ATTR_DESCS[attr]}</span>`;
    if (pts > 0) {
      const btn = document.createElement("button");
      btn.className = "hub-attr-btn";
      btn.textContent = "+";
      btn.onclick = () => {
        if ((hero.attrPoints || 0) <= 0) return;
        hero.attrPoints--;
        hero.attrs[attr] = (hero.attrs[attr] || 0) + 1;
        profile.save();
        buildHub(hero);
      };
      row.appendChild(btn);
    }
    attrsEl.appendChild(row);
  }

  // Equipment slots
  const equipEl = document.getElementById("hub-equip-slots");
  equipEl.innerHTML = "";
  for (const slot of ["weapon", "armor", "trinket"]) {
    const wrap = document.createElement("div");
    wrap.className = "inv-slot-wrap";
    const label = document.createElement("div");
    label.className = "inv-slot-label";
    label.textContent = slot.toUpperCase();
    const slotEl = document.createElement("div");
    const item = hero.equipped[slot];
    slotEl.className = item ? `inv-slot has-item rarity-${item.rarity}` : "inv-slot";
    if (item) {
      const img = document.createElement("img");
      img.src = sprites.items[item.icon].toDataURL();
      slotEl.appendChild(img);
      slotEl.title = item.name;
      slotEl.onmouseenter = (e) => showInvTooltip(e, hero, item, null);
      slotEl.onmouseleave = hideInvTooltip;
    }
    wrap.append(label, slotEl);
    equipEl.appendChild(wrap);
  }

  // Quest log
  const questsEl = document.getElementById("hub-quests");
  if (questsEl) {
    const active = profile.data.quests.active;
    if (active.length === 0) {
      questsEl.innerHTML = `<div class="hub-quest-row" style="color:#9b90b8">No active quests — visit the Quest Giver in town.</div>`;
    } else {
      questsEl.innerHTML = active.slice(0, 3).map((q) => {
        const def = profile.questDefs.find((d) => d.id === q.id);
        if (!def) return "";
        const prog = q.progress || {};
        const goal = def.goal;
        let bar = "";
        if (goal.kills) {
          const cur = Math.min(prog.kills || 0, goal.kills);
          const pct = Math.round(cur / goal.kills * 100);
          bar = `<div class="hub-quest-bar-bg"><div class="hub-quest-bar-fill" style="width:${pct}%"></div></div>`;
        }
        return `<div class="hub-quest-row">
          <div class="hub-quest-title">${def.title}</div>
          <div class="hub-quest-desc">${def.desc}${goal.kills ? ` (${Math.min(prog.kills || 0, goal.kills)}/${goal.kills})` : ""}</div>
          ${bar}
          <div class="hub-quest-reward">+${def.reward.gold}g on complete</div>
        </div>`;
      }).join("");
    }
  }

  // Continue button
  const hcBtn = document.getElementById("btn-hub-continue");
  const sv = usableSave();
  if (sv && CLASSES[sv.classKey]) {
    const svDungeonName = sv.dungeonId && DUNGEONS[sv.dungeonId] ? DUNGEONS[sv.dungeonId].name : "Dungeon";
    hcBtn.textContent = `Continue — ${svDungeonName} Fl.${sv.floor + 1}, ${CLASSES[sv.classKey].name} Lv ${sv.level}`;
    hcBtn.classList.remove("hidden");
  } else {
    hcBtn.classList.add("hidden");
  }
}

export function showHub(hero) {
  game.state = "hub";
  game.hero = hero;
  menuEl.classList.add("hidden");
  resultEl.classList.add("hidden");
  hubEl.classList.remove("hidden");
  buildHub(hero);
}

// Called when player picks a class from the class-select screen.
// Creates/switches the hero profile then goes to the world map (or, on a
// player's very first-ever class pick, the one-time onboarding screen first).
export function selectClass(classKey) {
  uiFlags.townSwitchClass = false;
  const hero = profile.getOrCreateHero(classKey);
  game.hero = hero;
  game.classKey = classKey;
  menuEl.classList.add("hidden");
  if (!profile.data.onboarded) {
    document.getElementById("onboarding").classList.remove("hidden");
  } else {
    showMap();
  }
}

// Spawn the local hero at the bottom-center of the current room.
export function spawnHeroInRoom() {
  const hero = game.hero || profile.getActiveHero();
  game.hero = hero;
  const classKey = (hero && hero.classKey) || game.classKey;
  const pl = new Player(classKey, WIDTH / 2, HEIGHT - TILE * 2.5, input, hero);
  game.players = [pl];
  game.localIndex = 0;
  input.setDashable(!!pl.cfg.dash);
  game.skeletons = [];
  game.projectiles = [];
  game.enemyShots = [];
  game.pickups = [];
  game.chests = [];
  game.spawnQueue = [];
  particles.clear();
}

export function hideAllOverlays() {
  hubEl.classList.add("hidden");
  resultEl.classList.add("hidden");
  menuEl.classList.add("hidden");
  document.getElementById("stats-overlay").classList.add("hidden");
  document.getElementById("raid-warning").classList.add("hidden");
  document.getElementById("trader").classList.add("hidden");
  document.getElementById("questgiver").classList.add("hidden");
}

// ---- barkeep stats overlay ----

export function buildStatsOverlay(hero) {
  const cls = CLASSES[hero.classKey];
  const titleEl = document.getElementById("so-title");
  if (titleEl) titleEl.textContent = `${cls.name} · Lv ${hero.level}`;

  const s = deriveStats(hero);
  document.getElementById("so-stats").innerHTML = [
    ["DMG",    s.dmg.toFixed(1)],
    ["SPD",    Math.round(s.speed)],
    ["MAX HP", Math.floor(s.hp)],
    s.range !== undefined ? ["RANGE", Math.round(s.range)] : null,
  ].filter(Boolean).map(([k, v]) =>
    `<div class="hub-stat-row"><span class="hub-stat-key">${k}</span><span class="hub-stat-val">${v}</span></div>`
  ).join("");

  const pts = hero.attrPoints || 0;
  const attrsEl = document.getElementById("so-attrs");
  attrsEl.innerHTML = `<div class="inv-slot-label" style="color:${pts > 0 ? "#ffd95e" : ""}">ATTRIBUTES${pts > 0 ? ` (${pts} to spend)` : ""}</div>`;
  for (const attr of ATTRS) {
    const row = document.createElement("div");
    row.className = "hub-attr-row";
    row.innerHTML =
      `<span class="hub-attr-name">${ATTR_LABELS[attr]}</span>` +
      `<span class="hub-attr-val">${hero.attrs[attr] || 0}</span>` +
      `<span class="hub-attr-desc">${ATTR_DESCS[attr]}</span>`;
    if (pts > 0) {
      const btn = document.createElement("button");
      btn.className = "hub-attr-btn";
      btn.textContent = "+";
      btn.onclick = () => {
        if ((hero.attrPoints || 0) <= 0) return;
        hero.attrPoints--;
        hero.attrs[attr] = (hero.attrs[attr] || 0) + 1;
        profile.save();
        buildStatsOverlay(hero);
      };
      row.appendChild(btn);
    }
    attrsEl.appendChild(row);
  }

  // equipment (click to unequip)
  const equipEl = document.getElementById("so-equip");
  equipEl.innerHTML = "";
  for (const slot of ["weapon", "armor", "trinket"]) {
    const wrap = document.createElement("div");
    wrap.className = "inv-slot-wrap";
    const label = document.createElement("div");
    label.className = "inv-slot-label";
    label.textContent = slot.toUpperCase();
    const slotEl = document.createElement("div");
    const item = hero.equipped[slot];
    slotEl.className = item ? `inv-slot has-item rarity-${item.rarity}` : "inv-slot";
    if (item) {
      const img = document.createElement("img");
      img.src = sprites.items[item.icon].toDataURL();
      slotEl.appendChild(img);
      slotEl.onclick = () => { unequip(hero, slot); profile.save(); buildStatsOverlay(hero); };
      slotEl.onmouseenter = (e) => showInvTooltip(e, hero, item, null);
      slotEl.onmouseleave = hideInvTooltip;
    }
    wrap.append(label, slotEl);
    equipEl.appendChild(wrap);
  }

  // inventory grid (click to equip)
  const grid = document.getElementById("so-inv-grid");
  grid.innerHTML = "";
  if (hero.inventory.length === 0) {
    const p = document.createElement("p");
    p.className = "inv-empty";
    p.textContent = "No items yet — defeat enemies to find gear!";
    grid.appendChild(p);
  } else {
    for (const item of hero.inventory) {
      const cell = document.createElement("div");
      cell.className = `inv-item rarity-${item.rarity}`;
      const img = document.createElement("img");
      img.src = sprites.items[item.icon].toDataURL();
      cell.appendChild(img);
      cell.onclick = () => { equip(hero, item); profile.save(); buildStatsOverlay(hero); };
      cell.onmouseenter = (e) => showInvTooltip(e, hero, item, hero.equipped[item.slot]);
      cell.onmouseleave = hideInvTooltip;
      grid.appendChild(cell);
    }
  }
}

export function backToMenu() {
  uiFlags.townSwitchClass = false;
  resultEl.classList.add("hidden");
  lobbyEl.classList.add("hidden");
  setMenuMode(null, "");
  room.prerendered = false;
  const hero = profile.getActiveHero();
  if (hero) {
    game.hero = hero;
    game.classKey = hero.classKey;
    menuEl.classList.add("hidden");
    showMap();
  } else {
    menuEl.classList.remove("hidden");
    refreshContinueButton();
    game.state = "menu";
  }
}

// ---- level-up overlay ----
// In co-op both players pick an upgrade for themselves before play resumes.

let lvlHostDone = false;
let lvlGuestDone = false;

export function coopActive() {
  return net.role === "host" && net.connected && game.players.length > 1;
}

export function buildUpgradeCards(picks, onPick) {
  upgradeCardsEl.innerHTML = "";
  picks.forEach((up, i) => {
    const card = document.createElement("button");
    card.className = "class-card upgrade-card";
    card.innerHTML =
      `<div class="ckey">${i + 1}</div>` +
      `<div class="cname">${up.name}</div>` +
      `<div class="cdesc">${up.desc}</div>`;
    card.addEventListener("click", () => onPick(up));
    upgradeCardsEl.appendChild(card);
  });
  game.levelUpPicks = picks;
  game.lvlOnPick = onPick;
  levelupEl.classList.remove("hidden");
}

export function openLevelUp() {
  game.state = "levelup";
  audio.levelup();
  const pl = game.players[0];
  const pool = UPGRADES.filter((u) => !u.classKey || u.classKey === pl.classKey);
  const picks = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  lvlHostDone = false;
  lvlGuestDone = !coopActive();
  if (coopActive()) net.send({ t: "lvl", ids: picks.map((u) => u.id) });
  buildUpgradeCards(picks, chooseUpgrade);
}

function finishLevelUp() {
  game.pendingLevelUps--;
  levelupEl.classList.add("hidden");
  game.state = "play";
  if (coopActive()) net.send({ t: "lvldone" });
}

export function maybeFinishLevelUp() {
  if (lvlHostDone && (lvlGuestDone || !coopActive())) finishLevelUp();
}

// The guest's half of the level-up handshake, called from coop.js. Kept as
// functions so lvlGuestDone stays private to this module - a shared mutable
// flag exported across the boundary is exactly what the split is retiring.
export function guestUpgradePicked(up, player) {
  if (up && player && !lvlGuestDone) up.apply(player);
  lvlGuestDone = true;
  maybeFinishLevelUp();
}
export function guestLeftLevelUp() {
  lvlGuestDone = true;
  maybeFinishLevelUp();
}

export function chooseUpgrade(up) {
  if (lvlHostDone) return; // already picked this level
  const pl = game.players[0];
  up.apply(pl);
  if (game.hero) {
    game.hero.attrPoints = (game.hero.attrPoints || 0) + 1;
    profile.save();
  }
  particles.burst(pl.x, pl.y - 20, {
    count: 16, colors: ["#ffd95e", "#fff3b8"], speed: 100, life: 0.6, gravity: -60,
  });
  lvlHostDone = true;
  if (!lvlGuestDone && coopActive()) {
    upgradeCardsEl.innerHTML = `<p class="tagline">Waiting for your teammate's pick...</p>`;
  }
  maybeFinishLevelUp();
}

// ---- inventory overlay ----

const inventoryEl = document.getElementById("inventory");
const invGridEl   = document.getElementById("inv-grid");
const invTooltip  = document.getElementById("inv-tooltip");

let _prevInventoryState = "play";

export function openInventory() {
  if (!game.hero) return;
  if (game.state !== "play" && game.state !== "hub") return;
  _prevInventoryState = game.state;
  game.state = "inventory";
  renderInventory(game.hero);
  inventoryEl.classList.remove("hidden");
}

export function closeInventory() {
  inventoryEl.classList.add("hidden");
  invTooltip.classList.add("hidden");
  if (_prevInventoryState === "hub" && game.hero) {
    showHub(game.hero);
  } else {
    game.state = "play";
  }
}

export function rebaseLocalPlayer() {
  const pl = game.localPlayer;
  if (pl && game.hero) {
    pl.baseStats = deriveStats(game.hero);
    pl.recompute();
    pl.hp = Math.min(pl.hp, pl.maxHp);
  }
}

export function renderInventory(hero) {
  for (const slot of ["weapon", "armor", "trinket"]) {
    const el = document.getElementById(`inv-slot-${slot}`);
    const item = hero.equipped[slot];
    el.innerHTML = "";
    if (item) {
      el.className = `inv-slot has-item rarity-${item.rarity}`;
      const img = document.createElement("img");
      img.src = sprites.items[item.icon].toDataURL();
      el.appendChild(img);
      el.onclick = () => { unequip(hero, slot); rebaseLocalPlayer(); profile.save(); renderInventory(hero); };
      el.onmouseenter = (e) => showInvTooltip(e, hero, item, null);
      el.onmouseleave = hideInvTooltip;
    } else {
      el.className = "inv-slot";
      el.onclick = null;
      el.onmouseenter = null;
      el.onmouseleave = null;
    }
  }

  invGridEl.innerHTML = "";
  if (hero.inventory.length === 0) {
    const p = document.createElement("p");
    p.className = "inv-empty";
    p.textContent = "No items yet — defeat enemies to find gear!";
    invGridEl.appendChild(p);
  } else {
    for (const item of hero.inventory) {
      const cell = document.createElement("div");
      cell.className = `inv-item rarity-${item.rarity}`;
      const img = document.createElement("img");
      img.src = sprites.items[item.icon].toDataURL();
      cell.appendChild(img);
      cell.onclick = () => {
        equip(hero, item);
        rebaseLocalPlayer();
        profile.save();
        renderInventory(hero);
      };
      cell.onmouseenter = (e) => showInvTooltip(e, hero, item, hero.equipped[item.slot]);
      cell.onmouseleave = hideInvTooltip;
      invGridEl.appendChild(cell);
    }
  }
}

export function showInvTooltip(e, hero, item, equipped) {
  const lines = itemStatLines(item);
  const compare = equipped ? compareItems(item, equipped) : null;
  const rColor = ITEM_RARITY[item.rarity].color;
  let html =
    `<div class="inv-tooltip-name" style="color:${rColor}">${item.name}</div>` +
    `<div class="inv-tooltip-rarity">${ITEM_RARITY[item.rarity].label} ${item.slot}</div>`;
  for (const { key, text } of lines) {
    const d = compare && compare[key];
    const cls = d > 0 ? "better" : d < 0 ? "worse" : "";
    html += `<div class="inv-tooltip-stat ${cls}">${text}</div>`;
  }
  if (equipped) {
    html += `<div style="font-size:10px;color:#8b80a8;margin-top:5px">Replaces: ${equipped.name}</div>`;
  }
  invTooltip.innerHTML = html;
  const tx = Math.min(e.clientX + 14, window.innerWidth - 210);
  const ty = Math.min(e.clientY,       window.innerHeight - 160);
  invTooltip.style.left = tx + "px";
  invTooltip.style.top  = ty + "px";
  invTooltip.classList.remove("hidden");
}

export function hideInvTooltip() { invTooltip.classList.add("hidden"); }

// ---- class select cards ----

export function buildClassCards() {
  const holder = document.getElementById("class-cards");
  for (const [key, cfg] of Object.entries(CLASSES)) {
    const card = document.createElement("button");
    card.className = "class-card";
    const img = document.createElement("img");
    img.src = sprites.players[key][0].toDataURL();
    img.alt = cfg.name;
    const name = document.createElement("div");
    name.className = "cname";
    name.textContent = cfg.name;
    name.style.color = cfg.color;
    const desc = document.createElement("div");
    desc.className = "cdesc";
    desc.textContent = cfg.desc;
    const stats = document.createElement("div");
    stats.className = "cstats";
    stats.textContent = cfg.stats;
    card.append(img, name, desc, stats);
    card.addEventListener("click", () => {
      audio.unlock();
      if (coopMode === "host-pick") hostWithClass(key);
      else if (coopMode === "join-pick") joinWithClass(key);
      else if (uiFlags.townSwitchClass) switchClass(key);
      else selectClass(key);
    });
    holder.appendChild(card);
  }
}

// ---- co-op lobby & networking ----

let coopMode = null;     // null | 'host-pick' | 'join-pick'

export const lobbyEl = document.getElementById("lobby");
export const lobbyStatus = document.getElementById("lobby-status");
export const lobbyOut = document.getElementById("lobby-out");
export const lobbyIn = document.getElementById("lobby-in");
export const roomCodeEl = document.getElementById("room-code");
export const codeIn = document.getElementById("code-in");
const modeHint = document.getElementById("menu-mode-hint");

export function showLobby(status, { out = false, input = false } = {}) {
  lobbyStatus.textContent = status;
  lobbyOut.classList.toggle("hidden", !out);
  lobbyIn.classList.toggle("hidden", !input);
  lobbyEl.classList.remove("hidden");
  menuEl.classList.add("hidden");
  hubEl.classList.add("hidden");
}

export function setMenuMode(mode, hint) {
  coopMode = mode;
  modeHint.textContent = hint || "";
  modeHint.classList.toggle("hidden", !hint);
}


// "Play Again" — but a town raid isn't a re-enterable dungeon, so send the
// player back to the town instead of replaying the raid.
export function playAgain() {
  if (net.role) net.reset();
  if (game.dungeonId === "townRaid") { showTownRoom(true); return; }
  beginRun(game.classKey, game.dungeonId, game.tier);
}
