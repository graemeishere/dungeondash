"use strict";
// Run lifecycle: starting, generating, gating, advancing and ending a run.
// The connected-floor path is the only traversal system (Phase 1 retired the
// classic single-room generator/`?classic`; raids and the finale route
// through here too now).

import { audio } from "./audio.js?v=ff8ca445";
import { Boss, CLASSES, Chest, KIND_FACTION, Pickup, Player, Skeleton, rollGrade } from "./entities.js?v=ff8ca445";
import { generateFloor } from "./floor.js?v=ff8ca445";
import { input } from "./input.js?v=ff8ca445";
import { net } from "./net.js?v=ff8ca445";
import { particles } from "./particles.js?v=ff8ca445";
import { profile } from "./profile.js?v=ff8ca445";
import { room } from "./room.js?v=ff8ca445";
import { TILE, choice, clamp, updateView } from "./util.js?v=ff8ca445";
import { canvas, resultEl, resultTitle, resultStats } from "./dom.js?v=ff8ca445";
import { game, DUNGEONS, ELITE_NAMES, isChampion, writeSave, clearSave, freshGameState } from "./state.js?v=ff8ca445";
import { sendRoomToGuest } from "./coop.js?v=ff8ca445";

// Connected-floor run: explore a floor of small rooms joined by
// corridors; combat rooms lock their doors on entry (Isaac-style) and unlock
// on clear; the boss chamber gates the descent to the next floor.
export function startFloorRun(classKey, dungeonId = "catacombs", tier = 0) {
  clearSave();
  const hero = profile.getOrCreateHero(classKey);
  game.hero = hero;
  game.classKey = classKey;
  game.dungeonId = dungeonId;
  game.tier = tier;
  game.floorMode = true;
  game.peaceful = false;
  game.raidMode = false;
  game.townNpcs = [];
  game.nearbyNpc = null;
  room.setTheme((DUNGEONS[dungeonId] && DUNGEONS[dungeonId].theme) || dungeonId);
  game.players = [new Player(classKey, 0, 0, input, hero)];
  game.localIndex = 0;
  input.setDashable(!!game.players[0].cfg.dash);
  game.floor = 0;
  game.xp = hero.xp || 0;
  game.level = hero.level || 1;
  game.gold = 0;
  game.kills = 0;
  game.killsByFaction = { skeleton: 0, goblin: 0, undead: 0 };
  game.time = 0;
  loadFloor();
  freshGameState();
}

// Every entry point into a run (menu, dungeon lobby, raid, finale) goes
// through the floor generator now — there is exactly one traversal system.
export const beginRun = startFloorRun;

// Generate + install the current floor, then spawn every room's entities at
// once (dormant + roomId-tagged) so entering a room can wake just that room.
export function loadFloor() {
  const cfg = game.floorCfg();
  const plan = cfg.plan;
  const floor = generateFloor({ plan, boss: plan[plan.length - 1] === "boss", sideRooms: cfg.sideRooms });
  room.setFloor(floor);
  updateView(canvas);
  game.skeletons = [];
  game.projectiles = [];
  game.enemyShots = [];
  game.pickups = [];
  game.chests = [];
  game.spawnQueue = [];
  game.shake = 0;
  game.endT = 0;
  game.roomCleared = true;      // whole-floor flag unused; rooms gate per-room
  game.activeRoomId = null;     // the currently locked (in-combat) room
  game._stairsTaken = false;
  game.stairsReady = false;     // set true once the boss chamber is cleared
  game.roomType = "floor";
  particles.clear();
  spawnFloorEntities(floor);
  for (const p of game.players) { p.x = floor.entry.x; p.y = floor.entry.y; }
  sendRoomToGuest(); // co-op: hand the whole floor to the guest (also on descent)
}

// Combat rooms lock on entry; these types gate. Others (treasure/side rooms)
// are free to walk through.
const GATED_ROOM = { combat: 1, elite: 1, boss: 1 };

