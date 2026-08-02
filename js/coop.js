"use strict";
// Co-op: hosting, joining, and the host/guest message handlers.
//
// Parked as a feature (roadmap decision 3) - this file is modularized like
// everything else and otherwise left alone. The guest still runs on raw
// level-1 class stats; that defect is knowingly open, see roadmap section 4.

import { rt } from "./runtime.js?v=6fd6c2e4";
import { audio } from "./audio.js?v=6fd6c2e4";
import { CLASSES, Player, UPGRADES } from "./entities.js?v=6fd6c2e4";
import { input } from "./input.js?v=6fd6c2e4";
import { RemoteInput, net, netSync } from "./net.js?v=6fd6c2e4";
import { particles } from "./particles.js?v=6fd6c2e4";
import { profile } from "./profile.js?v=6fd6c2e4";
import { room } from "./room.js?v=6fd6c2e4";
import { updateView } from "./util.js?v=6fd6c2e4";
import { canvas } from "./dom.js?v=6fd6c2e4";
import { game, uiFlags, clearSave } from "./state.js?v=6fd6c2e4";
import { loadFloor, showResult } from "./run.js?v=6fd6c2e4";
import { freshGameState } from "./state.js?v=6fd6c2e4";
import { showLobby, setMenuMode, buildUpgradeCards, backToMenu, guestUpgradePicked, guestLeftLevelUp, lobbyEl, lobbyStatus, lobbyIn, roomCodeEl, codeIn } from "./overlays.js?v=6fd6c2e4";
import { levelupEl, menuEl, resultEl, hubEl, upgradeCardsEl } from "./dom.js?v=6fd6c2e4";

// The class the guest picked, held until the connection opens.
let guestClass = "warrior";

export function sendRoomToGuest() {
  if (net.role === "host" && net.connected) {
    net.send({ t: "room", room: room.getData(), floor: game.floor, dungeonId: game.dungeonId, tier: game.tier, ri: game.roomIndex, rt: game.roomType });
  }
}

export async function hostWithClass(classKey) {
  uiFlags.townSwitchClass = false;
  game.classKey = classKey;
  showLobby("Creating a room...");
  try {
    const code = await net.host();
    roomCodeEl.textContent = code;
    showLobby("Tell your friend this room code. Waiting for them to join...", { out: true });
  } catch (e) {
    showLobby("Could not create a room: " + (e.message || e.type || e) + " — the free matchmaking server may be busy. Tap Host again.");
  }
}

export async function joinWithClass(classKey) {
  uiFlags.townSwitchClass = false;
  guestClass = classKey;
  game.classKey = classKey;
  codeIn.value = "";
  showLobby("Enter the host's room code.", { input: true });
  codeIn.focus();
}

export async function tryJoin() {
  const code = codeIn.value.trim();
  if (!code) return;
  lobbyStatus.textContent = "Connecting...";
  try {
    await net.join(code);
    // the onOpen handler takes it from here
  } catch (e) {
    net.reset();
    const reason = e && e.type === "peer-unavailable" ? "No game found with that code." :
      (e && (e.message || e.type)) || "Connection failed.";
    const hint = e && e.type === "peer-unavailable"
      ? " Double-check the code, make sure the host is still on the lobby screen, and try again — the free matchmaking server is sometimes slow to sync."
      : " Check the code and try again.";
    showLobby(reason + hint, { input: true });
  }
}


export function startCoopRun(guestClassKey) {
  clearSave();
  const hero = profile.getOrCreateHero(game.classKey);
  game.hero = hero;
  game.players = [
    new Player(game.classKey, 0, 0, input, hero),
    new Player(guestClassKey, 0, 0, new RemoteInput()),
  ];
  game.localIndex = 0;
  input.setDashable(!!game.players[0].cfg.dash);
  game.dungeonId = game.dungeonId || "catacombs";
  game.tier = game.tier || 0;
  game.floor = 0;
  game.xp = hero.xp || 0;
  game.level = hero.level || 1;
  game.gold = 0;
  game.kills = 0;
  game.killsByFaction = { skeleton: 0, goblin: 0, undead: 0 };
  game.time = 0;
  game.floorMode = true; // co-op runs the connected-floor path too
  loadFloor();
  lobbyEl.classList.add("hidden");
  setMenuMode(null, "");
  freshGameState();
}

