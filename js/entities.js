import { TILE, WIDTH, HEIGHT, angleDiff, angleTo, clamp, dist, rand, randi } from "./util.js?v=__BUILD__";
import { sprites } from "./sprites.js?v=__BUILD__";
import { audio } from "./audio.js?v=__BUILD__";
import { particles } from "./particles.js?v=__BUILD__";
import { room } from "./room.js?v=__BUILD__";
import { profile } from "./profile.js?v=__BUILD__";
import { deriveStats } from "./stats.js?v=__BUILD__";
import { INV_CAP, ITEM_RARITY, rollItem } from "./items.js?v=__BUILD__";

// Dormant ("inactive") skeletons wake when a player gets within this radius,
// then play the awaken animation for this long before chasing.
const SKELETON_WAKE_R = 120;
const SKELETON_AWAKEN_T = 2.3;   // matches Skeletons_Awaken_Floor (~2.3s)
const SKELETON_AUTO_WAKE_T = 60; // dormant skeletons wake after this long regardless
// Death (3D): play Skeletons_Death, then fade out and remove. Dying skeletons
// are gameplay-dead (no threat / don't block room-clear) but still render.
const SKELETON_DEATH_T = 2.0;    // matches Skeletons_Death (~2.0s)
const SKELETON_FADE_T = 0.7;     // opacity fade at the tail of the death
// Heroes get the same dying phase: play the rig's Death clip, fade, then
// dead (which is when the run actually ends, so the fall is visible).
const PLAYER_DEATH_T = 2.0;

// ---- low-HP threshold (Phase 5 systems decision) ----
// A player is "low" at or below 35% of max HP. 35% rather than the genre's
// usual 30% because HP pools here are tiny integers (Mage starts at 6): at
// 30% the Mage would only read as low at exactly 1 HP, too late to act on,
// while 35% puts every class at least one survivable hit inside the warning
// (Mage 6 -> low at <=2, Rogue/Ranger 8 -> <=2, Warrior 12 -> <=4), and it
// scales with maxHp as vitality/upgrades raise it.
// Consumers (the future low-HP audio cue and HUD/vignette signal): gate
// sustained treatments on `player.lowHp` each frame, and edge-detect entry
// by watching `player.lowHpSince` change (game.time when the state was
// entered; -1 while not low). Downed/dying/dead are their own, stronger
// states — lowHp is false in all of them.
export const LOW_HP_FRAC = 0.35;

export const CLASSES = {
  warrior: {
    name: "Warrior", color: "#aeb9cd",
    hp: 12, speed: 165, attack: "melee", range: 46, arc: 2.4, dmg: 3, cooldown: 0.5, swingLock: 0.4,
    desc: "Heavy armor and wide sword swings.",
    stats: "HP 12 • Big melee arc",
  },
  rogue: {
    name: "Rogue", color: "#3d7a4f",
    hp: 8, speed: 225, attack: "melee", range: 34, arc: 1.5, dmg: 2, cooldown: 0.42, swingLock: 0.35, dash: true,
    desc: "Lightning-fast stabs. Shift to dash.",
    stats: "HP 8 • Fastest • Dash • Post-dash opener crit",
  },
  mage: {
    name: "Mage", color: "#8657d8",
    hp: 6, speed: 160, attack: "bolt", dmg: 3, cooldown: 0.5, swingLock: 0.4, projSpeed: 380, splash: 38,
    desc: "Lobs magic bolts that explode on impact.",
    stats: "HP 6 • AoE damage",
  },
  ranger: {
    name: "Ranger", color: "#8a5e2e",
    hp: 8, speed: 185, attack: "arrow", dmg: 2, cooldown: 0.64, swingLock: 0.5, projSpeed: 540, pierce: 1,
    desc: "Rapid arrows that pierce through enemies.",
    stats: "HP 8 • Piercing shots",
  },
};

// Level-up choices. apply() records into runBuffs and calls recompute() so
// temporary run power never leaks onto the persistent hero profile.
export const UPGRADES = [
  {
    id: "dmg", name: "Sharpened Edge", desc: "+25% damage",
    apply: (pl) => { pl.runBuffs.dmg *= 1.25; pl.recompute(); },
  },
  {
    id: "speed", name: "Swift Boots", desc: "+15% move speed",
    apply: (pl) => { pl.runBuffs.speed *= 1.15; pl.recompute(); },
  },
  {
    id: "hp", name: "Tough Hide", desc: "+3 max HP, heal 3",
    apply: (pl) => { pl.runBuffs.maxHp += 3; pl.recompute(); pl.hp = Math.min(pl.maxHp, pl.hp + 3); },
  },
  {
    id: "cd", name: "Quick Hands", desc: "Attack 20% faster",
    apply: (pl) => { pl.runBuffs.cd *= 0.8; pl.recompute(); },
  },
  {
    id: "reach", name: "Heavy Impact", desc: "Bigger attacks",
    apply: (pl) => {
      const b = pl.baseStats;
      if (b.attack === "melee") { pl.runBuffs.range *= 1.25; pl.runBuffs.arc *= 1.12; }
      else if (b.attack === "bolt") { pl.runBuffs.splash *= 1.35; pl.runBuffs.projSpeed *= 1.1; }
      else { pl.runBuffs.pierce += 1; pl.runBuffs.projSpeed *= 1.1; }
      pl.recompute();
    },
  },
  {
    id: "siphon", name: "Soul Siphon", desc: "30% chance to heal 1 HP on kill",
    apply: (pl) => { pl.runBuffs.killHeal += 0.3; pl.recompute(); },
  },
  {
    id: "crit", name: "Lucky Strikes", desc: "+15% chance to deal double damage",
    apply: (pl) => { pl.runBuffs.critChance = Math.min(0.9, (pl.runBuffs.critChance || 0) + 0.15); pl.recompute(); },
  },
  {
    id: "evade", name: "Evasive Reflexes", desc: "+0.15s invulnerability after being hit",
    apply: (pl) => { pl.runBuffs.iframeBonus = (pl.runBuffs.iframeBonus || 0) + 0.15; pl.recompute(); },
  },
  {
    id: "warriorArmor", name: "Shield Wall", classKey: "warrior", desc: "Take 1 less damage from every hit (min 1)",
    apply: (pl) => { pl.runBuffs.armor = (pl.runBuffs.armor || 0) + 1; pl.recompute(); },
  },
  {
    id: "rogueOpener", name: "Extended Reflexes", classKey: "rogue", desc: "+0.3s to the post-dash strike window",
    apply: (pl) => { pl.runBuffs.dashCritWindowBonus = (pl.runBuffs.dashCritWindowBonus || 0) + 0.3; pl.recompute(); },
  },
  {
    id: "mageOverload", name: "Volatile Bolts", classKey: "mage", desc: "+50% splash radius",
    apply: (pl) => { pl.runBuffs.splash *= 1.5; pl.recompute(); },
  },
  {
    id: "rangerBroadhead", name: "Broadhead Arrows", classKey: "ranger", desc: "+2 pierce",
    apply: (pl) => { pl.runBuffs.pierce += 2; pl.recompute(); },
  },
];

const SPRITE_DRAW = 48; // on-screen size of a 16px character sprite
const DOWNED_TIME = 18;
const REVIVE_TIME = 1.6;

