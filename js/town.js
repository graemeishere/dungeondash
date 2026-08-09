"use strict";
// The walkable town and dungeon-lobby rooms, the four NPCs and their menus, and
// the raid / finale set-pieces that are built out of the town.

import { audio } from "./audio.js?v=d34ef17e";
import { CLASSES } from "./entities.js?v=d34ef17e";
import { INV_CAP, buyPrice, rollShopStock, sellPrice } from "./items.js?v=d34ef17e";
import { particles } from "./particles.js?v=d34ef17e";
import { profile } from "./profile.js?v=d34ef17e";
import { room } from "./room.js?v=d34ef17e";
import { sprites } from "./sprites.js?v=d34ef17e";
import { HEIGHT, WIDTH, choice, dist, updateView, view } from "./util.js?v=d34ef17e";
import { canvas, menuEl } from "./dom.js?v=d34ef17e";
import { game, DUNGEONS, TIER_REQ, uiFlags } from "./state.js?v=d34ef17e";
import { startFloorRun, beginRun } from "./run.js?v=d34ef17e";
import { buildStatsOverlay, hideAllOverlays, spawnHeroInRoom, rebaseLocalPlayer, refreshContinueButton, setMenuMode, showInvTooltip, hideInvTooltip } from "./overlays.js?v=d34ef17e";
import { sizeRoomToCanvas } from "./draw.js?v=d34ef17e";

// One-line faction motive, keyed by DUNGEONS[id].faction. Shown once per
// dungeon per session, on first entering that dungeon's lobby (see
// showDungeonLobby below) — the game never otherwise says why a faction
// fights the player or the town.
const FACTION_LORE = {
  skeleton: "The Catacombs' dead don't invade — they've guarded a king who died a thousand years ago, and no one told them to stop.",
  goblin:   "The goblins didn't dig the Mines for gold — they dug them for a home, and they raid the town for everything the rock won't give them.",
  undead:   "The Crypt's dead don't rest, and neither does the Lich's hunger — every soul it takes buys it one more day undying.",
};
const metDungeonLobbies = new Set(); // dungeon ids the player has already seen the lore toast for, this session

// Themed entry room with three tier doorways. Walk through one to start a run.
export function showDungeonLobby(dungeonId) {
  if (!DUNGEONS[dungeonId]) return;
  hideAllOverlays();
  game.state = "lobby";
  game.peaceful = true;
  game.lobbyDungeonId = dungeonId;
  game.lobbyDungeonName = DUNGEONS[dungeonId].name; // for the 3D overlay title
  game.dungeonId = dungeonId;
  game.time = 0;
  game.nearbyNpc = null;
  game.townNpcs = [];
  audio.setContext(dungeonId);
  sizeRoomToCanvas();
  room.setTheme(dungeonId);
  const lvl = (game.hero && game.hero.level) || 1;
  const tierInfo = DUNGEONS[dungeonId].tiers.map((t, ti) => {
    const req = TIER_REQ[ti] || 0;
    return {
      sub: t.levelHint, color: ["#9affb0", "#ffd95e", "#ff7a7a"][ti] || "#d8cfee",
      locked: lvl < req, req, cleared: profile.hasClear(game.hero, dungeonId, ti),
    };
  });
  room.generateLobby(tierInfo);
  updateView(canvas);
  spawnHeroInRoom();
  game.padTi = -1;
  game.padDwell = 0;
  if (!metDungeonLobbies.has(dungeonId)) {
    metDungeonLobbies.add(dungeonId);
    const lore = FACTION_LORE[DUNGEONS[dungeonId].faction];
    if (lore) townToast(lore, "#bdb3d6");
  }
}

export function tierLocked(ti) {
  return ((game.hero && game.hero.level) || 1) < (TIER_REQ[ti] || 0);
}