export function spawnFloorEntities(floor) {
  const cfg = game.floorCfg();
  const faction = cfg.faction || "skeleton";
  const factionFor = (kind) => cfg.multiFaction ? (KIND_FACTION[kind] || faction) : faction;
  const grade = () => rollGrade(game.floor, game.tier);
  let combatIdx = 0; // ramps enemy variety per successive combat room
  for (const rm of floor.rooms) {
    if (rm.type === "combat") {
      const allKinds = cfg.kinds || ["melee"];
      const kinds = allKinds.slice(0, Math.min(allKinds.length, combatIdx + 1));
      const count = clamp(3 + game.floor + combatIdx, 3, 6);
      for (let i = 0; i < count; i++) {
        const pos = room.randomFloorInRect(rm.rect);
        const kind = i > 0 && Math.random() < 0.4 ? choice(kinds) : kinds[0];
        game.skeletons.push(new Skeleton(pos.x, pos.y, {
          kind, faction, inactive: true, frozen: true, roomId: rm.id, scale: cfg.scale, grade: grade(),
        }));
      }
      combatIdx++;
    } else if (rm.type === "elite") {
      const eliteKinds = cfg.eliteKinds || cfg.kinds || ["melee"];
      const ek = choice(eliteKinds);
      const eliteNames = ELITE_NAMES[factionFor(ek)] || ELITE_NAMES.skeleton || ["ELITE"];
      const ep = room.randomFloorInRect(rm.rect);
      game.skeletons.push(new Skeleton(ep.x, ep.y, {
        kind: ek, faction: factionFor(ek), big: true, elite: true, name: choice(eliteNames),
        inactive: true, frozen: true, roomId: rm.id, scale: cfg.scale, grade: grade(),
      }));
      const minionKinds = (cfg.kinds || ["melee"]).filter((k) => k !== "shade");
      for (let i = 0; i < 2; i++) {
        const mp = room.randomFloorInRect(rm.rect);
        const mk = choice(minionKinds);
        game.skeletons.push(new Skeleton(mp.x, mp.y, {
          kind: mk, faction: factionFor(mk), inactive: true, frozen: true, roomId: rm.id, scale: cfg.scale, grade: grade(),
        }));
      }
      combatIdx++;
    } else if (rm.type === "boss") {
      const cx = (rm.rect.x + rm.rect.w / 2) * TILE, cy = (rm.rect.y + rm.rect.h / 2) * TILE;
      game.skeletons.push(new Boss(cx, cy, {
        hp: cfg.bossHp, dmg: cfg.bossDmg, name: cfg.boss, summonKind: cfg.summonKind,
        faction: cfg.bossFaction || cfg.faction, frozen: true, roomId: rm.id,
      }));
    } else if (rm.type === "treasure") {
      for (let i = 0; i < 3; i++) {
        const pos = room.randomFloorInRect(rm.rect);
        game.chests.push(new Chest(pos.x, pos.y));
      }
    } else if (rm.type === "trap") {
      // gauntlet: a chest reward plus scattered coins, placed clear of the
      // room's own spike cells so the payoff doesn't sit on a hazard tile
      const spikeSet = new Set(room.spikes
        .filter((s) => s.tx >= rm.rect.x && s.tx < rm.rect.x + rm.rect.w && s.ty >= rm.rect.y && s.ty < rm.rect.y + rm.rect.h)
        .map((s) => s.tx + "," + s.ty));
      const safePos = () => {
        for (let i = 0; i < 20; i++) {
          const p = room.randomFloorInRect(rm.rect);
          if (!spikeSet.has(Math.floor(p.x / TILE) + "," + Math.floor(p.y / TILE))) return p;
        }
        return room.randomFloorInRect(rm.rect);
      };
      const cp = safePos();
      game.chests.push(new Chest(cp.x, cp.y));
      for (let i = 0; i < 3; i++) {
        const pp = safePos();
        game.pickups.push(new Pickup("coin", pp.x, pp.y));
      }
    }
  }
}

function roomHasEnemies(roomId) {
  return game.skeletons.some((s) => s.roomId === roomId && !s.dead && !s.dying);
}

// Is the entity at least `margin` tiles inside the room rect on every side?
// Used so the combat lock fires only once the player is past the doorway.
function insideRoom(ent, rm, margin) {
  const R = rm.rect, tx = ent.x / TILE, ty = ent.y / TILE;
  return tx > R.x + margin && tx < R.x + R.w - margin &&
         ty > R.y + margin && ty < R.y + R.h - margin;
}

