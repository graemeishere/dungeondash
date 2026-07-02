"use strict";
// ---- 3D rendering path (?3d) ----------------------------------------------
// Drives the WebGL dungeon view: real 3D characters/items/projectiles where
// models exist, falling back to billboards that reuse each entity's 2D draw()
// captured to an offscreen canvas. The InstancedMesh dungeon itself lives in
// js/render3d.js; the character rigs/clips in js/char3d.js. game.js calls
// DD.game3d.active()/draw()/resize() and stays 3D-agnostic otherwise.
(function (DD) {
  // Loaded before game.js, so parse the URL ourselves (DD.use3d isn't set yet).
  const params = new URLSearchParams(location.search);
  const use3d = params.has("3d");
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
    if (p.downed) return { clip: rig.death, once: true, timeScale: 1 };
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
      // fade dying corpses; shades are translucent ghosts (distinct from minions)
      const opacity = s.dying ? Math.min(1, s.deathT / 0.7) : (s.kind === "shade" ? 0.5 : 1);
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
    // arrows -> 3D models (along velocity); mage bolts / magic -> glowing orbs
    // with a particle trail; anything else stays a billboard.
    const projs = [];
    const orbs = [];
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

    if (mgr) mgr.sync(chars, dt);
    if (DD.fx3d) { DD.fx3d.update(dt); DD.fx3d.setOrbs(orbs); }
    dr.setItems(items);
    dr.setProjectiles(projs);
    dr.setEntities(billboards);
    dr.render();

    // 2D canvas becomes a transparent HUD overlay in screen space.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawDamageNumbers3D(dr);
    if (game.state === "play" || game.state === "transition") DD.hud.draw(ctx, game);
    // room-transition fade (the 3D scene swaps rooms behind this)
    if (game.state === "transition") {
      const a = game.transitionPhase === "out" ? game.transitionT : 1 - game.transitionT;
      ctx.fillStyle = `rgba(10, 8, 18, ${DD.clamp(a, 0, 1)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (camTest) drawCamTest(dr);
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

  // States rendered by the 3D path: actual play plus the in-dungeon states whose
  // UI is a DOM overlay (levelup/inventory/won/lost) or just a fade (transition).
  // Without these the screen would flash back to the 2D dungeon every room change
  // and level-up.
  const ROOM_3D_STATES = { play: 1, transition: 1, levelup: 1, inventory: 1, won: 1, lost: 1 };

  // 'C' toggles the 3D camera between fixed (whole-room) and follow (player).
  // With ?camtest, arrow/bracket/etc. keys live-tune the camera + character scale
  // and print the values so we can bake the perfect numbers.
  if (use3d) {
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
      return use3d && DD.render3d && DD.render3d.proto && ROOM_3D_STATES[state];
    },
    draw: drawCombat3D,
    // Keep the WebGL canvas matched to the 2D canvas (called from fitCanvas).
    resize(w, h) {
      if (!use3d || !canvas3d) return;
      canvas3d.width = w;
      canvas3d.height = h;
      if (DD.render3d) DD.render3d.resize(w, h);
    },
  };
})(window.DD = window.DD || {});