export function enterTierDoor(ti) {
  if (tierLocked(ti)) {
    townToast(`Reach level ${TIER_REQ[ti]} to enter Tier ${ti + 1}`, "#ff6b70");
    return;
  }
  const classKey = (game.hero && game.hero.classKey) || game.classKey;
  beginRun(classKey, game.lobbyDungeonId, ti);
}

export function spawnTownNpcs() {
  const y = HEIGHT * 0.45;
  const slots = [0.22, 0.41, 0.59, 0.78];
  const defs = [
    { id: "barkeep",    label: "Barkeep",     sprite: "npcBarkeep",    interact: openBarkeepMenu },
    { id: "innkeeper",  label: "Innkeeper",   sprite: "npcInnkeeper",  interact: openInnkeeperMenu },
    { id: "trader",     label: "Trader",      sprite: "npcTrader",     interact: openTraderMenu },
    // sprite keys are generated as "npc" + capitalized kind (js/sprites.js), so
    // "questgiver" yields "npcQuestgiver" — lowercase g, unlike the label
    { id: "questgiver", label: "Quest Giver", sprite: "npcQuestgiver", interact: openQuestGiverMenu },
  ];
  return defs.map((d, i) => {
    const npc = { ...d, x: WIDTH * slots[i], y, r: 14, bob: Math.random() * Math.PI * 2 };
    // sprite shim so the 3D layer can stand the NPC up as a billboard
    npc.draw = (c) => drawTownNpc(c, npc, game.time);
    return npc;
  });
}

// Walkable town. 25% of arrivals trigger a raid warning instead.
export function showTownRoom(skipRaid) {
  hideAllOverlays();
  if (!skipRaid && Math.random() < 0.25) { showRaidWarning(); return; }
  game.state = "town";
  game.peaceful = true;
  game.raidMode = false;
  audio.setContext("town");
  game.time = 0;
  game.nearbyNpc = null;
  sizeRoomToCanvas();
  room.setTheme("town");
  room.generateTown();
  updateView(canvas);
  spawnHeroInRoom();
  game.townNpcs = spawnTownNpcs();
  game.shopStock = rollShopStock(5); // fresh trader stock each town visit
}

// ---- town NPC interactions ----

// One characterizing line per NPC, shown once per NPC on the player's first
// interact with them in a given session — the "[E] Talk to <name>" prompt
// (js/game3d.js drawPeacefulOverlay) otherwise promises a conversation and
// gets a stats/shop/quest panel with no greeting.
const NPC_GREETINGS = {
  barkeep:    "You look like you've seen some fights, friend — let's see what they left you with.",
  innkeeper:  "Plenty of rooms upstairs, plenty of callings to try on — walk out of here whoever you like.",
  trader:     "Fresh from the vaults below, priced fair — mind the sharp ones.",
  questgiver: "The town's got more trouble than hands to spare for it — care to even the odds?",
};
const metNpcs = new Set(); // npc ids already greeted this session

// A canvas-drawn townToast() would be invisible here: every open*Menu below
// shows a covering .overlay (z-index 5, ~88% opaque) in the same tick, and
// js/draw.js's update() stops calling particles.update() for as long as that
// overlay's state (stats/menu/trader/quests) is active, freezing the toast's
// fade at its very first frame underneath the overlay rather than playing it
// out visibly. #npc-greet-toast (index.html) sits above every .overlay via
// z-index instead, so the greeting reads the instant the NPC's panel opens.
const greetToastEl = document.getElementById("npc-greet-toast");
let greetToastTimer = null;
function npcGreetToast(text) {
  if (!greetToastEl) return;
  clearTimeout(greetToastTimer);
  greetToastEl.textContent = text;
  greetToastEl.classList.remove("hidden");
  greetToastEl.classList.remove("visible"); // restart the transition if one's mid-fade
  // eslint-disable-next-line no-unused-expressions
  greetToastEl.offsetHeight; // force a reflow so the next class add re-triggers the CSS transition
  greetToastEl.classList.add("visible");
  greetToastTimer = setTimeout(() => {
    greetToastEl.classList.remove("visible");
    greetToastTimer = setTimeout(() => greetToastEl.classList.add("hidden"), 300);
  }, 3600);
}

