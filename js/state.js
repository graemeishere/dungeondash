"use strict";
// The run's live state, the dungeon table it reads, and the mid-run save.
//
// `game` is the one mutable object the whole game shares. It stays a single
// object rather than a set of exported bindings because importers assign to its
// fields constantly, and an imported binding is read-only.

import { CLASSES } from "./entities.js?v=6fd6c2e4";
import { profile } from "./profile.js?v=6fd6c2e4";
import { dist } from "./util.js?v=6fd6c2e4";
import { menuEl, resultEl, levelupEl, hubEl } from "./dom.js?v=6fd6c2e4";

const SAVE_KEY = "dungeondash_save_v1";

// Cross-module UI flags. These are properties rather than exported bindings
// because more than one module writes them, and an imported binding is
// read-only - `townSwitchClass = false` from another file is a SyntaxError.
export const uiFlags = {
  townSwitchClass: false, // the Innkeeper sent us to the class picker
  guestInGame: false,     // co-op guest has received a room and is rendering
};

// The dungeon: each floor ends with a boss. Clear the last boss to win the
// run; gold is spent at the Trader in town, not between floors.
// DUNGEONS map — add new dungeons here without touching run logic.
// Each dungeon: id, name, faction, enemyLabel, floors[], tiers[]
// floors[] = room content per floor (kinds, eliteKinds, plan)
// tiers[] = stat scaling per difficulty door (scale, boss stats)
export const DUNGEONS = {
  catacombs: {
    id: "catacombs", name: "Catacombs", faction: "skeleton", enemyLabel: "Skeletons",
    // The 4 skeleton models, ordered easy->hard so the per-room ramp introduces
    // one new type per combat room: Minion -> Archer -> Heavy -> Mage.
    // melee=Skeleton_Minion, archer=Skeleton_Rogue(bow), zombie=Skeleton_Warrior
    // (heavy/tanky), warlock=Skeleton_Mage (casts magic orbs).
    floors: [
      { name: "Upper Catacombs",
        kinds: ["melee", "archer", "zombie", "warlock"], eliteKinds: ["zombie"],
        plan: ["combat", "combat", "combat", "combat", "boss"],
        bossDmg: [1, 3, 5], bossName: "SKELETON SENTRY" },
      { name: "Deep Catacombs",
        kinds: ["melee", "archer", "zombie", "warlock"], eliteKinds: ["archer", "warlock"],
        plan: ["combat", "trap", "combat", "elite", "treasure", "combat", "boss"],
        bossDmg: [2, 3, 6], bossName: "SKELETON GENERAL" },
      { name: "Catacombs Core",
        kinds: ["melee", "archer", "zombie", "warlock"], eliteKinds: ["zombie", "warlock"],
        plan: ["combat", "elite", "trap", "combat", "treasure", "combat", "boss"],
        bossDmg: [2, 4, 7], bossName: "SKELETON KING" },
    ],
    // bossHp stays keyed by tier (below) and is the *floor-2* value at that
    // tier - floors 0/1 scale it down via BOSS_HP_RATIO in dungeonFloorCfg(),
    // so each floor's boss is distinct and escalating instead of the same
    // fight 3 times. bossDmg moved to floors[] above (decision 13).
    tiers: [
      { tier: 0, levelHint: "1-10",  scale: 1.0, bossHp: 70,  bossName: "SKELETON KING",  summonKind: "melee"  },
      { tier: 1, levelHint: "11-20", scale: 2.8, bossHp: 160, bossName: "SKELETON KING",  summonKind: "archer" },
      { tier: 2, levelHint: "21-30", scale: 5.3, bossHp: 280, bossName: "SKELETON KING",  summonKind: "zombie" },
    ],
  },
  goblinMines: {
    id: "goblinMines", name: "Goblin Mines", faction: "goblin", enemyLabel: "Goblins",
    floors: [
      { name: "Mine Entrance",
        kinds: ["goblin", "goblinArcher"], eliteKinds: ["goblin"],
        plan: ["combat", "combat", "treasure", "combat", "boss"],
        bossDmg: [1, 3, 6], bossName: "GOBLIN OVERSEER" },
      { name: "Deep Mines",
        kinds: ["goblin", "goblinArcher", "goblinBomber", "goblinBerserker", "goblinShaman"], eliteKinds: ["goblinArcher", "goblinShaman"],
        plan: ["combat", "trap", "combat", "elite", "treasure", "combat", "boss"],
        bossDmg: [2, 4, 7], bossName: "GOBLIN CHIEFTAIN" },
      { name: "Warlord's Den",
        kinds: ["goblin", "goblinArcher", "goblinBomber", "goblinBerserker", "goblinShaman"], eliteKinds: ["goblin", "goblinBerserker", "goblinShaman"],
        plan: ["combat", "elite", "trap", "combat", "treasure", "combat", "boss"],
        bossDmg: [2, 5, 8], bossName: "GOBLIN WARLORD" },
    ],
    tiers: [
      { tier: 0, levelHint: "1-10",  scale: 1.1, bossHp: 80,  bossName: "GOBLIN WARLORD", summonKind: "goblin"          },
      { tier: 1, levelHint: "11-20", scale: 3.1, bossHp: 175, bossName: "GOBLIN WARLORD", summonKind: "goblinBerserker"  },
      { tier: 2, levelHint: "21-30", scale: 5.8, bossHp: 300, bossName: "GOBLIN WARLORD", summonKind: "goblinShaman"     },
    ],
  },
  crypt: {
    id: "crypt", name: "The Crypt", faction: "undead", enemyLabel: "Undead",
    floors: [
      { name: "Outer Crypt",
        kinds: ["zombie", "warlock"], eliteKinds: ["zombie"],
        plan: ["combat", "combat", "treasure", "combat", "boss"],
        bossDmg: [1, 3, 6], bossName: "CRYPT WARDEN" },
      { name: "Inner Crypt",
        kinds: ["zombie", "warlock", "necromancer"], eliteKinds: ["warlock", "necromancer"],
        plan: ["combat", "trap", "combat", "elite", "treasure", "combat", "boss"],
        bossDmg: [2, 4, 7], bossName: "DEATHLESS HERALD" },
      { name: "Lich's Sanctum",
        kinds: ["zombie", "warlock", "necromancer"], eliteKinds: ["zombie", "warlock"],
        plan: ["combat", "elite", "trap", "combat", "treasure", "combat", "boss"],
        bossDmg: [3, 5, 9], bossName: "THE LICH" },
    ],
    tiers: [
      { tier: 0, levelHint: "1-10",  scale: 1.2, bossHp: 90,  bossName: "THE LICH", summonKind: "zombie"      },
      { tier: 1, levelHint: "11-20", scale: 3.4, bossHp: 190, bossName: "THE LICH", summonKind: "warlock"     },
      { tier: 2, levelHint: "21-30", scale: 6.3, bossHp: 320, bossName: "THE LICH", summonKind: "necromancer" },
    ],
  },
};

