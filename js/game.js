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

  // The floor: fight, fight, loot, fight, boss.
  const FLOOR_PLAN = ["combat", "combat", "treasure", "combat", "boss"];

  const game = {
    state: "menu", // menu | play | levelup | transition | won | lost
    player: null,
    skeletons: [],
    projectiles: [],
    pickups: [],
    chests: [],
    spawnQueue: [],   // [{x, y, delay, big}]
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

    enemies() { return this.skeletons; },
    xpNext() { return 25 + (this.level - 1) * 15; },

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

  function startRun(classKey) {
    game.classKey = classKey;
    game.player = new DD.Player(classKey, DD.WIDTH / 2, DD.HEIGHT - DD.TILE * 2.5);
    game.roomIndex = 0;
    game.bossDefeated = false;
    game.xp = 0;
    game.level = 1;
    game.pendingLevelUps = 0;
    game.gold = 0;
    game.kills = 0;
    game.hintT = 7;
    game.time = 0;
    loadRoom(0);
    menuEl.classList.add("hidden");
    resultEl.classList.add("hidden");
    levelupEl.classList.add("hidden");
    game.state = "play";
  }

  function loadRoom(index) {
    game.roomIndex = index;
    game.roomType = FLOOR_PLAN[index];
    game.roomCleared = false;
    sizeRoomToCanvas(); // each room is generated to fill the current screen
    DD.room.generate();
    DD.updateView(canvas);
    game.skeletons = [];
    game.projectiles = [];
    game.pickups = [];
    game.chests = [];
    game.spawnQueue = [];
    game.shake = 0;
    game.endT = 0;
    DD.particles.clear();

    const pl = game.player;
    pl.x = DD.WIDTH / 2;
    pl.y = DD.HEIGHT - DD.TILE * 2.5;

    const spawnDist = Math.min(170, DD.WIDTH * 0.35);
    if (game.roomType === "combat") {
      // difficulty scales with how many combat rooms came before this one,
      // and the wave size scales with the room's area so phones aren't swamped
      const tier = FLOOR_PLAN.slice(0, index).filter((t) => t === "combat").length;
      const areaScale = (DD.ROOM_W * DD.ROOM_H) / (30 * 18);
      const count = Math.max(5, Math.round((7 + tier * 3) * Math.min(1, areaScale + 0.25)));
      for (let i = 0; i < count; i++) {
        const pos = DD.room.randomFloorPos(pl.x, pl.y, spawnDist);
        game.spawnQueue.push({ x: pos.x, y: pos.y, delay: 0.6 + i * 0.4, big: false });
      }
      for (let i = 0; i < tier; i++) {
        const pos = DD.room.randomFloorPos(pl.x, pl.y, spawnDist);
        game.spawnQueue.push({ x: pos.x, y: pos.y, delay: 1.4 + i * 0.8, big: true });
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
    } else if (game.roomType === "boss") {
      game.skeletons.push(new DD.Boss(DD.WIDTH / 2, DD.HEIGHT / 2 - 60));
    }
  }

  function setRoomCleared() {
    game.roomCleared = true;
    if (game.roomType === "boss") {
      endRun(true);
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

  function endRun(won) {
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
      `Room ${game.roomIndex + 1} of ${FLOOR_PLAN.length} &nbsp;•&nbsp; ` +
      `${game.kills} kills &nbsp;•&nbsp; ${game.gold} gold &nbsp;•&nbsp; ` +
      `${game.time.toFixed(1)}s`;
    resultEl.classList.remove("hidden");
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
    up.apply(game.player);
    game.pendingLevelUps--;
    levelupEl.classList.add("hidden");
    game.state = "play";
    DD.particles.burst(game.player.x, game.player.y - 20, {
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
          loadRoom(game.roomIndex + 1);
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
        game.skeletons.push(new DD.Skeleton(s.x, s.y, { big: s.big }));
        DD.audio.spawn();
        game.spawnQueue.splice(i, 1);
      }
    }

    if (game.state === "play" && !game.player.dead) game.player.update(dt, game);

    for (const sk of game.skeletons) if (!sk.dead) sk.update(dt, game);
    game.skeletons = game.skeletons.filter((s) => !s.dead);

    for (const pr of game.projectiles) if (!pr.dead) pr.update(dt, game);
    game.projectiles = game.projectiles.filter((p) => !p.dead);

    for (const pk of game.pickups) if (!pk.dead) pk.update(dt, game);
    game.pickups = game.pickups.filter((p) => !p.dead);

    // chest interaction
    if (!game.player.dead) {
      for (const ch of game.chests) {
        if (!ch.opened && DD.dist(ch.x, ch.y, game.player.x, game.player.y) < ch.r + game.player.r + 4) {
          ch.open(game);
        }
      }
    }

    DD.particles.update(dt);

    if (game.state === "play") {
      if (game.player.dead) {
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
      if (game.roomCleared && game.roomType !== "boss" &&
          DD.room.inDoorway(game.player.x, game.player.y - game.player.r)) {
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

    for (const pk of game.pickups) pk.draw(ctx);

    // y-sort so lower entities draw in front
    const drawables = [...game.skeletons, ...game.chests];
    if (!game.player.dead) drawables.push(game.player);
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw(ctx);

    for (const pr of game.projectiles) pr.draw(ctx);

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
  document.getElementById("btn-class").addEventListener("click", () => {
    resultEl.classList.add("hidden");
    menuEl.classList.remove("hidden");
    game.state = "menu";
  });
  window.addEventListener("keydown", (e) => {
    if (game.state === "levelup" && ["1", "2", "3"].includes(e.key)) {
      const up = game.levelUpPicks[Number(e.key) - 1];
      if (up) chooseUpgrade(up);
      return;
    }
    if (resultEl.classList.contains("hidden")) return;
    if (e.key === "Enter") startRun(game.classKey);
    if (e.key === "Escape") {
      resultEl.classList.add("hidden");
      menuEl.classList.remove("hidden");
      game.state = "menu";
    }
  });

  // ---- boot ----

  DD.sprites.init();
  fitCanvas();
  DD.input.init(canvas);
  buildClassCards();

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