net.onOpen(() => {
  if (net.role === "guest") {
    net.send({ t: "join", cls: guestClass });
    lobbyStatus.textContent = "Connected! Waiting for the host to start...";
    lobbyIn.classList.add("hidden");
  } else {
    lobbyStatus.textContent = "Friend connected! Starting...";
  }
});

net.onClose(() => {
  if (net.role === "host") {
    if (game.players.length > 1) {
      game.players.splice(1);
      if (game.localPlayer) {
        particles.text(game.localPlayer.x, game.localPlayer.y - 50, "Friend disconnected — going solo", "#ff9234");
      }
      guestLeftLevelUp();
    }
    net.reset();
  } else if (net.role === "guest") {
    net.reset();
    uiFlags.guestInGame = false;
    lobbyEl.classList.add("hidden");
    levelupEl.classList.add("hidden");
    backToMenu();
    setMenuMode(null, "Disconnected from the host.");
  }
});

net.onMessage((m) => {
  if (net.role === "host") {
    if (m.t === "join") {
      startCoopRun(CLASSES[m.cls] ? m.cls : "warrior");
    } else if (m.t === "i" && game.players[1]) {
      const inp = game.players[1].input;
      inp.state = { mv: m.mv || { dx: 0, dy: 0 }, aim: m.aim || 0, atk: !!m.atk, dash: !!m.dash };
      if (m.dt) inp._dashTap = true;
    } else if (m.t === "pick") {
      const up = UPGRADES.find((u) => u.id === m.id);
      guestUpgradePicked(up, game.players[1]);
    }
    return;
  }

  // guest side
  if (m.t === "room") {
    room.setTheme(m.dungeonId || "catacombs");
    room.setData(m.room);
    updateView(canvas);
    game.floor = m.floor;
    game.dungeonId = m.dungeonId || "catacombs";
    game.tier = m.tier || 0;
    game.roomIndex = m.ri;
    game.roomType = m.rt;
    game.localIndex = 1;
    // The guest's avatar is rebuilt from host snapshots rather than
    // constructed here, so none of the other setDashable call sites fire on
    // this side. Without this the guest's on-screen dash button stops
    // hit-testing on touch. The picked class is the authority.
    input.setDashable(!!(CLASSES[guestClass] && CLASSES[guestClass].dash));
    uiFlags.guestInGame = true;
    particles.clear();
    lobbyEl.classList.add("hidden");
    menuEl.classList.add("hidden");
    hubEl.classList.add("hidden");
    resultEl.classList.add("hidden");
    game.state = "play";
    game.hintT = 6;
  } else if (m.t === "s" && uiFlags.guestInGame) {
    netSync.applySnapshot(game, m);
  } else if (m.t === "lvl") {
    game.state = "levelup";
    audio.levelup();
    let picked = false;
    const picks = m.ids.map((id) => UPGRADES.find((u) => u.id === id)).filter(Boolean);
    buildUpgradeCards(picks, (up) => {
      if (picked) return;
      picked = true;
      net.send({ t: "pick", id: up.id });
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
    if (m.won) audio.win(); else audio.lose();
    setTimeout(showResult, 1000);
  }
});

export function sendGuestInput() {
  const lp = game.localPlayer;
  if (!lp) return;
  const msg = {
    t: "i",
    mv: input.moveVector(),
    aim: input.aimAngle(lp),
    atk: input.attacking(),
    dash: !!input.keys.shift,
  };
  if (input.consumeDashTap()) msg.dt = 1;
  net.send(msg);
}
