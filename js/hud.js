"use strict";
(function (DD) {
  DD.hud = {
    draw(ctx, game) {
      const pl = game.localPlayer;
      if (!pl) return;
      const font = "'Trebuchet MS', Verdana, sans-serif";
      // HUD is drawn on the overlay canvas in screen space, so anchor to the
      // canvas — not DD.WIDTH/HEIGHT, which is the (possibly huge) floor grid.
      const SW = ctx.canvas.width, SH = ctx.canvas.height;

      // --- HP bar ---
      const bx = 16, by = 14, bw = 190, bh = 18;
      ctx.fillStyle = "rgba(10,8,18,0.7)";
      ctx.fillRect(bx - 4, by - 4, bw + 8, bh + 40);
      ctx.fillStyle = "#1a1626";
      ctx.fillRect(bx, by, bw, bh);
      const frac = DD.clamp(pl.hp / pl.maxHp, 0, 1);
      ctx.fillStyle = frac > 0.5 ? "#6fce6f" : frac > 0.25 ? "#e8c84a" : "#e8484f";
      ctx.fillRect(bx, by, bw * frac, bh);
      // segment ticks, one per HP point
      ctx.fillStyle = "rgba(10,8,18,0.5)";
      for (let i = 1; i < pl.maxHp; i++) {
        ctx.fillRect(bx + (bw / pl.maxHp) * i, by, 1, bh);
      }
      ctx.fillStyle = "#f2ecdd";
      ctx.font = `bold 12px ${font}`;
      ctx.textAlign = "center";
      ctx.fillText(`${pl.hp} / ${pl.maxHp}`, bx + bw / 2, by + 13);

      // --- XP bar ---
      ctx.fillStyle = "#1a1626";
      ctx.fillRect(bx, by + bh + 4, bw, 7);
      ctx.fillStyle = "#a06ce8";
      ctx.fillRect(bx, by + bh + 4, bw * DD.clamp(game.xp / game.xpNext(), 0, 1), 7);

      // class + level + gold + kills
      ctx.textAlign = "left";
      ctx.font = `bold 13px ${font}`;
      ctx.fillStyle = "#bdb3d6";
      ctx.fillText(`${pl.cfg.name} Lv ${game.level}`, bx, by + bh + 26);
      ctx.drawImage(DD.sprites.coin, bx + 102, by + bh + 14, 14, 14);
      ctx.fillStyle = "#ffd14a";
      ctx.fillText(`${game.gold}`, bx + 120, by + bh + 26);
      ctx.fillStyle = "#9b90b8";
      ctx.fillText(`Kills ${game.kills}`, bx + 150, by + bh + 26);

      const narrow = SW < 720;
      const typeLabel = {
        combat: "Combat", treasure: "Treasure", boss: "BOSS",
        trap: "Trap Gauntlet", elite: "Elite",
      }[game.roomType];
      const floorName = game.floorCfg().name || `Floor ${game.floor + 1}`;
      let roomLabel;
      if (DD.room.isFloor && DD.room.rooms) {
        const gated = DD.room.rooms.filter((r) => r.type === "combat" || r.type === "elite" || r.type === "boss");
        const done = gated.filter((r) => r.cleared).length;
        roomLabel = `${floorName} · Tier ${game.tier + 1} · Rooms ${done}/${gated.length}`;
      } else {
        roomLabel = `${floorName} · Tier ${game.tier + 1} · Room ${game.roomIndex + 1}/${game.plan().length} — ${typeLabel}`;
      }

      // --- room progress ---
      ctx.font = `bold 13px ${font}`;
      if (narrow) {
        // stack under the HP block so nothing overlaps on phones
        ctx.fillStyle = "#bdb3d6";
        ctx.fillText(roomLabel, bx, by + bh + 44);
      } else {
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(10,8,18,0.7)";
        ctx.fillRect(SW / 2 - 95, 44, 190, 22);
        ctx.fillStyle = "#bdb3d6";
        ctx.fillText(roomLabel, SW / 2, 59);
      }

      // --- teammate HP (co-op) ---
      game.players.forEach((mate, i) => {
        if (mate === pl) return;
        const my = by + bh + (narrow ? 56 : 36) + i * 18;
        ctx.font = `bold 11px ${font}`;
        ctx.fillStyle = "#9b90b8";
        ctx.fillText(`P${i + 1} ${mate.cfg.name}`, bx, my + 9);
        ctx.fillStyle = "#1a1626";
        ctx.fillRect(bx + 78, my, 80, 9);
        ctx.fillStyle = mate.downed ? "#ff6b70" : "#6fce6f";
        ctx.fillRect(bx + 78, my, 80 * DD.clamp(mate.hp / mate.maxHp, 0, 1), 9);
        if (mate.downed) {
          ctx.fillStyle = "#ff6b70";
          ctx.fillText("DOWN!", bx + 164, my + 9);
        }
      });

      // --- objective (top right) ---
      ctx.textAlign = "right";
      ctx.font = `bold 15px ${font}`;
      // a frozen boss (floor mode, chamber not yet entered) shows no bar
      const boss = game.skeletons.find((s) => s instanceof DD.Boss && !s.frozen && !s.dead);
      if (boss) {
        // boss HP bar, top center (under the player HUD on phones)
        const bbw = Math.min(320, SW - 48);
        const bbx = SW / 2 - bbw / 2;
        const bby = narrow ? 70 : 16;
        ctx.fillStyle = "rgba(10,8,18,0.7)";
        ctx.fillRect(bbx - 4, bby - 4, bbw + 8, 22);
        ctx.fillStyle = "#1a1626";
        ctx.fillRect(bbx, bby, bbw, 14);
        ctx.fillStyle = "#e8484f";
        ctx.fillRect(bbx, bby, bbw * DD.clamp(boss.hp / boss.maxHp, 0, 1), 14);
        ctx.textAlign = "center";
        ctx.font = `bold 11px ${font}`;
        ctx.fillStyle = "#f2ecdd";
        ctx.fillText(boss.label || "BOSS", SW / 2, bby + 11);
      } else if (DD.room.isFloor) {
        // floor objective: foes remaining in the locked room, else rooms left
        const arm = game.activeRoomId != null ? DD.room.roomById(game.activeRoomId) : null;
        const boxW = narrow ? 150 : 250;
        ctx.fillStyle = "rgba(10,8,18,0.7)";
        ctx.fillRect(SW - boxW - 16, 12, boxW, 26);
        if (arm) {
          const foes = game.skeletons.filter((s) => s.roomId === arm.id && !s.dead && !s.dying).length;
          ctx.fillStyle = "#ff6b6b";
          ctx.fillText(narrow ? `Locked · ${foes}` : `Doors locked — foes: ${foes}`, SW - 26, 31);
        } else {
          const gated = (DD.room.rooms || []).filter((r) => r.type === "combat" || r.type === "elite" || r.type === "boss");
          const left = gated.filter((r) => !r.cleared).length;
          ctx.fillStyle = "#ffd95e";
          ctx.fillText(narrow ? `Rooms · ${left}` : (left > 0 ? `Clear the floor — ${left} left` : "Descend the stairs ▼"), SW - 26, 31);
        }
      } else {
        const remaining = game.skeletons.filter((s) => !s.dead && !s.dying).length + game.spawnQueue.length;
        const chestsLeft = game.chests.filter((c) => !c.opened).length;
        const boxW = narrow ? 130 : 234;
        ctx.fillStyle = "rgba(10,8,18,0.7)";
        ctx.fillRect(SW - boxW - 16, 12, boxW, 26);
        if (game.roomType === "treasure" && chestsLeft > 0) {
          ctx.fillStyle = "#ffd14a";
          ctx.fillText(narrow ? `Chests: ${chestsLeft}` : `Open the chests! ${chestsLeft} left`, SW - 26, 31);
        } else if (remaining > 0) {
          ctx.fillStyle = "#f2ecdd";
          const eLabel = game.floorCfg().enemyLabel || "Enemies";
          ctx.fillText(narrow ? `Foes: ${remaining}` : `${eLabel}: ${remaining}`, SW - 26, 31);
        } else if (game.roomType === "trap") {
          ctx.fillStyle = "#ff9234";
          ctx.fillText(narrow ? "Spikes! ▲" : "Mind the spikes! Exit ▲", SW - 26, 31);
        } else if (game.roomCleared && game.state === "play") {
          ctx.fillStyle = "#ffd95e";
          ctx.fillText(narrow ? "Exit ▲" : "Cleared! Exit through the door ▲", SW - 26, 31);
        }
      }
      ctx.textAlign = "left";

      // --- floor minimap (top-right, under the objective) ---
      if (DD.room.isFloor && DD.room.rooms) this.drawMinimap(ctx, game, SW, narrow);

      // --- controls hint, fades out ---
      if (game.hintT > 0) {
        ctx.globalAlpha = DD.clamp(game.hintT, 0, 1);
        ctx.font = `12px ${font}`;
        ctx.fillStyle = "#bdb3d6";
        let hint = DD.input.touchSeen
          ? "left thumb: move • right thumb: aim & attack"
          : "WASD move • click / space attack • aim with mouse";
        if (pl.cfg.dash && !DD.input.touchSeen) hint += " • shift dash";
        ctx.fillText(hint, 16, SH - 14);
        ctx.globalAlpha = 1;
      }

      // dash cooldown pip
      if (pl.cfg.dash) {
        ctx.fillStyle = pl.dashCd <= 0 ? "#7fd6ff" : "#3a4a5c";
        ctx.beginPath();
        ctx.arc(bx + bw + 18, by + 9, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- touch controls ---
      if (DD.input.touchSeen) {
        const R = DD.input.STICK_RADIUS;
        for (const stick of [DD.input.touch.move, DD.input.touch.aim]) {
          if (!stick.active) continue;
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = "#f2ecdd";
          ctx.beginPath();
          ctx.arc(stick.ox, stick.oy, R, 0, Math.PI * 2);
          ctx.fill();
          // knob clamped to the stick radius
          let kx = stick.x - stick.ox, ky = stick.y - stick.oy;
          const len = Math.hypot(kx, ky);
          if (len > R) { kx = (kx / len) * R; ky = (ky / len) * R; }
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          ctx.arc(stick.ox + kx, stick.oy + ky, 20, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        if (pl.cfg.dash) {
          const btn = DD.input.dashBtn();
          ctx.globalAlpha = pl.dashCd <= 0 ? 0.55 : 0.25;
          ctx.fillStyle = "#7fd6ff";
          ctx.beginPath();
          ctx.arc(btn.x, btn.y, btn.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = "#0e1b24";
          ctx.font = `bold 12px ${font}`;
          ctx.textAlign = "center";
          ctx.fillText("DASH", btn.x, btn.y + 4);
          ctx.textAlign = "left";
          ctx.globalAlpha = 1;
        }

        // Inventory button — always shown on touch screens
        const ibtn = DD.input.invBtn();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#b48cff";
        ctx.beginPath();
        ctx.arc(ibtn.x, ibtn.y, ibtn.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#0e1b24";
        ctx.font = `bold 11px ${font}`;
        ctx.textAlign = "center";
        ctx.fillText("BAG", ibtn.x, ibtn.y + 4);
        ctx.textAlign = "left";
        ctx.globalAlpha = 1;
      }
    },

    // Corner minimap built from the floor's room rects: discovered rooms as
    // blocks (colored by type), corridors between them, and the player dot.
    drawMinimap(ctx, game, SW, narrow) {
      const rooms = DD.room.rooms.filter((r) => r.seen);
      if (!rooms.length) return;
      const font = "'Trebuchet MS', Verdana, sans-serif";
      // floor extent in tiles (from every room, so the map doesn't jump as more
      // rooms are revealed)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const r of DD.room.rooms) {
        minX = Math.min(minX, r.rect.x); minY = Math.min(minY, r.rect.y);
        maxX = Math.max(maxX, r.rect.x + r.rect.w); maxY = Math.max(maxY, r.rect.y + r.rect.h);
      }
      const boxW = narrow ? 116 : 150, boxH = narrow ? 92 : 118;
      const pad = 8;
      const bx = SW - boxW - 16, by = 46;
      const s = Math.min((boxW - pad * 2) / (maxX - minX), (boxH - pad * 2) / (maxY - minY));
      const ox = bx + pad + ((boxW - pad * 2) - (maxX - minX) * s) / 2;
      const oy = by + pad + ((boxH - pad * 2) - (maxY - minY) * s) / 2;
      const sx = (tx) => ox + (tx - minX) * s;
      const sy = (ty) => oy + (ty - minY) * s;

      ctx.fillStyle = "rgba(10,8,18,0.72)";
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = "rgba(120,110,150,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);

      // corridors between discovered connected rooms
      ctx.strokeStyle = "rgba(150,140,175,0.55)";
      ctx.lineWidth = 1;
      for (const [a, b] of (DD.room.edges || [])) {
        const ra = DD.room.roomById(a), rb = DD.room.roomById(b);
        if (!ra || !rb || !ra.seen || !rb.seen) continue;
        ctx.beginPath();
        ctx.moveTo(sx(ra.rect.x + ra.rect.w / 2), sy(ra.rect.y + ra.rect.h / 2));
        ctx.lineTo(sx(rb.rect.x + rb.rect.w / 2), sy(rb.rect.y + rb.rect.h / 2));
        ctx.stroke();
      }

      const pl = game.localPlayer;
      const curId = pl ? (DD.room.roomAt(pl.x, pl.y) || {}).id : null;
      const COLOR = { boss: "#e8484f", treasure: "#ffd14a", elite: "#e88a3a", shrine: "#8ad0ff" };
      for (const r of rooms) {
        const x = sx(r.rect.x), y = sy(r.rect.y), w = r.rect.w * s, h = r.rect.h * s;
        ctx.fillStyle = r.id === DD.room.stairsRoomId ? "#e8484f"
          : (COLOR[r.type] || (r.cleared ? "#5a5470" : "#8b83a6"));
        ctx.fillRect(x, y, Math.max(2, w), Math.max(2, h));
        if (r.locked) {
          ctx.strokeStyle = "#ff5252"; ctx.lineWidth = 1.5;
          ctx.strokeRect(x - 0.5, y - 0.5, Math.max(2, w) + 1, Math.max(2, h) + 1);
        }
        if (r.id === curId) {
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
          ctx.strokeRect(x - 1, y - 1, Math.max(2, w) + 2, Math.max(2, h) + 2);
        }
      }

      // player dot
      if (pl) {
        ctx.fillStyle = "#7fd6ff";
        ctx.beginPath();
        ctx.arc(sx(pl.x / DD.TILE), sy(pl.y / DD.TILE), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "#bdb3d6";
      ctx.font = `9px ${font}`;
      ctx.textAlign = "left";
      ctx.fillText("MAP", bx + 5, by + 11);
    },
  };
})(window.DD);
