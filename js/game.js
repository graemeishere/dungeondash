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
        maxHp: pl.maxHp, hp: pl.hp, killHeal: pl.killHeal, stats: pl.stats,
      }));
    } catch (e) { /* private browsing etc. */ }
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
    clearSave(); // a new run abandons any saved one
    game.classKey = classKey;
    game.players = [new DD.Player(classKey, 0, 0, DD.input)];
    game.localIndex = 0;
    game.floor = 0;
    game.xp = 0;
    game.level = 1;
    game.gold = 0;
    game.kills = 0;
    game.time = 0;
    loadRoom(0);
    freshGameState();
  }

  function resumeRun(save) {
    game.classKey = save.classKey;
    const pl = new DD.Player(save.classKey, 0, 0, DD.input);
    Object.assign(pl.stats, save.stats);
    pl.maxHp = save.maxHp;
    pl.hp = Math.max(1, save.hp);
    pl.killHeal = save.killHeal || 0;
    game.players = [pl];
    game.localIndex = 0;
    game.floor = save.floor;
    game.xp = save.xp;
    game.level = save.level;
    game.gold = save.gold;
    game.kills = save.kills;
    game.time = save.time;
    loadRoom(game.plan().length - 1); // back to the shop after the saved boss kill
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
      game.shopkeeper = {
        x: DD.WIDTH / 2, y: cy - DD.TILE * 2, animT: 0,
        draw(c) {
          c.drawImage(DD.sprites.shopkeeper[Math.floor(performance.now() / 600) % 2],
            this.x - 24, this.y - 38, 48, 48);
        },
      };
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
    game.state = won ? "won" : "lost";
    game.endT = won ? 1.4 : 1.2;
    if (won) {
      DD.room.doorOpen = true;
      DD.audio.win();
    } else {
      DD.audio.lose();
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
    game.state = "menu";
    DD.room.prerendered = false;
  }

  // ---- level-up overlay ----

  function openLevelUp() {
    game.state = "levelup";
    DD.audio.levelup();
    upgradeCardsEl.innerHTML = "";
    const pool = [...DD.UPGRADES];
    const picks = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    picks.forEach((up, i) => {
      const card = document.createElement("button");
      card.className = "class-card upgrade-card";
      card.innerHTML =
        `<div class="ckey">${i + 1}</div>` +
        `<div class="cname">${up.name}</div>` +
        `<div class="cdesc">${up.desc}</div>`;
      card.addEventListener("click", () => chooseUpgrade(up));
      upgradeCardsEl.appendChild(card);
    });
    game.levelUpPicks = picks;
    levelupEl.classList.remove("hidden");
  }

  function chooseUpgrade(up) {
    const pl = game.localPlayer;
    up.apply(pl);
    game.pendingLevelUps--;
    levelupEl.classList.add("hidden");
    game.state = "play";
    DD.particles.burst(pl.x, pl.y - 20, {
      count: 16, colors: ["#ffd95e", "#fff3b8"], speed: 100, life: 0.6, gravity: -60,
    });
  }

  // ---- update ----

  function update(dt) {
    if (game.state === "menu" || game.state === "levelup") return;

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
        startRun(key);
      });
      holder.appendChild(card);
    }
  }

  // ---- result buttons / shortcuts ----

  document.getElementById("btn-again").addEventListener("click", () => startRun(game.classKey));
  document.getElementById("btn-class").addEventListener("click", backToMenu);
  continueBtn.addEventListener("click", () => {
    const save = readSave();
    if (save) { DD.audio.unlock(); resumeRun(save); }
  });
  window.addEventListener("keydown", (e) => {
    if (game.state === "levelup" && ["1", "2", "3"].includes(e.key)) {
      const up = game.levelUpPicks[Number(e.key) - 1];
      if (up) chooseUpgrade(up);
      return;
    }
    if (resultEl.classList.contains("hidden")) return;
    if (e.key === "Enter") startRun(game.classKey);
    if (e.key === "Escape") backToMenu();
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
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})(window.DD);