// Wake every enemy in a room (drop `frozen`; their own inactive->awaken logic,
// now room-scoped, rises them the moment the doors shut).
export function activateRoom(roomId) {
  for (const s of game.skeletons) if (s.roomId === roomId) s.frozen = false;
}

// Player crossed into / cleared a floor room: lock on entry, unlock on clear,
// and descend when the boss chamber (the stairs room) falls.
export function updateFloorGating() {
  const pl = game.localPlayer;
  if (!pl || !pl.alive()) return;
  const rm = room.roomAt(pl.x, pl.y);
  // reveal the current room + its neighbours on the minimap
  if (rm && !rm.seen) {
    rm.seen = true;
    for (const [a, b] of (room.edges || [])) {
      if (a === rm.id) { const n = room.roomById(b); if (n) n.seen = true; }
      else if (b === rm.id) { const n = room.roomById(a); if (n) n.seen = true; }
    }
  }
  // Only lock once the player is clear of the doorway (a tile inside), so the
  // closing door never catches them mid-threshold.
  if (rm && !rm.cleared && !rm.locked && GATED_ROOM[rm.type] && roomHasEnemies(rm.id) && insideRoom(pl, rm, 1)) {
    rm.locked = true;
    game.activeRoomId = rm.id;
    activateRoom(rm.id);
    audio.door();
    particles.text((rm.rect.x + rm.rect.w / 2) * TILE, (rm.rect.y - 0.2) * TILE, "The doors slam shut!", "#ff9234");
  }
  if (game.activeRoomId != null) {
    const arm = room.roomById(game.activeRoomId);
    if (arm && !roomHasEnemies(arm.id)) {
      arm.locked = false;
      arm.cleared = true;
      game.activeRoomId = null;
      audio.door();
      if (arm.id === room.stairsRoomId) {
        // Boss chamber cleared: reveal the stairs instead of auto-descending,
        // so the player gets a beat to loot/heal. Walking onto them descends
        // (see the play-state floor branch below).
        game.stairsReady = true;
        const st = room.floorStairs;
        if (st) particles.text((st.x + 0.5) * TILE, (st.y - 0.3) * TILE, "The stairs down are revealed...", "#ffd95e");
        return;
      }
      particles.text((arm.rect.x + arm.rect.w / 2) * TILE, (arm.rect.y - 0.2) * TILE, "Cleared!", "#ffd95e");
    }
  }
}

// The boss chamber fell — checkpoint and descend to the next floor (or win).
export function reachStairs() {
  if (game._stairsTaken) return;
  game._stairsTaken = true;
  const dungeon = DUNGEONS[game.dungeonId] || DUNGEONS.catacombs;
  writeSave();
  if (game.floor >= dungeon.floors.length - 1) { endRun(true); return; }
  const nextFloor = dungeon.floors[game.floor + 1];
  const pl = game.localPlayer;
  if (pl) particles.text(pl.x, pl.y - TILE, `Onward to ${nextFloor ? nextFloor.name : "the depths"}...`, "#ffd95e");
  startTransition();
}

export function advanceFloor() {
  game.floor++;
  loadFloor();
}

export function resumeRun(save) {
  const hero = profile.getOrCreateHero(save.classKey);
  game.hero = hero;
  game.classKey = save.classKey;
  const pl = new Player(save.classKey, 0, 0, input, hero);
  if (save.runBuffs) {
    Object.assign(pl.runBuffs, save.runBuffs);
    pl.recompute();
  } else if (save.maxHp) {
    // Old save without runBuffs: infer the maxHp buff and apply raw stats
    pl.runBuffs.maxHp = Math.max(0, save.maxHp - Math.floor(pl.baseStats.hp));
    pl.recompute();
    if (save.stats) Object.assign(pl.stats, save.stats);
  }
  pl.maxHp = save.maxHp || pl.maxHp;
  pl.hp = Math.max(1, Math.min(pl.maxHp, save.hp));
  pl.killHeal = save.killHeal !== undefined ? save.killHeal : pl.killHeal;
  game.players = [pl];
  game.localIndex = 0;
  input.setDashable(!!pl.cfg.dash);
  game.dungeonId = save.dungeonId || "catacombs";
  game.tier = save.tier || 0;
  game.peaceful = false;
  room.setTheme(game.dungeonId);
  game.floor = save.floor;
  game.xp = hero ? (hero.xp || 0) : (save.xp || 0);
  game.level = hero ? (hero.level || 1) : (save.level || 1);
  game.gold = save.gold;
  game.kills = save.kills;
  game.killsByFaction = { skeleton: 0, goblin: 0, undead: 0 };
  game.time = save.time;
  game.floorMode = true;
  loadFloor();
  freshGameState();
}