function drawShadow(ctx, x, y, w) {
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y + 5, w, w * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Draw a two-frame walking sprite anchored at the entity's feet.
function drawSprite(ctx, frames, ent, moving) {
  const d = ent.drawSize || SPRITE_DRAW;
  const frame = moving ? frames[Math.floor(ent.animT * 8) % 2] : frames[0];
  ctx.save();
  ctx.translate(ent.x, ent.y);
  if (ent.flip) ctx.scale(-1, 1);
  ctx.drawImage(frame, -d / 2, -d + 10, d, d);
  ctx.restore();
}

// ---------------- Player ----------------

export class Player {
  constructor(classKey, x, y, inputProvider, hero) {
    const c = CLASSES[classKey];
    this.classKey = classKey;
    this.cfg = c;
    this.baseStats = hero ? deriveStats(hero) : { ...c };
    this.runBuffs = {
      dmg: 1, speed: 1, cd: 1, range: 1, arc: 1, splash: 1, projSpeed: 1, pierce: 0, maxHp: 0, killHeal: 0,
      critChance: 0, iframeBonus: 0, armor: 0, dashCritWindowBonus: 0,
    };
    this._dmgAcc = 0;    // fractional damage carry, so investment below +1 whole point still averages out
    this.dashCritT = 0;  // post-dash opener-crit window (Rogue's post-dash mechanic)
    this.recompute();
    this.input = inputProvider || input;
    this.x = x;
    this.y = y;
    this.r = 10;
    this.hp = this.maxHp;
    this.aim = 0;
    this.flip = false;
    this.animT = 0;
    this.moving = false;
    this.attackCd = 0;
    this.iframes = 0;
    this.swingT = 0;       // remaining time on the melee swipe visual
    this.swingAngle = 0;
    this.dashCd = 0;
    this.dashT = 0;
    this.dashDir = { x: 1, y: 0 };
    this.dead = false;
    this.downed = false;   // co-op: waiting for a revive
    this.downT = 0;
    this.reviveP = 0;
    this.lowHp = false;    // sustained low-HP state, see LOW_HP_FRAC above
    this.lowHpSince = -1;  // game.time the state was entered; -1 while not low
  }

  // Recomputed once per frame (first thing in update()) rather than on every
  // hp write, so heals/damage/revives/maxHp buffs all flow through one place.
  updateLowHp(game) {
    const low = this.alive() && this.hp > 0 && this.hp <= this.maxHp * LOW_HP_FRAC;
    if (low !== this.lowHp) {
      this.lowHp = low;
      this.lowHpSince = low ? game.time : -1;
    }
  }

  recompute() {
    const b = this.baseStats;
    const r = this.runBuffs;
    this.stats = { ...b };
    this.stats.dmg      = b.dmg   * r.dmg;
    this.stats.speed    = b.speed * r.speed;
    this.stats.cooldown = Math.max(0.08, b.cooldown * r.cd);
    if (b.range     !== undefined) this.stats.range     = b.range     * r.range;
    if (b.arc       !== undefined) this.stats.arc       = b.arc       * r.arc;
    if (b.projSpeed !== undefined) this.stats.projSpeed = b.projSpeed * r.projSpeed;
    if (b.splash    !== undefined) this.stats.splash    = b.splash    * r.splash;
    if (b.pierce    !== undefined) this.stats.pierce    = b.pierce    + r.pierce;
    this.maxHp    = Math.floor(b.hp) + r.maxHp;
    this.killHeal = (b.killHeal || 0) + r.killHeal;
    this.stats.critChance = r.critChance || 0;
    this.iframeBonus = r.iframeBonus || 0;
    this.armor = r.armor || 0;
    this.dashCritWindowBonus = r.dashCritWindowBonus || 0;
  }

  alive() { return !this.dead && !this.downed && !this.dying; }

  // Fractional-carry accumulator instead of a flat round(): a raw stat of 3.5
  // deals 3,4,3,4,... (averaging exactly 3.5) rather than rounding every hit
  // to 4 and creating a dead zone where the next +0.5 of investment does
  // nothing until it crosses the next whole number. `dealt` is clamped to
  // >=1 before it's ever used to update the accumulator, so it can't drift
  // into debt - no class/upgrade combination currently drives stats.dmg
  // anywhere near 0.
  effDmg() {
    const raw = this.stats.dmg;
    this._dmgAcc += raw;
    let dealt = Math.floor(this._dmgAcc);
    if (dealt < 1) dealt = 1;
    this._dmgAcc = Math.max(0, this._dmgAcc - dealt);
    let crit = false;
    if (this.dashCritT > 0) { crit = true; this.dashCritT = 0; }
    else if (this.stats.critChance && Math.random() < this.stats.critChance) crit = true;
    if (crit) dealt *= 2;
    return dealt;
  }

  onKill() {
    if (this.killHeal && Math.random() < this.killHeal && this.hp < this.maxHp) {
      this.hp += 1;
      particles.text(this.x, this.y - 44, "+1 HP", "#ff8c91");
    }
  }

  goDown(game) {
    this.downed = true;
    this.downT = DOWNED_TIME;
    this.reviveP = 0;
    this.hp = 0;
    audio.downed();
  }

  revive(partial) {
    this.downed = false;
    this.dead = false;
    this.dying = false;
    this.hp = Math.max(1, Math.ceil(this.maxHp * partial));
    this.iframes = 1.5;
    audio.heal();
    particles.burst(this.x, this.y - 14, { count: 14, colors: ["#6fce6f", "#fff"], speed: 90, life: 0.5, gravity: -60 });
  }

  update(dt, game) {
    this.updateLowHp(game);
    if (this.dead) return;

    // dying: hold still while the death animation plays out, then be dead
    if (this.dying) {
      this.deathT -= dt;
      if (this.deathT <= 0) { this.dying = false; this.dead = true; }
      return;
    }

    if (this.downed) {
      this.downT -= dt;
      // a teammate standing close revives; stepping away decays progress
      const helper = game.players.find((p) => p !== this && p.alive() &&
        dist(p.x, p.y, this.x, this.y) < 40);
      if (helper) {
        this.reviveP += dt / REVIVE_TIME;
        if (this.reviveP >= 1) this.revive(0.5);
      } else {
        this.reviveP = Math.max(0, this.reviveP - dt);
      }
      if (this.downed && this.downT <= 0) {
        // failed revive: fade out, then sit out until the room is cleared
        this.downed = false;
        this.dying = true;
        this.deathT = PLAYER_DEATH_T;
        particles.burst(this.x, this.y - 14, { count: 20, colors: ["#8b80a8", "#f2c09a"], speed: 120, life: 0.7, gravity: 200 });
      }
      return;
    }

    const input = this.input;
    this.attackCd -= dt;
    this.iframes -= dt;
    this.swingT -= dt;
    this.dashCd -= dt;
    if (this.dashCritT > 0) this.dashCritT -= dt;
    if (this.lockT > 0) this.lockT -= dt;

    this.aim = input.aimAngle(this);
    this.flip = Math.cos(this.aim) < 0;

    const { dx, dy } = input.moveVector();
    this.moving = dx !== 0 || dy !== 0;
    if (this.moving) this.animT += dt;

    if (this.stats.dash && (input.dashing() || input.consumeDashTap()) && this.dashCd <= 0 && this.dashT <= 0) {
      this.dashT = 0.16;
      this.dashCd = 1.6;
      this.iframes = Math.max(this.iframes, 0.3);
      this.dashDir = this.moving ? { x: dx, y: dy } : { x: Math.cos(this.aim), y: Math.sin(this.aim) };
      audio.dash();
    }
    // root-the-swing: no walking during the attack swing. Dash always moves.
    const rooted = this.lockT > 0;
    if (this.dashT > 0) {
      this.dashT -= dt;
      room.moveEntity(this, this.dashDir.x * 620 * dt, this.dashDir.y * 620 * dt);
      particles.burst(this.x, this.y, { count: 2, colors: ["#bfe8c8", "#ffffff"], speed: 20, life: 0.3, size: 4 });
      // opener window: the strike that lands right after a dash ends is a
      // guaranteed crit - converts the mobility play into a damage payoff
      // instead of just repositioning (Rogue's post-dash identity).
      if (this.dashT <= 0 && this.stats.dash) {
        this.dashCritT = 0.6 + (this.dashCritWindowBonus || 0);
      }
    } else if (!rooted) {
      room.moveEntity(this, dx * this.stats.speed * dt, dy * this.stats.speed * dt);
    }

    if (!game.peaceful && input.attacking() && this.attackCd <= 0) this.performAttack(game);
  }

  performAttack(game) {
    const c = this.stats;
    this.attackCd = c.cooldown;
    this.atkAnimAt = game.time; // 3D attack-animation trigger (all classes, incl. ranged)
    // root-the-swing: face aim + stop moving for the swing's duration (3D look)
    this.swingDur = c.swingLock || 0.4;
    this.lockT = this.swingDur;
    if (c.attack === "melee") {
      this.swingT = 0.14;
      this.swingAngle = this.aim;
      audio.swing();
      let hitAny = false;
      for (const sk of game.enemies()) {
        if (sk.dormant() || sk.dead || sk.dying) continue;
        const d = dist(this.x, this.y, sk.x, sk.y);
        if (d > c.range + sk.r) continue;
        const da = Math.abs(angleDiff(this.aim, angleTo(this.x, this.y, sk.x, sk.y)));
        if (da > c.arc / 2 + 0.35) continue;
        sk.damage(this.effDmg(), this.x, this.y, game, this);
        hitAny = true;
      }
      if (hitAny) audio.hit();
    } else {
      const speed = c.projSpeed;
      game.projectiles.push(new Projectile({
        x: this.x + Math.cos(this.aim) * 14,
        y: this.y - 12 + Math.sin(this.aim) * 14,
        vx: Math.cos(this.aim) * speed,
        vy: Math.sin(this.aim) * speed,
        dmg: this.effDmg(),
        kind: c.attack,
        pierce: c.pierce || 0,
        splash: c.splash || 0,
        owner: this,
      }));
      if (c.attack === "bolt") audio.bolt(); else audio.shoot();
    }
  }

  damage(n, fromX, fromY, game) {
    if (this.iframes > 0 || this.dead || this.dying || this.downed) return;
    const dealt = Math.max(1, n - (this.armor || 0));
    this.hp -= dealt;
    this.iframes = 0.9 + (this.iframeBonus || 0);
    audio.hurt();
    game.shake = Math.max(game.shake, 6);
    particles.burst(this.x, this.y - 14, { count: 10, colors: ["#e8484f", "#a32630"], speed: 110, life: 0.4 });
    particles.text(this.x, this.y - 40, `-${dealt}`, "#ff6b70");
    const a = angleTo(fromX, fromY, this.x, this.y);
    room.moveEntity(this, Math.cos(a) * 14, Math.sin(a) * 14);
    if (this.hp <= 0) {
      this.hp = 0;
      const teammateUp = game.players.some((p) => p !== this && p.alive());
      if (teammateUp) {
        this.goDown(game);
      } else {
        this.dying = true;
        this.deathT = PLAYER_DEATH_T;
        particles.burst(this.x, this.y - 14, { count: 26, colors: ["#e8484f", "#f2c09a", "#ffffff"], speed: 160, life: 0.8, gravity: 220 });
      }
    }
  }

  draw(ctx) {
    if (this.dead) return;

    if (this.downed) {
      // lying down, with a fading timer ring and revive progress
      drawShadow(ctx, this.x, this.y, this.r + 4);
      ctx.save();
      ctx.translate(this.x, this.y - 8);
      ctx.rotate(this.flip ? Math.PI / 2 : -Math.PI / 2);
      ctx.globalAlpha = 0.8;
      ctx.drawImage(sprites.players[this.classKey][0], -SPRITE_DRAW / 2, -SPRITE_DRAW + 14, SPRITE_DRAW, SPRITE_DRAW);
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#ff6b70";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y - 16, 16, -Math.PI / 2, -Math.PI / 2 + (this.downT / DOWNED_TIME) * Math.PI * 2);
      ctx.stroke();
      if (this.reviveP > 0) {
        ctx.fillStyle = "#1a1626";
        ctx.fillRect(this.x - 16, this.y - 44, 32, 5);
        ctx.fillStyle = "#6fce6f";
        ctx.fillRect(this.x - 16, this.y - 44, 32 * this.reviveP, 5);
      }
      return;
    }

    if (this.iframes > 0 && Math.floor(this.iframes * 12) % 2 === 0) {
      drawShadow(ctx, this.x, this.y, this.r + 2);
      return; // blink while invulnerable
    }
    drawShadow(ctx, this.x, this.y, this.r + 2);
    drawSprite(ctx, sprites.players[this.classKey], this, this.moving);
    if (this.swingT > 0) this.drawSwing(ctx);
  }

  drawSwing(ctx) {
    const t = 1 - this.swingT / 0.14; // 0 -> 1
    const c = this.stats;
    ctx.save();
    ctx.translate(this.x, this.y - 12);
    ctx.rotate(this.swingAngle);
    ctx.globalAlpha = 0.85 * (1 - t * 0.6);
    ctx.fillStyle = "#fff8e0";
    ctx.beginPath();
    const a0 = -c.arc / 2 + c.arc * t - 0.5;
    const a1 = a0 + 0.9;
    ctx.arc(0, 0, c.range, a0, a1);
    ctx.arc(0, 0, c.range * 0.45, a1, a0, true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ---------------- Player projectile ----------------

export class Projectile {
  constructor(opts) {
    Object.assign(this, opts);
    this.dead = false;
    this.hitList = new Set();
  }

  update(dt, game) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (room.pointHitsWall(this.x, this.y)) {
      this.explode(game);
      return;
    }

    if (this.kind === "bolt") {
      particles.burst(this.x, this.y, { count: 1, colors: ["#b48cff", "#7a4fd0"], speed: 14, life: 0.25, size: 3 });
    }

    for (const sk of game.enemies()) {
      if (sk.dead || sk.dying || sk.dormant() || this.hitList.has(sk)) continue;
      if (dist(this.x, this.y, sk.x, sk.y - 12) < sk.r + 6) {
        sk.damage(this.dmg, this.x - this.vx, this.y - this.vy, game, this.owner);
        audio.hit();
        this.hitList.add(sk);
        if (this.splash) {
          this.explode(game);
        } else if (this.hitList.size > this.pierce) {
          this.dead = true;
        }
        return;
      }
    }
  }

  explode(game) {
    this.dead = true;
    if (this.splash) {
      audio.splash();
      game.shake = Math.max(game.shake, 3);
      particles.burst(this.x, this.y, { count: 18, colors: ["#b48cff", "#8657d8", "#fff"], speed: 150, life: 0.4 });
      particles.ring(this.x, this.y, "#b48cff");
      for (const sk of game.enemies()) {
        if (sk.dead || sk.dying || sk.dormant() || this.hitList.has(sk)) continue;
        if (dist(this.x, this.y, sk.x, sk.y - 12) < this.splash + sk.r) {
          sk.damage(this.dmg, this.x, this.y, game, this.owner);
        }
      }
    } else {
      particles.burst(this.x, this.y, { count: 5, colors: ["#d9cfa8", "#8b80a8"], speed: 70, life: 0.3 });
    }
  }

  draw(ctx) {
    if (this.kind === "bolt") {
      ctx.fillStyle = "#b48cff";
      ctx.beginPath();
      ctx.arc(this.x, this.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f1e6ff";
      ctx.beginPath();
      ctx.arc(this.x, this.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const a = Math.atan2(this.vy, this.vx);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(a);
      ctx.strokeStyle = "#d9b87a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(7, 0);
      ctx.stroke();
      ctx.fillStyle = "#e9e6da";
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(4, -4);
      ctx.lineTo(4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

// ---------------- Enemy bone shot ----------------

export class EnemyShot {
  constructor(x, y, angle, speed = 240, dmg = 1, style = "bone") {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.dmg = dmg;
    this.style = style;
    this.t = 0;
    this.dead = false;
  }

  update(dt, game) {
    this.t += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (room.pointHitsWall(this.x, this.y)) { this.dead = true; return; }
    for (const pl of game.players) {
      if (!pl.alive()) continue;
      if (dist(this.x, this.y, pl.x, pl.y - 8) < pl.r + 5) {
        pl.damage(this.dmg, this.x - this.vx, this.y - this.vy, game);
        this.dead = true;
        return;
      }
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.style === "magic") {
      // swirling arcane orb
      ctx.fillStyle = "#9940d0";
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c060f0";
      ctx.beginPath();
      ctx.arc(-2, -2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.t * 14);
      ctx.strokeStyle = "#e080ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 10, this.t * 8, this.t * 8 + Math.PI * 1.4);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (this.style === "arrow") {
      // wooden arrow pointing along its travel direction
      ctx.rotate(Math.atan2(this.vy, this.vx));
      ctx.fillStyle = "#7a5c2e"; // shaft
      ctx.fillRect(-7, -1, 12, 2);
      ctx.fillStyle = "#cfcfd8"; // steel tip
      ctx.beginPath();
      ctx.moveTo(5, -3); ctx.lineTo(9, 0); ctx.lineTo(5, 3); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#d8d0b0"; // fletching
      ctx.fillRect(-7, -3, 3, 2);
      ctx.fillRect(-7, 1, 3, 2);
    } else {
      // spinning bone
      ctx.rotate(this.t * 12);
      ctx.strokeStyle = "#e9e6da";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();
      ctx.fillStyle = "#e9e6da";
      for (const ex of [-6, 6]) {
        ctx.beginPath();
        ctx.arc(ex, -2, 2, 0, Math.PI * 2);
        ctx.arc(ex, 2, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

// ---------------- Enemy grade roller ----------------

// Returns "regular" | "veteran" | "elite" based on floor index (0-2) and tier (0-2).
// Higher floors and tiers skew toward harder grades.
export function rollGrade(floorIndex, tier) {
  const probs = [
    [[85, 13, 2], [75, 20, 5], [65, 25, 10]],
    [[65, 28, 7], [55, 32, 13], [45, 35, 20]],
    [[45, 38, 17], [35, 40, 25], [25, 42, 33]],
  ];
  const fi = Math.min(Math.max(floorIndex, 0), 2);
  const ti = Math.min(Math.max(tier, 0), 2);
  const [r, v, e] = probs[fi][ti];
  const roll = Math.random() * 100;
  if (roll < e) return "elite";
  if (roll < e + v) return "veteran";
  return "regular";
};

// Which faction an enemy kind belongs to (sprite/loot/death-colour). Used by
// multi-faction rooms (the finale) and boss summons.
export const KIND_FACTION = {
  melee: "skeleton", archer: "skeleton", bomber: "skeleton", shade: "skeleton",
  goblin: "goblin", goblinArcher: "goblin", goblinBomber: "goblin",
  goblinBerserker: "goblin", goblinShaman: "goblin",
  zombie: "undead", warlock: "undead", necromancer: "undead",
};

// ---------------- Skeleton (melee / archer / bomber, brute, elite) ----------------

export class Skeleton {
  constructor(x, y, opts = {}) {
    this.x = x;
    this.y = y;
    // melee|archer|bomber|shade | goblin|goblinArcher|goblinBerserker|goblinShaman | zombie|warlock|necromancer
    this.kind = opts.kind || "melee";
    this.faction = opts.faction || "skeleton";
    this.big = !!opts.big;
    this.elite = !!opts.elite;
    this.name = opts.name || null;
    const scale = opts.scale || 1;
    this.scale = scale; // remembered so Boss summons (see Boss.update) can pass it on
    this.r = this.big ? 14 : 10;
    this.drawSize = this.big ? 68 : SPRITE_DRAW;

    const baseHp = opts.hp ?? (
      this.big ? 16 :
      this.kind === "bomber"          ? 4 :
      this.kind === "archer"          ? 5 :
      this.kind === "shade"           ? 3 :
      this.kind === "goblin"          ? 4 :
      this.kind === "goblinArcher"    ? 4 :
      this.kind === "goblinBomber"    ? 4 :
      this.kind === "goblinBerserker" ? 5 :
      this.kind === "goblinShaman"    ? 7 :
      this.kind === "zombie"          ? 14 :
      this.kind === "warlock"         ? 5 :
      this.kind === "necromancer"     ? 9 : 6);
    this.hp = Math.round(baseHp * scale);
    this.maxHp = this.hp;
    const baseSpeed = opts.speed ?? (
      this.big ? rand(38, 48) :
      this.kind === "bomber"          ? rand(100, 118) :
      this.kind === "archer"          ? rand(48, 60) :
      this.kind === "shade"           ? rand(85, 105) :
      this.kind === "goblin"          ? rand(95, 120) :
      this.kind === "goblinArcher"    ? rand(55, 75) :
      this.kind === "goblinBomber"    ? rand(110, 130) :
      this.kind === "goblinBerserker" ? rand(120, 145) :
      this.kind === "goblinShaman"    ? rand(30, 45) :
      this.kind === "zombie"          ? rand(35, 55) :
      this.kind === "warlock"         ? rand(40, 58) :
      this.kind === "necromancer"     ? rand(28, 40) :
      rand(52, 78));
    this.speed = baseSpeed * (1 + 0.06 * (scale - 1));
    this.dmg = opts.dmg ?? (this.big ? 2 : 1) + (scale >= 1.9 ? 1 : 0);
    const baseXpValue = opts.xpValue ?? (
      this.elite ? 25 : this.big ? 12 :
      this.kind === "shade"           ? 4 :
      this.kind === "melee"           ? 5 :
      this.kind === "goblin"          ? 4 :
      this.kind === "goblinArcher"    ? 5 :
      this.kind === "goblinBomber"    ? 6 :
      this.kind === "goblinBerserker" ? 7 :
      this.kind === "goblinShaman"    ? 10 :
      this.kind === "zombie"          ? 6 :
      this.kind === "warlock"         ? 8 :
      this.kind === "necromancer"     ? 14 : 7);
    // xpValue/coinDrop scale with tier just like hp already does - otherwise
    // a tougher enemy pays exactly the same as a Tier-1 one, and progressing
    // is never worth more than farming the tier you've already outlevelled.
    this.xpValue = Math.max(1, Math.round(baseXpValue * scale));
    const baseCoinDrop = opts.coinDrop ?? (
      this.elite ? [6, 10] : this.big ? [2, 4] :
      this.kind === "shade"        ? [0, 2] :
      this.kind === "goblin"       ? [1, 2] :
      this.kind === "goblinShaman" ? [3, 5] :
      this.kind === "necromancer"  ? [4, 7] : [1, 3]);
    this.coinDrop = [
      Math.max(0, Math.round(baseCoinDrop[0] * scale)),
      Math.max(1, Math.round(baseCoinDrop[1] * scale)),
    ];

    // grade: "regular" | "veteran" | "elite" (enemy difficulty tier, orthogonal to elite room)
    this.grade = opts.grade || "regular";
    if (this.grade === "veteran") {
      this.maxHp = Math.round(this.maxHp * 1.6);
      this.hp = this.maxHp;
      this.dmg = Math.ceil(this.dmg * 1.35);
    } else if (this.grade === "elite") {
      this.maxHp = Math.round(this.maxHp * 2.8);
      this.hp = this.maxHp;
      this.dmg = Math.ceil(this.dmg * 2.0);
      this.xpValue = Math.round(this.xpValue * 2.0);
      this.coinDrop = [this.coinDrop[0] + 1, this.coinDrop[1] + 2];
    }

    // floor gating: enemies belong to a roomId and stay `frozen` (dormant, not
    // targetable, no AI) until the player enters that room and it activates.
    this.roomId = opts.roomId != null ? opts.roomId : null;
    this.frozen = !!opts.frozen;

    // inactive: lies dormant on the floor and wakes when a player approaches
    // (inactive -> awaken -> chase). Otherwise the normal rise (spawn -> chase).
    this.state = opts.inactive ? "inactive" : "spawn"; // -> chase -> windup/fuse -> recover
    this.stateT = opts.inactive ? SKELETON_AUTO_WAKE_T : 1.0; // inactive: auto-wake countdown
    this.dying = false;
    this.deathT = 0;
    this.shootCd = rand(1.0, 2.2);
    this.animT = Math.random() * 10;
    this.flip = false;
    this.flash = 0;
    this.enraged = false;
    this.kbx = 0;
    this.kby = 0;
    this.dead = false;
    this.wanderA = rand(0, Math.PI * 2);
  }

  // Not yet a threat and not targetable/damageable: rising, dormant, or waking.
  dormant() {
    return this.state === "spawn" || this.state === "inactive" || this.state === "awaken";
  }

  frames() {
    const sp = sprites;
    if (this.kind === "archer")          return sp.skeletonArcher;
    if (this.kind === "bomber")          return sp.skeletonBomber;
    if (this.kind === "shade")           return sp.skeletonShade;
    if (this.kind === "goblin")          return sp.goblin          || sp.skeleton;
    if (this.kind === "goblinArcher")    return sp.goblinArcher    || sp.skeletonArcher;
    if (this.kind === "goblinBomber")    return sp.goblinBomber    || sp.skeletonBomber;
    if (this.kind === "goblinBerserker") return sp.goblinBerserker || sp.skeleton;
    if (this.kind === "goblinShaman")    return sp.goblinShaman    || sp.skeleton;
    if (this.kind === "zombie")          return sp.zombie          || sp.skeleton;
    if (this.kind === "warlock")         return sp.warlock         || sp.skeleton;
    if (this.kind === "necromancer")     return sp.necromancer     || sp.skeleton;
    return sp.skeleton;
  }

  update(dt, game) {
    // dying: play out the death animation + fade, then remove. No AI.
    if (this.dying) {
      this.deathT -= dt;
      if (this.deathT <= 0) this.dead = true;
      return;
    }
    // frozen: dormant in an unentered floor room — hold the inactive pose,
    // run no AI and never wake until the room activates.
    if (this.frozen) return;
    this.stateT -= dt;
    this.flash -= dt;
    this.animT += dt;
    this.shootCd -= dt;

    // knockback decays quickly (brutes barely budge)
    if (Math.abs(this.kbx) > 1 || Math.abs(this.kby) > 1) {
      const kbScale = this.big ? 0.4 : 1;
      room.moveEntity(this, this.kbx * kbScale * dt, this.kby * kbScale * dt);
      this.kbx *= Math.pow(0.0001, dt);
      this.kby *= Math.pow(0.0001, dt);
    }

    const pl = game.nearestAlivePlayer(this.x, this.y);

    switch (this.state) {
      case "spawn":
        if (Math.random() < 0.3) {
          particles.burst(this.x, this.y, { count: 1, colors: ["#6b6481", "#46415c"], speed: 40, life: 0.4, gravity: -60 });
        }
        if (this.stateT <= 0) this.state = "chase";
        break;

      case "inactive": {
        // Wake when: a player is near, OR the auto-wake timer (stateT counting
        // down from SKELETON_AUTO_WAKE_T) elapses, OR these dormant ones are the
        // only enemies left (so the room can never soft-lock — the last ambush
        // rises to finish the fight).
        const near = pl && dist(this.x, this.y, pl.x, pl.y) < SKELETON_WAKE_R;
        // floor mode: only this room's enemies count toward the last-ambush
        // wake, so clearing another room can't rouse a distant room.
        const lastEnemies = game.spawnQueue.length === 0 &&
          game.enemies().every((s) => s === this || s.dead || s.dying || s.state === "inactive" ||
            (this.roomId != null && s.roomId !== this.roomId));
        if (near || this.stateT <= 0 || lastEnemies) {
          this.state = "awaken";
          this.stateT = SKELETON_AWAKEN_T;
          audio.bones();
        }
        break;
      }

      case "awaken":
        // rising up; harmless until fully awake, then chase
        if (Math.random() < 0.25) {
          particles.burst(this.x, this.y, { count: 1, colors: ["#6b6481", "#46415c"], speed: 40, life: 0.4, gravity: -60 });
        }
        if (this.stateT <= 0) this.state = "chase";
        break;

      case "chase": {
        if (!pl) break;
        const d = dist(this.x, this.y, pl.x, pl.y);
        let a;
        if (d < 380) {
          a = angleTo(this.x, this.y, pl.x, pl.y);
          const isRanged = this.kind === "archer" || this.kind === "goblinArcher" ||
            this.kind === "goblinShaman" || this.kind === "warlock" || this.kind === "necromancer";
          if (isRanged) {
            if (d < 150) a += Math.PI;
            else if (d < 240) a += Math.PI / 2;
            if (this.shootCd <= 0 && d < 340) {
              const aimAngle = angleTo(this.x, this.y, pl.x, pl.y - 8);
              this.atkAnimAt = game.time; // play the ranged cast/draw animation
              if (this.kind === "archer" || this.kind === "goblinArcher") {
                this.shootCd = rand(1.9, 2.6);
                // both archers now hold a bow -> fire arrows (renders as 3D arrow)
                game.enemyShots.push(new EnemyShot(this.x, this.y - 14, aimAngle, 240, 1, "arrow"));
                audio.shoot();
              } else if (this.kind === "goblinShaman") {
                this.shootCd = rand(3.5, 5.0);
                // heal most-damaged goblin ally
                let bestTarget = null, bestMissing = 0;
                for (const sk of game.skeletons) {
                  if (sk === this || sk.dead || sk.dying || sk.dormant() || sk.faction !== "goblin") continue;
                  const missing = sk.maxHp - sk.hp;
                  if (missing > bestMissing && dist(this.x, this.y, sk.x, sk.y) < 220) {
                    bestMissing = missing; bestTarget = sk;
                  }
                }
                if (bestTarget) {
                  bestTarget.hp = Math.min(bestTarget.maxHp, bestTarget.hp + 2);
                  particles.burst(bestTarget.x, bestTarget.y - 14, {
                    count: 10, colors: ["#4a7c4a", "#6bae6b", "#88dd88"], speed: 55, life: 0.55, gravity: -100,
                  });
                }
                game.enemyShots.push(new EnemyShot(this.x, this.y - 14, aimAngle, 200, 1));
                audio.shoot();
              } else if (this.kind === "warlock") {
                this.shootCd = rand(2.0, 3.0);
                game.enemyShots.push(new EnemyShot(this.x, this.y - 14, aimAngle, 200, 1, "magic"));
                audio.bolt();
              } else if (this.kind === "necromancer") {
                this.shootCd = rand(8.0, 12.0);
                const summonCount = randi(1, 2);
                for (let i = 0; i < summonCount; i++) {
                  const pos = room.randomFloorPos(pl.x, pl.y, 140);
                  game.spawnQueue.push({ x: pos.x, y: pos.y, delay: 0.3 + i * 0.5, kind: "zombie", faction: "undead", scale: game.floorCfg().scale });
                }
                particles.burst(this.x, this.y - 20, {
                  count: 14, colors: ["#9940d0", "#4a90d9", "#0d1a2e"], speed: 70, life: 0.6, gravity: -80,
                });
              }
            }
          }
        } else {
          if (Math.random() < dt * 0.8) this.wanderA = rand(0, Math.PI * 2);
          a = this.wanderA;
        }
        const isEnraged = this.kind === "goblinBerserker" && this.hp < this.maxHp * 0.5;
        if (isEnraged && !this.enraged) {
          this.enraged = true;
          particles.burst(this.x, this.y - 14, { count: 8, colors: ["#cc2222", "#ff6666"], speed: 80, life: 0.4 });
        }
        const spd = isEnraged ? this.speed * 1.6 : this.speed;
        let mx = Math.cos(a) * spd;
        let my = Math.sin(a) * spd;
        // gently push away from other skeletons so they don't stack
        for (const other of game.enemies()) {
          if (other === this || other.dead) continue;
          const od = dist(this.x, this.y, other.x, other.y);
          if (od < this.r + other.r + 2 && od > 0.01) {
            mx += ((this.x - other.x) / od) * 40;
            my += ((this.y - other.y) / od) * 40;
          }
        }
        this.flip = mx < 0;
        // shades phase through walls; others use room collision
        if (this.kind === "shade") {
          this.x = clamp(this.x + mx * dt, TILE, WIDTH - TILE);
          this.y = clamp(this.y + my * dt, TILE, HEIGHT - TILE);
        } else {
          room.moveEntity(this, mx * dt, my * dt);
        }

        const isMelee = this.kind === "melee" || this.kind === "shade" ||
          this.kind === "goblin" || this.kind === "goblinBerserker" || this.kind === "zombie";
        if (this.kind === "bomber" || this.kind === "goblinBomber") {
          if (d < 60) { this.state = "fuse"; this.stateT = 0.8; }
        } else if (isMelee && d < this.r + 20) {
          this.state = "windup";
          this.stateT = this.kind === "goblinBerserker" ? 0.26 : this.big ? 0.5 : 0.38;
        }
        break;
      }

      case "windup":
        if (this.stateT <= 0) {
          if (pl && dist(this.x, this.y, pl.x, pl.y) < this.r + 30) {
            pl.damage(this.dmg, this.x, this.y, game);
          }
          this.state = "recover";
          this.stateT = 0.9;
        }
        break;

      case "fuse":
        if (this.stateT <= 0) this.explodeNow(game);
        break;

      case "recover":
        if (this.stateT <= 0) this.state = "chase";
        break;
    }
  }

  explodeNow(game) {
    audio.slam();
    game.shake = Math.max(game.shake, 7);
    particles.burst(this.x, this.y - 10, { count: 26, colors: ["#ff9234", "#ffd14a", "#e9e6da"], speed: 200, life: 0.5 });
    for (const p of game.players) {
      if (p.alive() && dist(this.x, this.y, p.x, p.y) < 75) p.damage(2, this.x, this.y, game);
    }
    for (const sk of game.enemies()) {
      if (sk !== this && !sk.dead && sk.state !== "spawn" && dist(this.x, this.y, sk.x, sk.y) < 75) {
        sk.damage(3, this.x, this.y, game, null);
      }
    }
    this.die(game, null);
  }

  damage(n, fromX, fromY, game, attacker) {
    if (this.dead || this.dying || this.dormant()) return;
    this.hp -= n;
    this.flash = 0.12;
    const a = angleTo(fromX, fromY, this.x, this.y);
    this.kbx = Math.cos(a) * 220;
    this.kby = Math.sin(a) * 220;
    particles.text(this.x, this.y - this.drawSize + 4, `${n}`, "#ffd95e");
    particles.burst(this.x, this.y - 14, { count: 6, colors: ["#e9e6da", "#b9b4a4"], speed: 90, life: 0.35 });
    if (this.hp <= 0) this.die(game, attacker);
  }

  die(game, attacker) {
    if (this.dead || this.dying) return;
    // Enter a dying phase (play Skeletons_Death + fade, then remove).
    // Rewards/drops happen now, not at the end of the animation.
    this.dying = true; this.deathT = SKELETON_DEATH_T; this.state = "dying";
    game.kills++;
    if (game.killsByFaction) {
      const f = this.faction || "skeleton";
      game.killsByFaction[f] = (game.killsByFaction[f] || 0) + 1;
    }
    game.addXP(this.xpValue);
    if (attacker) attacker.onKill();
    audio.bones();
    const deathColors = this.faction === "goblin"
      ? ["#4a7c4a", "#88dd88", "#2d5e2d"]
      : this.faction === "undead"
      ? ["#9940d0", "#6688ff", "#0d1a2e"]
      : this.kind === "shade"
      ? ["#6688ff", "#99aaff", "#3344cc"]
      : ["#e9e6da", "#b9b4a4", "#fff"];
    particles.burst(this.x, this.y - 14, {
      count: this.big ? 24 : 16, colors: deathColors, speed: 140, life: 0.6, gravity: 260,
    });
    const coins = randi(this.coinDrop[0], this.coinDrop[1]);
    for (let i = 0; i < coins; i++) {
      game.pickups.push(new Pickup("coin", this.x + rand(-8, 8), this.y + rand(-8, 8)));
    }
    const heartChance = (this.kind === "goblinShaman" || this.kind === "necromancer") ? 0.35 : 0.18;
    if (this.elite || Math.random() < heartChance) {
      game.pickups.push(new Pickup("heart", this.x, this.y));
    }
    // Item drops: elite = guaranteed rare+, brute = 25%, regular = 10%
    if (game.hero && rollItem) {
      const chance = this.elite ? 1.0 : this.big ? 0.25 : 0.10;
      if (Math.random() < chance) {
        const minRarity = this.elite ? "rare" : undefined;
        game.pickups.push(new Pickup("item", this.x, this.y - 8,
          rollItem({ floor: game.floor, minRarity, faction: this.faction })));
      }
    }
  }

  draw(ctx) {
    const d = this.drawSize;
    if (this.state === "spawn") {
      // rising out of the floor
      const t = clamp(1 - this.stateT / 1.0, 0, 1);
      ctx.save();
      ctx.globalAlpha = t;
      drawShadow(ctx, this.x, this.y, this.r * t + 2);
      const h = Math.floor(d * t);
      if (h > 2) {
        const frame = this.frames()[0];
        ctx.drawImage(
          frame,
          0, 0, frame.width, frame.height * t,
          this.x - d / 2, this.y + 10 - h, d, h
        );
      }
      ctx.restore();
      return;
    }

    drawShadow(ctx, this.x, this.y, this.r + 2);

    // shade is semi-transparent
    if (this.kind === "shade") ctx.globalAlpha = 0.72;

    const fuseFlash = this.state === "fuse" && Math.floor(this.stateT * 14) % 2 === 0;
    const enrageFlash = this.enraged && Math.floor(performance.now() / 100) % 2 === 0;

    if (this.flash > 0 || fuseFlash || enrageFlash) {
      ctx.save();
      ctx.translate(this.x, this.y);
      if (this.flip) ctx.scale(-1, 1);
      ctx.filter = fuseFlash
        ? "brightness(2) sepia(1) hue-rotate(-50deg) saturate(4)"
        : enrageFlash
        ? "brightness(2) sepia(1) hue-rotate(100deg) saturate(4)"
        : "brightness(3)";
      ctx.drawImage(this.frames()[0], -d / 2, -d + 10, d, d);
      ctx.restore();
      ctx.filter = "none";
    } else {
      drawSprite(ctx, this.frames(), this, this.state === "chase");
    }

    if (this.kind === "shade") ctx.globalAlpha = 1;

    const showHpBar = this.big || this.elite || this.grade === "veteran" || this.grade === "elite";
    if (showHpBar && this.maxHp > this.hp) {
      const barColor = this.grade === "elite" ? "#ffd95e"
        : this.grade === "veteran" ? "#a06ce8"
        : "#e8484f";
      ctx.fillStyle = "#1a1626";
      ctx.fillRect(this.x - 16, this.y - d + 2, 32, 4);
      ctx.fillStyle = barColor;
      ctx.fillRect(this.x - 16, this.y - d + 2, 32 * (this.hp / this.maxHp), 4);
    }

    if (this.name) {
      ctx.font = "bold 11px 'Trebuchet MS', Verdana, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd95e";
      ctx.fillText(this.name, this.x, this.y - d - 2);
      ctx.textAlign = "left";
    }

    if (this.state === "windup") {
      ctx.fillStyle = "#ff5252";
      ctx.font = "bold 18px 'Trebuchet MS', Verdana, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", this.x, this.y - d + 4);
      ctx.textAlign = "left";
    }
  }
}

// ---------------- Boss ----------------

// Tier-0 baseline reward, scaled the same way Skeleton scales its own
// xpValue/coinDrop - without this a Tier-2 boss with 4x the HP paid exactly
// what a Tier-0 boss did.
const BOSS_BASE_XP = 40;
const BOSS_BASE_COIN = [12, 18];

export class Boss extends Skeleton {
  constructor(x, y, opts = {}) {
    const scale = opts.scale || 1;
    const xpValue = opts.xpValue ?? Math.round(BOSS_BASE_XP * scale);
    const coinDrop = opts.coinDrop ?? [
      Math.round(BOSS_BASE_COIN[0] * scale),
      Math.round(BOSS_BASE_COIN[1] * scale),
    ];
    super(x, y, {
      big: true,
      faction: opts.faction,
      hp: opts.hp ?? 70,
      speed: 55,
      dmg: opts.dmg ?? 2,
      xpValue, coinDrop,
      roomId: opts.roomId, frozen: opts.frozen,
    });
    this.scale = scale; // real battle scale, for boss-summoned adds below (super() didn't forward it, to avoid double-scaling the reward figures above)
    this.bossName = opts.name || "SKELETON KING";
    this.label = this.bossName;
    this.summonKind = opts.summonKind || "melee";
    this.r = 18;
    this.drawSize = 96;
    this.modelScale = 1.7; // towers over normal skeletons in 3D
    this.slamCd = 4.5;
    this.summonCd = 7;
    this.slamT = 0;     // active slam windup
    this.slamAnimAt = null; // rising-edge marker for the 3D slam telegraph/anim
    this.stateT = 1.4;  // longer rise
  }

  frames() {
    const sp = sprites;
    if (this.faction === "finale") return sp.bossFinale || sp.bossSkeleton;
    if (this.faction === "goblin") return sp.bossGoblin || sp.skeleton;
    if (this.faction === "undead") return sp.bossLich || sp.skeleton;
    return sp.bossSkeleton || sp.skeleton;
  }

  update(dt, game) {
    if (this.frozen) return; // dormant until its floor room activates
    const pl = game.nearestAlivePlayer(this.x, this.y);
    this.slamCd -= dt;
    this.summonCd -= dt;
    const enraged = this.hp < this.maxHp * 0.3;
    this.speed = enraged ? 85 : 55;

    // slam: telegraphed AoE around the king
    if (this.slamT > 0) {
      this.slamT -= dt;
      this.flash = 0; // don't mix flash with telegraph
      this.animT += dt;
      if (this.slamT <= 0) {
        audio.slam();
        game.shake = Math.max(game.shake, 10);
        particles.burst(this.x, this.y, { count: 30, colors: ["#e9e6da", "#8b80a8", "#fff"], speed: 220, life: 0.5 });
        for (const p of game.players) {
          if (p.alive() && dist(this.x, this.y, p.x, p.y) < 105) {
            p.damage(this.dmg, this.x, this.y, game);
          }
        }
        this.state = "recover";
        this.stateT = 0.7;
      }
      return;
    }

    if (this.state !== "spawn" && pl) {
      if (this.slamCd <= 0 && dist(this.x, this.y, pl.x, pl.y) < 150) {
        this.slamT = 0.85;
        this.slamAnimAt = game.time; // rising edge -> 3D telegraph + jump-chop
        audio.slamTelegraph();
        this.slamCd = enraged ? 3.2 : 5.0;
        return;
      }
      if (this.summonCd <= 0 && game.skeletons.filter((s) => !s.dead && !(s instanceof Boss)).length < 5) {
        this.summonCd = enraged ? 6 : 9;
        const fallback = this.faction === "finale" ? "skeleton" : (this.faction || "skeleton");
        for (let i = 0; i < 2; i++) {
          const pos = room.randomFloorPos(pl.x, pl.y, 120);
          const kind = i === 0 ? this.summonKind : "melee";
          game.skeletons.push(new Skeleton(pos.x, pos.y, {
            kind,
            faction: KIND_FACTION[kind] || fallback,
            scale: this.scale,
          }));
          audio.spawn();
        }
      }
    }

    super.update(dt, game);
  }

  die(game, attacker) {
    super.die(game, attacker);
    game.bossDefeated = true;
    // bossKill quests credit here, at the kill itself: "the dungeon's boss"
    // is the top floor's boss, and it can die without the run being won (the
    // player can still fall before reaching the stairs). clearDungeon quests
    // credit at endRun() instead, once every floor is actually behind you.
    // townRaid is a synthetic dungeon, same exclusion endRun applies.
    if (game.hero && game.dungeonId !== "townRaid" && game.onFinalFloor()) {
      // completeQuest banks reward XP straight onto hero.xp, which works at
      // endRun (it runs after hero.xp is synced) but mid-run would be
      // clobbered by endRun's `hero.xp = game.xp` — so move any reward XP
      // into the run's live counter, which also pays out level-ups now.
      const xpBefore = game.hero.xp || 0;
      profile.progressQuests({ bossKill: game.dungeonId });
      const rewardXp = (game.hero.xp || 0) - xpBefore;
      if (rewardXp > 0) { game.hero.xp = xpBefore; game.addXP(rewardXp); }
    }
    game.shake = 12;
    particles.burst(this.x, this.y - 20, { count: 50, colors: ["#ffd14a", "#e9e6da", "#fff"], speed: 260, life: 1.0, gravity: 200 });
    if (game.hero && rollItem) {
      game.pickups.push(new Pickup("item", this.x + rand(-24, 24), this.y, rollItem({ floor: game.floor, minRarity: "rare" })));
    }
  }

  draw(ctx) {
    // slam telegraph circle
    if (this.slamT > 0) {
      ctx.strokeStyle = `rgba(255, 82, 82, ${0.4 + 0.5 * Math.sin(this.slamT * 30)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 105, 0, Math.PI * 2);
      ctx.stroke();
    }
    super.draw(ctx);
  }
}

// ---------------- Chest ----------------

export class Chest {
  constructor(x, y, opts = {}) {
    this.x = x;
    this.y = y;
    this.r = 12;
    this.opened = false;
    this.shrine = !!opts.shrine;
  }

  open(game, player) {
    if (this.opened) return;
    this.opened = true;
    audio.chestOpen();
    particles.burst(this.x, this.y - 14, { count: 14, colors: ["#ffd14a", "#fff3b8"], speed: 120, life: 0.5, gravity: -40 });
    if (this.shrine) {
      // shrine reward: one random permanent-for-the-run buff, smaller in
      // magnitude than the matching level-up UPGRADES pick since this is a
      // free bonus on top of that system, not a replacement for it.
      const pl = player || game.localPlayer;
      const SHRINE_BUFFS = [
        () => { pl.runBuffs.dmg *= 1.15; pl.recompute(); },
        () => { pl.runBuffs.speed *= 1.10; pl.recompute(); },
        () => { pl.runBuffs.maxHp += 4; pl.recompute(); pl.hp = Math.min(pl.maxHp, pl.hp + 4); },
        () => { pl.runBuffs.cd *= 0.9; pl.recompute(); },
      ];
      SHRINE_BUFFS[Math.floor(Math.random() * SHRINE_BUFFS.length)]();
      return;
    }
    const coins = randi(4, 7);
    for (let i = 0; i < coins; i++) {
      game.pickups.push(new Pickup("coin", this.x + rand(-10, 10), this.y + rand(-6, 10)));
    }
    if (Math.random() < 0.5) {
      game.pickups.push(new Pickup("heart", this.x, this.y + 6));
    }
    if (game.hero && rollItem) {
      game.pickups.push(new Pickup("item", this.x, this.y + 6, rollItem({ floor: game.floor })));
    }
    game.addXP(4);
  }

  draw(ctx) {
    drawShadow(ctx, this.x, this.y, 13);
    const img = this.opened ? sprites.chestOpen : sprites.chestClosed;
    ctx.drawImage(img, this.x - 16, this.y - 24, 32, 32);
    if (!this.opened) {
      // sparkle so it reads as interactive
      const t = performance.now() / 300;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t);
      ctx.fillStyle = "#fff3b8";
      ctx.fillRect(this.x + 8, this.y - 26, 3, 3);
      ctx.globalAlpha = 1;
    }
  }
}

// ---------------- Pickup ----------------

export class Pickup {
  constructor(kind, x, y, item) {
    this.kind = kind; // 'coin' | 'heart' | 'item'
    this.item = item || null;
    this.x = x;
    this.y = y;
    const a = rand(0, Math.PI * 2);
    this.vx = Math.cos(a) * rand(30, 90);
    this.vy = Math.sin(a) * rand(30, 90);
    this.t = 0;
    this.dead = false;
  }

  update(dt, game) {
    this.t += dt;
    // scatter then settle
    this.vx *= Math.pow(0.01, dt);
    this.vy *= Math.pow(0.01, dt);
    room.moveEntity(Object.assign(this, { r: 5 }), this.vx * dt, this.vy * dt);

    const pl = game.nearestAlivePlayer(this.x, this.y);
    if (!pl || this.t < 0.25) return;
    const d = dist(this.x, this.y, pl.x, pl.y);
    if (d < 70) {
      // magnet toward the player
      const a = angleTo(this.x, this.y, pl.x, pl.y);
      const pull = 340 * (1 - d / 70) + 60;
      this.x += Math.cos(a) * pull * dt;
      this.y += Math.sin(a) * pull * dt;
    }
    if (d < pl.r + 6) this.collect(game, pl);
  }

  collect(game, pl) {
    this.dead = true;
    if (this.kind === "coin") {
      game.gold++;
      audio.coin();
      particles.text(this.x, this.y - 16, "+1", "#ffd14a");
    } else if (this.kind === "heart") {
      pl.hp = Math.min(pl.maxHp, pl.hp + 2);
      audio.heal();
      particles.text(this.x, this.y - 16, "+2 HP", "#ff8c91");
      particles.burst(this.x, this.y, { count: 8, colors: ["#ff8c91", "#e8484f"], speed: 60, life: 0.4, gravity: -80 });
    } else if (this.kind === "item" && this.item && game.hero) {
      if (game.hero.inventory.length >= (INV_CAP || 15)) {
        particles.text(this.x, this.y - 16, "Bag full!", "#e8484f");
        return;
      }
      game.hero.inventory.push(this.item);
      profile.save();
      const rColor = ITEM_RARITY[this.item.rarity].color;
      audio.lootPickup();
      particles.text(this.x, this.y - 16, this.item.name, rColor);
      particles.burst(this.x, this.y, { count: 8, colors: [rColor, "#fff"], speed: 70, life: 0.4, gravity: -60 });
    }
  }

  draw(ctx) {
    const bobY = Math.sin(this.t * 5) * 2;
    if (this.kind === "item" && this.item && sprites.items) {
      const rColor = (ITEM_RARITY[this.item.rarity] || {}).color || "#8b80a8";
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.t * 4);
      ctx.fillStyle = rColor;
      ctx.beginPath();
      ctx.arc(this.x, this.y - 2 + bobY, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      const icon = sprites.items[this.item.icon];
      if (icon) ctx.drawImage(icon, this.x - 8, this.y - 10 + bobY, 16, 16);
    } else {
      const img = this.kind === "coin" ? sprites.coin : sprites.heart;
      ctx.drawImage(img, this.x - 8, this.y - 10 + bobY, 16, 16);
    }
  }
}