function greetOnce(id) {
  if (metNpcs.has(id)) return;
  metNpcs.add(id);
  const line = NPC_GREETINGS[id];
  if (line) npcGreetToast(line);
}

const statsOverlayEl = document.getElementById("stats-overlay");

export function openBarkeepMenu() {
  if (!game.hero) return;
  greetOnce("barkeep");
  game.state = "stats";
  buildStatsOverlay(game.hero);
  statsOverlayEl.classList.remove("hidden");
}

export function closeStatsOverlay() {
  statsOverlayEl.classList.add("hidden");
  if (game.hero) rebaseLocalPlayer();
  game.state = "town";
}

export function openInnkeeperMenu() {
  greetOnce("innkeeper");
  uiFlags.townSwitchClass = true;
  game.state = "menu";
  menuEl.classList.remove("hidden");
  refreshContinueButton();
  setMenuMode(null, "INNKEEPER — pick a new class. Your level, gold and gear are kept.");
}

const traderEl = document.getElementById("trader");

export function openTraderMenu() {
  if (!game.hero) return;
  greetOnce("trader");
  game.state = "trader";
  buildTraderOverlay(game.hero);
  traderEl.classList.remove("hidden");
}

export function closeTraderOverlay() {
  traderEl.classList.add("hidden");
  if (game.hero) rebaseLocalPlayer();
  game.state = "town";
}

export function buildTraderOverlay(hero) {
  document.getElementById("tr-gold").innerHTML =
    `<span style="color:#ffd14a">${hero.gold || 0} gold</span>`;

  // FOR SALE — buy into your bag
  const shopEl = document.getElementById("tr-shop");
  shopEl.innerHTML = "";
  const stock = game.shopStock || [];
  if (stock.length === 0) {
    shopEl.innerHTML = `<p class="shop-empty">Sold out — come back after your next run.</p>`;
  } else {
    for (const item of stock) {
      const price = buyPrice(item);
      const bagFull = hero.inventory.length >= INV_CAP;
      const tooPoor = (hero.gold || 0) < price;
      const row = document.createElement("div");
      row.className = `shop-row rarity-${item.rarity}`;
      row.innerHTML =
        `<img src="${sprites.items[item.icon].toDataURL()}">` +
        `<span class="shop-name">${item.name}</span>` +
        `<span class="shop-price">${price}g</span>`;
      const btn = document.createElement("button");
      btn.className = "shop-btn";
      btn.textContent = "Buy";
      btn.disabled = bagFull || tooPoor;
      if (bagFull) btn.title = "Bag full";
      else if (tooPoor) btn.title = "Not enough gold";
      btn.onclick = () => {
        if (hero.inventory.length >= INV_CAP || (hero.gold || 0) < price) return;
        hero.gold -= price;
        hero.inventory.push(item);
        game.shopStock = game.shopStock.filter((s) => s !== item);
        audio.purchase();
        profile.save();
        buildTraderOverlay(hero);
      };
      row.appendChild(btn);
      row.onmouseenter = (e) => showInvTooltip(e, hero, item, hero.equipped[item.slot]);
      row.onmouseleave = hideInvTooltip;
      shopEl.appendChild(row);
    }
  }

  // YOUR BAG — sell for gold
  const invEl = document.getElementById("tr-inv");
  invEl.innerHTML = "";
  if (hero.inventory.length === 0) {
    invEl.innerHTML = `<p class="shop-empty">Your bag is empty.</p>`;
  } else {
    for (const item of hero.inventory) {
      const value = sellPrice(item);
      const row = document.createElement("div");
      row.className = `shop-row rarity-${item.rarity}`;
      row.innerHTML =
        `<img src="${sprites.items[item.icon].toDataURL()}">` +
        `<span class="shop-name">${item.name}</span>` +
        `<span class="shop-price">${value}g</span>`;
      const btn = document.createElement("button");
      btn.className = "shop-btn sell";
      btn.textContent = "Sell";
      btn.onclick = () => {
        const idx = hero.inventory.indexOf(item);
        if (idx < 0) return;
        hero.inventory.splice(idx, 1);
        hero.gold = (hero.gold || 0) + value;
        audio.purchase();
        profile.save();
        buildTraderOverlay(hero);
      };
      row.appendChild(btn);
      row.onmouseenter = (e) => showInvTooltip(e, hero, item, hero.equipped[item.slot]);
      row.onmouseleave = hideInvTooltip;
      invEl.appendChild(row);
    }
  }
}

