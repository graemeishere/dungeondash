"use strict";
// The frame: simulation update, the draw dispatch, and the rAF loop.

import { audio } from "./audio.js?v=__BUILD__";
import { Skeleton, rollGrade } from "./entities.js?v=__BUILD__";
import { game3d } from "./game3d.js?v=__BUILD__";
import { input } from "./input.js?v=__BUILD__";
import { net, netSync } from "./net.js?v=__BUILD__";
import { particles } from "./particles.js?v=__BUILD__";
import { room } from "./room.js?v=__BUILD__";
import { generateFloor } from "./floor.js?v=__BUILD__";
import { WIDTH, dist, roomSizeForCanvas, setRoomSize, updateView } from "./util.js?v=__BUILD__";
import { canvas, ctx, resultEl } from "./dom.js?v=__BUILD__";
import { safeMode } from "./env.js?v=__BUILD__";
import { game, uiFlags } from "./state.js?v=__BUILD__";
import { advanceFloor, endRun, reachStairs, showResult, updateFloorGating } from "./run.js?v=__BUILD__";
import { openInventory, openLevelUp, showHub } from "./overlays.js?v=__BUILD__";
import { enterTierDoor, townToast, showTownRoom, showDungeonLobby } from "./town.js?v=__BUILD__";
import { showMap, drawMap } from "./worldmap.js?v=__BUILD__";
import { sendGuestInput } from "./coop.js?v=__BUILD__";

export function fitCanvas() {
  canvas.width = Math.max(320, window.innerWidth);
  canvas.height = Math.max(320, window.innerHeight);
  ctx.imageSmoothingEnabled = false; // resets on resize
  if (game3d) game3d.resize(canvas.width, canvas.height);
  updateView(canvas);
}

export function sizeRoomToCanvas() {
  const d = roomSizeForCanvas(canvas);
  setRoomSize(d.tw, d.th);
}

// ---- update ----

