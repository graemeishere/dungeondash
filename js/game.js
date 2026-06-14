"use strict";
(function (DD) {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  function fitCanvas() {
    canvas.width = Math.max(320, window.innerWidth);
    canvas.height = Math.max(320, window.innerHeight);
    ctx.imageSmoothingEnabled = false; // resets on resize
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

  const SAVE_KEY = "dungeondash_save_v1";

  // The dungeon: each floor ends with a boss, then a shop before the next
  // floor. Clear the last boss to win the run.
  const FLOORS = [
    {
      boss: "SKELETON KING", bossHp: 70, bossDmg: 2, scale: 1, summonKind: "melee",
      plan: ["combat", "combat", "treasure", "combat", "boss", "shop"],
    },
    {
      boss: "BONE EMPEROR", bossHp: 105, bossDmg: 2, scale: 1.45, summonKind: "archer",
      plan: ["combat", "trap", "combat", "elite", "treasure", "combat", "boss", "shop"],
    },
    {
      boss: "THE DEATHLESS", bossHp: 145, bossDmg: 3, scale: 1.95, summonKind: "bomber",
      plan: ["combat", "elite", "trap", "combat", "treasure", "combat", "boss"],
    },
  ];

  const ELITE_NAMES = ["GRAVE WARDEN", "TOMB HERALD", "MARROW FIEND"];

  const game = {
    state: "menu", // menu | play | levelup | transition | won | lost
    players: [],
    localIndex: 0,
    skeletons: [],
    projectiles: [],
    enemyShots: [],
    pickups: [],
    chests: [],
    shopItems: [],
    shopkeeper: null,
    spawnQueue: [],   // [{x, y, delay, big, kind}]
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

    get localPlayer() { return this.players[this.localIndex]; },
    enemies() { return this.skeletons; },
    floorCfg() { return FLOORS[this.floor]; },
    plan() { return FLOORS[this.floor].plan; },
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
        classKey: pl.classKey, floor: game.floor, level: game.level, xp: game.xp,
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
      continueBtn.textContent =
        `Continue run — Floor ${save.floor + 1}, ${DD.CLASSES[save.classKey].name} Lv ${save.level}`;
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
    resultEl.classList.add("hidden");
    levelupEl.classList.add("hidden");
    game.state = "play";
  }

  function startRun(classKey) {
    clearSave();
    const hero = DD.profile.getOrCreateHero(classKey);
    game.hero = hero;
    game.classKey = classKey;
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

    if (game.roomType === "combat") {
      const tier = cfg.plan.slice(0, index).filter((t) => t === "combat").length;
      const count = Math.max(5, Math.round((6 + tier * 3 + game.floor * 2) * areaScale));
      const kinds = ["melee"];
      if (game.floor >= 1) kinds.push("archer");
      if (game.floor >= 2) kinds.push("bomber");
      for (let i = 0; i < count; i++) {
        const pos = DD.room.randomFloorPos(pl.x, pl.y, spawnDist);
        const kind = i > 1 && Math.random() < 0.3 ? DD.choice(kinds) : "melee";
        game.spawnQueue.push({ x: pos.x, y: pos.y, delay: 0.6 + i * 0.4, big: false, kind });
      }
      for (let i = 0; i < tier + Math.max(0, game.floor - 1); i++) {
        const pos = DD.room.randomFloorPos(pl.x, pl.y, spawnDist);
        game.spawnQueue.push({ x: pos.x, y: pos.y, delay: 1.4 + i * 0.8, big: true, kind: "melee" });
      }
    } else if (game.roomType === "elite") {
      const pos = DD.room.randomFloorPos(pl.x, pl.y, spawnDist);
      game.spawnQueue.push({
        x: pos.x, y: pos.y, delay: 0.8, big: true, kind: "melee",
        elite: true, name: DD.choice(ELITE_NAMES),
      });
      for (let i = 0; i < 2; i++) {
        const mp = DD.room.randomFloorPos(pl.x, pl.y, spawnDist);
        game.spawnQueue.push({
          x: mp.x, y: mp.y, delay: 1.6 + i * 0.5, big: false,
          kind: game.floor >= 1 ? "archer" : "melee",
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
        hp: cfg.bossHp, dmg: cfg.bossDmg, name: cfg.boss, summonKind: cfg.summonKind,
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
      if (game.floor >= FLOORS.length - 1) {
        endRun(true);
      } else {
        writeSave(); // the run is checkpointed after every floor boss
        DD.room.doorOpen = true;
        DD.audio.door();
        DD.particles.text(DD.WIDTH / 2, DD.TILE * 2.2, "Floor cleared! The shop awaits...", "#ffd95e");
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
      game.hero.gold = Math.max(0, (game.hero.gold || 0) + game.gold);
      game.hero.kills = (game.hero.kills || 0) + game.kills;
      if (!won) game.hero.deaths = (game.hero.deaths || 0) + 1;
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
    resultStats.innerHTML =
      `${DD.CLASSES[game.classKey].name} Lv ${game.level} &nbsp;•&nbsp; ` +
      `Floor ${game.floor + 1}, Room ${game.roomIndex + 1} &nbsp;•&nbsp; ` +
      `${game.kills} kills &nbsp;•&nbsp; ${game.gold} gold &nbsp;•&nbsp; ` +
      `${game.time.toFixed(1)}s`;
    resultEl.classList.remove("hidden");
  }

  function backToMenu() {
    resultEl.classList.add("hidden");
    menuEl.classList.remove("hidden");
    refreshContinueButton();
    setMenuMode(null, "");
    game.state = "menu";
    DD.room.prerendered = false;
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

  function openInventory() {
    if (!game.hero || game.state !== "play") return;
    game.state = "inventory";
    renderInventory(game.hero);
    inventoryEl.classList.remove("hidden");
  }

  function closeInventory() {
    inventoryEl.classList.add("hidden");
    invTooltip.classList.add("hidden");
    game.state = "play";
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

    if (game.state === "menu" || game.state === "levelup" || game.state === "inventory") return;

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

    // staggered skeleton spawns
    for (let i = game.spawnQueue.length - 1; i >= 0; i--) {
      const s = game.spawnQueue[i];
      s.delay -= dt;
      if (s.delay <= 0) {
        game.skeletons.push(new DD.Skeleton(s.x, s.y, {
          big: s.big, kind: s.kind, elite: s.elite, name: s.name, scale: game.floorCfg().scale,
        }));
        DD.audio.spawn();
        game.spawnQueue.splice(i, 1);
      }
    }

    if (game.state === "play") {
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

    for (const sk of game.skeletons) if (!sk.dead) sk.update(dt, game);
    game.skeletons = game.skeletons.filter((s) => !s.dead);

    for (const pr of game.projectiles) if (!pr.dead) pr.update(dt, game);
    game.projectiles = game.projectiles.filter((p) => !p.dead);

    for (const es of game.enemyShots) if (!es.dead) es.update(dt, game);
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
        } else if (game.skeletons.length === 0 && game.spawnQueue.length === 0) {
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

  // ---- draw ----

  function draw() {
    ctx.fillStyle = "#0e0b16";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(DD.view.ox, DD.view.oy);
    ctx.scale(DD.view.scale, DD.view.scale);

    if (game.state === "menu") {
      // dim empty room behind the class-select overlay
      if (!DD.room.prerendered) {
        sizeRoomToCanvas();
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
        else startRun(key);
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
  }

  function setMenuMode(mode, hint) {
    coopMode = mode;
    modeHint.textContent = hint || "";
    modeHint.classList.toggle("hidden", !hint);
  }

  function sendRoomToGuest() {
    if (DD.net.role === "host" && DD.net.connected) {
      DD.net.send({ t: "room", room: DD.room.getData(), floor: game.floor, ri: game.roomIndex, rt: game.roomType });
    }
  }

  async function hostWithClass(classKey) {
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
    setMenuMode(null, "");
    lobbyEl.classList.add("hidden");
    menuEl.classList.remove("hidden");
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
      DD.room.setData(m.room);
      DD.updateView(canvas);
      game.floor = m.floor;
      game.roomIndex = m.ri;
      game.roomType = m.rt;
      game.localIndex = 1;
      guestInGame = true;
      DD.particles.clear();
      lobbyEl.classList.add("hidden");
      menuEl.classList.add("hidden");
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

  document.getElementById("btn-again").addEventListener("click", () => {
    if (DD.net.role) DD.net.reset();
    startRun(game.classKey);
  });
  document.getElementById("btn-class").addEventListener("click", () => {
    if (DD.net.role) DD.net.reset();
    backToMenu();
  });
  continueBtn.addEventListener("click", () => {
    const save = readSave();
    if (save) { DD.audio.unlock(); resumeRun(save); }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "i" || e.key === "I") {
      if (game.state === "play") { openInventory(); return; }
      if (game.state === "inventory") { closeInventory(); return; }
    }
    if (game.state === "inventory" && e.key === "Escape") { closeInventory(); return; }
    if (game.state === "levelup" && ["1", "2", "3"].includes(e.key)) {
      const up = game.levelUpPicks[Number(e.key) - 1];
      if (up && game.lvlOnPick) game.lvlOnPick(up);
      return;
    }
    if (resultEl.classList.contains("hidden")) return;
    if (e.key === "Enter") { if (DD.net.role) DD.net.reset(); startRun(game.classKey); }
    if (e.key === "Escape") { if (DD.net.role) DD.net.reset(); backToMenu(); }
  });

  // ---- boot ----

  DD.sprites.init();
  fitCanvas();
  DD.input.init(canvas);
  buildClassCards();
  refreshContinueButton();

  window.addEventListener("resize", () => {
    fitCanvas();
    // regenerate the backdrop room to fill the new shape; mid-run rooms keep
    // their layout and letterbox until the next room loads
    if (game.state === "menu") DD.room.prerendered = false;
  });

  let last = performance.now();
  let netAccum = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
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