const questGiverEl = document.getElementById("questgiver");

export function openQuestGiverMenu() {
  if (!game.hero) return;
  greetOnce("questgiver");
  audio.questTalk();
  game.state = "quests";
  buildQuestGiverOverlay(game.hero);
  questGiverEl.classList.remove("hidden");
}

export function closeQuestGiverOverlay() {
  questGiverEl.classList.add("hidden");
  game.state = "town";
}

function questRewardText(def) {
  let t = `Reward: ${def.reward.gold || 0}g`;
  if (def.reward.xp) t += ` · ${def.reward.xp} XP`;
  return t;
}

// Progress bar HTML for kill-count quests; other goals are pass/fail.
function questProgressHtml(def, q) {
  const g = def.goal;
  if (!g.kills) return "";
  const cur = Math.min((q.progress && q.progress.kills) || 0, g.kills);
  const pct = Math.round((cur / g.kills) * 100);
  return `<div class="q-bar-bg"><div class="q-bar-fill" style="width:${pct}%"></div></div>` +
    `<div class="q-desc">${cur} / ${g.kills}</div>`;
}

export function buildQuestGiverOverlay(hero) {
  const P = profile;
  const active = P.data.quests.active;
  const completed = P.data.quests.completed;
  document.getElementById("qg-sub").textContent =
    `${active.length}/${P.ACTIVE_CAP} active  •  ${completed.length} completed`;

  const activeEl = document.getElementById("qg-active");
  activeEl.innerHTML = "";
  if (active.length === 0) {
    activeEl.innerHTML = `<p class="shop-empty">No active quests — accept one from the list.</p>`;
  } else {
    for (const q of active) {
      const def = P.questDef(q.id);
      if (!def) continue;
      const card = document.createElement("div");
      card.className = "quest-card";
      card.innerHTML =
        `<div class="q-title">${def.title}</div>` +
        `<div class="q-desc">${def.desc}</div>` +
        questProgressHtml(def, q) +
        `<div class="q-reward">${questRewardText(def)}</div>`;
      const actions = document.createElement("div");
      actions.className = "q-actions";
      const btn = document.createElement("button");
      btn.className = "shop-btn danger";
      const canAfford = (hero.gold || 0) >= P.ABANDON_COST;
      btn.textContent = `Abandon (${P.ABANDON_COST}g)`;
      btn.disabled = !canAfford;
      if (!canAfford) btn.title = "Not enough gold";
      btn.onclick = () => {
        if (P.abandonQuest(q.id, hero)) { audio.menuBack(); buildQuestGiverOverlay(hero); }
      };
      actions.appendChild(btn);
      card.appendChild(actions);
      activeEl.appendChild(card);
    }
  }

  const availEl = document.getElementById("qg-avail");
  availEl.innerHTML = "";
  const avail = P.availableQuests();
  if (avail.length === 0) {
    availEl.innerHTML = `<p class="shop-empty">Nothing new right now — come back later.</p>`;
  } else {
    const full = active.length >= P.ACTIVE_CAP;
    for (const def of avail) {
      const card = document.createElement("div");
      card.className = "quest-card";
      card.innerHTML =
        `<div class="q-title">${def.title}</div>` +
        `<div class="q-desc">${def.desc}</div>` +
        `<div class="q-reward">${questRewardText(def)}</div>`;
      const actions = document.createElement("div");
      actions.className = "q-actions";
      const btn = document.createElement("button");
      btn.className = "shop-btn";
      btn.textContent = "Accept";
      btn.disabled = full;
      if (full) btn.title = `Max ${P.ACTIVE_CAP} active quests`;
      btn.onclick = () => {
        if (P.acceptQuest(def.id)) { audio.menuConfirm(); buildQuestGiverOverlay(hero); }
      };
      actions.appendChild(btn);
      card.appendChild(actions);
      availEl.appendChild(card);
    }
  }
}

