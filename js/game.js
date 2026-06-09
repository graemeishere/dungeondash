"use strict";
(function (DD) {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const menuEl = document.getElementById("menu");
  const resultEl = document.getElementById("result");
  const resultTitle = document.getElementById("result-title");
  const resultStats = document.getElementById("result-stats");

  const game = {
    state: "menu", // menu | play | won | lost
    player: null,
    skeletons: [],
    projectiles: [],
    pickups: [],
    spawnQueue: [],   // [{x, y, delay}]
    gold: 0,
    kills: 0,
    shake: 0,
    hintT: 0,
    endT: 0,          // delay before showing the result overlay
    classKey: "warrior",
    time: 0,
  };
  DD.game = game;

  const WAVE_SIZE = 8;

  function startRun(classKey) {
    game.classKey = classKey;
    DD.room.generate();
    game.player = new DD.Player(classKey, DD.WIDTH / 2, DD.HEIGHT / 2 + 40);
    game.skeletons = [];
    game.projectiles = [];
    game.pickups = [];
    game.spawnQueue = [];
    game.gold = 0;
    game.kills = 0;
    game.shake = 0;
    game.hintT = 7;
    game.endT = 0;
    game.time = 0;
    DD.particles.clear();

    for (let i = 0; i < WAVE_SIZE; i++) {
      const pos = DD.room.randomFloorPos(game.player.x, game.player.y, 170);
      game.spawnQueue.push({ x: pos.x, y: pos.y, delay: 0.6 + i * 0.45 });
    }

    menuEl.classList.add("hidden");
    resultEl.classList.add("hidden");
    game.state = "play";
  }

  function endRun(won) {
    game.state = won ? "won" : "lost";
    game.endT = won ? 1.0 : 1.2;
    if (won) {
      DD.room.doorOpen = true;
      DD.audio.win();
    } else {
      DD.audio.lose();
    }
  }

  function showResult() {
    resultTitle.textContent = game.state === "won" ? "ROOM CLEARED!" : "YOU DIED";
    resultTitle.style.color = game.state === "won" ? "#ffd95e" : "#ff5252";
    resultStats.innerHTML =
      `${DD.CLASSES[game.classKey].name} &nbsp;•&nbsp; ` +
      `${game.kills} skeletons slain &nbsp;•&nbsp; ${game.gold} gold &nbsp;•&nbsp; ` +
      `${game.time.toFixed(1)}s`;
    resultEl.classList.remove("hidden");
  }

  function update(dt) {
    if (game.state === "menu") return;

    game.time += dt;
    game.hintT -= dt;
    game.shake = Math.max(0, game.shake - 30 * dt);

    // staggered skeleton spawns
    for (let i = game.spawnQueue.length - 1; i >= 0; i--) {
      const s = game.spawnQueue[i];
      s.delay -= dt;
      if (s.delay <= 0) {
        game.skeletons.push(new DD.Skeleton(s.x, s.y));
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

    DD.particles.update(dt);

    if (game.state === "play") {
      if (game.player.dead) {
        endRun(false);
      } else if (game.skeletons.length === 0 && game.spawnQueue.length === 0) {
        endRun(true);
      }
    } else if (game.state === "won" || game.state === "lost") {
      if (game.endT > 0) {
        game.endT -= dt;
        if (game.endT <= 0 && resultEl.classList.contains("hidden")) showResult();
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, DD.WIDTH, DD.HEIGHT);
    if (game.state === "menu") {
      // dim empty room behind the class-select overlay
      if (!DD.room.prerendered) DD.room.generate();
      DD.room.prerendered = true;
      DD.room.draw(ctx);
      return;
    }

    ctx.save();
    if (game.shake > 0) {
      ctx.translate(DD.rand(-game.shake, game.shake), DD.rand(-game.shake, game.shake));
    }

    DD.room.draw(ctx);

    for (const pk of game.pickups) pk.draw(ctx);

    // y-sort so lower entities draw in front
    const drawables = [...game.skeletons];
    if (!game.player.dead) drawables.push(game.player);
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw(ctx);

    for (const pr of game.projectiles) pr.draw(ctx);

    DD.particles.draw(ctx);
    DD.hud.draw(ctx, game);

    ctx.restore();
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
  DD.input.init(canvas);
  buildClassCards();

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
