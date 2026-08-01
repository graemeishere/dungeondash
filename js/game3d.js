// ---- 3D rendering path (?3d) ----------------------------------------------
// Drives the WebGL dungeon view: real 3D characters/items/projectiles where
// models exist, falling back to billboards that reuse each entity's 2D draw()
// captured to an offscreen canvas. The InstancedMesh dungeon itself lives in
// js/render3d.js; the character rigs/clips in js/char3d.js. game.js calls
// game3d.active()/draw()/resize() and stays 3D-agnostic otherwise.

import { TILE, clamp } from "./util.js?v=8addee6b";
import { rt } from "./runtime.js?v=8addee6b";
import { room } from "./room.js?v=8addee6b";
import { input } from "./input.js?v=8addee6b";
import { particles } from "./particles.js?v=8addee6b";
import { hud } from "./hud.js?v=8addee6b";
import { Boss } from "./entities.js?v=8addee6b";

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
  const dr = rt.render3d;
  const k = dr.CELL / TILE; // px -> world units
  return {
    canvas: c, gx: ent.x / TILE, gy: ent.y / TILE,
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
function comboAttack(ent, rig, game) {
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
function rigClip(ent, rig, game, opts) {
  if (opts.spawn) return { clip: rig.spawn, once: true, timeScale: 1 };
  const atk = comboAttack(ent, rig, game);
  if (atk) return { clip: atk.clip, once: true, timeScale: rig.attackSpeed || 1, restart: atk.fresh };
  return { clip: opts.moving ? rig.run : rig.idle, once: false, timeScale: 1 };
}
function playerClip(p, game) {
  const rig = rt.char3d.RIG[rt.char3d.classModelKey(p.classKey)];
  if (p.downed || p.dying) return { clip: rig.death, once: true, timeScale: 1 };
  return rigClip(p, rig, game, { moving: p.moving });
}
// The boss uses a dedicated rig (Skeleton_Warrior + axe + 2H clips); everything
// else maps by kind.
function enemyMk(s) { return (s instanceof Boss) ? "enemy:boss" : rt.char3d.enemyModelKey(s.kind); }
function enemyClip(s, game) {
  const rig = rt.char3d.RIG[enemyMk(s)];
  // boss slam: a two-handed overhead chop timed so it lands at impact (slamT->0)
  if (s instanceof Boss && s.slamT > 0) {
    const dur = (rt.charMgr && rt.charMgr.factory.clips.get("Melee_2H_Attack_Chop")?.duration) || 1.63;
    const fresh = s.slamAnimAt != null && s.slamAnimAt !== s.__slamClipAt;
    if (fresh) s.__slamClipAt = s.slamAnimAt;
    return { clip: "Melee_2H_Attack_Chop", once: true, timeScale: dur / 0.85, restart: fresh };
  }
  if (s.dying)                return { clip: rig.death, once: true, timeScale: 1 };
  if (s.state === "inactive") return { clip: rig.inactive || rig.idle, once: false, timeScale: 1 };
  if (s.state === "awaken")   return { clip: rig.awaken || rig.spawn, once: true, timeScale: 1 };
  const atking = s.state === "windup" || s.state === "fuse";
  if (atking && !s.__wasAtk) s.atkAnimAt = game.time; // rising edge of a strike
  s.__wasAtk = atking;
  return rigClip(s, rig, game, { moving: s.state === "chase", spawn: s.state === "spawn" });
}

// Lost-context prompt. Shown once, lazily, the first frame after the renderer
// flags the loss — the render path itself is already inert by then, so this is
// purely about telling the player why the world stopped.
let lostShown = false;
function showContextLostOverlay() {
  if (lostShown) return;
  lostShown = true;
  const el = document.getElementById("webgl-lost");
  if (!el) return;
  document.querySelectorAll(".overlay").forEach((o) => o.classList.add("hidden"));
  el.classList.remove("hidden");
  const btn = document.getElementById("btn-webgl-reload");
  if (btn) btn.addEventListener("click", () => location.reload());
}

function drawCombat3D(game, dt) {
  const dr = rt.render3d;
  if (dr.contextLost) { showContextLostOverlay(); return; }
  const menuish = MENU_3D[game.state];    // room is just a backdrop, no entities
  const peaceful = PEACE_3D[game.state];  // walkable hub: players + NPCs, no HUD
  // Rebuild the mesh when the room layout changes, or when late-loading
  // decor pieces ask for one identical re-instance.
  if (dr._builtVersion !== room.version || dr.needsRebuild) {
    const d = room.getData();
    dr.buildRoom({
      tiles: d.tiles.split(",").map(Number), w: d.w, h: d.h,
      seed: d.seed, theme: d.theme, roomType: d.roomType,
      isLobby: !!d.isLobby, isTown: !!d.isTown, exit: d.exit, spikes: d.spikes,
      isFloor: !!d.isFloor, rooms: d.rooms, floorDoors: d.floorDoors, floorWalls: d.floorWalls,
      stairs: d.floorStairs,
    });
    dr._builtVersion = room.version;
    if (rt.fx3d) rt.fx3d.setFlames(dr.flameWorld);
  }
  // gate visual tracks the gameplay door state; instant right after a
  // rebuild (covers guests joining an already-cleared room)
  if (dr.gates && dr._doorOpen !== room.doorOpen) {
    dr.setDoorOpen(room.doorOpen, dr._doorOpen === null);
  }
  // floor gates: a shared door swings shut while any bordering room is locked.
  // A fresh rebuild recreates every gate open, so re-apply all states then.
  if (dr.floorGates && dr.floorGates.length && room.isFloor && room.rooms) {
    const rebuilt = dr._floorGateBuiltAt !== dr._builtVersion;
    for (const fg of dr.floorGates) {
      const open = !fg.roomIds.some((id) => { const r = room.roomById(id); return r && r.locked; });
      if (rebuilt || fg._openState !== open) {
        fg.open = open;
        fg.animT = rebuilt ? 1 : 0;
        fg._openState = open;
      }
    }
    dr._floorGateBuiltAt = dr._builtVersion;
  }

  // Camera mode (fixed whole-room vs follow the local player). Backdrop
  // screens and the walkable hubs (town/lobby) frame the whole room; combat
  // and floors follow the player.
  const camMode = (menuish || peaceful) ? "fixed" : camMode3d;
  if (dr.camMode !== camMode) dr.setCameraMode(camMode);
  if (camMode === "follow" && game.localPlayer) {
    const w = dr.cellToWorld(game.localPlayer.x / TILE, game.localPlayer.y / TILE);
    dr.setFollowTarget(w.x, w.z);
  }

  const mgr = rt.charMgr, C = rt.char3d;
  const billboards = [];
  const chars = [];
  const items = [];
  const projs = [];
  const orbs = [];
  const worldOf = (e) => dr.cellToWorld(e.x / TILE, e.y / TILE);
  const asChar = (e, modelKey, rotationY, anim, opacity) => {
    const w = worldOf(e);
    chars.push({ entity: e, modelKey, x: w.x, z: w.z, rotationY, clip: anim.clip, once: anim.once, timeScale: anim.timeScale, restart: anim.restart, opacity: opacity == null ? 1 : opacity, scale: e.modelScale || 1 });
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
    if (rt.fx3d && p.stats.attack === "melee" && p.atkAnimAt != null && p.atkAnimAt !== p.__trailAt) {
      p.__trailAt = p.atkAnimAt;
      const w = worldOf(p);
      // visual radius hugs the character (~weapon length), not the full
      // gameplay reach — full reach reads as a detached ring on the floor
      const reach = (p.stats.range / TILE) * dr.CELL * 0.55;
      rt.fx3d.swingArc(w.x, 1.2, w.z, p.swingAngle, p.stats.arc, reach, "#fff8e0", (p.swingDur || 0.4) * 0.6);
    }
    // dying heroes fade out over the tail of the death animation
    const pOpacity = p.dying ? Math.min(1, p.deathT / 0.7) : 1;
    if (mgr && mk && mgr.factory.spawnable(mk)) asChar(p, mk, face, playerClip(p, game), pOpacity);
    else billboards.push(captureEntity(p));
  }
  // town NPCs stand as billboards (they carry a draw() sprite shim)
  for (const npc of game.townNpcs) {
    if (npc.draw) billboards.push(captureEntity(npc));
  }
  // Combat-room content; the walkable hubs show only players + NPCs (stale
  // arrays from a finished run must not leak into town/lobby).
  if (!peaceful) {
  let liveBoss = null;
  for (const s of game.skeletons) {
    if (!s || s.dead) continue;
    const mk = C && enemyMk(s);
    if (s instanceof Boss) liveBoss = s;
    // boss slam windup -> red ground danger telegraph (radius = the AoE reach)
    if (rt.fx3d && s instanceof Boss && s.slamAnimAt != null && s.slamAnimAt !== s.__slamFxAt) {
      s.__slamFxAt = s.slamAnimAt;
      const w = worldOf(s);
      const radius = (105 / TILE) * dr.CELL;
      rt.fx3d.telegraph(w.x, 0, w.z, radius, 0.85, "#ff3b3b");
    }
    // fade dying corpses; shades are translucent ghosts (distinct from minions)
    const opacity = s.dying ? Math.min(1, s.deathT / 0.7) : (s.kind === "shade" ? 0.5 : 1);
    if (mgr && mk && mgr.factory.spawnable(mk)) asChar(s, mk, faceFromMove(s), enemyClip(s, game), opacity);
    else billboards.push(captureEntity(s));
  }
  // golden aura follows the living boss (cleared when it dies / no boss)
  if (rt.fx3d) rt.fx3d.setBossGlow(liveBoss && !liveBoss.dying ? { ...worldOf(liveBoss), y: 1.8 } : null);
  // 3D items (coins/potions/chests); everything else stays a billboard.
  const asItem = (e, key) => items.push({ entity: e, key, gx: e.x / TILE, gy: e.y / TILE });
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
  // arrows -> 3D models (along velocity); mage bolts / magic -> glowing orbs
  // with a particle trail; anything else stays a billboard.
  const asProj = (e) => projs.push({ entity: e, key: "arrow", gx: e.x / TILE, gy: e.y / TILE, rotationY: Math.atan2(e.vx, e.vy) });
  const asOrb = (e, color, size, trail) => {
    const w = dr.cellToWorld(e.x / TILE, e.y / TILE);
    orbs.push({ entity: e, x: w.x, y: 1.4, z: w.z, color, size });
    if (rt.fx3d) rt.fx3d.burst(w.x, 1.4, w.z, { count: 1, colors: trail, speed: 8, life: 0.25 });
  };
  for (const pr of game.projectiles) {
    if (pr.kind === "arrow" && dr.hasProjectile("arrow")) asProj(pr);
    else if (pr.kind === "bolt" && rt.fx3d) asOrb(pr, "#b48cff", 1.3, ["#b48cff", "#d8b4ff"]);
    else billboards.push(captureEntity(pr));
  }
  for (const es of game.enemyShots) {
    if (es.style === "arrow" && dr.hasProjectile("arrow")) asProj(es);
    else if (es.style === "magic" && rt.fx3d) asOrb(es, "#9940d0", 1.1, ["#9940d0", "#c060f0"]);
    else billboards.push(captureEntity(es));
  }
  } // !peaceful
  } // !menuish
  // no combat context -> ensure the boss aura is cleared
  if (rt.fx3d && (menuish || peaceful)) rt.fx3d.setBossGlow(null);

  if (mgr) mgr.sync(chars, dt);
  if (rt.fx3d) { rt.fx3d.update(dt); rt.fx3d.setOrbs(orbs); }
  // spike traps rise/sink with their gameplay cycle
  if (dr.spikeInst) dr.updateSpikes(room.spikes.map((s) => room.spikeStage(s, game.time)));
  dr.setItems(items);
  dr.setProjectiles(projs);
  dr.setEntities(billboards);
  dr.render();

  // 2D canvas becomes a transparent HUD overlay in screen space.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (menuish) return; // DOM overlays provide the menu/hub UI
  drawDamageNumbers3D(dr);
  if (game.state === "lobby") drawTierPads3D(dr, game);
  if (peaceful) drawPeacefulOverlay(dr, game);
  if (game.state === "play" || game.state === "transition") hud.draw(ctx, game);
  // room-transition fade (the 3D scene swaps rooms behind this)
  if (game.state === "transition") {
    const a = game.transitionPhase === "out" ? game.transitionT : 1 - game.transitionT;
    ctx.fillStyle = `rgba(10, 8, 18, ${clamp(a, 0, 1)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (camTest) drawCamTest(dr);
}

// Tier pads (lobby): glowing entry circles projected onto the 3D floor,
// with their labels and the dwell-to-enter progress ring. Ported from the
// old 2D drawTierPad; radii are projected per-axis so the ellipse follows
// the camera's perspective of the floor.
function drawTierPads3D(dr, game) {
  const pads = room.tierPads || [];
  if (!pads.length) return;
  const font = "'Trebuchet MS', Verdana, sans-serif";
  const time = game.time;
  for (const pad of pads) {
    const c = dr.projectToScreen(pad.x / TILE, pad.y / TILE, 0.05);
    if (c.depth > 1) continue;
    const ex = dr.projectToScreen((pad.x + pad.r) / TILE, pad.y / TILE, 0.05);
    const ey = dr.projectToScreen(pad.x / TILE, (pad.y + pad.r) / TILE, 0.05);
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
      const frac = clamp(game.padDwell / 0.7, 0, 1);
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
function drawPeacefulOverlay(dr, game) {
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
    sub = input.touchSeen
      ? "Tap an NPC to talk  •  walk up through the door to leave"
      : "Walk to an NPC and press E  •  exit ▲ to the map  •  Esc: map";
  }
  ctx.fillText(title, cx, 32);
  ctx.fillStyle = "#bdb3d6";
  ctx.font = `12px ${font}`;
  ctx.fillText(sub, cx, 48);
  if (game.state === "town" && game.nearbyNpc) {
    const n = game.nearbyNpc;
    const sp = dr.projectToScreen(n.x / TILE, n.y / TILE, 2.6);
    if (sp.depth <= 1) {
      ctx.fillStyle = "#ffd95e";
      ctx.font = `bold 13px ${font}`;
      const label = input.touchSeen ? `Tap to talk to ${n.label}` : `[E] Talk to ${n.label}`;
      ctx.fillText(label, sp.x, sp.y);
    }
  }
  ctx.textAlign = "left";
}

// Floating damage/heal numbers, projected from world space onto the HUD
// overlay and risen in screen space over their lifetime.
function drawDamageNumbers3D(dr) {
  if (!particles.activeTexts) return;
  const texts = particles.activeTexts();
  if (!texts.length) return;
  ctx.font = "bold 15px 'Trebuchet MS', Verdana, sans-serif";
  ctx.textAlign = "center";
  for (const t of texts) {
    const sp = dr.projectToScreen(t.x / TILE, t.y / TILE, 1.7);
    if (sp.depth > 1) continue; // behind the camera
    const rise = (0.8 - t.life) * 42;
    const y = sp.y - rise;
    ctx.globalAlpha = clamp(t.life / 0.4, 0, 1);
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
    b.addEventListener("click", (e) => { e.preventDefault(); const dr = rt.render3d; if (dr) fn(dr); });
    bar.appendChild(b);
  };
  mk("Zoom−", (dr) => { dr._camDist *= 1.06; });
  mk("Zoom+", (dr) => { dr._camDist /= 1.06; });
  mk("FOV−", (dr) => { dr.camera.fov = Math.max(15, dr.camera.fov - 2); dr.camera.updateProjectionMatrix(); });
  mk("FOV+", (dr) => { dr.camera.fov = Math.min(90, dr.camera.fov + 2); dr.camera.updateProjectionMatrix(); });
  mk("Tilt−", (dr) => { dr.elev = Math.max(0.1, dr.elev - 0.03); });
  mk("Tilt+", (dr) => { dr.elev = Math.min(1.5, dr.elev + 0.03); });
  mk("Scale−", () => { if (rt.charMgr) rt.charMgr.scaleMul = Math.max(0.3, rt.charMgr.scaleMul - 0.03); });
  mk("Scale+", () => { if (rt.charMgr) rt.charMgr.scaleMul = Math.min(3, rt.charMgr.scaleMul + 0.03); });
  mk("Cam", () => { camMode3d = camMode3d === "follow" ? "fixed" : "follow"; if (rt.render3d) rt.render3d.setCameraMode(camMode3d); });
  document.body.appendChild(bar);
}

// Live camera-tuning readout (?camtest). Adjust with arrows (elev/orbit),
// [ ] (zoom), - = (fov), 9 0 (character scale) — or the on-screen buttons.
function drawCamTest(dr) {
  const deg = (r) => (r * 180 / Math.PI).toFixed(1);
  const mul = rt.charMgr ? rt.charMgr.scaleMul : 1;
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
      if (rt.render3d) rt.render3d.setCameraMode(camMode3d);
      return;
    }
    if (!camTest) return;
    const dr = rt.render3d; if (!dr) return;
    switch (e.key) {
      case "ArrowUp":    dr.elev = Math.min(1.5, dr.elev + 0.02); break;     // higher/steeper
      case "ArrowDown":  dr.elev = Math.max(0.1, dr.elev - 0.02); break;     // lower/flatter
      case "ArrowLeft":  dr.camAngle -= 0.05; break;                          // orbit
      case "ArrowRight": dr.camAngle += 0.05; break;
      case "[":          dr._camDist *= 1.05; break;                          // zoom out
      case "]":          dr._camDist /= 1.05; break;                          // zoom in
      case "-": case "_": dr.camera.fov = Math.min(90, dr.camera.fov + 1); dr.camera.updateProjectionMatrix(); break;
      case "=": case "+": dr.camera.fov = Math.max(15, dr.camera.fov - 1); dr.camera.updateProjectionMatrix(); break;
      case "9": if (rt.charMgr) rt.charMgr.scaleMul = Math.max(0.3, rt.charMgr.scaleMul - 0.03); break;
      case "0": if (rt.charMgr) rt.charMgr.scaleMul = Math.min(3, rt.charMgr.scaleMul + 0.03); break;
      default: return;
    }
    e.preventDefault();
  });
  if (camTest) setupCamButtons();
}

export const game3d = {
  // True when the 3D path should draw this frame's state.
  active(state) {
    return rt.render3d && rt.render3d.proto && ROOM_3D_STATES[state];
  },
  // "Is the 3D view usable at all" — game.js freezes the simulation on this
  // rather than reaching into rt.render3d itself, keeping every 3D-readiness
  // question answered in this file.
  contextLost() { return !!(rt.render3d && rt.render3d.contextLost); },
  draw: drawCombat3D,
  // Keep the WebGL canvas matched to the overlay canvas (called from fitCanvas).
  resize(w, h) {
    if (!canvas3d) return;
    canvas3d.width = w;
    canvas3d.height = h;
    if (rt.render3d) rt.render3d.resize(w, h);
  },
};