export function townToast(text, color) {
  // centered on-screen so short placeholder messages never run off a narrow phone
  particles.text(WIDTH / 2, HEIGHT * 0.66, text, color || "#ffd95e");
}

// Change the active hero's class while keeping all progression.
export function switchClass(classKey) {
  if (!CLASSES[classKey] || !game.hero) return;
  game.hero.classKey = classKey;
  game.classKey = classKey;
  profile.save();
  uiFlags.townSwitchClass = false;
  menuEl.classList.add("hidden");
  setMenuMode(null, "");
  showTownRoom(true);
}

// ---- raid warning ----

// Why this faction, specifically, is at the walls tonight — one clause each,
// distinct from FACTION_LORE's dungeon-lobby framing (that's the standing
// motive; this is what's brought them topside for this one raid).
const RAID_CLAUSE = {
  skeleton: "Something's stirred the dead from their tombs.",
  goblin:   "The goblins have come topside for plunder.",
  undead:   "The Lich has sent its dead to feed on the town.",
};

// Who leads the raid, per faction — extends decision 13's per-floor bossName
// pattern to the raid's single floor. Each name answers its faction's
// RAID_CLAUSE above (stirred dead need marshaling; plunder needs a boss; the
// Lich sends an envoy) and deliberately shares no name with the ELITE_NAMES
// pools or the dungeon bosses — the raid boss used to be hardcoded
// "RAID CAPTAIN", colliding exactly with a goblin elite-room name.
const RAID_BOSS_NAMES = {
  skeleton: "RISEN MARSHAL",
  goblin:   "PLUNDER BOSS",
  undead:   "CARRION ENVOY",
};

export function showRaidWarning() {
  game.state = "raid-warn";
  game.raidFaction = choice(["goblin", "skeleton", "undead"]);
  const dungeonName = {
    goblin: "Goblin Mines", skeleton: "Catacombs", undead: "The Crypt",
  }[game.raidFaction];
  const clause = RAID_CLAUSE[game.raidFaction] || "";
  document.getElementById("raid-text").textContent =
    `Raiders from the ${dungeonName} are attacking the town! ${clause}`;
  document.getElementById("raid-warning").classList.remove("hidden");
}

function factionDungeon(faction) {
  return { goblin: "goblinMines", skeleton: "catacombs", undead: "crypt" }[faction] || "catacombs";
}

// A short, town-themed mini-dungeon built from the raiding faction's enemies.
// Registered as DUNGEONS.townRaid so all the DUNGEONS[game.dungeonId] lookups work.
function buildRaidDungeon(faction) {
  const src = DUNGEONS[factionDungeon(faction)];
  const f0 = src.floors[0];
  const topFloor = src.floors[src.floors.length - 1];
  return {
    id: "townRaid", name: "Town Under Siege", faction, theme: "town",
    enemyLabel: src.enemyLabel,
    // no side rooms: a raid is a tight gauntlet straight to the boss, not an
    // exploratory floor with shrine/storage/dining/treasure detours.
    // bossDmg borrows the source dungeon's top-floor (anchor) value, same as
    // bossHp already does via dungeonFloorCfg's single-floor ratio=1 case -
    // a raid boss should hit as hard as that tier's real final boss, not the
    // weaker floor-0 one, even though the raid reuses floor-0's enemy kinds.
    floors: [{
      name: "Town Square", kinds: f0.kinds, eliteKinds: f0.eliteKinds,
      plan: ["combat", "combat", "boss"], sideRooms: false,
      bossDmg: topFloor.bossDmg, bossName: RAID_BOSS_NAMES[faction] || "RAID WARLEADER",
    }],
    tiers: src.tiers,
  };
}

