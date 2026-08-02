"use strict";
// The world map screen: the only peaceful state still drawn purely in 2D
// screen space rather than through the 3D renderer. It draws directly against
// the real canvas pixel size (see drawMap below) so it fills the viewport at
// any aspect ratio instead of letterboxing to a fixed room shape.

import { audio } from "./audio.js?v=4e2b9596";
import { input } from "./input.js?v=4e2b9596";
import { profile } from "./profile.js?v=4e2b9596";
import { dist } from "./util.js?v=4e2b9596";
import { game, DUNGEONS } from "./state.js?v=4e2b9596";
import { hideAllOverlays, showHub, backToMenu } from "./overlays.js?v=4e2b9596";
import { showTownRoom, showDungeonLobby, startFinale } from "./town.js?v=4e2b9596";

export function showMap() {
  hideAllOverlays();
  game.state = "map";
  game.mapSelected = null;
  game.peaceful = false;
  game.townNpcs = [];
  game.nearbyNpc = null;
}

// ---- world map ----

export const MAP_LOCS = [
  { id: "catacombs",   name: "Catacombs",    fx: 0.22, fy: 0.27, kind: "dungeon" },
  { id: "goblinMines", name: "Goblin Mines",  fx: 0.26, fy: 0.68, kind: "dungeon" },
  { id: "town",        name: "Town",          fx: 0.50, fy: 0.46, kind: "town"    },
  { id: "crypt",       name: "The Crypt",     fx: 0.75, fy: 0.28, kind: "dungeon" },
  { id: "finale",      name: "The Last Stand", fx: 0.74, fy: 0.74, kind: "finale", championOnly: true },
];

// Touch-friendly "back to hub" button on the world map (mobile has no Esc).
// Coordinates are absolute canvas pixels, matching drawMap + handleMapTap.
export const MAP_HUB_BTN = { x: 12, y: 10, w: 104, h: 30 };

// Draw a small pixel-art icon for each location (48×48 in world pixels).
function drawMapIcon(ctx, loc, cx, cy, hovered) {
  const R = 28;
  ctx.fillStyle = hovered ? "rgba(255,255,255,0.12)" : "rgba(10,8,18,0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, R + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hovered ? "#ffd95e" : "#6b6481";
  ctx.lineWidth = hovered ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 4, 0, Math.PI * 2);
  ctx.stroke();

  if (loc.id === "catacombs") {
    // skull icon
    ctx.fillStyle = "#e9e6da";
    ctx.beginPath(); ctx.arc(cx, cy - 6, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1a1626";
    ctx.fillRect(cx - 8, cy - 10, 5, 6); ctx.fillRect(cx + 3, cy - 10, 5, 6); // sockets
    ctx.fillRect(cx - 10, cy + 6, 20, 8); // jaw
    ctx.fillStyle = "#e9e6da";
    ctx.fillRect(cx - 9, cy + 7, 18, 6);
    for (let i = 0; i < 4; i++) ctx.fillRect(cx - 7 + i * 5, cy + 10, 3, 4); // teeth
  } else if (loc.id === "goblinMines") {
    // pickaxe icon
    ctx.fillStyle = "#8b9ab5";
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 4);
    ctx.fillRect(-3, -18, 6, 36); // handle
    ctx.restore();
    ctx.fillStyle = "#d8d4e6";
    ctx.save(); ctx.translate(cx - 10, cy - 10);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(20, 0); ctx.lineTo(20, 8); ctx.lineTo(0, 20); ctx.closePath();
    ctx.fill(); ctx.restore();
  } else if (loc.id === "crypt") {
    // coffin / arch icon
    ctx.fillStyle = "#3a1a60";
    ctx.beginPath();
    ctx.arc(cx, cy - 8, 14, Math.PI, 0);
    ctx.lineTo(cx + 14, cy + 14);
    ctx.lineTo(cx - 14, cy + 14);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#9940d0";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#9940d0";
    ctx.beginPath(); ctx.arc(cx, cy - 8, 6, 0, Math.PI * 2); ctx.fill();
  } else if (loc.id === "town") {
    // house icon
    ctx.fillStyle = "#7a5c2e";
    ctx.fillRect(cx - 14, cy - 4, 28, 20);
    ctx.fillStyle = "#6fce6f";
    ctx.beginPath(); ctx.moveTo(cx - 18, cy - 4); ctx.lineTo(cx, cy - 22); ctx.lineTo(cx + 18, cy - 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#4a3020";
    ctx.fillRect(cx - 5, cy + 2, 10, 14); // door
  } else if (loc.id === "finale") {
    // flaming crown over a dark sigil
    ctx.fillStyle = "#2a1020";
    ctx.beginPath(); ctx.arc(cx, cy + 2, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff5a2a";
    ctx.fillRect(cx - 12, cy - 2, 24, 8); // crown band
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 9 - 4, cy - 2);
      ctx.lineTo(cx + i * 9, cy - 14);
      ctx.lineTo(cx + i * 9 + 4, cy - 2);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "#ffd14a";
    ctx.fillRect(cx - 3, cy + 6, 6, 6); // ember
  }
}

