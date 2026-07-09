"use strict";
// ---- 3D rendering path (?3d) ----------------------------------------------
// Drives the WebGL dungeon view: real 3D characters/items/projectiles where
// models exist, falling back to billboards that reuse each entity's 2D draw()
// captured to an offscreen canvas. The InstancedMesh dungeon itself lives in
// js/render3d.js; the character rigs/clips in js/char3d.js. game.js calls
// DD.game3d.active()/draw()/resize() and stays 3D-agnostic otherwise.
(function (DD) {
  // Loaded before game.js, so parse the URL ourselves.
  const params = new URLSearchParams(location.search);
  const camTest = params.has("camtest"); // live camera-tuning controls + readout
  let camMode3d = params.get("cam") === "fixed" ? "fixed" : "follow"; // 'C' toggles

  const canvas = document.getElementById("game"); // 2D canvas = HUD overlay in 3D
  const ctx = canvas.getContext("2d");
  const canvas3d = document.getElementById("game3d");

  // Reuses every entity's existing 2D draw() by capturing it to an offscreen
  // canvas, then standing that up as a camera-facing billboard on the 3D floor.
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
    const t = DD.game.time - ent.atkAnimAt;
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
    if (p.downed || p.dying) return { clip: rig.death, once: true, timeScale: 1 };
    return rigClip(p, rig, { moving: p.moving });
  }
  function enemyClip(s) {
    const rig = DD.char3d.RIG[DD.char3d.enemyModelKey(s.kind)];
    if (s.dying)                return { clip: rig.death, once: true, timeScale: 1 };
    if (s.state === "inactive") return { clip: rig.inactive || rig.idle, once: false, timeScale: 1 };
    if (s.state === "awaken")   return { clip: rig.awaken || rig.spawn, once: true, timeScale: 1 };
    const atking = s.state === "windup" || s.state === "fuse";
    if (atking && !s.__wasAtk) s.atkAnimAt = DD.game.time; // rising edge of a strike
    s.__wasAtk = atking;
    return rigClip(s, rig, { moving: s.state === "chase", spawn: s.state === "spawn" });
  }

  function drawCombat3D(dt) {
    const dr = DD.render3d;
    const game = DD.game;
    const menuish = MENU_3D[game.state];    // room is just a backdrop, no entities
    const peaceful = PEACE_3D[game.state];  // walkable hub: players + NPCs, no HUD
    // Rebuild the mesh when the room layout changes, or when late-loading
    // decor pieces ask for one identical re-instance.
    if (dr._builtVersion !== DD.room.version || dr.needsRebuild) {
      const d = DD.room.getData();
      dr.buildRoom({
        tiles: d.tiles.split(",").map(Number), w: d.w, h: d.h,
        seed: d.seed, theme: d.theme, roomType: d.roomType,
        isLobby: !!d.isLobby, isTown: !!d.isTown, exit: d.exit,
      });
      dr._builtVersion = DD.room.version;
      if (DD.fx3d) DD.fx3d.setFlames(dr.flameWorld);
    }
    // gate visual tracks the gameplay door state; instant right after a
    // rebuild (covers guests joining an already-cleared room)
    if (dr.gates && dr._doorOpen !== DD.room.doorOpen) {
      dr.setDoorOpen(DD.room.doorOpen, dr._doorOpen === null);
    }

    // Camera mode (fixed whole-room vs follow the local player). Backdrop
    // screens always use the fixed whole-room camera.
    const camMode = menuish ? "fixed" : camMode3d;
    if (dr.camMode !== camMode) dr.setCameraMode(camMode);
    if (camMode === "follow" && game.localPlayer) {
      const w = dr.cellToWorld(game.localPlayer.x / DD.TILE, game.localPlayer.y / DD.TILE);
      dr.setFollowTarget(w.x, w.z);
    }

    const mgr = DD.charMgr, C = DD.char3d;
    const billboards = [];
    const chars = [];
    const items = [];
    const projs = [];
    const orbs = [];
    const worldOf = (e) => dr.cellToWorld(e.x / DD.TILE, e.y / DD.TILE);
    const asChar = (e, modelKey, rotationY, anim, opacity) => {
      const w = worldOf(e);
      chars.push({ entity: e, modelKey, x: w.x, z: w.z, rotationY, clip: anim.clip, once: anim.once, timeScale: anim.timeScale, restart: anim.restart, opacity: opacity == null ? 1 : opacity });
    };

    // Players + skeletons render as 3D characters once the models have loaded;
    // until then (or if a model is missing) they fall back to billboards.
    if (!menuish) {
    for (const p of game.players) {
      if (!p || p.dead) continue;
      const mk = C && C.classModelKey(p.classKey);
      // face the aim direction while a swing is active (root-the-swing model),
      // else face movement; keep faceFromMove ticking so __px/__py stay current.
      const moveFace = faceFromMove(p);
      const face = (p.lockT > 0) ? faceFromAim(p.aim) : moveFace;
      // fresh melee swing -> 3D weapon trail sweeping the swing's arc
      if (DD.fx3d && p.stats.attack === "melee" && p.atkAnimAt != null && p.atkAnimAt !== p.__trailAt) {
        p.__trailAt = p.atkAnimAt;
        const w = worldOf(p);
        // visual radius hugs the character (~weapon length), not the full
        // gameplay reach — full reach reads as a detached ring on the floor
        const reach = (p.stats.range / DD.TILE) * dr.CELL * 0.55;
        DD.fx3d.swingArc(w.x, 1.2, w.z, p.swingAngle, p.stats.arc, reach, "#fff8e0", (p.swingDur || 0.4) * 0.6);
      }
      // dying heroes fade out over the tail of the death animation
      const pOpacity = p.dying ? Math.min(1, p.deathT / 0.7) : 1;
      if (mgr && mk && mgr.factory.protos.has(mk)) asChar(p, mk, face, playerClip(p), pOpacity);
      else billboards.push(captureEntity(p));
    }
    // town NPCs stand as billboards (they carry a draw() sprite shim)
    for (const npc of game.townNpcs) {
      if (npc.draw) billboards.push(captureEntity(npc));
    }
    // Combat-room content; the walkable hubs show only players + NPCs (stale
    // arrays from a finished run must not leak into town/lobby).
    if (!peaceful) {
    for (const s of game.skeletons) {
      if (!s || s.dead) continue;
      const mk = C && C.enemyModelKey(s.kind);
      // fade dying corpses; shades are translucent ghosts (distinct from minions)
      const opacity = s.dying ? Math.min(1, s.deathT / 0.7) : (s.kind === "shade" ? 0.5 : 1);
      if (mgr && mk && mgr.factory.protos.has(mk)) asChar(s, mk, faceFromMove(s), enemyClip(s), opacity);
      else billboards.push(captureEntity(s));
    }
    // 3D items (coins/potions/chests); everything else stays a billboard.
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
    for (const it of game.shopItems) billboards.push(captureEntity(it));
    // spike traps: animated floor-spike sprites stood up as billboards (interim
    // until they get real 3D meshes)
    for (const s of (DD.room.spikes || [])) {
      if (!s.draw) {
        s.x = (s.tx + 0.5) * DD.TILE;
        s.y = (s.ty + 1) * DD.TILE;
        s.draw = (c) => c.drawImage(DD.sprites.spikes[DD.room.spikeStage(s, DD.game.time)], s.tx * DD.TILE, s.ty * DD.TILE);
      }
      billboards.push(captureEntity(s));
    }
    // arrows -> 3D models (along velocity); mage bolts / magic -> glowing orbs
    // with a particle trail; anything else stays a billboard.
    const asProj = (e) => projs.push({ entity: e, key: "arrow", gx: e.x / DD.TILE, gy: e.y / DD.TILE, rotationY: Math.atan2(e.vx, e.vy) });
    const asOrb = (e, color, size, trail) => {
      const w = dr.cellToWorld(e.x / DD.TILE, e.y / DD.TILE);
      orbs.push({ entity: e, x: w.x, y: 1.4, z: w.z, color, size });
      if (DD.fx3d) DD.fx3d.burst(w.x, 1.4, w.z, { count: 1, colors: trail, speed: 8, life: 0.25 });
    };
    for (const pr of game.projectiles) {
      if (pr.kind === "arrow" && dr.hasProjectile("arrow")) asProj(pr);
      else if (pr.kind === "bolt" && DD.fx3d) asOrb(pr, "#b48cff", 1.3, ["#b48cff", "#d8b4ff"]);
      else billboards.push(captureEntity(pr));
    }
    for (const es of game.enemyShots) {
      if (es.style === "arrow" && dr.hasProjectile("arrow")) asProj(es);
      else if (es.style === "magic" && DD.fx3d) asOrb(es, "#9940d0", 1.1, ["#9940d0", "#c060f0"]);
      else billboards.push(captureEntity(es));
    }
    } // !peaceful
    } // !menuish

    if (mgr) mgr.sync(chars, dt);
    if (DD.fx3d) { DD.fx3d.update(dt); DD.fx3d.setOrbs(orbs); }
    dr.setItems(items);
    dr.setProjectiles(projs);
    dr.setEntities(billboards);
    dr.render();

    // 2D canvas becomes a transparent HUD overlay in screen space.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (menuish) return; // DOM overlays provide the menu/hub UI
    drawDamageNumbers3D(dr);
    if (game.state === "lobby") drawTierPads3D(dr);
    if (peaceful) drawPeacefulOverlay(dr);
    if (game.state === "play" || game.state === "transition") DD.hud.draw(ctx, game);
    // room-transition fade (the 3D scene swaps rooms behind this)
    if (game.state === "transition") {
      const a = game.transitionPhase === "out" ? game.transitionT : 1 - game.transitionT;
      ctx.fillStyle = `rgba(10, 8, 18, ${DD.clamp(a, 0, 1)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (camTest) drawCamTest(dr);
  }

  // Tier pads (lobby): glowing entry circles projected onto the 3D floor,
  // with their labels and the dwell-to-enter progress ring. Ported from the
  // old 2D drawTierPad; radii are projected per-axis so the ellipse follows
  // the camera's perspective of the floor.
  function drawTierPads3D(dr) {
    const game = DD.game;
    const pads = DD.room.tierPads || [];
    if (!pads.length) return;
    const font = "'Trebuchet MS', Verdana, sans-serif";
    const time = game.time;
    for (const pad of pads) {
      const c = dr.projectToScreen(pad.x / DD.TILE, pad.y / DD.TILE, 0.05);
      if (c.depth > 1) continue;
      const ex = dr.projectToScreen((pad.x + pad.r) / DD.TILE, pad.y / DD.TILE, 0.05);
      const ey = dr.projectToScreen(pad.x / DD.TILE, (pad.y + pad.r) / DD.TILE, 0.05);
      const rx = Math.max(6, Math.hypot(ex.x - c.x, ex.y - c.y));
      const ry = Math.max(4, Math.hypot(ey.x - c.x, ey.y - c.y));
      const col = pad.locked ? "#6b6481" : pad.color;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + pad.ti);
      ctx.save();
      ctx.globalAlpha = pad.locked ? 0.12 : 0.18 + 0.14 * pulse;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = pad.locked ? 0.5 : 0.9;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // dwell-to-enter progress ring on the active pad
      if (!pad.locked && game.padTi === pad.ti && game.padDwell > 0) {
        const frac = DD.clamp(game.padDwell / 0.7, 0, 1);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      }
      ctx.textAlign = "center";
      ctx.fillStyle = pad.locked ? "#9b90b8" : col;
      ctx.font = `bold 14px ${font}`;
      const title = pad.cleared && !pad.locked ? `${pad.label}  ✓` : pad.label;
      ctx.fillText(title, c.x, c.y - ry - 18);
      ctx.fillStyle = pad.locked ? "#ff8a8a" : (pad.cleared ? "#9affb0" : "#d8cfee");
      ctx.font = `11px ${font}`;
      const subText = pad.locked ? `LOCKED · Lv ${pad.req}` : (pad.cleared ? `${pad.sub} · cleared` : pad.sub);
      ctx.fillText(subText, c.x, c.y - ry - 5);
      ctx.textAlign = "left";
    }
  }

  // Title bar + interaction prompt for the walkable hub screens (lobby/town),
  // drawn in screen space on the HUD overlay.
  function drawPeacefulOverlay(dr) {
    const game = DD.game;
    const font = "'Trebuchet MS', Verdana, sans-serif";
    const cx = canvas.width / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(10,8,18,0.66)";
    ctx.fillRect(cx - 150, 10, 300, 44);
    ctx.fillStyle = "#ffd95e";
    ctx.font = `bold 19px ${font}`;
    let title, sub;
    if (game.state === "lobby") {
      title = (game.lobbyDungeonName || "Dungeon").toUpperCase();
      sub = "Stand on a glowing pad to enter that tier  •  Esc: map";
    } else {
      title = "TOWN";
      sub = DD.input.touchSeen
        ? "Tap an NPC to talk  •  walk up through the door to leave"
        : "Walk to an NPC and press E  •  exit ▲ to the map  •  Esc: map";
    }
    ctx.fillText(title, cx, 32);
    ctx.fillStyle = "#bdb3d6";
    ctx.font = `12px ${font}`;
    ctx.fillText(sub, cx, 48);
    if (game.state === "town" && game.nearbyNpc) {
      const n = game.nearbyNpc;
      const sp = dr.projectToScreen(n.x / DD.TILE, n.y / DD.TILE, 2.6);
      if (sp.depth <= 1) {
        ctx.fillStyle = "#ffd95e";
        ctx.font = `bold 13px ${font}`;
        const label = DD.input.touchSeen ? `Tap to talk to ${n.label}` : `[E] Talk to ${n.label}`;
        ctx.fillText(label, sp.x, sp.y);
      }
    }
    ctx.textAlign = "left";
  }

  // Floating damage/heal numbers, projected from world space onto the HUD
  // overlay and risen in screen space over their lifetime.
  function drawDamageNumbers3D(dr) {
    if (!DD.particles.activeTexts) return;
    const texts = DD.particles.activeTexts();
    if (!texts.length) return;
    ctx.font = "bold 15px 'Trebuchet MS', Verdana, sans-serif";
    ctx.textAlign = "center";
    for (const t of texts) {
      const sp = dr.projectToScreen(t.x / DD.TILE, t.y / DD.TILE, 1.7);
      if (sp.depth > 1) continue; // behind the camera
      const rise = (0.8 - t.life) * 42;
      const y = sp.y - rise;
      ctx.globalAlpha = DD.clamp(t.life / 0.4, 0, 1);
      ctx.fillStyle = "#1a1626";
      ctx.fillText(t.str, sp.x + 1, y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, sp.x, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
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

  // Everything except the map screen (pure 2D UI, drawn on the overlay canvas)
  // renders through the 3D path: combat states, the walkable lobby/town hubs,
  // and the menu/hub screens (which show the dungeon as a backdrop behind
  // their DOM overlays).
  const MENU_3D = { menu: 1, hub: 1 };
  const PEACE_3D = { lobby: 1, town: 1, stats: 1, trader: 1, quests: 1 };
  const ROOM_3D_STATES = {
    play: 1, transition: 1, levelup: 1, inventory: 1, won: 1, lost: 1,
    menu: 1, hub: 1, lobby: 1, town: 1, stats: 1, trader: 1, quests: 1,
  };

  // 'C' toggles the 3D camera between fixed (whole-room) and follow (player).
  // With ?camtest, arrow/bracket/etc. keys live-tune the camera + character scale
  // and print the values so we can bake the perfect numbers.
  {
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

  DD.game3d = {
    // True when the 3D path should draw this frame's state.
    active(state) {
      return DD.render3d && DD.render3d.proto && ROOM_3D_STATES[state];
    },
    draw: drawCombat3D,
    // Keep the WebGL canvas matched to the overlay canvas (called from fitCanvas).
    resize(w, h) {
      if (!canvas3d) return;
      canvas3d.width = w;
      canvas3d.height = h;
      if (DD.render3d) DD.render3d.resize(w, h);
    },
  };
})(window.DD = window.DD || {});