// Boss HP escalates per floor within a tier (decision 13): floor 0 is the
// weakest fight at a given tier, floor 2 is the tier's full, already-tuned
// value (ratio 1.0 - nothing that was already balanced moves). Per-dungeon
// override via `d.bossHpRatios` if a dungeon ever needs a different shape.
const BOSS_HP_RATIO = [0.6, 0.8, 1.0];

// Merge the active floor's content + tier's stats into one flat config object.
// All run logic reads game.floorCfg() — adding new dungeons requires only a DUNGEONS entry.
export function dungeonFloorCfg() {
  const d = DUNGEONS[game.dungeonId] || DUNGEONS.catacombs;
  const floorIdx = Math.min(game.floor, d.floors.length - 1);
  const tierIdx = Math.min(game.tier, d.tiers.length - 1);
  const flr = d.floors[floorIdx];
  const tier = d.tiers[tierIdx];
  // Single-floor synthetic dungeons (town raid, the Champion finale) keep
  // their tier's boss at full strength - they're one climactic fight, not
  // "floor 0 of 3", so the per-floor ratio only applies to the 3-floor core
  // dungeons the ratio was designed for.
  const ratio = d.floors.length > 1 ? (d.bossHpRatios || BOSS_HP_RATIO)[floorIdx] : 1;
  const bossDmg = Array.isArray(flr.bossDmg) && flr.bossDmg[tierIdx] !== undefined
    ? flr.bossDmg[tierIdx]
    : tier.bossDmg;
  return {
    ...flr,
    ...tier,
    faction: d.faction,
    enemyLabel: d.enemyLabel,
    id: d.id,
    multiFaction: !!d.multiFaction,
    bossFaction: d.bossFaction || null,
    bossHp: Math.round(tier.bossHp * ratio),
    bossDmg,
    boss: flr.bossName || tier.bossName, // alias used by Boss constructor
  };
}