export function drawMap(ctx) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  // stone floor background
  ctx.fillStyle = "#1e1a2e";
  ctx.fillRect(0, 0, W, H);
  // subtle grid
  ctx.strokeStyle = "rgba(80,70,110,0.18)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // path lines between locations
  ctx.strokeStyle = "rgba(180,160,220,0.2)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  const town = MAP_LOCS.find((l) => l.id === "town");
  for (const loc of MAP_LOCS) {
    if (loc.kind !== "dungeon") continue;
    ctx.beginPath();
    ctx.moveTo(town.fx * W, town.fy * H);
    ctx.lineTo(loc.fx * W, loc.fy * H);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // title
  const font = "'Trebuchet MS', Verdana, sans-serif";
  ctx.font = `bold 20px ${font}`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#d8cfee";
  ctx.fillText("WORLD MAP", W / 2, 30);
  ctx.font = `12px ${font}`;
  ctx.fillStyle = "#7a6e96";
  ctx.fillText("Click a location to travel there", W / 2, 50);

  if (game.hero && game.hero.victory) {
    ctx.font = `bold 13px ${font}`;
    ctx.fillStyle = "#ffd95e";
    ctx.fillText("★  REALM CHAMPION  ★", W / 2, 68);
  }

  const mx = input.mouse.x, my = input.mouse.y;

  // "back to hub" button (top-left) — the reliable path to Host/Join Co-op
  const hb = MAP_HUB_BTN;
  const hbHover = mx >= hb.x && mx <= hb.x + hb.w && my >= hb.y && my <= hb.y + hb.h;
  ctx.fillStyle = hbHover ? "rgba(120,100,170,0.55)" : "rgba(30,24,46,0.85)";
  ctx.strokeStyle = "rgba(180,160,220,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(hb.x, hb.y, hb.w, hb.h, 6) : ctx.rect(hb.x, hb.y, hb.w, hb.h);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = `bold 13px ${font}`;
  ctx.fillStyle = hbHover ? "#fff" : "#d8cfee";
  ctx.fillText("‹ Hub", hb.x + hb.w / 2, hb.y + hb.h / 2 + 4);

  // draw locations
  for (const loc of MAP_LOCS) {
    if (loc.championOnly && !(game.hero && game.hero.victory)) continue;
    const cx = loc.fx * W, cy = loc.fy * H;
    const hovered = dist(mx, my, cx, cy) < 36;
    drawMapIcon(ctx, loc, cx, cy, hovered);

    // label
    ctx.textAlign = "center";
    ctx.font = `bold 13px ${font}`;
    ctx.fillStyle = hovered ? "#ffd95e" : "#bdb3d6";
    ctx.fillText(loc.name, cx, cy + 46);

    // per-dungeon tier-clear pips + a star once the top tier is beaten
    if (loc.kind === "dungeon" && game.hero) {
      const d = DUNGEONS[loc.id];
      const top = d.tiers.length - 1;
      d.tiers.forEach((t, ti) => {
        const px = cx - 16 + ti * 16;
        ctx.fillStyle = profile.hasClear(game.hero, loc.id, ti) ? "#ffd14a" : "rgba(120,110,150,0.4)";
        ctx.beginPath(); ctx.arc(px, cy + 60, 4, 0, Math.PI * 2); ctx.fill();
      });
      if (profile.hasClear(game.hero, loc.id, top)) {
        ctx.fillStyle = "#ffd95e";
        ctx.font = `16px ${font}`;
        ctx.fillText("★", cx, cy - 40);
      }
    }
  }
  ctx.textAlign = "left";
}

// ---- world map click / tap handler ----

export function handleMapTap(clientX, clientY, targetEl) {
  if (game.state !== "map") return false;
  const rect = targetEl.getBoundingClientRect();
  const cx = (clientX - rect.left) * (targetEl.width / rect.width);
  const cy = (clientY - rect.top) * (targetEl.height / rect.height);
  const wx = cx;
  const wy = cy;

  // "‹ Hub" button — always available so the map is never a dead end
  const hb = MAP_HUB_BTN;
  if (wx >= hb.x && wx <= hb.x + hb.w && wy >= hb.y && wy <= hb.y + hb.h) {
    audio.unlock();
    if (game.hero) showHub(game.hero); else backToMenu();
    return true;
  }

  for (const loc of MAP_LOCS) {
    if (loc.championOnly && !(game.hero && game.hero.victory)) continue;
    const lx = loc.fx * targetEl.width, ly = loc.fy * targetEl.height;
    if (dist(wx, wy, lx, ly) < 52) {
      audio.unlock();
      if (loc.kind === "town") showTownRoom();
      else if (loc.kind === "finale") startFinale();
      else showDungeonLobby(loc.id);
      return true;
    }
  }
  return false;
}
