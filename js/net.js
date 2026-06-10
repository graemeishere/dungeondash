"use strict";
// Peer-to-peer co-op over WebRTC with manual code exchange — no server needed,
// in the spirit of the design brief's Bluetooth/local-WiFi pairing. The host
// runs the simulation; the guest sends input and renders snapshots.
(function (DD) {
  let pc = null;
  let chan = null;
  const handlers = { message: null, open: null, close: null };

  function waitIce(conn) {
    return new Promise((resolve) => {
      if (conn.iceGatheringState === "complete") return resolve();
      const check = () => {
        if (conn.iceGatheringState === "complete") {
          conn.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      conn.addEventListener("icegatheringstatechange", check);
      setTimeout(resolve, 3000); // partial candidates usually suffice on a LAN
    });
  }

  let closeFired = false;

  function fireClose() {
    if (closeFired) return;
    closeFired = true;
    DD.net.connected = false;
    if (handlers.close) handlers.close();
  }

  function wire(c) {
    chan = c;
    c.onopen = () => { DD.net.connected = true; closeFired = false; if (handlers.open) handlers.open(); };
    c.onclose = fireClose;
    c.onerror = fireClose;
    c.onmessage = (e) => {
      try { if (handlers.message) handlers.message(JSON.parse(e.data)); } catch (err) { /* ignore malformed */ }
    };
  }

  function newPc() {
    pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    // an abruptly closed tab never sends a channel close — watch the ICE state
    pc.onconnectionstatechange = () => {
      if (DD.net.connected && ["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        fireClose();
      }
    };
    return pc;
  }

  DD.net = {
    role: null, // null | 'host' | 'guest'
    connected: false,

    onMessage(cb) { handlers.message = cb; },
    onOpen(cb) { handlers.open = cb; },
    onClose(cb) { handlers.close = cb; },

    send(obj) {
      if (chan && chan.readyState === "open") {
        try { chan.send(JSON.stringify(obj)); } catch (e) { /* buffer full etc. */ }
      }
    },

    async host() {
      this.role = "host";
      const p = newPc();
      wire(p.createDataChannel("game"));
      await p.setLocalDescription(await p.createOffer());
      await waitIce(p);
      return btoa(JSON.stringify(p.localDescription));
    },

    async hostAccept(answerCode) {
      await pc.setRemoteDescription(JSON.parse(atob(answerCode.trim())));
    },

    async join(offerCode) {
      this.role = "guest";
      const p = newPc();
      p.ondatachannel = (e) => wire(e.channel);
      await p.setRemoteDescription(JSON.parse(atob(offerCode.trim())));
      await p.setLocalDescription(await p.createAnswer());
      await waitIce(p);
      return btoa(JSON.stringify(p.localDescription));
    },

    reset() {
      try { if (chan) chan.close(); } catch (e) { /* already closed */ }
      try { if (pc) pc.close(); } catch (e) { /* already closed */ }
      pc = null;
      chan = null;
      this.role = null;
      this.connected = false;
    },
  };

  // Input provider for the guest's avatar on the host: replays the latest
  // input state received over the wire.
  DD.RemoteInput = class {
    constructor() {
      this.state = { mv: { dx: 0, dy: 0 }, aim: 0, atk: false, dash: false };
      this._dashTap = false;
    }
    moveVector() { return this.state.mv; }
    aimAngle() { return this.state.aim; }
    attacking() { return this.state.atk; }
    dashing() { return this.state.dash; }
    consumeDashTap() { const v = this._dashTap; this._dashTap = false; return v; }
  };

  // ---- world serialization (host -> guest) ----

  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;

  DD.netSync = {
    snapshot(game) {
      return {
        t: "s",
        time: r2(game.time),
        gold: game.gold, kills: game.kills, xp: game.xp, level: game.level,
        floor: game.floor, ri: game.roomIndex, rt: game.roomType, rc: game.roomCleared,
        door: DD.room.doorOpen,
        sq: game.spawnQueue.length,
        pl: game.players.map((p) => ({
          c: p.classKey, x: r1(p.x), y: r1(p.y), hp: p.hp, mhp: p.maxHp,
          aim: r2(p.aim), fl: p.flip ? 1 : 0, mv: p.moving ? 1 : 0, an: r2(p.animT % 100),
          sw: r2(Math.max(0, p.swingT)), swa: r2(p.swingAngle), ifr: r2(Math.max(0, p.iframes)),
          dn: p.downed ? 1 : 0, dnt: r1(p.downT), rp: r2(p.reviveP), dd: p.dead ? 1 : 0,
          arc: r2(p.stats.arc || 0), rng: r1(p.stats.range || 0),
          dsh: p.stats.dash ? 1 : 0, dcd: r1(p.dashCd),
        })),
        en: game.skeletons.map((s) => ({
          x: r1(s.x), y: r1(s.y), hp: s.hp, mhp: s.maxHp,
          st: s.state, stt: r2(s.stateT), an: r2(s.animT % 100), fl: s.flip ? 1 : 0,
          bg: s.big ? 1 : 0, el: s.elite ? 1 : 0, nm: s.name || 0, kd: s.kind,
          ds: s.drawSize, r: s.r, fs: r2(Math.max(0, s.flash)),
          boss: s instanceof DD.Boss ? 1 : 0, bn: s.bossName || 0, sl: s.slamT ? r2(s.slamT) : 0,
        })),
        pr: game.projectiles.map((p) => ({ x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy), kind: p.kind })),
        es: game.enemyShots.map((e) => ({ x: r1(e.x), y: r1(e.y), t: r2(e.t) })),
        pk: game.pickups.map((p) => ({ kind: p.kind, x: r1(p.x), y: r1(p.y), t: r2(p.t % 100) })),
        ch: game.chests.map((c) => ({ x: r1(c.x), y: r1(c.y), o: c.opened ? 1 : 0 })),
        si: game.shopItems.map((i) => ({
          kind: i.kind, x: r1(i.x), y: r1(i.y), price: i.price, label: i.label, sold: i.sold ? 1 : 0,
        })),
        sk: game.shopkeeper ? { x: r1(game.shopkeeper.x), y: r1(game.shopkeeper.y) } : 0,
      };
    },

    applySnapshot(game, s) {
      game.time = s.time;
      game.gold = s.gold; game.kills = s.kills; game.xp = s.xp; game.level = s.level;
      game.floor = s.floor; game.roomIndex = s.ri; game.roomType = s.rt; game.roomCleared = s.rc;
      DD.room.doorOpen = s.door;
      game.spawnQueue = new Array(s.sq).fill({});

      game.players = s.pl.map((d) => {
        const o = Object.create(DD.Player.prototype);
        o.classKey = d.c; o.cfg = DD.CLASSES[d.c];
        o.stats = { arc: d.arc, range: d.rng, dash: !!d.dsh };
        o.x = d.x; o.y = d.y; o.hp = d.hp; o.maxHp = d.mhp; o.r = 10;
        o.aim = d.aim; o.flip = !!d.fl; o.moving = !!d.mv; o.animT = d.an;
        o.swingT = d.sw; o.swingAngle = d.swa; o.iframes = d.ifr;
        o.downed = !!d.dn; o.downT = d.dnt; o.reviveP = d.rp; o.dead = !!d.dd;
        o.dashCd = d.dcd; o.killHeal = 0;
        return o;
      });

      game.skeletons = s.en.map((d) => {
        const o = Object.create(d.boss ? DD.Boss.prototype : DD.Skeleton.prototype);
        o.x = d.x; o.y = d.y; o.hp = d.hp; o.maxHp = d.mhp;
        o.state = d.st; o.stateT = d.stt; o.animT = d.an; o.flip = !!d.fl;
        o.big = !!d.bg; o.elite = !!d.el; o.name = d.nm || null; o.kind = d.kd;
        o.drawSize = d.ds; o.r = d.r; o.flash = d.fs; o.dead = false;
        o.bossName = d.bn || null; o.slamT = d.sl || 0;
        return o;
      });

      game.projectiles = s.pr.map((d) => Object.assign(Object.create(DD.Projectile.prototype), d, { dead: false }));
      game.enemyShots = s.es.map((d) => Object.assign(Object.create(DD.EnemyShot.prototype), d, { dead: false }));
      game.pickups = s.pk.map((d) => Object.assign(Object.create(DD.Pickup.prototype), d, { dead: false }));
      game.chests = s.ch.map((d) => Object.assign(Object.create(DD.Chest.prototype), { x: d.x, y: d.y, opened: !!d.o, r: 12 }));
      game.shopItems = s.si.map((d) => Object.assign(Object.create(DD.ShopItem.prototype), {
        kind: d.kind, x: d.x, y: d.y, r: 14, price: d.price, label: d.label, sold: !!d.sold, upgrade: null,
      }));
      game.shopkeeper = s.sk ? DD.makeShopkeeper(s.sk.x, s.sk.y) : null;
    },
  };
})(window.DD);