// Hero level required to enter each tier (bands are 1-10 / 11-20 / 21-30).
export const TIER_REQ = [1, 11, 21];

// The three "real" dungeons. townRaid + finale are synthetic and excluded
// from champion progress.
const CORE_DUNGEONS = ["catacombs", "goblinMines", "crypt"];

// Champion = every core dungeon cleared at its top tier.
export function isChampion(hero) {
  return CORE_DUNGEONS.every((id) => profile.hasClear(hero, id, DUNGEONS[id].tiers.length - 1));
}

export const ELITE_NAMES = {
  skeleton: ["GRAVE WARDEN", "TOMB HERALD", "MARROW FIEND"],
  goblin:   ["RAID CAPTAIN", "CAVE BRUISER", "MINE TYRANT"],
  undead:   ["DEATH KNIGHT", "DREAD REVENANT", "BONE HERALD"],
};

export const game = {
  state: "menu", // menu | play | levelup | transition | won | lost | map
  players: [],
  localIndex: 0,
  skeletons: [],
  projectiles: [],
  enemyShots: [],
  pickups: [],
  chests: [],
  spawnQueue: [],   // [{x, y, delay, big, kind, faction}]
  dungeonId: "catacombs",
  tier: 0,
  floor: 0,
  roomIndex: 0,
  roomType: "combat",
  roomCleared: false,
  bossDefeated: false,
  xp: 0,
  level: 1,
  pendingLevelUps: 0,
  gold: 0,
  kills: 0,
  killsByFaction: { skeleton: 0, goblin: 0, undead: 0 },
  shake: 0,
  hintT: 0,
  endT: 0,          // delay before showing the result overlay
  transitionT: 0,
  transitionPhase: null, // 'out' | 'in'
  classKey: "warrior",
  time: 0,
  mapSelected: null, // dungeon id currently selected on the world map (showing tier buttons)
  peaceful: false,   // town/lobby: player can move but not attack
  padTi: -1,         // lobby: tier pad the player is currently standing on
  padDwell: 0,       // lobby: dwell timer toward entering that pad's tier
  lobbyDungeonId: null,
  townNpcs: [],
  nearbyNpc: null,
  shopStock: [],
  raidMode: false,
  raidFaction: null,
  justWonGame: false, // set the run you become Champion (first full clear)
  justWonFinale: false, // set when you beat the Champion-only finale

  get localPlayer() { return this.players[this.localIndex]; },
  enemies() { return this.skeletons; },
  floorCfg() { return dungeonFloorCfg(); },
  plan() { return dungeonFloorCfg().plan; },
  xpNext() { return 25 + (this.level - 1) * 15; },

  nearestAlivePlayer(x, y) {
    let best = null, bestD = Infinity;
    for (const p of this.players) {
      if (!p.alive()) continue;
      const d = dist(x, y, p.x, p.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  },

  addXP(n) {
    this.xp += n;
    while (this.xp >= this.xpNext()) {
      this.xp -= this.xpNext();
      this.level++;
      this.pendingLevelUps++;
    }
  },
};

// ---- save / resume ----

export function writeSave() {
  const pl = game.players[0];
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      classKey: pl.classKey, dungeonId: game.dungeonId, tier: game.tier,
      floor: game.floor, floorMode: !!game.floorMode, level: game.level, xp: game.xp,
      gold: game.gold, kills: game.kills, time: game.time,
      maxHp: pl.maxHp, hp: pl.hp, killHeal: pl.killHeal,
      runBuffs: pl.runBuffs, stats: pl.stats,
    }));
  } catch (e) { /* private browsing etc. */ }
  if (game.hero) {
    game.hero.level = game.level;
    game.hero.xp = game.xp;
    profile.save();
  }
}

export function readSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

// A save is only resumable if it matches the current run mode. Phase 1
// retired the classic single-room path, so a save from before that (or one
// otherwise missing floorMode) would resume as the wrong layout — discard it
// and offer no Continue rather than dropping the player into a broken room.
export function usableSave() {
  const s = readSave();
  if (!s || !CLASSES[s.classKey]) return null;
  if (!s.floorMode) { clearSave(); return null; }
  return s;
}


export function freshGameState() {
  game.bossDefeated = false;
  game.pendingLevelUps = 0;
  game.hintT = 7;
  menuEl.classList.add("hidden");
  hubEl.classList.add("hidden");
  resultEl.classList.add("hidden");
  levelupEl.classList.add("hidden");
  game.state = "play";
}
