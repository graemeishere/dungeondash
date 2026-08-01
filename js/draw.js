"use strict";
// The frame: simulation update, the draw dispatch, and the rAF loop.

import { audio } from "./audio.js?v=8addee6b";
import { Skeleton, rollGrade } from "./entities.js?v=8addee6b";
import { game3d } from "./game3d.js?v=8addee6b";
import { input } from "./input.js?v=8addee6b";
import { net, netSync } from "./net.js?v=8addee6b";
import { particles } from "./particles.js?v=8addee6b";
import { room } from "./room.js?v=8addee6b";
import { WIDTH, dist, roomSizeForCanvas, setRoomSize, updateView, view } from "./util.js?v=8addee6b";
import { canvas, ctx, resultEl } from "./dom.js?v=8addee6b";
import { safeMode } from "./env.js?v=8addee6b";
import { game, uiFlags } from "./state.js?v=8addee6b";
import { advanceFloor, advanceRoom, endRun, reachStairs, setRoomCleared, showResult, startTransition, updateFloorGating } from "./run.js?v=8addee6b";
import { openInventory, openLevelUp, showHub } from "./overlays.js?v=8addee6b";
import { enterTierDoor, townToast, showTownRoom, showDungeonLobby } from "./town.js?v=8addee6b";
import { showMap, drawMap } from "./worldmap.js?v=8addee6b";
import { sendGuestInput } from "./coop.js?v=8addee6b";

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
    game.transitionT += dt * 2.6;
    if (game.transitionT >= 1) {
      if (game.transitionPhase === "out") {
        if (game.floorMode) advanceFloor(); else advanceRoom();
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
      if (!ch.opened && dist(ch.x, ch.y, p.x, p.y) < ch.r + p.r + 4) ch.open(game);
    }
  }

  particles.update(dt);

  if (game.state === "play") {
    // wait for death animations to play out before showing the result screen
    if (!game.players.some((p) => p.alive()) && !game.players.some((p) => p.dying)) {
      endRun(false);
      return;
    }

    // floor mode: per-room combat gating (lock on entry, unlock on clear,
    // reveal the stairs when the boss chamber falls)
    if (room.isFloor) updateFloorGating();

    // walk onto the revealed stairs -> descend (or win on the last floor).
    // reachStairs() branches to advanceFloor()/endRun(true) itself.
    if (room.isFloor && game.stairsReady && !game._stairsTaken &&
        game.players.some((p) => p.alive() && room.onStairs(p.x, p.y))) {
      reachStairs();
      return;
    }

    // room-clear conditions (single-room mode; floors gate per-room)
    if (!room.isFloor && !game.roomCleared) {
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

    // walk through the open door -> next room (single-room mode)
    if (!room.isFloor && game.roomCleared && room.doorOpen &&
        game.players.some((p) => p.alive() && room.inDoorway(p.x, p.y - p.r))) {
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
  // menu/hub show a generated dungeon as their 3D backdrop
  if ((game.state === "menu" || game.state === "hub") && !room.prerendered) {
    sizeRoomToCanvas();
    room.setTheme("catacombs"); // neutral backdrop, not the last dungeon's theme
    room.generate();
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
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);
    drawMap(ctx);
    ctx.restore();
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
  } else if (game.state === "map") {
    // the map is redrawn each frame from WIDTH/HEIGHT — resync them so it
    // reflows to the new aspect instead of letterboxing the old shape
    sizeRoomToCanvas();
    updateView(canvas);
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