export function startRaid() {
  document.getElementById("raid-warning").classList.add("hidden");
  const classKey = (game.hero && game.hero.classKey) || game.classKey;
  DUNGEONS.townRaid = buildRaidDungeon(game.raidFaction);
  startFloorRun(classKey, "townRaid", game.tier);
  game.raidMode = true;
}

// The Champion-only capstone: a town-themed siege by every faction at once,
// ending with a unique final boss. Tougher than any tier-3 run.
function buildFinaleDungeon() {
  return {
    id: "finale", name: "The Last Stand", faction: "skeleton", bossFaction: "finale",
    theme: "town", multiFaction: true, enemyLabel: "Raiders",
    // no side rooms: the Champion-only finale is a straight-line siege, the
    // biggest set-piece in the game, not a floor to be explored
    floors: [{
      name: "Town Under Siege",
      kinds: ["melee", "goblin", "zombie", "archer", "goblinArcher", "warlock", "goblinBerserker", "goblinBomber"],
      eliteKinds: ["goblinBerserker", "warlock", "archer"],
      plan: ["combat", "combat", "combat", "boss"],
      sideRooms: false,
    }],
    tiers: [{ tier: 0, levelHint: "30+", scale: 8.0, bossHp: 440, bossDmg: 10, bossName: "THE WORLD-EATER", summonKind: "goblinBerserker" }],
  };
}

export function startFinale() {
  const classKey = (game.hero && game.hero.classKey) || game.classKey;
  DUNGEONS.finale = buildFinaleDungeon();
  startFloorRun(classKey, "finale", 0);
}

// ---- town / lobby rendering ----

export function drawTownNpc(ctx, npc, time) {
  const frames = sprites[npc.sprite] || sprites.npcBarkeep;
  const d = 48;
  const bobY = Math.sin(time * 2 + npc.bob) * 2;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(npc.x, npc.y + 5, npc.r + 2, (npc.r + 2) * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  const frame = frames[Math.floor(time * 4) % frames.length];
  ctx.drawImage(frame, Math.round(npc.x - d / 2), Math.round(npc.y - d + 10 + bobY), d, d);

  const hot = game.nearbyNpc === npc;
  const font = "'Trebuchet MS', Verdana, sans-serif";
  ctx.textAlign = "center";
  ctx.font = `bold 11px ${font}`;
  const w = ctx.measureText(npc.label).width + 12;
  ctx.fillStyle = "rgba(10,8,18,0.72)";
  ctx.fillRect(npc.x - w / 2, npc.y - d - 6, w, 16);
  ctx.fillStyle = hot ? "#ffd95e" : "#d8cfee";
  ctx.fillText(npc.label, npc.x, npc.y - d + 6);
  ctx.textAlign = "left";
}


// Tap an NPC in the town to talk to them (mobile has no E key).
export function handleTownTap(clientX, clientY, targetEl) {
  if (game.state !== "town") return false;
  const rect = targetEl.getBoundingClientRect();
  const cx = (clientX - rect.left) * (targetEl.width / rect.width);
  const cy = (clientY - rect.top) * (targetEl.height / rect.height);
  const wx = (cx - view.ox) / view.scale;
  const wy = (cy - view.oy) / view.scale;
  for (const npc of game.townNpcs) {
    if (dist(wx, wy, npc.x, npc.y - 18) < 40) {
      audio.unlock();
      npc.interact();
      return true;
    }
  }
  return false;
}