export function update(dt) {
  // WebGL context lost: the player can't see the world, so nothing in it may
  // advance — timers, AI, spawns and damage all stop until they reload.
  // Letting the fight run on behind a black screen would cost them HP for
  // hits they had no way to see, let alone dodge. draw() keeps running so the
  // reload prompt stays live.
  if (game3d && game3d.contextLost()) return;

  // co-op guests don't simulate: they render host snapshots
  if (net.role === "guest") {
    if (uiFlags.guestInGame) particles.update(dt);
    return;
  }

  if (game.state === "hub") {
    if (input.consumeInvTap()) openInventory();
    return;
  }
  if (game.state === "lobby" || game.state === "town") { updatePeaceful(dt); return; }
  if (game.state === "map" || game.state === "menu" || game.state === "levelup" ||
      game.state === "inventory" || game.state === "stats" || game.state === "trader" ||
      game.state === "quests" || game.state === "raid-warn") return;

  if (game.state === "transition") {
    // The "out" half is slower than the "in" half: it has to show the hero
    // walking down the stairwell before the screen covers (game3d.js holds the
    // fade back over the first third for the same reason). Fading out in the
    // old 0.38s hid the descent completely.
    game.transitionT += dt * (game.transitionPhase === "out" ? 1.1 : 2.6);
    if (game.transitionT >= 1) {
      if (game.transitionPhase === "out") {
        advanceFloor();
        game.transitionPhase = "in";
        game.transitionT = 0;
      } else {
        game.state = "play";
      }
    }
    particles.update(dt);
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
      const grade = s.grade || (s.big || s.elite ? "regular" : rollGrade(game.floor, game.tier));
      game.skeletons.push(new Skeleton(s.x, s.y, {
        big: s.big, kind: s.kind, elite: s.elite, name: s.name,
        scale: floorCfg.scale, faction: s.faction || "skeleton", grade,
      }));
      audio.spawn();
      game.spawnQueue.splice(i, 1);
    }
  }

  if (game.state === "play") {
    if (input.consumeInvTap()) { openInventory(); return; }

    for (const p of game.players) p.update(dt, game);

    // spike traps
    if (room.spikes.length) {
      for (const p of game.players) {
        if (p.alive() && room.spikeUpAt(p.x, p.y, game.time)) {
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

  // chest interaction
  for (const p of game.players) {
    if (!p.alive()) continue;
    for (const ch of game.chests) {
      if (!ch.opened && dist(ch.x, ch.y, p.x, p.y) < ch.r + p.r + 4) ch.open(game, p);
    }
  }

  particles.update(dt);

  if (game.state === "play") {
    // wait for death animations to play out before showing the result screen
    if (!game.players.some((p) => p.alive()) && !game.players.some((p) => p.dying)) {
      endRun(false);
      return;
    }

    // per-room combat gating (lock on entry, unlock on clear, reveal the
    // stairs when the boss chamber falls)
    updateFloorGating();

    // walk onto the revealed stairs -> descend (or win on the last floor).
    // reachStairs() branches to advanceFloor()/endRun(true) itself.
    if (game.stairsReady && !game._stairsTaken &&
        game.players.some((p) => p.alive() && room.onStairs(p.x, p.y))) {
      reachStairs();
      return;
    }

    // pending level-ups pause the action
    if (game.pendingLevelUps > 0) {
      openLevelUp();
      return;
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
export function updatePeaceful(dt) {
  game.time += dt;
  const pl = game.players[0];
  if (!pl) return;
  pl.update(dt, game);
  particles.update(dt);

  if (game.state === "town") {
    game.nearbyNpc = null;
    for (const npc of game.townNpcs) {
      if (dist(pl.x, pl.y, npc.x, npc.y) < npc.r + pl.r + 18) { game.nearbyNpc = npc; break; }
    }
    const talk = input.consumeInteract() || input.consumeInvTap();
    if (game.nearbyNpc && talk) { game.nearbyNpc.interact(); return; }
    if (room.doorOpen && room.inDoorway(pl.x, pl.y - pl.r)) showMap();
  } else if (game.state === "lobby") {
    input.consumeInteract();
    const pads = room.tierPads || [];
    const pad = pads.find((p) => dist(pl.x, pl.y, p.x, p.y) < p.r);
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

// ---- draw ----

export function draw(dt) {
  // menu/hub show a generated dungeon as their 3D backdrop. Phase 1 retired
  // the classic single-room generator this used to call — a small connected
  // floor stands in fine, since it's just eye candy behind the menu.
  if ((game.state === "menu" || game.state === "hub") && !room.prerendered) {
    room.setTheme("catacombs"); // neutral backdrop, not the last dungeon's theme
    room.setFloor(generateFloor({ plan: ["combat", "boss"], boss: true }));
    updateView(canvas);
    room.prerendered = true;
  }

  // js/game3d.js renders the scene + HUD overlay for every in-world state.
  if (game3d && game3d.active(game.state)) {
    game3d.draw(game, dt);
    return;
  }

  // Screen-space UI states (the world map), plus a plain backdrop while the
  // 3D kit is still loading.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0e0b16";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (game.state === "map") {
    drawMap(ctx);
  }
}


// Registered by boot.js rather than at module scope: boot.js is deliberately
// the only module with top-level side effects, which is what keeps the circular
// imports between the run/UI modules inert.
export function onResize() {
  fitCanvas();
  // regenerate the backdrop room to fill the new shape; mid-run rooms keep
  // their layout and letterbox until the next room loads
  if (game.state === "menu" || game.state === "hub") {
    room.prerendered = false;
  } else if (game.state === "town") {
    showTownRoom(true);
  } else if (game.state === "lobby") {
    showDungeonLobby(game.lobbyDungeonId);
  }
}


let last = performance.now();
let netAccum = 0;
export function startLoop() {
  last = performance.now();
  requestAnimationFrame(frame);
}

function frame(now) {
  // Clamp to >= 0: on the first frame the rAF timestamp can predate the
  // performance.now() captured at boot, yielding a negative dt that pushes
  // game.time below zero (which broke decoration frame indexing, and could
  // corrupt spawn/animation timers).
  const dt = Math.max(0, Math.min((now - last) / 1000, 1 / 30));
  last = now;
  update(dt);
  draw(dt); // dt feeds the 3D animation mixers

  // network pump: host streams snapshots, guest streams input
  if (net.connected) {
    netAccum += dt;
    const interval = net.role === "host" ? 1 / 15 : 1 / 30;
    if (netAccum >= interval) {
      netAccum = 0;
      if (net.role === "host" && game.state !== "menu" && game.players.length > 1) {
        net.send(netSync.snapshot(game));
      } else if (net.role === "guest" && uiFlags.guestInGame) {
        sendGuestInput();
      }
    }
  }

  requestAnimationFrame(frame);
}
