"use strict";
(function (DD) {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // Opt-in 3D dungeon rendering (?3d). DD.render3d is supplied by the module
  // boot in index.html once the Kenney kit has loaded. Set before that module
  // runs so it knows whether to spin up at all.
  const params = new URLSearchParams(location.search);
  DD.use3d = params.has("3d");
  const canvas3d = document.getElementById("game3d");
  let lastDt = 0; // most recent frame dt, for 3D animation mixers
  let camMode3d = params.get("cam") === "fixed" ? "fixed" : "follow"; // follow default; 'C' toggles
  const camTest = params.has("camtest"); // live camera-tuning controls + readout
  const safeMode = camTest || params.has("safe"); // freeze + disarm enemies for tweaking

  function fitCanvas() {
    canvas.width = Math.max(320, window.innerWidth);
    canvas.height = Math.max(320, window.innerHeight);
    ctx.imageSmoothingEnabled = false; // resets on resize
    if (DD.use3d && canvas3d) {
      canvas3d.width = canvas.width;
      canvas3d.height = canvas.height;
      if (DD.render3d) DD.render3d.resize(canvas.width, canvas.height);
    }
    DD.updateView(canvas);
  }

  function sizeRoomToCanvas() {
    const d = DD.roomSizeForCanvas(canvas);
    DD.setRoomSize(d.tw, d.th);
  }

  const menuEl = document.getElementById("menu");
  const resultEl = document.getElementById("result");
  const resultTitle = document.getElementById("result-title");
  const resultStats = document.getElementById("result-stats");
  const levelupEl = document.getElementById("levelup");
  const upgradeCardsEl = document.getElementById("upgrade-cards");
  const continueBtn = document.getElementById("btn-continue");
  const hubEl = document.getElementById("hub");

  const SAVE_KEY = "dungeondash_save_v1";

  // The dungeon: each floor ends with a boss, then a shop before the next
  // floor. Clear the last boss to win the run.
  // DUNGEONS map — add new dungeons here without touching run logic.
  // Each dungeon: id, name, faction, enemyLabel, floors[], tiers[]
  // floors[] = room content per floor (kinds, eliteKinds, plan)
  // tiers[] = stat scaling per difficulty door (scale, boss stats)
  const DUNGEONS = {
    catacombs: {
      id: "catacombs", name: "Catacombs", faction: "skeleton", enemyLabel: "Skeletons",
      floors: [
        { name: "Upper Catacombs",
          kinds: ["melee", "shade"], eliteKinds: ["melee"],
          plan: ["combat", "combat", "treasure", "combat", "boss"] },
        { name: "Deep Catacombs",
          kinds: ["melee", "archer", "shade"], eliteKinds: ["archer", "shade"],
          plan: ["combat", "trap", "combat", "elite", "treasure", "combat", "boss"] },
        { name: "Catacombs Core",
          kinds: ["melee", "archer", "shade"], eliteKinds: ["melee", "archer", "shade"],
          plan: ["combat", "elite", "trap", "combat", "treasure", "combat", "boss"] },
      ],
      tiers: [
        { tier: 0, levelHint: "1-10",  scale: 1.0, bossHp: 70,  bossDmg: 2, bossName: "SKELETON KING",  summonKind: "melee"  },
        { tier: 1, levelHint: "11-20", scale: 3.0, bossHp: 160, bossDmg: 4, bossName: "SKELETON KING",  summonKind: "archer" },
        { tier: 2, levelHint: "21-30", scale: 6.0, bossHp: 280, bossDmg: 7, bossName: "SKELETON KING",  summonKind: "bomber" },
      ],
    },
    goblinMines: {
      id: "goblinMines", name: "Goblin Mines", faction: "goblin", enemyLabel: "Goblins",
      floors: [
        { name: "Mine Entrance",
          kinds: ["goblin", "goblinArcher"], eliteKinds: ["goblin"],
          plan: ["combat", "combat", "treasure", "combat", "boss"] },
        { name: "Deep Mines",
          kinds: ["goblin", "goblinArcher", "goblinBomber", "goblinBerserker", "goblinShaman"], eliteKinds: ["goblinArcher", "goblinShaman"],
          plan: ["combat", "trap", "combat", "elite", "treasure", "combat", "boss"] },
        { name: "Warlord's Den",
          kinds: ["goblin", "goblinArcher", "goblinBomber", "goblinBerserker", "goblinShaman"], eliteKinds: ["goblin", "goblinBerserker", "goblinShaman"],
          plan: ["combat", "elite", "trap", "combat", "treasure", "combat", "boss"] },
      ],
      tiers: [
        { tier: 0, levelHint: "1-10",  scale: 1.1, bossHp: 80,  bossDmg: 2, bossName: "GOBLIN WARLORD", summonKind: "goblin"          },
        { tier: 1, levelHint: "11-20", scale: 3.3, bossHp: 175, bossDmg: 5, bossName: "GOBLIN WARLORD", summonKind: "goblinBerserker"  },
        { tier: 2, levelHint: "21-30", scale: 6.5, bossHp: 300, bossDmg: 8, bossName: "GOBLIN WARLORD", summonKind: "goblinShaman"     },
      ],
    },
    crypt: {
      id: "crypt", name: "The Crypt", faction: "undead", enemyLabel: "Undead",
      floors: [
        { name: "Outer Crypt",
          kinds: ["zombie", "warlock"], eliteKinds: ["zombie"],
          plan: ["combat", "combat", "treasure", "combat", "boss"] },
        { name: "Inner Crypt",
          kinds: ["zombie", "warlock", "necromancer"], eliteKinds: ["warlock", "necromancer"],
          plan: ["combat", "trap", "combat", "elite", "treasure", "combat", "boss"] },
        { name: "Lich's Sanctum",
          kinds: ["zombie", "warlock", "necromancer"], eliteKinds: ["zombie", "warlock"],
          plan: ["combat", "elite", "trap", "combat", "treasure", "combat", "boss"] },
      ],
      tiers: [
        { tier: 0, levelHint: "1-10",  scale: 1.2, bossHp: 90,  bossDmg: 3, bossName: "THE LICH", summonKind: "zombie"      },
        { tier: 1, levelHint: "11-20", scale: 3.6, bossHp: 190, bossDmg: 5, bossName: "THE LICH", summonKind: "warlock"     },
        { tier: 2, levelHint: "21-30", scale: 7.0, bossHp: 320, bossDmg: 9, bossName: "THE LICH", summonKind: "necromancer" },
      ],
    },
  };

  // Merge the active floor's content + tier's stats into one flat config object.
  // All run logic reads game.floorCfg() — adding new dungeons requires only a DUNGEONS entry.
  function dungeonFloorCfg() {
    const d = DUNGEONS[game.dungeonId] || DUNGEONS.catacombs;
    const flr = d.floors[Math.min(game.floor, d.floors.length - 1)];
    const tier = d.tiers[Math.min(game.tier, d.tiers.length - 1)];
    return {
      ...flr,
      ...tier,
      faction: d.faction,
      enemyLabel: d.enemyLabel,
      id: d.id,
      boss: tier.bossName, // alias used by Boss constructor
    };
  }

  // Hero level required to enter each tier (bands are 1-10 / 11-20 / 21-30).
  const TIER_REQ = [1, 11, 21];

  const ELITE_NAMES = {
    skeleton: ["GRAVE WARDEN", "TOMB HERALD", "MARROW FIEND"],
    goblin:   ["RAID CAPTAIN", "CAVE BRUISER", "MINE TYRANT"],
    undead:   ["DEATH KNIGHT", "DREAD REVENANT", "BONE HERALD"],
  };

  const game = {
    state: "menu", // menu | play | levelup | transition | won | lost | map
    players: [],
    localIndex: 0,
    skeletons: [],
    projectiles: [],
    enemyShots: [],
    pickups: [],
    chests: [],
    shopItems: [],
    shopkeeper: null,
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
    raidMode: false,
    raidFaction: null,

    get localPlayer() { return this.players[this.localIndex]; },
    enemies() { return this.skeletons; },
    floorCfg() { return dungeonFloorCfg(); },
    plan() { return dungeonFloorCfg().plan; },
    xpNext() { return 25 + (this.level - 1) * 15; },

    nearestAlivePlayer(x, y) {
      let best = null, bestD = Infinity;
      for (const p of this.players) {
        if (!p.alive()) continue;
        const d = DD.dist(x, y, p.x, p.y);
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
  DD.game = game;

  // ---- save / resume ----

  function writeSave() {
    const pl = game.players[0];
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        classKey: pl.classKey, dungeonId: game.dungeonId, tier: game.tier,
        floor: game.floor, level: game.level, xp: game.xp,
        gold: game.gold, kills: game.kills, time: game.time,
        maxHp: pl.maxHp, hp: pl.hp, killHeal: pl.killHeal,
        runBuffs: pl.runBuffs, stats: pl.stats,
      }));
    } catch (e) { /* private browsing etc. */ }
    if (game.hero) {
      game.hero.level = game.level;
      game.hero.xp = game.xp;
      DD.profile.save();
    }
  }

  function readSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  function refreshContinueButton() {
    const save = readSave();
    if (save && DD.CLASSES[save.classKey]) {
      const dungeonName = save.dungeonId && DUNGEONS[save.dungeonId] ? DUNGEONS[save.dungeonId].name : "Dungeon";
      continueBtn.textContent =
        `Continue — ${dungeonName} Fl.${save.floor + 1}, ${DD.CLASSES[save.classKey].name} Lv ${save.level}`;
      continueBtn.classList.remove("hidden");
    } else {
      continueBtn.classList.add("hidden");
    }
  }

  // ---- run lifecycle ----

  function freshGameState() {
    game.bossDefeated = false;
    game.pendingLevelUps = 0;
    game.hintT = 7;
    menuEl.classList.add("hidden");
    hubEl.classList.add("hidden");
    resultEl.classList.add("hidden");
    levelupEl.classList.add("hidden");
    game.state = "play";
  }

  function startRun(classKey, dungeonId = "catacombs", tier = 0) {
    clearSave();
    const hero = DD.profile.getOrCreateHero(classKey);
    game.hero = hero;
    game.classKey = classKey;
    game.dungeonId = dungeonId;
    game.tier = tier;
    game.peaceful = false;
    game.raidMode = false;
    game.townNpcs = [];
    game.nearbyNpc = null;
    DD.room.setTheme((DUNGEONS[dungeonId] && DUNGEONS[dungeonId].theme) || dungeonId);
    game.players = [new DD.Player(classKey, 0, 0, DD.input, hero)];
    game.localIndex = 0;
    game.floor = 0;
    game.xp = hero.xp || 0;
    game.level = hero.level || 1;
    game.gold = 0;
    game.kills = 0;
    game.time = 0;
    loadRoom(0);
    freshGameState();
  }

  function resumeRun(save) {
    const hero = DD.profile.getOrCreateHero(save.classKey);
    game.hero = hero;
    game.classKey = save.classKey;
    const pl = new DD.Player(save.classKey, 0, 0, DD.input, hero);
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
    game.dungeonId = save.dungeonId || "catacombs";
    game.tier = save.tier || 0;
    game.peaceful = false;
    DD.room.setTheme(game.dungeonId);
    game.floor = save.floor;
    game.xp = hero ? (hero.xp || 0) : (save.xp || 0);
    game.level = hero ? (hero.level || 1) : (save.level || 1);
    game.gold = save.gold;
    game.kills = save.kills;
    game.time = save.time;
    loadRoom(game.plan().length - 1);
    freshGameState();
  }

  function loadRoom(index) {
    const cfg = game.floorCfg();
    game.roomIndex = index;
    game.roomType = cfg.plan[index];
    game.roomCleared = false;
    sizeRoomToCanvas(); // each room is generated to fill the current screen
    DD.room.generate({ spikes: game.roomType === "trap" });
    DD.updateView(canvas);
    game.skeletons = [];
    game.projectiles = [];
    game.enemyShots = [];
    game.pickups = [];
    game.chests = [];
    game.shopItems = [];
    game.shopkeeper = null;
    game.spawnQueue = [];
    game.shake = 0;
    game.endT = 0;
    DD.particles.clear();
    sendRoomToGuest();

    // everyone enters at the bottom, side by side
    game.players.forEach((p, i) => {
      p.x = DD.WIDTH / 2 + (i - (game.players.length - 1) / 2) * 36;
      p.y = DD.HEIGHT - DD.TILE * 2.5;
    });

    const pl = game.players[0];
    const spawnDist = Math.min(170, DD.WIDTH * 0.35);
    const areaScale = Math.min(1, (DD.ROOM_W * DD.ROOM_H) / (30 * 18) + 0.25);

    const faction = cfg.faction || "skeleton";
    if (game.roomType === "combat") {
      const tier = cfg.plan.slice(0, index).filter((t) => t === "combat").length;
      const count = Math.max(5, Math.round((6 + tier * 3 + game.floor * 2) * areaScale));
      const kinds = cfg.kinds || ["melee"];
      // A handful start dormant on the floor (Skeletons_Inactive_Floor_Pose) and
      // wake when a player approaches; the rest rise in via the staggered queue.
      const inactiveCount = Math.min(5, Math.max(0, count - 2));
      for (let i = 0; i < count; i++) {
        const pos = DD.room.randomFloorPos(pl.x, pl.y, spawnDist);
        const kind = i > 1 && Math.random() < 0.4 ? DD.choice(kinds) : kinds[0];
        if (i < inactiveCount) {
          game.skeletons.push(new DD.Skeleton(pos.x, pos.y, {
            kind, faction, inactive: true, scale: cfg.scale,
            grade: DD.rollGrade(game.floor, game.tier),
          }));
        } else {
          game.spawnQueue.push({ x: pos.x, y: pos.y, delay: 0.6 + (i - inactiveCount) * 0.4, big: false, kind, faction });
        }
      }
      const bruteKind = kinds.find((k) => k !== "shade") || "melee";
      for (let i = 0; i < tier + Math.max(0, game.floor - 1); i++) {
        const pos = DD.room.randomFloorPos(pl.x, pl.y, spawnDist);
        game.spawnQueue.push({ x: pos.x, y: pos.y, delay: 1.4 + i * 0.8, big: true, kind: bruteKind, faction });
      }
    } else if (game.roomType === "elite") {
      const eliteKinds = cfg.eliteKinds || cfg.kinds || ["melee"];
      const eliteKind = DD.choice(eliteKinds);
      const eliteNames = ELITE_NAMES[faction] || ELITE_NAMES.skeleton || ["ELITE"];
      const pos = DD.room.randomFloorPos(pl.x, pl.y, spawnDist);
      game.spawnQueue.push({
        x: pos.x, y: pos.y, delay: 0.8, big: true, kind: eliteKind, faction,
        elite: true, name: DD.choice(eliteNames),
      });
      const minionKinds = (cfg.kinds || ["melee"]).filter((k) => k !== "shade");
      for (let i = 0; i < 2; i++) {
        const mp = DD.room.randomFloorPos(pl.x, pl.y, spawnDist);
        game.spawnQueue.push({
          x: mp.x, y: mp.y, delay: 1.6 + i * 0.5, big: false,
          kind: DD.choice(minionKinds), faction,
        });
      }
    } else if (game.roomType === "treasure") {
      const spots = [];
      const spacing = Math.min(110, DD.WIDTH * 0.25);
      for (let i = 0; i < 3; i++) {
        let pos;
        let tries = 0;
        do {
          pos = DD.room.randomFloorPos(pl.x, pl.y, spacing);
          tries++;
        } while (tries < 30 && spots.some((s) => DD.dist(s.x, s.y, pos.x, pos.y) < spacing));
        spots.push(pos);
        game.chests.push(new DD.Chest(pos.x, pos.y));
      }
    } else if (game.roomType === "trap") {
      // gauntlet: door is open from the start; loot waits on the far side
      game.roomCleared = true;
      DD.room.doorOpen = true;
      game.chests.push(new DD.Chest(DD.WIDTH / 2, DD.TILE * 2.6));
      for (let i = 0; i < 5; i++) {
        game.pickups.push(new DD.Pickup("coin", DD.rand(DD.TILE * 2, DD.WIDTH - DD.TILE * 2), DD.TILE * DD.rand(1.8, 3.2)));
      }
    } else if (game.roomType === "boss") {
      game.skeletons.push(new DD.Boss(DD.WIDTH / 2, DD.HEIGHT / 2 - 60, {
        hp: cfg.bossHp, dmg: cfg.bossDmg, name: cfg.boss, summonKind: cfg.summonKind, faction: cfg.faction,
      }));
    } else if (game.roomType === "shop") {
      game.roomCleared = true;
      DD.room.doorOpen = true;
      const cy = DD.HEIGHT / 2;
      const gap = Math.min(140, DD.WIDTH / 4);
      const upgrade = DD.choice(DD.UPGRADES);
      game.shopItems = [
        new DD.ShopItem("heal", DD.WIDTH / 2 - gap, cy, 12, "Full Heal"),
        new DD.ShopItem("maxhp", DD.WIDTH / 2, cy, 20, "+3 Max HP"),
        new DD.ShopItem("upgrade", DD.WIDTH / 2 + gap, cy, 28, upgrade.name, upgrade),
      ];
      game.shopkeeper = DD.makeShopkeeper(DD.WIDTH / 2, cy - DD.TILE * 2);
    }
  }

  function setRoomCleared() {
    game.roomCleared = true;

    // co-op: fallen players return at the room entrance with a sliver of HP
    if (game.players.length > 1) {
      for (const p of game.players) {
        if (p.dead || p.downed) {
          p.dead = false;
          p.downed = false;
          p.hp = Math.max(1, Math.ceil(p.maxHp * 0.25));
          p.x = DD.WIDTH / 2;
          p.y = DD.HEIGHT - DD.TILE * 2.5;
          p.iframes = 1.5;
        }
      }
    }

    if (game.roomType === "boss") {
      const dungeon = DUNGEONS[game.dungeonId] || DUNGEONS.catacombs;
      if (game.floor >= dungeon.floors.length - 1) {
        endRun(true);
      } else {
        writeSave();
        DD.room.doorOpen = true;
        DD.audio.door();
        const nextFloor = dungeon.floors[game.floor + 1];
        DD.particles.text(DD.WIDTH / 2, DD.TILE * 2.2,
          `Floor cleared! Onward to ${nextFloor ? nextFloor.name : "the depths"}...`, "#ffd95e");
      }
    } else {
      DD.room.doorOpen = true;
      DD.audio.door();
      DD.particles.text(DD.WIDTH / 2, DD.TILE * 2.2, "The door creaks open...", "#ffd95e");
    }
  }

  function startTransition() {
    game.state = "transition";
    game.transitionPhase = "out";
    game.transitionT = 0;
  }

  function advanceRoom() {
    if (game.roomIndex + 1 < game.plan().length) {
      loadRoom(game.roomIndex + 1);
    } else {
      game.floor++;
      loadRoom(0);
    }
  }

  function endRun(won) {
    clearSave();
    if (game.hero) {
      game.hero.level = game.level;
      game.hero.xp = game.xp;
      // gold is only banked on a successful run; dying forfeits the run's gold
      if (won) game.hero.gold = Math.max(0, (game.hero.gold || 0) + game.gold);
      game.hero.kills = (game.hero.kills || 0) + game.kills;
      if (!won) game.hero.deaths = (game.hero.deaths || 0) + 1;
      DD.profile.progressQuests({ kills: game.kills, floor: game.floor + (won ? 1 : 0), won });
      DD.profile.save();
    }
    game.state = won ? "won" : "lost";
    game.endT = won ? 1.4 : 1.2;
    if (won) {
      DD.room.doorOpen = true;
      DD.audio.win();
    } else {
      DD.audio.lose();
    }
    if (DD.net.role === "host" && DD.net.connected) {
      DD.net.send({
        t: "end", won,
        stats: { level: game.level, floor: game.floor, ri: game.roomIndex, kills: game.kills, gold: game.gold, time: game.time },
      });
    }
  }

  function showResult() {
    const won = game.state === "won";
    resultTitle.textContent = won ? "DUNGEON CLEARED!" : "YOU DIED";
    resultTitle.style.color = won ? "#ffd95e" : "#ff5252";
    const dungeon = DUNGEONS[game.dungeonId] || DUNGEONS.catacombs;
    const floorName = (dungeon.floors[game.floor] || {}).name || `Floor ${game.floor + 1}`;
    resultStats.innerHTML =
      `${DD.CLASSES[game.classKey].name} Lv ${game.level} &nbsp;•&nbsp; ` +
      `${floorName}, Room ${game.roomIndex + 1} &nbsp;•&nbsp; ` +
      `${game.kills} kills &nbsp;•&nbsp; ${game.gold} gold &nbsp;•&nbsp; ` +
      `${game.time.toFixed(1)}s`;
    resultEl.classList.remove("hidden");
  }

  // ---- hero hub ----

  const ATTR_LABELS = { might: "Might", agility: "Agility", focus: "Focus", vitality: "Vitality" };
  const ATTR_DESCS  = { might: "DMG +0.5", agility: "SPD +5", focus: "Range +2", vitality: "HP +1.5" };

  function buildHub(hero) {
    const cls = DD.CLASSES[hero.classKey];
    document.getElementById("hub-portrait").src = DD.sprites.players[hero.classKey][0].toDataURL();
    document.getElementById("hub-hero-name").textContent = `${cls.name} · Lv ${hero.level}`;
    document.getElementById("hub-hero-meta").textContent =
      `${hero.gold || 0} gold  •  ${hero.kills || 0} kills  •  ${hero.deaths || 0} deaths`;

    // XP bar
    const xpNext = 25 + (hero.level - 1) * 15;
    document.getElementById("hub-xp-fill").style.width = (Math.min(1, (hero.xp || 0) / xpNext) * 100) + "%";
    document.getElementById("hub-xp-label").textContent = `${hero.xp || 0} / ${xpNext} XP to next level`;

    // Derived stats
    const s = DD.deriveStats(hero);
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
    for (const attr of DD.ATTRS) {
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
          DD.profile.save();
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
        img.src = DD.sprites.items[item.icon].toDataURL();
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
      const active = DD.profile.data.quests.active;
      if (active.length === 0) {
        questsEl.innerHTML = `<div class="hub-quest-row" style="color:#6b5e96">All quests complete!</div>`;
      } else {
        questsEl.innerHTML = active.slice(0, 3).map((q) => {
          const def = DD.profile.questDefs.find((d) => d.id === q.id);
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
    const sv = readSave();
    if (sv && DD.CLASSES[sv.classKey]) {
      const svDungeonName = sv.dungeonId && DUNGEONS[sv.dungeonId] ? DUNGEONS[sv.dungeonId].name : "Dungeon";
      hcBtn.textContent = `Continue — ${svDungeonName} Fl.${sv.floor + 1}, ${DD.CLASSES[sv.classKey].name} Lv ${sv.level}`;
      hcBtn.classList.remove("hidden");
    } else {
      hcBtn.classList.add("hidden");
    }
  }

  function showHub(hero) {
    game.state = "hub";
    game.hero = hero;
    menuEl.classList.add("hidden");
    resultEl.classList.add("hidden");
    hubEl.classList.remove("hidden");
    buildHub(hero);
  }

  // Called when player picks a class from the class-select screen.
  // Creates/switches the hero profile then goes to the world map.
  function selectClass(classKey) {
    townSwitchClass = false;
    const hero = DD.profile.getOrCreateHero(classKey);
    game.hero = hero;
    game.classKey = classKey;
    menuEl.classList.add("hidden");
    showMap();
  }

  // Spawn the local hero at the bottom-center of the current room.
  function spawnHeroInRoom() {
    const hero = game.hero || DD.profile.getActiveHero();
    game.hero = hero;
    const classKey = (hero && hero.classKey) || game.classKey;
    const pl = new DD.Player(classKey, DD.WIDTH / 2, DD.HEIGHT - DD.TILE * 2.5, DD.input, hero);
    game.players = [pl];
    game.localIndex = 0;
    game.skeletons = [];
    game.projectiles = [];
    game.enemyShots = [];
    game.pickups = [];
    game.chests = [];
    game.shopItems = [];
    game.shopkeeper = null;
    game.spawnQueue = [];
    DD.particles.clear();
  }

  function hideAllOverlays() {
    hubEl.classList.add("hidden");
    resultEl.classList.add("hidden");
    menuEl.classList.add("hidden");
    document.getElementById("stats-overlay").classList.add("hidden");
    document.getElementById("raid-warning").classList.add("hidden");
  }

  // Themed entry room with three tier doorways. Walk through one to start a run.
  function showDungeonLobby(dungeonId) {
    if (!DUNGEONS[dungeonId]) return;
    hideAllOverlays();
    game.state = "lobby";
    game.peaceful = true;
    game.lobbyDungeonId = dungeonId;
    game.dungeonId = dungeonId;
    game.time = 0;
    game.nearbyNpc = null;
    game.townNpcs = [];
    sizeRoomToCanvas();
    DD.room.setTheme(dungeonId);
    const lvl = (game.hero && game.hero.level) || 1;
    const tierInfo = DUNGEONS[dungeonId].tiers.map((t, ti) => {
      const req = TIER_REQ[ti] || 0;
      return {
        sub: t.levelHint, color: ["#9affb0", "#ffd95e", "#ff7a7a"][ti] || "#d8cfee",
        locked: lvl < req, req,
      };
    });
    DD.room.generateLobby(tierInfo);
    DD.updateView(canvas);
    spawnHeroInRoom();
    game.padTi = -1;
    game.padDwell = 0;
  }

  function tierLocked(ti) {
    return ((game.hero && game.hero.level) || 1) < (TIER_REQ[ti] || 0);
  }

  function enterTierDoor(ti) {
    if (tierLocked(ti)) {
      townToast(`Reach level ${TIER_REQ[ti]} to enter Tier ${ti + 1}`, "#ff6b70");
      return;
    }
    const classKey = (game.hero && game.hero.classKey) || game.classKey;
    startRun(classKey, game.lobbyDungeonId, ti);
  }

  function spawnTownNpcs() {
    const y = DD.HEIGHT * 0.45;
    const slots = [0.22, 0.41, 0.59, 0.78];
    const defs = [
      { id: "barkeep",    label: "Barkeep",     sprite: "npcBarkeep",    interact: openBarkeepMenu },
      { id: "innkeeper",  label: "Innkeeper",   sprite: "npcInnkeeper",  interact: openInnkeeperMenu },
      { id: "trader",     label: "Trader",      sprite: "npcTrader",     interact: openTraderMenu },
      { id: "questgiver", label: "Quest Giver", sprite: "npcQuestGiver", interact: openQuestGiverMenu },
    ];
    return defs.map((d, i) => ({ ...d, x: DD.WIDTH * slots[i], y, r: 14, bob: Math.random() * Math.PI * 2 }));
  }

  // Walkable town. 25% of arrivals trigger a raid warning instead.
  function showTownRoom(skipRaid) {
    hideAllOverlays();
    if (!skipRaid && Math.random() < 0.25) { showRaidWarning(); return; }
    game.state = "town";
    game.peaceful = true;
    game.raidMode = false;
    game.time = 0;
    game.nearbyNpc = null;
    sizeRoomToCanvas();
    DD.room.setTheme("town");
    DD.room.generateTown();
    DD.updateView(canvas);
    spawnHeroInRoom();
    game.townNpcs = spawnTownNpcs();
  }

  function showMap() {
    hideAllOverlays();
    game.state = "map";
    game.mapSelected = null;
    game.peaceful = false;
    game.townNpcs = [];
    game.nearbyNpc = null;
    sizeRoomToCanvas();
    DD.updateView(canvas);
  }

  // ---- town NPC interactions ----

  let townSwitchClass = false;

  const statsOverlayEl = document.getElementById("stats-overlay");

  function openBarkeepMenu() {
    if (!game.hero) return;
    game.state = "stats";
    buildStatsOverlay(game.hero);
    statsOverlayEl.classList.remove("hidden");
  }

  function closeStatsOverlay() {
    statsOverlayEl.classList.add("hidden");
    if (game.hero) rebaseLocalPlayer();
    game.state = "town";
  }

  function openInnkeeperMenu() {
    townSwitchClass = true;
    game.state = "menu";
    menuEl.classList.remove("hidden");
    refreshContinueButton();
    setMenuMode(null, "INNKEEPER — pick a new class. Your level, gold and gear are kept.");
  }

  function openTraderMenu() {
    townToast("Trader — coming soon!", "#ffd95e");
  }

  function openQuestGiverMenu() {
    townToast("Quest Giver — coming soon!", "#9affb0");
  }

  function townToast(text, color) {
    // centered on-screen so short placeholder messages never run off a narrow phone
    DD.particles.text(DD.WIDTH / 2, DD.HEIGHT * 0.66, text, color || "#ffd95e");
  }

  // Change the active hero's class while keeping all progression.
  function switchClass(classKey) {
    if (!DD.CLASSES[classKey] || !game.hero) return;
    game.hero.classKey = classKey;
    game.classKey = classKey;
    DD.profile.save();
    townSwitchClass = false;
    menuEl.classList.add("hidden");
    setMenuMode(null, "");
    showTownRoom(true);
  }

  // ---- raid warning ----

  function showRaidWarning() {
    game.state = "raid-warn";
    game.raidFaction = DD.choice(["goblin", "skeleton", "undead"]);
    const dungeonName = {
      goblin: "Goblin Mines", skeleton: "Catacombs", undead: "The Crypt",
    }[game.raidFaction];
    document.getElementById("raid-text").textContent =
      `Raiders from the ${dungeonName} are attacking the town!`;
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
    return {
      id: "townRaid", name: "Town Under Siege", faction, theme: "town",
      enemyLabel: src.enemyLabel,
      floors: [{ name: "Town Square", kinds: f0.kinds, eliteKinds: f0.eliteKinds, plan: ["combat", "combat", "boss"] }],
      tiers: src.tiers.map((t) => ({ ...t, bossName: "RAID CAPTAIN" })),
    };
  }

  function startRaid() {
    document.getElementById("raid-warning").classList.add("hidden");
    const classKey = (game.hero && game.hero.classKey) || game.classKey;
    DUNGEONS.townRaid = buildRaidDungeon(game.raidFaction);
    startRun(classKey, "townRaid", game.tier);
    game.raidMode = true;
  }

  // ---- barkeep stats overlay ----

  function buildStatsOverlay(hero) {
    const cls = DD.CLASSES[hero.classKey];
    const titleEl = document.getElementById("so-title");
    if (titleEl) titleEl.textContent = `${cls.name} · Lv ${hero.level}`;

    const s = DD.deriveStats(hero);
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
    for (const attr of DD.ATTRS) {
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
          DD.profile.save();
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
        img.src = DD.sprites.items[item.icon].toDataURL();
        slotEl.appendChild(img);
        slotEl.onclick = () => { DD.unequip(hero, slot); DD.profile.save(); buildStatsOverlay(hero); };
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
        img.src = DD.sprites.items[item.icon].toDataURL();
        cell.appendChild(img);
        cell.onclick = () => { DD.equip(hero, item); DD.profile.save(); buildStatsOverlay(hero); };
        cell.onmouseenter = (e) => showInvTooltip(e, hero, item, hero.equipped[item.slot]);
        cell.onmouseleave = hideInvTooltip;
        grid.appendChild(cell);
      }
    }
  }

  function backToMenu() {
    townSwitchClass = false;
    resultEl.classList.add("hidden");
    lobbyEl.classList.add("hidden");
    setMenuMode(null, "");
    DD.room.prerendered = false;
    const hero = DD.profile.getActiveHero();
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

  function coopActive() {
    return DD.net.role === "host" && DD.net.connected && game.players.length > 1;
  }

  function buildUpgradeCards(picks, onPick) {
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

  function openLevelUp() {
    game.state = "levelup";
    DD.audio.levelup();
    const pool = [...DD.UPGRADES];
    const picks = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    lvlHostDone = false;
    lvlGuestDone = !coopActive();
    if (coopActive()) DD.net.send({ t: "lvl", ids: picks.map((u) => u.id) });
    buildUpgradeCards(picks, chooseUpgrade);
  }

  function finishLevelUp() {
    game.pendingLevelUps--;
    levelupEl.classList.add("hidden");
    game.state = "play";
    if (coopActive()) DD.net.send({ t: "lvldone" });
  }

  function maybeFinishLevelUp() {
    if (lvlHostDone && (lvlGuestDone || !coopActive())) finishLevelUp();
  }

  function chooseUpgrade(up) {
    if (lvlHostDone) return; // already picked this level
    const pl = game.players[0];
    up.apply(pl);
    if (game.hero) {
      game.hero.attrPoints = (game.hero.attrPoints || 0) + 1;
      DD.profile.save();
    }
    DD.particles.burst(pl.x, pl.y - 20, {
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

  function openInventory() {
    if (!game.hero) return;
    if (game.state !== "play" && game.state !== "hub") return;
    _prevInventoryState = game.state;
    game.state = "inventory";
    renderInventory(game.hero);
    inventoryEl.classList.remove("hidden");
  }

  function closeInventory() {
    inventoryEl.classList.add("hidden");
    invTooltip.classList.add("hidden");
    if (_prevInventoryState === "hub" && game.hero) {
      showHub(game.hero);
    } else {
      game.state = "play";
    }
  }

  function rebaseLocalPlayer() {
    const pl = game.localPlayer;
    if (pl && game.hero) {
      pl.baseStats = DD.deriveStats(game.hero);
      pl.recompute();
      pl.hp = Math.min(pl.hp, pl.maxHp);
    }
  }

  function renderInventory(hero) {
    for (const slot of ["weapon", "armor", "trinket"]) {
      const el = document.getElementById(`inv-slot-${slot}`);
      const item = hero.equipped[slot];
      el.innerHTML = "";
      if (item) {
        el.className = `inv-slot has-item rarity-${item.rarity}`;
        const img = document.createElement("img");
        img.src = DD.sprites.items[item.icon].toDataURL();
        el.appendChild(img);
        el.onclick = () => { DD.unequip(hero, slot); rebaseLocalPlayer(); DD.profile.save(); renderInventory(hero); };
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
        img.src = DD.sprites.items[item.icon].toDataURL();
        cell.appendChild(img);
        cell.onclick = () => {
          DD.equip(hero, item);
          rebaseLocalPlayer();
          DD.profile.save();
          renderInventory(hero);
        };
        cell.onmouseenter = (e) => showInvTooltip(e, hero, item, hero.equipped[item.slot]);
        cell.onmouseleave = hideInvTooltip;
        invGridEl.appendChild(cell);
      }
    }
  }

  function showInvTooltip(e, hero, item, equipped) {
    const lines = DD.itemStatLines(item);
    const compare = equipped ? DD.compareItems(item, equipped) : null;
    const rColor = DD.ITEM_RARITY[item.rarity].color;
    let html =
      `<div class="inv-tooltip-name" style="color:${rColor}">${item.name}</div>` +
      `<div class="inv-tooltip-rarity">${DD.ITEM_RARITY[item.rarity].label} ${item.slot}</div>`;
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

  function hideInvTooltip() { invTooltip.classList.add("hidden"); }

  document.getElementById("btn-inv-close").addEventListener("click", closeInventory);

  // ---- update ----

  function update(dt) {
    // co-op guests don't simulate: they render host snapshots
    if (DD.net.role === "guest") {
      if (guestInGame) DD.particles.update(dt);
      return;
    }

    if (game.state === "hub") {
      if (DD.input.consumeInvTap()) openInventory();
      return;
    }
    if (game.state === "lobby" || game.state === "town") { updatePeaceful(dt); return; }
    if (game.state === "map" || game.state === "menu" || game.state === "levelup" ||
        game.state === "inventory" || game.state === "stats" || game.state === "raid-warn") return;

    if (game.state === "transition") {
      game.transitionT += dt * 2.6;
      if (game.transitionT >= 1) {
        if (game.transitionPhase === "out") {
          advanceRoom();
          game.transitionPhase = "in";
          game.transitionT = 0;
        } else {
          game.state = "play";
        }
      }
      DD.particles.update(dt);
      return;
    }

    game.time += dt;
    game.hintT -= dt;
    game.shake = Math.max(0, game.shake - 30 * dt);

    // staggered skeleton spawns (suppressed in safe mode for camera tweaking)
    for (let i = game.spawnQueue.length - 1; !safeMode && i >= 0; i--) {
      const s = game.spawnQueue[i];
      s.delay -= dt;
      if (s.delay <= 0) {
        const floorCfg = game.floorCfg();
        const grade = s.grade || (s.big || s.elite ? "regular" : DD.rollGrade(game.floor, game.tier));
        game.skeletons.push(new DD.Skeleton(s.x, s.y, {
          big: s.big, kind: s.kind, elite: s.elite, name: s.name,
          scale: floorCfg.scale, faction: s.faction || "skeleton", grade,
        }));
        DD.audio.spawn();
        game.spawnQueue.splice(i, 1);
      }
    }

    if (game.state === "play") {
      if (DD.input.consumeInvTap()) { openInventory(); return; }

      for (const p of game.players) p.update(dt, game);

      // spike traps
      if (DD.room.spikes.length) {
        for (const p of game.players) {
          if (p.alive() && DD.room.spikeUpAt(p.x, p.y, game.time)) {
            p.damage(1, p.x, p.y + 30, game);
          }
        }
      }
    }

    // safe mode: don't run enemy AI/attacks so they stay frozen and harmless
    if (!safeMode) for (const sk of game.skeletons) if (!sk.dead) sk.update(dt, game);
    game.skeletons = game.skeletons.filter((s) => !s.dead);

    for (const pr of game.projectiles) if (!pr.dead) pr.update(dt, game);
    game.projectiles = game.projectiles.filter((p) => !p.dead);

    if (!safeMode) for (const es of game.enemyShots) if (!es.dead) es.update(dt, game);
    game.enemyShots = game.enemyShots.filter((p) => !p.dead);

    for (const pk of game.pickups) if (!pk.dead) pk.update(dt, game);
    game.pickups = game.pickups.filter((p) => !p.dead);

    // chest + shop interaction
    for (const p of game.players) {
      if (!p.alive()) continue;
      for (const ch of game.chests) {
        if (!ch.opened && DD.dist(ch.x, ch.y, p.x, p.y) < ch.r + p.r + 4) ch.open(game);
      }
      for (const it of game.shopItems) {
        if (!it.sold && DD.dist(it.x, it.y, p.x, p.y) < it.r + p.r) it.tryBuy(game, p);
      }
    }

    DD.particles.update(dt);

    if (game.state === "play") {
      if (!game.players.some((p) => p.alive())) {
        endRun(false);
        return;
      }

      // room-clear conditions
      if (!game.roomCleared) {
        if (game.roomType === "treasure") {
          if (game.chests.every((c) => c.opened)) setRoomCleared();
        } else if (game.skeletons.every((s) => s.dying) && game.spawnQueue.length === 0) {
          // dying skeletons are gameplay-dead (fading corpses) — don't block clear
          setRoomCleared();
        }
      }

      // pending level-ups pause the action
      if (game.pendingLevelUps > 0) {
        openLevelUp();
        return;
      }

      // walk through the open door -> next room
      if (game.roomCleared && DD.room.doorOpen &&
          game.players.some((p) => p.alive() && DD.room.inDoorway(p.x, p.y - p.r))) {
        startTransition();
      }
    } else if (game.state === "won" || game.state === "lost") {
      if (game.endT > 0) {
        game.endT -= dt;
        if (game.endT <= 0 && resultEl.classList.contains("hidden")) showResult();
      }
    }
  }

  // Movement-only loop for the town and dungeon-lobby rooms: walk around,
  // talk to NPCs, and step through doorways. No combat.
  function updatePeaceful(dt) {
    game.time += dt;
    const pl = game.players[0];
    if (!pl) return;
    pl.update(dt, game);
    DD.particles.update(dt);

    if (game.state === "town") {
      game.nearbyNpc = null;
      for (const npc of game.townNpcs) {
        if (DD.dist(pl.x, pl.y, npc.x, npc.y) < npc.r + pl.r + 18) { game.nearbyNpc = npc; break; }
      }
      const talk = DD.input.consumeInteract() || DD.input.consumeInvTap();
      if (game.nearbyNpc && talk) { game.nearbyNpc.interact(); return; }
      if (DD.room.doorOpen && DD.room.inDoorway(pl.x, pl.y - pl.r)) showMap();
    } else if (game.state === "lobby") {
      DD.input.consumeInteract();
      const pads = DD.room.tierPads || [];
      const pad = pads.find((p) => DD.dist(pl.x, pl.y, p.x, p.y) < p.r);
      if (!pad || pad.locked) {
        if (pad && pad.locked && game.padTi !== pad.ti) {
          townToast(`Reach level ${pad.req} to enter Tier ${pad.ti + 1}`, "#ff6b70");
        }
        game.padTi = pad ? pad.ti : -1;
        game.padDwell = 0;
      } else {
        if (pad.ti !== game.padTi) { game.padTi = pad.ti; game.padDwell = 0; }
        game.padDwell += dt;
        if (game.padDwell >= 0.7) { enterTierDoor(pad.ti); return; }
      }
    }
  }

  // ---- world map ----

  const MAP_LOCS = [
    { id: "catacombs",   name: "Catacombs",    fx: 0.22, fy: 0.27, kind: "dungeon" },
    { id: "goblinMines", name: "Goblin Mines",  fx: 0.26, fy: 0.68, kind: "dungeon" },
    { id: "town",        name: "Town",          fx: 0.50, fy: 0.50, kind: "town"    },
    { id: "crypt",       name: "The Crypt",     fx: 0.75, fy: 0.28, kind: "dungeon" },
  ];

  // Draw a small pixel-art icon for each location (48×48 in world pixels).
  function drawMapIcon(ctx, loc, cx, cy, hovered) {
    const R = 28;
    ctx.fillStyle = hovered ? "rgba(255,255,255,0.12)" : "rgba(10,8,18,0.55)";
    ctx.beginPath();
    ctx.arc(cx, cy, R + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hovered ? "#ffd95e" : "#6b6481";
    ctx.lineWidth = hovered ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 4, 0, Math.PI * 2);
    ctx.stroke();

    if (loc.id === "catacombs") {
      // skull icon
      ctx.fillStyle = "#e9e6da";
      ctx.beginPath(); ctx.arc(cx, cy - 6, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1a1626";
      ctx.fillRect(cx - 8, cy - 10, 5, 6); ctx.fillRect(cx + 3, cy - 10, 5, 6); // sockets
      ctx.fillRect(cx - 10, cy + 6, 20, 8); // jaw
      ctx.fillStyle = "#e9e6da";
      ctx.fillRect(cx - 9, cy + 7, 18, 6);
      for (let i = 0; i < 4; i++) ctx.fillRect(cx - 7 + i * 5, cy + 10, 3, 4); // teeth
    } else if (loc.id === "goblinMines") {
      // pickaxe icon
      ctx.fillStyle = "#8b9ab5";
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 4);
      ctx.fillRect(-3, -18, 6, 36); // handle
      ctx.restore();
      ctx.fillStyle = "#d8d4e6";
      ctx.save(); ctx.translate(cx - 10, cy - 10);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(20, 0); ctx.lineTo(20, 8); ctx.lineTo(0, 20); ctx.closePath();
      ctx.fill(); ctx.restore();
    } else if (loc.id === "crypt") {
      // coffin / arch icon
      ctx.fillStyle = "#3a1a60";
      ctx.beginPath();
      ctx.arc(cx, cy - 8, 14, Math.PI, 0);
      ctx.lineTo(cx + 14, cy + 14);
      ctx.lineTo(cx - 14, cy + 14);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#9940d0";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#9940d0";
      ctx.beginPath(); ctx.arc(cx, cy - 8, 6, 0, Math.PI * 2); ctx.fill();
    } else if (loc.id === "town") {
      // house icon
      ctx.fillStyle = "#7a5c2e";
      ctx.fillRect(cx - 14, cy - 4, 28, 20);
      ctx.fillStyle = "#6fce6f";
      ctx.beginPath(); ctx.moveTo(cx - 18, cy - 4); ctx.lineTo(cx, cy - 22); ctx.lineTo(cx + 18, cy - 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#4a3020";
      ctx.fillRect(cx - 5, cy + 2, 10, 14); // door
    }
  }

  function drawMap(ctx) {
    const W = DD.WIDTH, H = DD.HEIGHT;
    // stone floor background
    ctx.fillStyle = "#1e1a2e";
    ctx.fillRect(0, 0, W, H);
    // subtle grid
    ctx.strokeStyle = "rgba(80,70,110,0.18)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // path lines between locations
    ctx.strokeStyle = "rgba(180,160,220,0.2)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    const town = MAP_LOCS.find((l) => l.id === "town");
    for (const loc of MAP_LOCS) {
      if (loc.kind !== "dungeon") continue;
      ctx.beginPath();
      ctx.moveTo(town.fx * W, town.fy * H);
      ctx.lineTo(loc.fx * W, loc.fy * H);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // title
    const font = "'Trebuchet MS', Verdana, sans-serif";
    ctx.font = `bold 20px ${font}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#d8cfee";
    ctx.fillText("WORLD MAP", W / 2, 30);
    ctx.font = `12px ${font}`;
    ctx.fillStyle = "#7a6e96";
    ctx.fillText("Click a location to travel there", W / 2, 50);

    const mx = DD.input.mouse.x, my = DD.input.mouse.y;

    // draw locations
    for (const loc of MAP_LOCS) {
      const cx = loc.fx * W, cy = loc.fy * H;
      const hovered = DD.dist(mx, my, cx, cy) < 36;
      drawMapIcon(ctx, loc, cx, cy, hovered);

      // label
      ctx.textAlign = "center";
      ctx.font = `bold 13px ${font}`;
      ctx.fillStyle = hovered ? "#ffd95e" : "#bdb3d6";
      ctx.fillText(loc.name, cx, cy + 46);
    }
    ctx.textAlign = "left";
  }

  // ---- town / lobby rendering ----

  function drawTownNpc(ctx, npc, time) {
    const frames = DD.sprites[npc.sprite] || DD.sprites.npcBarkeep;
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

  // A glowing floor pad that starts a tier when you stand on it.
  function drawTierPad(ctx, pad, time) {
    const font = "'Trebuchet MS', Verdana, sans-serif";
    const col = pad.locked ? "#6b6481" : pad.color;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3 + pad.ti);
    ctx.save();
    ctx.globalAlpha = pad.locked ? 0.12 : 0.18 + 0.14 * pulse;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(pad.x, pad.y, pad.r, pad.r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = pad.locked ? 0.5 : 0.9;
    ctx.beginPath();
    ctx.ellipse(pad.x, pad.y, pad.r, pad.r * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // dwell-to-enter progress ring on the active pad
    if (!pad.locked && game.padTi === pad.ti && game.padDwell > 0) {
      const frac = DD.clamp(game.padDwell / 0.7, 0, 1);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(pad.x, pad.y, pad.r, pad.r * 0.5, 0, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.fillStyle = pad.locked ? "#9b90b8" : col;
    ctx.font = `bold 14px ${font}`;
    ctx.fillText(pad.label, pad.x, pad.y - pad.r * 0.5 - 14);
    ctx.fillStyle = pad.locked ? "#ff8a8a" : "#d8cfee";
    ctx.font = `11px ${font}`;
    ctx.fillText(pad.locked ? `LOCKED · Lv ${pad.req}` : pad.sub, pad.x, pad.y - pad.r * 0.5 - 1);
    ctx.textAlign = "left";
  }

  function drawPeaceful(ctx) {
    DD.room.draw(ctx);
    const time = game.time;
    if (game.state === "lobby" && DD.room.tierPads) {
      for (const pad of DD.room.tierPads) drawTierPad(ctx, pad, time);
    }
    const ents = [];
    for (const p of game.players) if (p && !p.dead) ents.push({ y: p.y, render: () => p.draw(ctx) });
    if (game.state === "town" || game.state === "stats") {
      for (const npc of game.townNpcs) ents.push({ y: npc.y, render: () => drawTownNpc(ctx, npc, time) });
    }
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) e.render();
    DD.particles.draw(ctx);

    // title + prompt
    const font = "'Trebuchet MS', Verdana, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(10,8,18,0.66)";
    ctx.fillRect(DD.WIDTH / 2 - 150, 10, 300, 44);
    ctx.fillStyle = "#ffd95e";
    ctx.font = `bold 19px ${font}`;
    let title, sub;
    if (game.state === "lobby") {
      const dn = (DUNGEONS[game.lobbyDungeonId] || {}).name || "Dungeon";
      title = dn.toUpperCase();
      sub = "Stand on a glowing pad to enter that tier  •  Esc: map";
    } else {
      title = "TOWN";
      sub = DD.input.touchSeen
        ? "Tap an NPC to talk  •  walk up through the door to leave"
        : "Walk to an NPC and press E  •  exit ▲ to the map  •  Esc: map";
    }
    ctx.fillText(title, DD.WIDTH / 2, 32);
    ctx.fillStyle = "#bdb3d6";
    ctx.font = `12px ${font}`;
    ctx.fillText(sub, DD.WIDTH / 2, 48);

    if (game.state === "town" && game.nearbyNpc) {
      const pl = game.players[0];
      ctx.fillStyle = "#ffd95e";
      ctx.font = `bold 13px ${font}`;
      const label = DD.input.touchSeen ? `Tap to talk to ${game.nearbyNpc.label}` : `[E] Talk to ${game.nearbyNpc.label}`;
      ctx.fillText(label, pl.x, pl.y - 40);
    }
    ctx.textAlign = "left";
  }

  // ---- draw ----

  // ---- 3D rendering path (?3d) -------------------------------------------
  // Reuses every entity's existing 2D draw() by capturing it to an offscreen
  // canvas, then standing that up as a camera-facing billboard on the 3D floor.
  // The architecture comes from the InstancedMesh dungeon in js/render3d.js.
  const CAP_W = 96, CAP_H = 128, CAP_AX = 48, CAP_AY = 96; // capture box + (x,y) anchor px

  function captureEntity(ent) {
    let c = ent.__cap;
    if (!c) {
      c = ent.__cap = document.createElement("canvas");
      c.width = CAP_W; c.height = CAP_H;
      ent.__capctx = c.getContext("2d");
    }
    const cx = ent.__capctx;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, CAP_W, CAP_H);
    cx.imageSmoothingEnabled = false;
    cx.translate(CAP_AX - ent.x, CAP_AY - ent.y); // map (ent.x,ent.y) -> (AX,AY)
    ent.draw(cx);
    const dr = DD.render3d;
    const k = dr.CELL / DD.TILE; // px -> world units
    return {
      canvas: c, gx: ent.x / DD.TILE, gy: ent.y / DD.TILE,
      w: CAP_W * k, h: CAP_H * k, cx: CAP_AX / CAP_W, cy: 1 - CAP_AY / CAP_H,
    };
  }

  // Y-rotation so a model (forward = +Z at rot 0) faces a 2D direction. The 2D
  // y axis maps to world Z, x to world X, so forward (sin a, cos a) = (dx, dz).
  function faceFromAim(aim) { return Math.atan2(Math.cos(aim), Math.sin(aim)); }
  function faceFromMove(e) {
    const dx = e.x - (e.__px == null ? e.x : e.__px);
    const dy = e.y - (e.__py == null ? e.y : e.__py);
    e.__px = e.x; e.__py = e.y;
    if (dx * dx + dy * dy > 0.02) e.__face = Math.atan2(dx, dy);
    return e.__face == null ? Math.PI : e.__face;
  }
  const ATK_WIN = 0.5, ATK_WIN_SEQ = 0.85; // attack-animation hold windows (s)

  // Pick the current attack clip (or null) for an entity using its rig:
  // combos cycle one clip per swing; seq rigs play their clips in order across
  // the window (e.g. bow Draw -> Release). Attacks are triggered by atkAnimAt.
  function comboAttack(ent, rig) {
    const fresh = ent.atkAnimAt != null && ent.atkAnimAt !== ent.__lastAtk;
    if (fresh) {
      ent.__lastAtk = ent.atkAnimAt;
      ent.__atkIdx = ent.__atkIdx == null ? 0 : ent.__atkIdx + 1;
    }
    if (ent.atkAnimAt == null) return null;
    const t = game.time - ent.atkAnimAt;
    // players carry their own swing duration (swingLock); skeletons use the
    // generic constants so the window matches the visible swing exactly.
    const win = ent.swingDur || (rig.seq ? ATK_WIN_SEQ : ATK_WIN);
    if (t < 0 || t >= win) return null;
    let clip;
    if (rig.seq) {
      const n = rig.attacks.length;
      clip = rig.attacks[Math.min(n - 1, Math.floor((t / win) * n))];
    } else {
      clip = rig.attacks[(ent.__atkIdx || 0) % rig.attacks.length];
    }
    return { clip, fresh }; // fresh -> force the one-shot to restart
  }
  function rigClip(ent, rig, opts) {
    if (opts.spawn) return { clip: rig.spawn, once: true, timeScale: 1 };
    const atk = comboAttack(ent, rig);
    if (atk) return { clip: atk.clip, once: true, timeScale: rig.attackSpeed || 1, restart: atk.fresh };
    return { clip: opts.moving ? rig.run : rig.idle, once: false, timeScale: 1 };
  }
  function playerClip(p) {
    const rig = DD.char3d.RIG[DD.char3d.classModelKey(p.classKey)];
    if (p.downed) return { clip: rig.death, once: true, timeScale: 1 };
    return rigClip(p, rig, { moving: p.moving });
  }
  function enemyClip(s) {
    const rig = DD.char3d.RIG[DD.char3d.enemyModelKey(s.kind)];
    if (s.dying)                return { clip: rig.death, once: true, timeScale: 1 };
    if (s.state === "inactive") return { clip: rig.inactive || rig.idle, once: false, timeScale: 1 };
    if (s.state === "awaken")   return { clip: rig.awaken || rig.spawn, once: true, timeScale: 1 };
    const atking = s.state === "windup" || s.state === "fuse";
    if (atking && !s.__wasAtk) s.atkAnimAt = game.time; // rising edge of a strike
    s.__wasAtk = atking;
    return rigClip(s, rig, { moving: s.state === "chase", spawn: s.state === "spawn" });
  }

  function drawCombat3D() {
    const dr = DD.render3d;
    // Rebuild the mesh only when the room layout actually changes.
    if (dr._builtVersion !== DD.room.version) {
      const d = DD.room.getData();
      dr.buildRoom({ tiles: d.tiles.split(",").map(Number), w: d.w, h: d.h });
      dr._builtVersion = DD.room.version;
    }

    // Camera mode (fixed whole-room vs follow the local player).
    if (dr.camMode !== camMode3d) dr.setCameraMode(camMode3d);
    if (camMode3d === "follow" && game.localPlayer) {
      const w = dr.cellToWorld(game.localPlayer.x / DD.TILE, game.localPlayer.y / DD.TILE);
      dr.setFollowTarget(w.x, w.z);
    }

    const mgr = DD.charMgr, C = DD.char3d;
    const billboards = [];
    const chars = [];
    const worldOf = (e) => dr.cellToWorld(e.x / DD.TILE, e.y / DD.TILE);
    const asChar = (e, modelKey, rotationY, anim, opacity) => {
      const w = worldOf(e);
      chars.push({ entity: e, modelKey, x: w.x, z: w.z, rotationY, clip: anim.clip, once: anim.once, timeScale: anim.timeScale, restart: anim.restart, opacity: opacity == null ? 1 : opacity });
    };

    // Players + skeletons render as 3D characters once the models have loaded;
    // until then (or if a model is missing) they fall back to billboards.
    for (const p of game.players) {
      if (!p || p.dead) continue;
      const mk = C && C.classModelKey(p.classKey);
      // face the aim direction while a swing is active (root-the-swing model),
      // else face movement; keep faceFromMove ticking so __px/__py stay current.
      const moveFace = faceFromMove(p);
      const face = (p.lockT > 0) ? faceFromAim(p.aim) : moveFace;
      if (mgr && mk && mgr.factory.protos.has(mk)) asChar(p, mk, face, playerClip(p));
      else billboards.push(captureEntity(p));
    }
    for (const s of game.skeletons) {
      if (!s || s.dead) continue;
      const mk = C && C.enemyModelKey(s.kind);
      // fade the corpse out over the tail of the death animation
      const opacity = s.dying ? Math.min(1, s.deathT / 0.7) : 1;
      if (mgr && mk && mgr.factory.protos.has(mk)) asChar(s, mk, faceFromMove(s), enemyClip(s), opacity);
      else billboards.push(captureEntity(s));
    }
    // 3D items (coins/potions/chests); everything else stays a billboard.
    const items = [];
    const asItem = (e, key) => items.push({ entity: e, key, gx: e.x / DD.TILE, gy: e.y / DD.TILE });
    const ITEM_FOR = { coin: "coin", heart: "heart" };
    for (const c of game.chests) {
      if (!c || c.dead) continue;
      if (dr.hasItem("chest")) asItem(c, "chest"); else billboards.push(captureEntity(c));
    }
    for (const pk of game.pickups) {
      if (!pk) continue;
      // coins/hearts by kind; gear drops by their item icon (sword/axe -> 3D)
      let key = ITEM_FOR[pk.kind];
      if (!key && pk.kind === "item" && pk.item) key = pk.item.icon;
      if (key && dr.hasItem(key)) asItem(pk, key); else billboards.push(captureEntity(pk));
    }
    if (game.shopkeeper) billboards.push(captureEntity(game.shopkeeper));
    // arrows render as 3D models oriented along velocity; other shots stay 2D
    const projs = [];
    const asProj = (e) => projs.push({ entity: e, key: "arrow", gx: e.x / DD.TILE, gy: e.y / DD.TILE, rotationY: Math.atan2(e.vx, e.vy) });
    for (const pr of game.projectiles) {
      if (pr.kind === "arrow" && dr.hasProjectile("arrow")) asProj(pr); else billboards.push(captureEntity(pr));
    }
    for (const es of game.enemyShots) {
      if (es.style === "arrow" && dr.hasProjectile("arrow")) asProj(es); else billboards.push(captureEntity(es));
    }

    if (mgr) mgr.sync(chars, lastDt);
    dr.setItems(items);
    dr.setProjectiles(projs);
    dr.setEntities(billboards);
    dr.render();

    // 2D canvas becomes a transparent HUD overlay in screen space.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    DD.hud.draw(ctx, game);
    if (camTest) drawCamTest(dr);
  }

  // On-screen camera buttons for mobile tuning (?camtest). Touch-friendly DOM
  // overlay; the live values are shown by drawCamTest().
  function setupCamButtons() {
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:8px;z-index:30;display:flex;" +
      "flex-wrap:wrap;gap:6px;justify-content:center;pointer-events:none;";
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "pointer-events:auto;min-width:58px;padding:11px 12px;font:bold 13px monospace;" +
        "background:rgba(20,16,30,0.88);color:#9affb0;border:1px solid #4a4368;border-radius:8px;touch-action:manipulation;";
      b.addEventListener("click", (e) => { e.preventDefault(); const dr = DD.render3d; if (dr) fn(dr); });
      bar.appendChild(b);
    };
    mk("Zoom−", (dr) => { dr._camDist *= 1.06; });
    mk("Zoom+", (dr) => { dr._camDist /= 1.06; });
    mk("FOV−", (dr) => { dr.camera.fov = Math.max(15, dr.camera.fov - 2); dr.camera.updateProjectionMatrix(); });
    mk("FOV+", (dr) => { dr.camera.fov = Math.min(90, dr.camera.fov + 2); dr.camera.updateProjectionMatrix(); });
    mk("Tilt−", (dr) => { dr.elev = Math.max(0.1, dr.elev - 0.03); });
    mk("Tilt+", (dr) => { dr.elev = Math.min(1.5, dr.elev + 0.03); });
    mk("Scale−", () => { if (DD.charMgr) DD.charMgr.scaleMul = Math.max(0.3, DD.charMgr.scaleMul - 0.03); });
    mk("Scale+", () => { if (DD.charMgr) DD.charMgr.scaleMul = Math.min(3, DD.charMgr.scaleMul + 0.03); });
    mk("Cam", () => { camMode3d = camMode3d === "follow" ? "fixed" : "follow"; if (DD.render3d) DD.render3d.setCameraMode(camMode3d); });
    document.body.appendChild(bar);
  }

  // Live camera-tuning readout (?camtest). Adjust with arrows (elev/orbit),
  // [ ] (zoom), - = (fov), 9 0 (character scale) — or the on-screen buttons.
  function drawCamTest(dr) {
    const deg = (r) => (r * 180 / Math.PI).toFixed(1);
    const mul = DD.charMgr ? DD.charMgr.scaleMul : 1;
    const heroScale = 1.42 * mul;
    const lines = [
      "CAMERA TEST  (" + camMode3d + ")",
      "elev   " + deg(dr.elev) + "°   [Up/Down]",
      "orbit  " + deg(dr.camAngle) + "°   [Left/Right]",
      "dist   " + dr._camDist.toFixed(1) + "   [ [ / ] ]",
      "fov    " + dr.camera.fov.toFixed(0) + "   [ - / = ]",
      "scale  " + heroScale.toFixed(2) + " (h~" + (2.54 * heroScale).toFixed(1) + "u)  [9/0]",
      "C = toggle fixed/follow",
    ];
    ctx.font = "12px monospace";
    const w = 260, h = lines.length * 16 + 12;
    ctx.fillStyle = "rgba(10,8,18,0.78)";
    ctx.fillRect(canvas.width - w - 8, 8, w, h);
    ctx.fillStyle = "#9affb0";
    ctx.textAlign = "left";
    lines.forEach((s, i) => ctx.fillText(s, canvas.width - w, 26 + i * 16));
  }

  function draw() {
    // 3D path drives combat; menus/inventory/results stay on the 2D canvas.
    if (DD.use3d && DD.render3d && DD.render3d.proto && game.state === "play") {
      drawCombat3D();
      return;
    }

    ctx.fillStyle = "#0e0b16";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(DD.view.ox, DD.view.oy);
    ctx.scale(DD.view.scale, DD.view.scale);

    if (game.state === "map") {
      drawMap(ctx);
      ctx.restore();
      return;
    }

    if (game.state === "lobby" || game.state === "town" || game.state === "stats") {
      drawPeaceful(ctx);
      ctx.restore();
      return;
    }

    if (game.state === "menu" || game.state === "hub") {
      if (!DD.room.prerendered) {
        sizeRoomToCanvas();
        DD.room.setTheme("catacombs"); // neutral backdrop, not the last dungeon's theme
        DD.room.generate();
        DD.updateView(canvas);
      }
      DD.room.prerendered = true;
      DD.room.draw(ctx);
      ctx.restore();
      return;
    }

    ctx.save();
    if (game.shake > 0) {
      ctx.translate(DD.rand(-game.shake, game.shake), DD.rand(-game.shake, game.shake));
    }

    DD.room.draw(ctx);

    for (const it of game.shopItems) it.draw(ctx);
    for (const pk of game.pickups) pk.draw(ctx);

    // y-sort so lower entities draw in front
    const drawables = [...game.skeletons, ...game.chests, ...game.players.filter((p) => !p.dead)];
    if (game.shopkeeper) drawables.push(game.shopkeeper);
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw(ctx);

    for (const pr of game.projectiles) pr.draw(ctx);
    for (const es of game.enemyShots) es.draw(ctx);

    DD.particles.draw(ctx);
    DD.hud.draw(ctx, game);

    ctx.restore(); // shake
    ctx.restore(); // view transform

    // room transition fade covers the whole screen
    if (game.state === "transition") {
      const a = game.transitionPhase === "out" ? game.transitionT : 1 - game.transitionT;
      ctx.fillStyle = `rgba(10, 8, 18, ${DD.clamp(a, 0, 1)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ---- class select cards ----

  function buildClassCards() {
    const holder = document.getElementById("class-cards");
    for (const [key, cfg] of Object.entries(DD.CLASSES)) {
      const card = document.createElement("button");
      card.className = "class-card";
      const img = document.createElement("img");
      img.src = DD.sprites.players[key][0].toDataURL();
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
        DD.audio.unlock();
        if (coopMode === "host-pick") hostWithClass(key);
        else if (coopMode === "join-pick") joinWithClass(key);
        else if (townSwitchClass) switchClass(key);
        else selectClass(key);
      });
      holder.appendChild(card);
    }
  }

  // ---- co-op lobby & networking ----

  let coopMode = null;     // null | 'host-pick' | 'join-pick'
  let guestClass = "warrior";
  let guestInGame = false;

  const lobbyEl = document.getElementById("lobby");
  const lobbyStatus = document.getElementById("lobby-status");
  const lobbyOut = document.getElementById("lobby-out");
  const lobbyIn = document.getElementById("lobby-in");
  const roomCodeEl = document.getElementById("room-code");
  const codeIn = document.getElementById("code-in");
  const modeHint = document.getElementById("menu-mode-hint");

  function showLobby(status, { out = false, input = false } = {}) {
    lobbyStatus.textContent = status;
    lobbyOut.classList.toggle("hidden", !out);
    lobbyIn.classList.toggle("hidden", !input);
    lobbyEl.classList.remove("hidden");
    menuEl.classList.add("hidden");
    hubEl.classList.add("hidden");
  }

  function setMenuMode(mode, hint) {
    coopMode = mode;
    modeHint.textContent = hint || "";
    modeHint.classList.toggle("hidden", !hint);
  }

  function sendRoomToGuest() {
    if (DD.net.role === "host" && DD.net.connected) {
      DD.net.send({ t: "room", room: DD.room.getData(), floor: game.floor, dungeonId: game.dungeonId, tier: game.tier, ri: game.roomIndex, rt: game.roomType });
    }
  }

  async function hostWithClass(classKey) {
    townSwitchClass = false;
    game.classKey = classKey;
    showLobby("Creating a room...");
    try {
      const code = await DD.net.host();
      roomCodeEl.textContent = code;
      showLobby("Tell your friend this room code. Waiting for them to join...", { out: true });
    } catch (e) {
      showLobby("Could not create a room: " + (e.message || e.type || e));
    }
  }

  async function joinWithClass(classKey) {
    townSwitchClass = false;
    guestClass = classKey;
    game.classKey = classKey;
    codeIn.value = "";
    showLobby("Enter the host's room code.", { input: true });
    codeIn.focus();
  }

  document.getElementById("btn-host").addEventListener("click", () => {
    DD.audio.unlock();
    setMenuMode("host-pick", "HOSTING CO-OP — pick your class to create an invite code");
  });
  document.getElementById("btn-join").addEventListener("click", () => {
    DD.audio.unlock();
    setMenuMode("join-pick", "JOINING CO-OP — pick your class first");
  });
  document.getElementById("btn-lobby-back").addEventListener("click", () => {
    DD.net.reset();
    backToMenu();
  });
  async function tryJoin() {
    const code = codeIn.value.trim();
    if (!code) return;
    lobbyStatus.textContent = "Connecting...";
    try {
      await DD.net.join(code);
      // the onOpen handler takes it from here
    } catch (e) {
      DD.net.reset();
      const reason = e && e.type === "peer-unavailable" ? "No game found with that code." :
        (e && (e.message || e.type)) || "Connection failed.";
      showLobby(reason + " Check the code and try again.", { input: true });
    }
  }
  document.getElementById("btn-accept").addEventListener("click", tryJoin);
  codeIn.addEventListener("keydown", (e) => { if (e.key === "Enter") tryJoin(); });

  function startCoopRun(guestClassKey) {
    clearSave();
    const hero = DD.profile.getOrCreateHero(game.classKey);
    game.hero = hero;
    game.players = [
      new DD.Player(game.classKey, 0, 0, DD.input, hero),
      new DD.Player(guestClassKey, 0, 0, new DD.RemoteInput()),
    ];
    game.localIndex = 0;
    game.dungeonId = game.dungeonId || "catacombs";
    game.tier = game.tier || 0;
    game.floor = 0;
    game.xp = hero.xp || 0;
    game.level = hero.level || 1;
    game.gold = 0;
    game.kills = 0;
    game.time = 0;
    loadRoom(0);
    lobbyEl.classList.add("hidden");
    setMenuMode(null, "");
    freshGameState();
  }

  DD.net.onOpen(() => {
    if (DD.net.role === "guest") {
      DD.net.send({ t: "join", cls: guestClass });
      lobbyStatus.textContent = "Connected! Waiting for the host to start...";
      lobbyIn.classList.add("hidden");
    } else {
      lobbyStatus.textContent = "Friend connected! Starting...";
    }
  });

  DD.net.onClose(() => {
    if (DD.net.role === "host") {
      if (game.players.length > 1) {
        game.players.splice(1);
        if (game.localPlayer) {
          DD.particles.text(game.localPlayer.x, game.localPlayer.y - 50, "Friend disconnected — going solo", "#ff9234");
        }
        lvlGuestDone = true;
        maybeFinishLevelUp();
      }
      DD.net.reset();
    } else if (DD.net.role === "guest") {
      DD.net.reset();
      guestInGame = false;
      lobbyEl.classList.add("hidden");
      levelupEl.classList.add("hidden");
      backToMenu();
      setMenuMode(null, "Disconnected from the host.");
    }
  });

  DD.net.onMessage((m) => {
    if (DD.net.role === "host") {
      if (m.t === "join") {
        startCoopRun(DD.CLASSES[m.cls] ? m.cls : "warrior");
      } else if (m.t === "i" && game.players[1]) {
        const inp = game.players[1].input;
        inp.state = { mv: m.mv || { dx: 0, dy: 0 }, aim: m.aim || 0, atk: !!m.atk, dash: !!m.dash };
        if (m.dt) inp._dashTap = true;
      } else if (m.t === "pick") {
        const up = DD.UPGRADES.find((u) => u.id === m.id);
        if (up && game.players[1] && !lvlGuestDone) up.apply(game.players[1]);
        lvlGuestDone = true;
        maybeFinishLevelUp();
      }
      return;
    }

    // guest side
    if (m.t === "room") {
      DD.room.setTheme(m.dungeonId || "catacombs");
      DD.room.setData(m.room);
      DD.updateView(canvas);
      game.floor = m.floor;
      game.dungeonId = m.dungeonId || "catacombs";
      game.tier = m.tier || 0;
      game.roomIndex = m.ri;
      game.roomType = m.rt;
      game.localIndex = 1;
      guestInGame = true;
      DD.particles.clear();
      lobbyEl.classList.add("hidden");
      menuEl.classList.add("hidden");
      hubEl.classList.add("hidden");
      resultEl.classList.add("hidden");
      game.state = "play";
      game.hintT = 6;
    } else if (m.t === "s" && guestInGame) {
      DD.netSync.applySnapshot(game, m);
    } else if (m.t === "lvl") {
      game.state = "levelup";
      DD.audio.levelup();
      let picked = false;
      const picks = m.ids.map((id) => DD.UPGRADES.find((u) => u.id === id)).filter(Boolean);
      buildUpgradeCards(picks, (up) => {
        if (picked) return;
        picked = true;
        DD.net.send({ t: "pick", id: up.id });
        upgradeCardsEl.innerHTML = `<p class="tagline">Waiting for your teammate's pick...</p>`;
      });
    } else if (m.t === "lvldone") {
      levelupEl.classList.add("hidden");
      game.state = "play";
    } else if (m.t === "end") {
      Object.assign(game, {
        level: m.stats.level, floor: m.stats.floor, roomIndex: m.stats.ri,
        kills: m.stats.kills, gold: m.stats.gold, time: m.stats.time,
      });
      game.state = m.won ? "won" : "lost";
      if (m.won) DD.audio.win(); else DD.audio.lose();
      setTimeout(showResult, 1000);
    }
  });

  function sendGuestInput() {
    const lp = game.localPlayer;
    if (!lp) return;
    const msg = {
      t: "i",
      mv: DD.input.moveVector(),
      aim: DD.input.aimAngle(lp),
      atk: DD.input.attacking(),
      dash: !!DD.input.keys.shift,
    };
    if (DD.input.consumeDashTap()) msg.dt = 1;
    DD.net.send(msg);
  }

  // ---- result buttons / shortcuts ----

  // "Play Again" — but a town raid isn't a re-enterable dungeon, so send the
  // player back to the town instead of replaying the raid.
  function playAgain() {
    if (DD.net.role) DD.net.reset();
    if (game.dungeonId === "townRaid") { showTownRoom(true); return; }
    startRun(game.classKey, game.dungeonId, game.tier);
  }

  document.getElementById("btn-again").addEventListener("click", playAgain);
  document.getElementById("btn-class").addEventListener("click", () => {
    if (DD.net.role) DD.net.reset();
    if (game.hero) showMap(); else backToMenu();
  });
  continueBtn.addEventListener("click", () => {
    const save = readSave();
    if (save) { DD.audio.unlock(); resumeRun(save); }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "i" || e.key === "I") {
      if (game.state === "play" || game.state === "hub") { openInventory(); return; }
      if (game.state === "inventory") { closeInventory(); return; }
    }
    if (game.state === "inventory" && e.key === "Escape") { closeInventory(); return; }
    if (game.state === "stats" && e.key === "Escape") { closeStatsOverlay(); return; }
    if ((game.state === "town" || game.state === "lobby") && e.key === "Escape") { showMap(); return; }
    if (game.state === "raid-warn" && e.key === "Escape") { document.getElementById("raid-warning").classList.add("hidden"); showMap(); return; }
    if (game.state === "menu" && townSwitchClass && e.key === "Escape") { townSwitchClass = false; showTownRoom(true); return; }
    if (game.state === "map" && e.key === "Escape") { if (game.hero) showHub(game.hero); else backToMenu(); return; }
    if (game.state === "levelup" && ["1", "2", "3"].includes(e.key)) {
      const up = game.levelUpPicks[Number(e.key) - 1];
      if (up && game.lvlOnPick) game.lvlOnPick(up);
      return;
    }
    if (resultEl.classList.contains("hidden")) return;
    if (e.key === "Enter") { playAgain(); }
    if (e.key === "Escape") { if (DD.net.role) DD.net.reset(); if (game.hero) showMap(); else backToMenu(); }
  });

  // ---- world map click / tap handler ----

  function handleMapTap(clientX, clientY, targetEl) {
    if (game.state !== "map") return false;
    const rect = targetEl.getBoundingClientRect();
    const cx = (clientX - rect.left) * (targetEl.width / rect.width);
    const cy = (clientY - rect.top) * (targetEl.height / rect.height);
    const wx = (cx - DD.view.ox) / DD.view.scale;
    const wy = (cy - DD.view.oy) / DD.view.scale;

    for (const loc of MAP_LOCS) {
      const lx = loc.fx * DD.WIDTH, ly = loc.fy * DD.HEIGHT;
      if (DD.dist(wx, wy, lx, ly) < 52) {
        DD.audio.unlock();
        if (loc.kind === "town") showTownRoom();
        else showDungeonLobby(loc.id);
        return true;
      }
    }
    return false;
  }

  // Tap an NPC in the town to talk to them (mobile has no E key).
  function handleTownTap(clientX, clientY, targetEl) {
    if (game.state !== "town") return false;
    const rect = targetEl.getBoundingClientRect();
    const cx = (clientX - rect.left) * (targetEl.width / rect.width);
    const cy = (clientY - rect.top) * (targetEl.height / rect.height);
    const wx = (cx - DD.view.ox) / DD.view.scale;
    const wy = (cy - DD.view.oy) / DD.view.scale;
    for (const npc of game.townNpcs) {
      if (DD.dist(wx, wy, npc.x, npc.y - 18) < 40) {
        DD.audio.unlock();
        npc.interact();
        return true;
      }
    }
    return false;
  }

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
    DD.audio.unlock();
    if (game.hero) showMap();
  });

  document.getElementById("btn-switch-class").addEventListener("click", () => {
    DD.audio.unlock();
    hubEl.classList.add("hidden");
    menuEl.classList.remove("hidden");
    refreshContinueButton();
    setMenuMode(null, "");
    game.state = "menu";
  });

  document.getElementById("btn-hub-continue").addEventListener("click", () => {
    const sv = readSave();
    if (sv) { DD.audio.unlock(); resumeRun(sv); }
  });

  document.getElementById("btn-hub-host").addEventListener("click", () => {
    DD.audio.unlock();
    if (game.hero) {
      game.classKey = game.hero.classKey;
      hostWithClass(game.hero.classKey);
    }
  });

  document.getElementById("btn-hub-join").addEventListener("click", () => {
    DD.audio.unlock();
    if (game.hero) joinWithClass(game.hero.classKey);
  });

  document.getElementById("btn-hub-inventory").addEventListener("click", () => {
    DD.audio.unlock();
    openInventory();
  });

  // ---- stats overlay + raid buttons ----

  document.getElementById("btn-stats-close").addEventListener("click", closeStatsOverlay);

  document.getElementById("btn-fight-back").addEventListener("click", () => {
    DD.audio.unlock();
    startRaid();
  });

  document.getElementById("btn-flee").addEventListener("click", () => {
    document.getElementById("raid-warning").classList.add("hidden");
    showMap();
  });

  // ---- boot ----

  DD.sprites.init();
  fitCanvas();
  DD.input.init(canvas);
  buildClassCards();
  const _bootHero = DD.profile.getActiveHero();
  if (_bootHero) {
    game.hero = _bootHero;
    game.classKey = _bootHero.classKey;
    showMap();
  } else {
    refreshContinueButton();
  }

  // Dev shortcut for verifying the 3D path: ?dev=combat jumps straight into a
  // solo combat room (skips menus). Not wired to any UI.
  if (params.get("dev") === "combat") {
    document.querySelectorAll(".overlay").forEach((el) => el.classList.add("hidden"));
    const cls = params.get("class"); // ?class=mage|ranger|rogue|warrior
    startRun(DD.CLASSES[cls] ? cls : "warrior");
  }

  // 'C' toggles the 3D camera between fixed (whole-room) and follow (player).
  // With ?camtest, arrow/bracket/etc. keys live-tune the camera + character scale
  // and print the values so we can bake the perfect numbers.
  if (DD.use3d) {
    window.addEventListener("keydown", (e) => {
      if (e.key === "c" || e.key === "C") {
        camMode3d = camMode3d === "follow" ? "fixed" : "follow";
        if (DD.render3d) DD.render3d.setCameraMode(camMode3d);
        return;
      }
      if (!camTest) return;
      const dr = DD.render3d; if (!dr) return;
      switch (e.key) {
        case "ArrowUp":    dr.elev = Math.min(1.5, dr.elev + 0.02); break;     // higher/steeper
        case "ArrowDown":  dr.elev = Math.max(0.1, dr.elev - 0.02); break;     // lower/flatter
        case "ArrowLeft":  dr.camAngle -= 0.05; break;                          // orbit
        case "ArrowRight": dr.camAngle += 0.05; break;
        case "[":          dr._camDist *= 1.05; break;                          // zoom out
        case "]":          dr._camDist /= 1.05; break;                          // zoom in
        case "-": case "_": dr.camera.fov = Math.min(90, dr.camera.fov + 1); dr.camera.updateProjectionMatrix(); break;
        case "=": case "+": dr.camera.fov = Math.max(15, dr.camera.fov - 1); dr.camera.updateProjectionMatrix(); break;
        case "9": if (DD.charMgr) DD.charMgr.scaleMul = Math.max(0.3, DD.charMgr.scaleMul - 0.03); break;
        case "0": if (DD.charMgr) DD.charMgr.scaleMul = Math.min(3, DD.charMgr.scaleMul + 0.03); break;
        default: return;
      }
      e.preventDefault();
    });
    if (camTest) setupCamButtons();
  }

  window.addEventListener("resize", () => {
    fitCanvas();
    // regenerate the backdrop room to fill the new shape; mid-run rooms keep
    // their layout and letterbox until the next room loads
    if (game.state === "menu" || game.state === "hub") {
      DD.room.prerendered = false;
    } else if (game.state === "map") {
      // the map is redrawn each frame from DD.WIDTH/HEIGHT — resync them so it
      // reflows to the new aspect instead of letterboxing the old shape
      sizeRoomToCanvas();
      DD.updateView(canvas);
    } else if (game.state === "town") {
      showTownRoom(true);
    } else if (game.state === "lobby") {
      showDungeonLobby(game.lobbyDungeonId);
    }
  });

  let last = performance.now();
  let netAccum = 0;
  function frame(now) {
    // Clamp to >= 0: on the first frame the rAF timestamp can predate the
    // performance.now() captured at boot, yielding a negative dt that pushes
    // game.time below zero (which broke decoration frame indexing, and could
    // corrupt spawn/animation timers).
    const dt = Math.max(0, Math.min((now - last) / 1000, 1 / 30));
    last = now;
    lastDt = dt; // exposed to the 3D draw path for animation mixers
    update(dt);
    draw();

    // network pump: host streams snapshots, guest streams input
    if (DD.net.connected) {
      netAccum += dt;
      const interval = DD.net.role === "host" ? 1 / 15 : 1 / 30;
      if (netAccum >= interval) {
        netAccum = 0;
        if (DD.net.role === "host" && game.state !== "menu" && game.players.length > 1) {
          DD.net.send(DD.netSync.snapshot(game));
        } else if (DD.net.role === "guest" && guestInGame) {
          sendGuestInput();
        }
      }
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})(window.DD);
