"use strict";
// Procedurally generated pixel-art assets. Every sprite is drawn onto an
// offscreen canvas at boot, so the game needs no image files at all.
(function (DD) {
  const PX = 4;      // screen pixels per art pixel
  const GRID = 16;   // character sprites are authored on a 16x16 grid

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  // A 16x16 pixel surface with a plot helper. p(x, y, color, w, h)
  function surface(grid = GRID) {
    const canvas = makeCanvas(grid * PX, grid * PX);
    const ctx = canvas.getContext("2d");
    const p = (x, y, color, w = 1, h = 1) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x * PX), Math.round(y * PX), Math.round(w * PX), Math.round(h * PX));
    };
    return { canvas, ctx, p };
  }

  const SKIN = "#f2c09a";
  const SKIN_SHADE = "#d49a72";
  const DARK = "#241f33";

  // Chibi hero: head rows 2-8, body rows 9-12, feet rows 13-14, hat rows 0-4.
  // frame 1 bobs the head/hat down one pixel and swaps the feet.
  function drawHero(p, opts, frame) {
    const bob = frame === 1 ? 1 : 0;

    // feet
    if (frame === 0) {
      p(5, 13, opts.boot, 2, 2);
      p(9, 13, opts.boot, 2, 2);
    } else {
      p(4, 13, opts.boot, 2, 2);
      p(9, 14, opts.boot, 2, 1);
    }

    // body + arms
    p(5, 9, opts.body, 6, 4);
    p(4, 9, opts.sleeve, 1, 3);
    p(11, 9, opts.sleeve, 1, 3);
    p(5, 12, opts.belt, 6, 1);
    if (opts.emblem) p(7, 10, opts.emblem, 2, 1);

    // head
    p(4, 2 + bob, SKIN, 8, 7);
    p(4, 7 + bob, SKIN_SHADE, 8, 1); // chin shading
    p(6, 5 + bob, DARK, 1, 2);       // eyes
    p(9, 5 + bob, DARK, 1, 2);

    // headgear
    switch (opts.hat) {
      case "helmet":
        p(3, 1 + bob, opts.hatColor, 10, 4);
        p(3, 1 + bob, "#dde6f2", 10, 1);     // shine
        p(7, 0 + bob, opts.accent, 2, 2);     // plume
        break;
      case "wizard":
        p(7, 0 + bob, opts.hatColor, 2, 1);
        p(6, 1 + bob, opts.hatColor, 4, 1);
        p(5, 2 + bob, opts.hatColor, 6, 1);
        p(5, 3 + bob, opts.accent, 6, 1);     // hat band
        p(3, 4 + bob, opts.hatColor, 10, 1);  // brim
        break;
      case "hood":
        p(3, 1 + bob, opts.hatColor, 10, 3);
        p(3, 4 + bob, opts.hatColor, 1, 4);
        p(12, 4 + bob, opts.hatColor, 1, 4);
        break;
      case "cap":
        p(3, 1 + bob, opts.hatColor, 10, 2);
        p(12, 0 + bob, opts.accent, 1, 3);    // feather
        break;
    }
  }

  function drawSkeleton(p, frame, variant) {
    const bob = frame === 1 ? 1 : 0;
    const BONE = variant === "shade" ? "#8899dd" : "#e9e6da";
    const BONE_SHADE_C = variant === "shade" ? "#6677bb" : "#b9b4a4";

    // feet
    if (frame === 0) {
      p(5, 13, BONE, 2, 2);
      p(9, 13, BONE, 2, 2);
    } else {
      p(4, 13, BONE, 2, 2);
      p(9, 14, BONE, 2, 1);
    }

    // ribcage torso
    p(5, 9, "#34304a", 6, 4);
    p(5, 9, BONE, 6, 1);
    p(5, 11, BONE, 6, 1);
    p(4, 9, BONE_SHADE_C, 1, 3); // arms
    p(11, 9, BONE_SHADE_C, 1, 3);

    if (variant === "bomber") {
      // round black bomb strapped to the ribcage
      p(4, 9, "#1c1a24", 8, 4);
      p(5, 8, "#1c1a24", 6, 1);
      p(7, 7, "#ff9234", 2, 1); // fuse spark
      p(5, 9, "#3a3750", 2, 1); // highlight
    }

    // skull
    p(4, 1 + bob, BONE, 8, 7);
    p(3, 2 + bob, BONE, 10, 4);
    const socket = variant === "bomber" ? "#c93232"
      : variant === "shade" ? "#5566ee"
      : "#1a1626";
    p(5, 3 + bob, socket, 2, 2);  // sockets
    p(9, 3 + bob, socket, 2, 2);
    p(7, 5 + bob, "#1a1626", 1, 1);  // nose
    p(5, 7 + bob, "#1a1626", 1, 1);  // grin gaps
    p(7, 7 + bob, "#1a1626", 1, 1);
    p(9, 7 + bob, "#1a1626", 1, 1);

    if (variant === "archer") {
      // mossy hood + a bow at the side
      p(3, 0 + bob, "#3a5e3d", 10, 3);
      p(3, 3 + bob, "#3a5e3d", 1, 4);
      p(12, 3 + bob, "#3a5e3d", 1, 4);
      p(13, 8, "#8a5e2e", 1, 5); // bow stave
      p(12, 7, "#8a5e2e", 1, 1);
      p(12, 13, "#8a5e2e", 1, 1);
    }
  }

  function drawGoblin(p, frame, variant) {
    const bob = frame === 1 ? 1 : 0;
    const SKIN = "#4a7c4a", SKIN_D = "#2d5e2d";
    const LEATHER = "#7a5c2e", BELT = "#4a3020";
    const EYE = "#cc2222", DARK = "#241f33";

    // feet
    if (frame === 0) {
      p(5, 13, BELT, 2, 2); p(9, 13, BELT, 2, 2);
    } else {
      p(4, 13, BELT, 2, 2); p(9, 14, BELT, 2, 1);
    }

    // stout torso
    p(4, 9, LEATHER, 8, 4);
    p(5, 9, "#8a6c3a", 6, 1); // highlight
    p(3, 10, SKIN, 1, 2);  // arms
    p(12, 10, SKIN, 1, 2);
    p(4, 12, BELT, 8, 1); // belt

    // big round goblin head with protruding ears
    p(4, 1 + bob, SKIN, 6, 1);
    p(3, 2 + bob, SKIN, 8, 1);
    p(3, 3 + bob, SKIN, 10, 6);
    p(3, 8 + bob, SKIN_D, 10, 1); // chin
    p(1, 3 + bob, SKIN, 2, 3); p(1, 3 + bob, SKIN_D, 1, 3); // left ear
    p(13, 3 + bob, SKIN, 2, 3); p(14, 3 + bob, SKIN_D, 1, 3); // right ear
    p(5, 5 + bob, EYE, 2, 1); p(9, 5 + bob, EYE, 2, 1); // eyes
    p(7, 6 + bob, SKIN_D, 2, 1); // nose bump
    p(5, 7 + bob, DARK, 1, 1); p(7, 7 + bob, DARK, 2, 1); p(10, 7 + bob, DARK, 1, 1); // grin

    if (variant === "goblinArcher") {
      p(13, 7, "#8a5e2e", 1, 6); // bow stave
      p(12, 6, "#8a5e2e", 1, 1); p(12, 13, "#8a5e2e", 1, 1);
    } else if (variant === "goblinBerserker") {
      p(2, 6, "#8b9ab5", 3, 5); // axe head
      p(2, 6, "#d8d4e6", 1, 5); // blade edge
      p(4, 8, "#7a4f26", 1, 6); // haft
    } else if (variant === "goblinShaman") {
      p(13, 6, "#4a7c4a", 2, 2); // orb
      p(14, 6, "#88dd88", 1, 1); // shine
      p(13, 8, "#7a5c2e", 1, 6); // staff
      p(12, 6, "#88dd88", 1, 1); p(15, 7, "#88dd88", 1, 1); // sparkles
    }
  }

  function drawUndead(p, frame, variant) {
    const bob = frame === 1 ? 1 : 0;
    const DARK = "#241f33";

    if (variant === "zombie") {
      const ZSK = "#6a8c6a", ZSD = "#445c44", CLOTH = "#3a3550", ROT = "#4a5c2a";
      if (frame === 0) {
        p(5, 13, ZSD, 2, 2); p(9, 13, ZSD, 2, 2);
      } else {
        p(4, 13, ZSD, 2, 2); p(9, 14, ZSD, 2, 1);
      }
      p(4, 9, CLOTH, 8, 4);
      p(3, 10, ZSK, 1, 2); p(12, 10, ZSK, 1, 2);
      p(4, 12, ROT, 8, 1);
      p(3, 2 + bob, ZSK, 10, 7);
      p(3, 8 + bob, ZSD, 10, 1);
      p(5, 4 + bob, "#88dd44", 2, 2); p(9, 4 + bob, "#88dd44", 2, 2); // glowing eyes
      p(5, 5 + bob, DARK, 1, 1); p(9, 5 + bob, DARK, 1, 1); // pupils
      p(5, 7 + bob, DARK, 6, 1); // gaping mouth
      p(6, 7 + bob, ZSK, 1, 1); p(9, 7 + bob, ZSK, 1, 1); // teeth gaps

    } else if (variant === "warlock") {
      const ROBE = "#220d40", ROBE_L = "#3a1a60", ACCENT = "#9940d0", SKIN = "#c0a890";
      if (frame === 0) {
        p(5, 13, ROBE, 2, 2); p(9, 13, ROBE, 2, 2);
      } else {
        p(4, 13, ROBE, 2, 2); p(9, 14, ROBE, 2, 1);
      }
      p(4, 9, ROBE, 8, 5); p(5, 9, ROBE_L, 6, 1);
      p(3, 10, ROBE, 2, 3); p(11, 10, ROBE, 2, 3);
      p(7, 10, ACCENT, 2, 1); p(6, 11, ACCENT, 4, 1); p(7, 12, ACCENT, 2, 1); // glyph
      p(3, 1 + bob, ROBE, 10, 4); // hood
      p(4, 2 + bob, SKIN, 8, 5); p(4, 7 + bob, "#a08060", 8, 1);
      p(3, 4 + bob, ROBE, 1, 4); p(12, 4 + bob, ROBE, 1, 4); // hood sides
      p(5, 4 + bob, ACCENT, 2, 2); p(9, 4 + bob, ACCENT, 2, 2); // glowing eyes

    } else if (variant === "necromancer") {
      const ROBE = "#0d1a2e", ROBE_L = "#1a2e48", GLOW = "#4a90d9", ACCENT = "#2060aa", SKIN = "#c8a8d0";
      if (frame === 0) {
        p(5, 13, ROBE, 2, 2); p(9, 13, ROBE, 2, 2);
      } else {
        p(4, 13, ROBE, 2, 2); p(9, 14, ROBE, 2, 1);
      }
      p(4, 9, ROBE, 8, 5); p(5, 9, ROBE_L, 6, 1);
      p(3, 10, ROBE, 2, 3); p(11, 10, ROBE, 2, 3);
      p(7, 10, ACCENT, 1, 1); p(8, 11, ACCENT, 1, 1); p(7, 12, ACCENT, 1, 1); // runes
      p(13, 5, GLOW, 2, 2); p(14, 5, "#88c0ff", 1, 1); // crystal tip
      p(13, 7, "#6a5a3a", 1, 7); // staff
      p(6, 0 + bob, ROBE, 4, 2); p(5, 1 + bob, ROBE, 6, 1); // pointed cowl
      p(4, 2 + bob, SKIN, 8, 5); p(4, 7 + bob, "#a890b0", 8, 1);
      p(4, 2 + bob, ROBE, 2, 2); p(10, 2 + bob, ROBE, 2, 2); // cowl sides
      p(5, 4 + bob, GLOW, 2, 1); p(9, 4 + bob, GLOW, 2, 1); // cold blue eyes
    }
  }

  function makeFrames(drawFn) {
    return [0, 1].map((frame) => {
      const s = surface();
      drawFn(s.p, frame);
      return s.canvas;
    });
  }

  // ---- tiles (drawn at native TILE resolution) ----

  function makeFloorTile(variant) {
    const t = makeCanvas(DD.TILE, DD.TILE);
    const ctx = t.getContext("2d");
    ctx.fillStyle = "#46415c";
    ctx.fillRect(0, 0, DD.TILE, DD.TILE);
    ctx.fillStyle = "#3c3750";
    ctx.fillRect(0, 0, DD.TILE, 2);
    ctx.fillRect(0, 0, 2, DD.TILE);
    // speckle
    const speckles = ["#514b6b", "#3a3550", "#554f72"];
    for (let i = 0; i < 7 + variant * 2; i++) {
      ctx.fillStyle = DD.choice(speckles);
      ctx.fillRect(DD.randi(2, 28), DD.randi(2, 28), DD.randi(2, 4), DD.randi(2, 3));
    }
    if (variant === 3) { // cracked variant
      ctx.strokeStyle = "#322e45";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(6, 24);
      ctx.lineTo(14, 16);
      ctx.lineTo(13, 9);
      ctx.stroke();
    }
    return t;
  }

  function makeWallTile() {
    const t = makeCanvas(DD.TILE, DD.TILE);
    const ctx = t.getContext("2d");
    ctx.fillStyle = "#231f33";
    ctx.fillRect(0, 0, DD.TILE, DD.TILE);
    ctx.fillStyle = "#312c46";
    // two rows of offset bricks
    ctx.fillRect(1, 1, 14, 13);
    ctx.fillRect(17, 1, 14, 13);
    ctx.fillRect(1, 17, 6, 13);
    ctx.fillRect(9, 17, 14, 13);
    ctx.fillRect(25, 17, 6, 13);
    ctx.fillStyle = "#3e3857";
    ctx.fillRect(1, 1, 14, 2);
    ctx.fillRect(17, 1, 14, 2);
    return t;
  }

  function makeDoorTile(open) {
    const t = makeCanvas(DD.TILE, DD.TILE);
    const ctx = t.getContext("2d");
    ctx.drawImage(DD.sprites.wallTile, 0, 0);
    ctx.fillStyle = open ? "#15121f" : "#0d0b14";
    ctx.fillRect(4, 6, 24, 26);
    if (open) {
      ctx.fillStyle = "#ffd95e";
      ctx.globalAlpha = 0.25;
      ctx.fillRect(4, 6, 24, 26);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#6b6481";
      for (let x = 7; x <= 25; x += 6) ctx.fillRect(x, 6, 3, 26);
      ctx.fillRect(4, 14, 24, 3);
    }
    ctx.fillStyle = "#3e3857";
    ctx.fillRect(2, 4, 28, 3);
    return t;
  }

  // ---- pickups (8x8 art) ----

  function makeHeart() {
    const s = surface(8);
    const R = "#e8484f", D = "#a32630", L = "#ff8c91";
    s.p(1, 0, R, 2, 1); s.p(5, 0, R, 2, 1);
    s.p(0, 1, R, 8, 2);
    s.p(1, 3, R, 6, 1);
    s.p(2, 4, D, 4, 1);
    s.p(3, 5, D, 2, 1);
    s.p(1, 1, L, 1, 1);
    return s.canvas;
  }

  function makeChest(open) {
    const s = surface(16);
    const WOOD = "#7a4f26", WOOD_D = "#5a3a1a", GOLD = "#ffd14a", DARKI = "#241f33";
    if (open) {
      s.p(3, 0, WOOD_D, 10, 1);
      s.p(2, 1, WOOD_D, 12, 3);   // lid flipped up
      s.p(7, 1, GOLD, 2, 3);
      s.p(2, 6, WOOD, 12, 8);     // body
      s.p(3, 6, DARKI, 10, 3);    // dark interior
      s.p(4, 7, GOLD, 2, 1);      // glints
      s.p(9, 8, GOLD, 2, 1);
      s.p(2, 13, WOOD_D, 12, 1);
    } else {
      s.p(3, 3, WOOD_D, 10, 1);
      s.p(2, 4, WOOD_D, 12, 3);   // lid
      s.p(2, 7, WOOD, 12, 7);     // body
      s.p(2, 13, WOOD_D, 12, 1);
      s.p(7, 3, GOLD, 2, 11);     // band
      s.p(6, 8, GOLD, 4, 3);      // lock
      s.p(7, 9, DARKI, 1, 1);
    }
    return s.canvas;
  }

  function makeCrown() {
    const s = surface(8);
    const G = "#ffd14a", R = "#e8484f";
    s.p(0, 0, G, 1, 2);
    s.p(3, 0, G, 2, 2);
    s.p(7, 0, G, 1, 2);
    s.p(0, 2, G, 8, 2);
    s.p(3, 2, R, 2, 1);
    return s.canvas;
  }

  // ---- spike trap tile (3 stages: hidden, warning tips, fully up) ----
  function makeSpike(stage) {
    const t = makeCanvas(DD.TILE, DD.TILE);
    const ctx = t.getContext("2d");
    // base plate with holes
    ctx.fillStyle = "#2e2a40";
    ctx.fillRect(2, 2, 28, 28);
    ctx.fillStyle = "#241f33";
    for (const [hx, hy] of [[8, 10], [20, 10], [14, 20]]) {
      ctx.fillRect(hx - 2, hy - 1, 6, 4);
    }
    if (stage >= 1) {
      const h = stage === 1 ? 6 : 14;
      ctx.fillStyle = stage === 1 ? "#8b80a8" : "#d8d4e6";
      for (const [hx, hy] of [[9, 12], [21, 12], [15, 22]]) {
        ctx.beginPath();
        ctx.moveTo(hx - 4, hy);
        ctx.lineTo(hx, hy - h);
        ctx.lineTo(hx + 4, hy);
        ctx.closePath();
        ctx.fill();
      }
    }
    return t;
  }

  function makeScroll() {
    const s = surface(8);
    const P = "#e8dcb8", D = "#b8a878", R = "#8a5e2e";
    s.p(0, 1, R, 1, 6);
    s.p(7, 1, R, 1, 6);
    s.p(1, 1, P, 6, 6);
    s.p(2, 2, D, 4, 1);
    s.p(2, 4, D, 4, 1);
    return s.canvas;
  }

  function makeItemSword() {
    const s = surface(8);
    const BLADE = "#d8d4e6", GUARD = "#8b80a8", HILT = "#7a4f26", SHINE = "#f0eeff";
    s.p(3, 0, BLADE, 2, 4); s.p(3, 1, SHINE, 1, 1);
    s.p(2, 4, GUARD, 4, 1);
    s.p(3, 5, HILT, 2, 3);
    return s.canvas;
  }

  function makeItemArmor() {
    const s = surface(8);
    const STEEL = "#8b9ab5", EDGE = "#5d6880", EMBLEM = "#d33a3a";
    s.p(1, 0, STEEL, 6, 1);
    s.p(0, 1, STEEL, 8, 4);
    s.p(1, 5, STEEL, 6, 1);
    s.p(2, 6, STEEL, 4, 1);
    s.p(3, 7, STEEL, 2, 1);
    s.p(0, 1, EDGE, 1, 4); s.p(7, 1, EDGE, 1, 4);
    s.p(3, 2, EMBLEM, 2, 2);
    return s.canvas;
  }

  function makeItemRing() {
    const s = surface(8);
    const GOLD = "#ffd14a", GEM = "#b48cff", SHINE = "#e0c0ff";
    s.p(2, 0, GEM, 4, 2); s.p(3, 0, SHINE, 1, 1);
    s.p(3, 2, GOLD, 2, 1);
    s.p(1, 3, GOLD, 1, 3); s.p(6, 3, GOLD, 1, 3);
    s.p(2, 6, GOLD, 4, 1);
    return s.canvas;
  }

  function makeItemAxe() {
    const s = surface(8);
    const HEAD = "#8b9ab5", EDGE = "#d8d4e6", HAFT = "#7a4f26", SHINE = "#e8eeff";
    s.p(1, 0, HEAD, 4, 5); // axe head
    s.p(1, 0, EDGE, 1, 5); // blade edge
    s.p(1, 0, SHINE, 2, 1); // shine
    s.p(4, 2, HAFT, 2, 6); // handle
    s.p(3, 7, HAFT, 1, 1); // butt cap
    return s.canvas;
  }

  function makeCoin() {
    const s = surface(8);
    const G = "#ffd14a", D = "#c2912a", L = "#fff3b8";
    s.p(2, 0, G, 4, 1);
    s.p(1, 1, G, 6, 6);
    s.p(2, 7, G, 4, 1);
    s.p(0, 2, G, 8, 4);
    s.p(3, 2, D, 2, 4); // stamped slot
    s.p(2, 1, L, 1, 2); // shine
    return s.canvas;
  }

  // ---- per-dungeon themed tiles ----
  // Each theme supplies a wall tile, floor variants, and a closed/open door.
  // The offset-brick layout matches makeWallTile so collision visuals stay aligned.

  function paintTile(paint) {
    const t = makeCanvas(DD.TILE, DD.TILE);
    paint(t.getContext("2d"));
    return t;
  }

  function makeBrickWall(pal) {
    return paintTile((ctx) => {
      ctx.fillStyle = pal.mortar;
      ctx.fillRect(0, 0, DD.TILE, DD.TILE);
      ctx.fillStyle = pal.brick;
      ctx.fillRect(1, 1, 14, 13);
      ctx.fillRect(17, 1, 14, 13);
      ctx.fillRect(1, 17, 6, 13);
      ctx.fillRect(9, 17, 14, 13);
      ctx.fillRect(25, 17, 6, 13);
      ctx.fillStyle = pal.hi;
      ctx.fillRect(1, 1, 14, 2);
      ctx.fillRect(17, 1, 14, 2);
      if (pal.accent) {
        ctx.fillStyle = pal.accent;
        ctx.fillRect(4, 5, 2, 6);    // vein/beam accent
        ctx.fillRect(20, 19, 2, 7);
      }
    });
  }

  function makeThemedFloor(pal, variant) {
    return paintTile((ctx) => {
      ctx.fillStyle = pal.base;
      ctx.fillRect(0, 0, DD.TILE, DD.TILE);
      ctx.fillStyle = pal.edge;
      ctx.fillRect(0, 0, DD.TILE, 2);
      ctx.fillRect(0, 0, 2, DD.TILE);
      for (let i = 0; i < 6 + variant * 2; i++) {
        ctx.fillStyle = DD.choice(pal.speckles);
        ctx.fillRect(DD.randi(2, 28), DD.randi(2, 28), DD.randi(2, 4), DD.randi(2, 3));
      }
      if (pal.rail) {
        // mine cart rails: two parallel lines with sleepers
        ctx.fillStyle = pal.rail;
        ctx.fillRect(8, 0, 3, DD.TILE);
        ctx.fillRect(21, 0, 3, DD.TILE);
        ctx.fillStyle = pal.sleeper || pal.edge;
        for (let y = 3; y < DD.TILE; y += 10) ctx.fillRect(6, y, 20, 2);
      }
      if (pal.crack && variant === 2) {
        ctx.strokeStyle = pal.crack;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(6, 24); ctx.lineTo(14, 16); ctx.lineTo(13, 9);
        ctx.stroke();
      }
    });
  }

  function makeWoodFloor(variant) {
    return paintTile((ctx) => {
      const planks = ["#b9863f", "#c89850", "#a8762f"];
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = planks[(i + variant) % planks.length];
        ctx.fillRect(0, i * 8, DD.TILE, 8);
        ctx.fillStyle = "#6e4a23"; // groove
        ctx.fillRect(0, i * 8 + 7, DD.TILE, 1);
      }
      ctx.fillStyle = "#8a5e2e"; // plank butt joints
      ctx.fillRect((variant * 11) % DD.TILE, 0, 1, DD.TILE);
    });
  }

  function makeThemedDoor(pal, open) {
    return paintTile((ctx) => {
      ctx.drawImage(pal.wall, 0, 0);
      ctx.fillStyle = open ? "#15121f" : "#0d0b14";
      ctx.fillRect(4, 6, 24, 26);
      if (open) {
        ctx.fillStyle = pal.glow || "#ffd95e";
        ctx.globalAlpha = 0.28;
        ctx.fillRect(4, 6, 24, 26);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = pal.bars || "#6b6481";
        for (let x = 7; x <= 25; x += 6) ctx.fillRect(x, 6, 3, 26);
        ctx.fillRect(4, 14, 24, 3);
      }
      ctx.fillStyle = pal.hi || "#3e3857";
      ctx.fillRect(2, 4, 28, 3);
    });
  }

  // ---- themed decorations (free-size canvases, anchored by their center) ----

  function makeTorch(frame) {
    const c = makeCanvas(12 * 3, 22 * 3);
    const ctx = c.getContext("2d");
    const px = (x, y, col, w = 1, h = 1) => { ctx.fillStyle = col; ctx.fillRect(x * 3, y * 3, w * 3, h * 3); };
    px(5, 10, "#3a2a18", 2, 11);     // wooden handle
    px(4, 9, "#6b6481", 4, 2);       // iron bracket
    // flame flickers between two shapes
    if (frame === 0) {
      px(4, 4, "#ff8c00", 4, 5);
      px(5, 2, "#ffcf3a", 2, 4);
      px(5, 1, "#fff3b8", 2, 2);
    } else {
      px(4, 5, "#ff8c00", 4, 4);
      px(5, 3, "#ffcf3a", 2, 3);
      px(4, 2, "#fff3b8", 2, 2);
    }
    return c;
  }

  function makeLantern(frame) {
    const c = makeCanvas(12 * 3, 20 * 3);
    const ctx = c.getContext("2d");
    const px = (x, y, col, w = 1, h = 1) => { ctx.fillStyle = col; ctx.fillRect(x * 3, y * 3, w * 3, h * 3); };
    px(5, 0, "#5a3a1a", 2, 3);        // hanging rope
    px(3, 3, "#3a2a18", 6, 2);        // top cap
    px(3, 5, "#7a5c2e", 6, 8);        // frame
    const glow = frame === 0 ? "#ffd060" : "#ffe89a";
    px(4, 6, glow, 4, 6);             // glass glow
    px(5, 7, "#fff3b8", 2, 2);        // bright core
    px(3, 13, "#3a2a18", 6, 2);       // bottom cap
    return c;
  }

  function makeBat(frame) {
    const c = makeCanvas(16 * 3, 10 * 3);
    const ctx = c.getContext("2d");
    const px = (x, y, col, w = 1, h = 1) => { ctx.fillStyle = col; ctx.fillRect(x * 3, y * 3, w * 3, h * 3); };
    const B = "#2a1a1a", D = "#3a2424";
    px(7, 3, B, 2, 3);                // body
    px(7, 2, B, 2, 1);               // head
    if (frame === 0) {
      px(2, 2, D, 5, 2); px(9, 2, D, 5, 2);   // wings up
      px(1, 1, B, 2, 1); px(13, 1, B, 2, 1);
    } else {
      px(2, 4, D, 5, 2); px(9, 4, D, 5, 2);   // wings down
      px(1, 5, B, 2, 1); px(13, 5, B, 2, 1);
    }
    px(7, 1, "#cc2222", 1, 1); px(8, 1, "#cc2222", 1, 1); // red eyes
    return c;
  }

  function makeGravestone() {
    const c = makeCanvas(20 * 3, 26 * 3);
    const ctx = c.getContext("2d");
    const px = (x, y, col, w = 1, h = 1) => { ctx.fillStyle = col; ctx.fillRect(x * 3, y * 3, w * 3, h * 3); };
    const STONE = "#8a8a9a", SHADE = "#5d5d6e", DARK = "#3a3a48";
    px(7, 1, STONE, 6, 4);            // rounded top
    px(6, 3, STONE, 8, 18);
    px(6, 3, "#a4a4b4", 8, 1);        // top highlight
    px(13, 4, SHADE, 1, 17);         // right shade
    px(4, 21, DARK, 12, 3);          // dirt mound base
    px(8, 7, SHADE, 4, 1);           // engraved lines
    px(8, 9, SHADE, 4, 1);
    px(9, 11, SHADE, 2, 1);
    return c;
  }

  function makeIronFence() {
    const c = makeCanvas(DD.TILE, 16 * 3);
    const ctx = c.getContext("2d");
    const px = (x, y, col, w = 1, h = 1) => { ctx.fillStyle = col; ctx.fillRect(x * 3, y * 3, w * 3, h * 3); };
    const IRON = "#444455", HI = "#5d5d70";
    px(0, 4, IRON, 11, 2);            // top rail (32px wide ≈ 10.6 art px)
    px(0, 10, IRON, 11, 2);          // bottom rail
    for (let x = 1; x < 11; x += 3) {
      px(x, 1, IRON, 1, 13);         // vertical bar
      px(x, 0, HI, 1, 1);            // spear tip
    }
    return c;
  }

  function makeMineCart() {
    const c = makeCanvas(28 * 3, 22 * 3);
    const ctx = c.getContext("2d");
    const px = (x, y, col, w = 1, h = 1) => { ctx.fillStyle = col; ctx.fillRect(x * 3, y * 3, w * 3, h * 3); };
    const METAL = "#4a4a55", HI = "#6a6a78", DARK = "#2a2a32", WOOD = "#7a5c2e";
    px(3, 6, METAL, 22, 9);          // cart body
    px(3, 6, HI, 22, 1);
    px(4, 7, DARK, 20, 4);           // contents shadow
    px(6, 7, "#7a5c2e", 3, 3); px(14, 8, "#8a6c3a", 4, 3); // ore/rocks
    px(18, 7, "#6a6a78", 3, 2);
    px(3, 15, WOOD, 22, 2);          // axle plank
    px(6, 17, DARK, 5, 5); px(17, 17, DARK, 5, 5);   // wheels
    px(7, 18, HI, 3, 3); px(18, 18, HI, 3, 3);
    return c;
  }

  function makeBarCounter() {
    const c = makeCanvas(DD.TILE * 4, DD.TILE * 2);
    const ctx = c.getContext("2d");
    const W = DD.TILE * 4;
    ctx.fillStyle = "#5a3a1a";       // counter base
    ctx.fillRect(0, 18, W, 46);
    ctx.fillStyle = "#7a4f26";       // counter top
    ctx.fillRect(0, 10, W, 10);
    ctx.fillStyle = "#9a6f3a";
    ctx.fillRect(0, 10, W, 3);       // top highlight
    ctx.fillStyle = "#4a3020";       // panel grooves
    for (let x = 14; x < W; x += 28) ctx.fillRect(x, 22, 2, 38);
    // a couple of mugs on the bar
    ctx.fillStyle = "#caa46a";
    ctx.fillRect(24, 2, 8, 8); ctx.fillRect(70, 3, 7, 7);
    ctx.fillStyle = "#e8dcb8";
    ctx.fillRect(24, 2, 8, 2); ctx.fillRect(70, 3, 7, 2);
    return c;
  }

  // ---- town NPCs (16x16, single static frame reused for both anim frames) ----

  function drawNpc(p, kind) {
    const DARKC = "#241f33";
    if (kind === "barkeep") {
      const SKIN = "#e8b888", SHIRT = "#9a5a3a", APRON = "#d8cfb8";
      p(5, 13, "#3a2a18", 2, 2); p(9, 13, "#3a2a18", 2, 2); // boots
      p(4, 9, SHIRT, 8, 4);                                  // burly torso
      p(5, 10, APRON, 6, 3);                                 // apron
      p(3, 10, SKIN, 1, 2); p(12, 10, SKIN, 1, 2);          // arms
      p(4, 2, SKIN, 8, 7); p(4, 7, "#caa46a", 8, 1);        // head
      p(4, 1, "#6b4a2a", 8, 2);                              // hair
      p(6, 5, DARKC, 1, 1); p(9, 5, DARKC, 1, 1);          // eyes
      p(6, 7, "#7a4a2a", 4, 1);                              // moustache
      p(12, 9, "#caa46a", 2, 3); p(12, 9, "#e8dcb8", 2, 1); // tankard
    } else if (kind === "innkeeper") {
      const SKIN = "#f2c09a", ROBE = "#3a5e8a", ROBE_L = "#4a72a8";
      p(5, 13, "#2a2418", 2, 2); p(9, 13, "#2a2418", 2, 2);
      p(4, 9, ROBE, 8, 5); p(5, 9, ROBE_L, 6, 1);
      p(3, 10, ROBE, 1, 3); p(12, 10, ROBE, 1, 3);
      p(4, 2, SKIN, 8, 7); p(4, 7, "#d49a72", 8, 1);
      p(3, 1, "#8a8a96", 10, 2);                             // grey hair
      p(6, 5, DARKC, 1, 1); p(9, 5, DARKC, 1, 1);
      p(7, 7, "#b8b8c4", 2, 2);                              // beard
      p(12, 8, "#ffd14a", 1, 4); p(11, 11, "#ffd14a", 2, 1); // key
    } else if (kind === "trader") {
      const SKIN = "#caa078", CLOAK = "#6e4a8a", CLOAK_L = "#8a5ea8";
      p(5, 13, "#2a2418", 2, 2); p(9, 13, "#2a2418", 2, 2);
      p(4, 9, CLOAK, 8, 5); p(5, 9, CLOAK_L, 6, 1);
      p(3, 1, CLOAK, 10, 4);                                 // hood
      p(3, 4, CLOAK, 1, 4); p(12, 4, CLOAK, 1, 4);
      p(4, 3, SKIN, 8, 5);
      p(5, 5, DARKC, 2, 1); p(9, 5, DARKC, 2, 1);          // shaded eyes
      p(11, 10, "#7a5c2e", 3, 3); p(12, 9, "#7a5c2e", 1, 1); // coin bag
      p(12, 11, "#ffd14a", 1, 1);
    } else if (kind === "questgiver") {
      const SKIN = "#f2c09a", TUNIC = "#3a6e4a", TUNIC_L = "#4a8a5a";
      p(5, 13, "#3a2a18", 2, 2); p(9, 13, "#3a2a18", 2, 2);
      p(4, 9, TUNIC, 8, 4); p(5, 9, TUNIC_L, 6, 1);
      p(3, 10, SKIN, 1, 2); p(12, 10, SKIN, 1, 2);
      p(4, 2, SKIN, 8, 7); p(4, 7, "#d49a72", 8, 1);
      p(4, 1, "#caa46a", 8, 2);                              // blond hair
      p(6, 5, DARKC, 1, 1); p(9, 5, DARKC, 1, 1);
      p(2, 9, "#e8dcb8", 3, 4); p(2, 9, "#b8a878", 3, 1); p(2, 12, "#b8a878", 3, 1); // scroll
    }
  }

  DD.sprites = {
    init() {
      const heroDefs = {
        warrior: { hat: "helmet", hatColor: "#aeb9cd", accent: "#d33a3a", body: "#7e8aa3", sleeve: "#5d6880", belt: "#4a3826", boot: "#4a3826", emblem: "#d33a3a" },
        rogue:   { hat: "hood",   hatColor: "#2f5e3d", accent: "#2f5e3d", body: "#3d7a4f", sleeve: "#2f5e3d", belt: "#26211a", boot: "#26211a" },
        mage:    { hat: "wizard", hatColor: "#6f44c4", accent: "#ffd95e", body: "#8657d8", sleeve: "#6f44c4", belt: "#ffd95e", boot: "#34284f" },
        ranger:  { hat: "cap",    hatColor: "#6e4a23", accent: "#e8d44d", body: "#8a5e2e", sleeve: "#56682f", belt: "#3c2c14", boot: "#3c2c14" },
      };
      this.players = {};
      for (const key of Object.keys(heroDefs)) {
        this.players[key] = makeFrames((p, f) => drawHero(p, heroDefs[key], f));
      }
      this.skeleton = makeFrames((p, f) => drawSkeleton(p, f));
      this.skeletonArcher = makeFrames((p, f) => drawSkeleton(p, f, "archer"));
      this.skeletonBomber = makeFrames((p, f) => drawSkeleton(p, f, "bomber"));
      this.skeletonShade = makeFrames((p, f) => drawSkeleton(p, f, "shade"));
      this.goblin = makeFrames((p, f) => drawGoblin(p, f, "goblin"));
      this.goblinArcher = makeFrames((p, f) => drawGoblin(p, f, "goblinArcher"));
      this.goblinBerserker = makeFrames((p, f) => drawGoblin(p, f, "goblinBerserker"));
      this.goblinShaman = makeFrames((p, f) => drawGoblin(p, f, "goblinShaman"));
      this.zombie = makeFrames((p, f) => drawUndead(p, f, "zombie"));
      this.warlock = makeFrames((p, f) => drawUndead(p, f, "warlock"));
      this.necromancer = makeFrames((p, f) => drawUndead(p, f, "necromancer"));
      this.shopkeeper = makeFrames((p, f) => drawHero(p, {
        hat: "hood", hatColor: "#6e4a23", accent: "#6e4a23",
        body: "#8a6a3a", sleeve: "#6e4a23", belt: "#3c2c14", boot: "#3c2c14",
      }, f));
      this.floorTiles = [0, 1, 2, 3].map(makeFloorTile);
      this.wallTile = makeWallTile();
      this.doorClosed = makeDoorTile(false);
      this.doorOpen = makeDoorTile(true);
      this.heart = makeHeart();
      this.coin = makeCoin();
      this.chestClosed = makeChest(false);
      this.chestOpen = makeChest(true);
      this.crown = makeCrown();
      this.spikes = [0, 1, 2].map(makeSpike);
      this.scroll = makeScroll();
      this.items = { sword: makeItemSword(), armor: makeItemArmor(), ring: makeItemRing(), axe: makeItemAxe() };

      // NPC sprites — drawn on the same 16x16 hero grid, two identical frames
      // so the idle-bob loop in the draw code finds a [0],[1] pair.
      for (const kind of ["barkeep", "innkeeper", "trader", "questgiver"]) {
        const cap = "npc" + kind[0].toUpperCase() + kind.slice(1);
        this[cap] = makeFrames((p) => drawNpc(p, kind));
      }

      // ---- per-dungeon themes ----
      // Each theme: wall, floor[] variants, doorClosed, doorOpen, plus the
      // animated/decoration sprites used by room.generateLobby / generateTown.
      const cataWall = makeBrickWall({ mortar: "#22222a", brick: "#3a3a45", hi: "#4d4d5c" });
      const mineWall = makeBrickWall({ mortar: "#2a2012", brick: "#5c4a2a", hi: "#7a5c2e", accent: "#3a2a14" });
      const cryptWall = makeBrickWall({ mortar: "#100e18", brick: "#1e1a2a", hi: "#2c2640", accent: "#4a2060" });
      const townWall = makeBrickWall({ mortar: "#7a5c34", brick: "#c8a870", hi: "#e0c590" });

      this.themes = {
        catacombs: {
          wall: cataWall,
          floor: [0, 1, 2].map((v) => makeThemedFloor({
            base: "#4a4a58", edge: "#3a3a46", speckles: ["#54546b", "#3f3f50", "#5c5c70"], crack: "#2e2e3c",
          }, v)),
          doorClosed: makeThemedDoor({ wall: cataWall }, false),
          doorOpen: makeThemedDoor({ wall: cataWall, glow: "#ffd95e" }, true),
          torch: [makeTorch(0), makeTorch(1)],
        },
        goblinMines: {
          wall: mineWall,
          floor: [0, 1, 2].map((v) => makeThemedFloor({
            base: "#3c2e18", edge: "#2a2012", speckles: ["#4a3a20", "#332715", "#52401f"],
            rail: "#6a6a72", sleeper: "#5a3a1a",
          }, v)),
          doorClosed: makeThemedDoor({ wall: mineWall, bars: "#7a5c2e" }, false),
          doorOpen: makeThemedDoor({ wall: mineWall, glow: "#ffd060" }, true),
          lantern: [makeLantern(0), makeLantern(1)],
          mineCart: makeMineCart(),
        },
        crypt: {
          wall: cryptWall,
          floor: [0, 1, 2].map((v) => makeThemedFloor({
            base: "#2a2535", edge: "#1a1726", speckles: ["#332e44", "#221d30", "#3a3450"], crack: "#15121f",
          }, v)),
          doorClosed: makeThemedDoor({ wall: cryptWall, bars: "#4a2060" }, false),
          doorOpen: makeThemedDoor({ wall: cryptWall, glow: "#9940d0" }, true),
          bat: [makeBat(0), makeBat(1)],
          gravestone: makeGravestone(),
          fence: makeIronFence(),
        },
        town: {
          wall: townWall,
          floor: [0, 1, 2].map((v) => makeWoodFloor(v)),
          doorClosed: makeThemedDoor({ wall: townWall, bars: "#8a5e2e" }, false),
          doorOpen: makeThemedDoor({ wall: townWall, glow: "#ffd95e" }, true),
          barCounter: makeBarCounter(),
          torch: [makeTorch(0), makeTorch(1)],
        },
      };
    },
  };
})(window.DD);