export function startTransition() {
  game.state = "transition";
  game.transitionPhase = "out";
  game.transitionT = 0;
}

export function endRun(won) {
  clearSave();
  game.justWonGame = false;
  game.justWonFinale = false;
  if (game.hero) {
    game.hero.level = game.level;
    game.hero.xp = game.xp;
    // gold is only banked on a successful run; dying forfeits the run's gold
    if (won) game.hero.gold = Math.max(0, (game.hero.gold || 0) + game.gold);
    game.hero.kills = (game.hero.kills || 0) + game.kills;
    if (!won) game.hero.deaths = (game.hero.deaths || 0) + 1;
    const clearedDungeon = won && game.dungeonId !== "townRaid" ? game.dungeonId : null;
    profile.progressQuests({
      kills: game.kills,
      killsByFaction: game.killsByFaction,
      won,
      bossKill: clearedDungeon,
      clearDungeon: clearedDungeon,
      repelRaid: (won && game.raidMode) ? 1 : 0,
    });
    // record the dungeon+tier clear and check for game victory
    if (clearedDungeon) {
      profile.markClear(game.hero, game.dungeonId, game.tier);
      if (game.dungeonId === "finale") {
        game.hero.finaleWon = true;
        game.justWonFinale = true;
      } else if (!game.hero.victory && isChampion(game.hero)) {
        game.hero.victory = true;
        game.justWonGame = true;
      }
    }
    profile.save();
  }
  game.state = won ? "won" : "lost";
  game.endT = won ? 1.4 : 1.2;
  if (won) {
    room.doorOpen = true;
    audio.win();
  } else {
    audio.lose();
  }
  if (net.role === "host" && net.connected) {
    net.send({
      t: "end", won,
      stats: { level: game.level, floor: game.floor, ri: game.roomIndex, kills: game.kills, gold: game.gold, time: game.time },
    });
  }
}

export function showResult() {
  const won = game.state === "won";
  if (game.justWonFinale) {
    resultTitle.textContent = "THE REALM IS SAVED!";
    resultTitle.style.color = "#ff9234";
  } else if (game.justWonGame) {
    resultTitle.textContent = "DUNGEON DASH CHAMPION!";
    resultTitle.style.color = "#ffd95e";
  } else {
    resultTitle.textContent = won ? "DUNGEON CLEARED!" : "YOU DIED";
    resultTitle.style.color = won ? "#ffd95e" : "#ff5252";
  }
  const dungeon = DUNGEONS[game.dungeonId] || DUNGEONS.catacombs;
  const floorName = (dungeon.floors[game.floor] || {}).name || `Floor ${game.floor + 1}`;
  let line;
  if (game.justWonFinale) {
    line = `You drove back the siege and felled the World-Eater. A true legend!`;
  } else if (game.justWonGame) {
    line = `You conquered every dungeon at the highest tier. The realm is yours!`;
  } else {
    line = `${CLASSES[game.classKey].name} Lv ${game.level} &nbsp;•&nbsp; ` +
      `${floorName}, Room ${game.roomIndex + 1} &nbsp;•&nbsp; ` +
      `${game.kills} kills &nbsp;•&nbsp; ${game.gold} gold &nbsp;•&nbsp; ` +
      `${game.time.toFixed(1)}s`;
  }
  resultStats.innerHTML = line;
  resultEl.classList.remove("hidden");
}
