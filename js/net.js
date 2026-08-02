// Peer-to-peer co-op over WebRTC. PeerJS's free cloud broker handles the
// handshake, so pairing is a short room code instead of pasted SDP blobs;
// game data still flows directly between the two players. A free TURN relay
// is configured so strict NATs can connect too.

import { room } from "./room.js?v=6fd6c2e4";
import { CLASSES, Player, Skeleton, Boss, Chest, Projectile, EnemyShot, Pickup } from "./entities.js?v=6fd6c2e4";

let peer = null;
let conn = null;
const handlers = { message: null, open: null, close: null };
let closeFired = false;

// unambiguous characters only (no 0/O, 1/I)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 4;
const ID_PREFIX = "dungeondash-";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randomCode() {
  let c = "";
  for (let i = 0; i < CODE_LEN; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

// window.DD_PEER_OPTS allows pointing at a self-hosted PeerServer (tests do
// this); by default the PeerJS public cloud broker is used.
function peerOpts() {
  return Object.assign({
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      ],
    },
  }, window.DD_PEER_OPTS || {});
}

function fireClose() {
  if (closeFired) return;
  closeFired = true;
  net.connected = false;
  if (handlers.close) handlers.close();
}

function wire(c) {
  conn = c;
  const onOpen = () => {
    net.connected = true;
    closeFired = false;
    // an abruptly closed tab never sends a clean close — watch the ICE state
    const pc = c.peerConnection;
    if (pc) {
      pc.onconnectionstatechange = () => {
        if (net.connected && ["disconnected", "failed", "closed"].includes(pc.connectionState)) {
          fireClose();
        }
      };
    }
    if (handlers.open) handlers.open();
  };
  // the guest wires a connection only after it has already opened (see join),
  // so honour an already-open channel instead of waiting for an event that
  // has already fired.
  if (c.open) onOpen(); else c.on("open", onOpen);
  c.on("close", fireClose);
  c.on("error", fireClose);
  c.on("data", (data) => {
    try { if (handlers.message) handlers.message(data); } catch (err) { /* ignore malformed */ }
  });
}

// One attempt to open a data channel to a host. Resolves with the OPEN
// connection (caller wires it) or rejects. On failure the half-open channel
// is closed and all temporary listeners are removed, so a retry starts clean
// and never trips the game's disconnect handling.
function attemptConnect(p, fullId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const c = p.connect(fullId, { reliable: true, serialization: "json" });
    const onOpen = () => settle(true);
    const onErr = (e) => settle(false, e);
    const timer = setTimeout(() => settle(false, new Error("Timed out reaching the host")), timeoutMs);
    function settle(ok, err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      c.off("open", onOpen);
      c.off("error", onErr);
      p.off("error", onErr);
      if (ok) { resolve(c); return; }
      try { c.close(); } catch (e2) { /* already gone */ }
      reject(err);
    }
    c.on("open", onOpen);
    c.on("error", onErr);
    // 'peer-unavailable' is delivered on the peer, not the connection
    p.on("error", onErr);
  });
}

function newPeer(id) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === "undefined") {
      reject(new Error("PeerJS failed to load — check your connection"));
      return;
    }
    const p = id ? new Peer(id, peerOpts()) : new Peer(peerOpts());
    const timer = setTimeout(() => reject(new Error("Could not reach the matchmaking server")), 12000);
    p.on("open", () => { clearTimeout(timer); resolve(p); });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

export const net = {
  role: null, // null | 'host' | 'guest'
  connected: false,
  roomCode: null,

  onMessage(cb) { handlers.message = cb; },
  onOpen(cb) { handlers.open = cb; },
  onClose(cb) { handlers.close = cb; },

  send(obj) {
    if (conn && conn.open) {
      try { conn.send(obj); } catch (e) { /* buffer full etc. */ }
    }
  },

  // Registers a room and resolves with its short code. The returned promise
  // does NOT wait for a guest — the 'open' handler fires when one connects.
  async host() {
    this.role = "host";
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomCode();
      try {
        peer = await newPeer(ID_PREFIX + code);
        this.roomCode = code;
        peer.on("connection", (c) => {
          if (conn && conn.open) { c.close(); return; } // room is full
          wire(c);
        });
        // The public broker drops idle registrations; without this the room
        // code silently goes dead and the guest gets "no game found". Re-
        // register whenever we lose the broker (a no-op once a guest is on
        // the direct P2P channel).
        peer.on("disconnected", () => {
          if (this.role === "host") { try { peer.reconnect(); } catch (e) { /* destroyed */ } }
        });
        return code;
      } catch (e) {
        if (e && e.type === "unavailable-id") continue; // code collision, reroll
        this.role = null;
        throw e;
      }
    }
    this.role = null;
    throw new Error("Could not register a room code");
  },

  // Connects to a host's room code. Resolves once the data channel is open.
  // A "peer-unavailable" can be transient on the public broker — the host may
  // still be (re)registering, or two broker replicas briefly disagree — so we
  // make ONE quick retry before giving up. (We don't retry harder: a genuinely
  // wrong code is also peer-unavailable, and each attempt costs a few seconds,
  // so more retries would just make a typo take painfully long to report.)
  async join(code) {
    this.role = "guest";
    const fullId = ID_PREFIX + code.trim().toUpperCase();
    try {
      peer = await newPeer();
    } catch (e) {
      this.role = null;
      throw e;
    }
    const ATTEMPTS = 2;
    let lastErr = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const c = await attemptConnect(peer, fullId, 9000);
        wire(c); // c is already open — wire fires the open handler immediately
        return;
      } catch (e) {
        lastErr = e;
        const retriable = !e || !e.type || e.type === "peer-unavailable";
        if (!retriable || attempt === ATTEMPTS - 1) break;
        await sleep(1200);
      }
    }
    this.role = null;
    throw lastErr || new Error("No game found with that code");
  },

  reset() {
    try { if (conn) conn.close(); } catch (e) { /* already closed */ }
    try { if (peer) peer.destroy(); } catch (e) { /* already closed */ }
    peer = null;
    conn = null;
    this.role = null;
    this.connected = false;
    this.roomCode = null;
    closeFired = false;
    guestEnemies.clear();
  },
};


// Input provider for the guest's avatar on the host: replays the latest
// input state received over the wire.
export class RemoteInput {
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

// Guest-side entity identity. The 3D character manager (char3d.js) keys models
// by entity OBJECT identity, so the guest must REUSE the same objects across
// snapshots — matching players by slot and enemies by a host-assigned id.
// Rebuilding them every frame (as this used to) destroyed and respawned every
// model ~15x/s, which froze all animation into a stuttering loop.
let nextEnemyId = 1;             // host: stable per-enemy id, assigned lazily
const guestEnemies = new Map();  // guest: id -> reconstructed skeleton

export const netSync = {
  snapshot(game) {
    return {
      t: "s",
      time: r2(game.time),
      gold: game.gold, kills: game.kills, xp: game.xp, level: game.level,
      floor: game.floor, ri: game.roomIndex, rt: game.roomType, rc: game.roomCleared,
      door: room.doorOpen,
      sq: game.spawnQueue.length,
      // connected-floor gating: per-room locked|cleared|seen bits + stairs ready
      rr: (room.isFloor && room.rooms)
        ? room.rooms.map((r) => (r.locked ? 1 : 0) | (r.cleared ? 2 : 0) | (r.seen ? 4 : 0)) : null,
      sr: game.stairsReady ? 1 : 0,
      pl: game.players.map((p) => ({
        c: p.classKey, x: r1(p.x), y: r1(p.y), hp: p.hp, mhp: p.maxHp,
        aim: r2(p.aim), fl: p.flip ? 1 : 0, mv: p.moving ? 1 : 0, an: r2(p.animT % 100),
        sw: r2(Math.max(0, p.swingT)), swa: r2(p.swingAngle), ifr: r2(Math.max(0, p.iframes)),
        dn: p.downed ? 1 : 0, dnt: r1(p.downT), rp: r2(p.reviveP), dd: p.dead ? 1 : 0,
        dg: p.dying ? 1 : 0, dgt: r1(p.deathT || 0),
        arc: r2(p.stats.arc || 0), rng: r1(p.stats.range || 0),
        dsh: p.stats.dash ? 1 : 0, dcd: r1(p.dashCd),
      })),
      en: game.skeletons.map((s) => {
        if (s._nid == null) s._nid = nextEnemyId++;
        return {
          id: s._nid,
          x: r1(s.x), y: r1(s.y), hp: s.hp, mhp: s.maxHp,
          st: s.state, stt: r2(s.stateT), an: r2(s.animT % 100), fl: s.flip ? 1 : 0,
          bg: s.big ? 1 : 0, el: s.elite ? 1 : 0, nm: s.name || 0, kd: s.kind,
          ds: s.drawSize, r: s.r, fs: r2(Math.max(0, s.flash)),
          boss: s instanceof Boss ? 1 : 0, bn: s.bossName || 0, sl: s.slamT ? r2(s.slamT) : 0,
          fc: s.faction || "skeleton", gr: s.grade || "regular", eg: s.enraged ? 1 : 0,
          fz: s.frozen ? 1 : 0, // dormant floor enemies — HUD hides the boss bar for these
        };
      }),
      pr: game.projectiles.map((p) => ({ x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy), kind: p.kind })),
      es: game.enemyShots.map((e) => ({ x: r1(e.x), y: r1(e.y), t: r2(e.t), style: e.style || "bone" })),
      pk: game.pickups.map((p) => ({ kind: p.kind, x: r1(p.x), y: r1(p.y), t: r2(p.t % 100) })),
      ch: game.chests.map((c) => ({ x: r1(c.x), y: r1(c.y), o: c.opened ? 1 : 0 })),
    };
  },

  applySnapshot(game, s) {
    game.time = s.time;
    game.gold = s.gold; game.kills = s.kills; game.xp = s.xp; game.level = s.level;
    game.floor = s.floor; game.roomIndex = s.ri; game.roomType = s.rt; game.roomCleared = s.rc;
    room.doorOpen = s.door;
    game.spawnQueue = new Array(s.sq).fill({});
    // connected-floor gating from the host: drives the guest's door locks,
    // minimap reveal, and stairs. Rooms are in the same order as the floor msg.
    if (s.rr && room.isFloor && room.rooms) {
      for (let i = 0; i < s.rr.length && i < room.rooms.length; i++) {
        const b = s.rr[i], rm = room.rooms[i];
        rm.locked = !!(b & 1); rm.cleared = !!(b & 2); rm.seen = !!(b & 4);
      }
    }
    game.stairsReady = !!s.sr;

    // Reuse player objects by slot so their 3D models (and face-smoothing
    // history) persist across snapshots instead of being respawned each frame.
    const prevPlayers = game.players || [];
    game.players = s.pl.map((d, i) => {
      const o = (prevPlayers[i] && prevPlayers[i].classKey === d.c)
        ? prevPlayers[i] : Object.create(Player.prototype);
      o.classKey = d.c; o.cfg = CLASSES[d.c];
      o.stats = { arc: d.arc, range: d.rng, dash: !!d.dsh };
      o.x = d.x; o.y = d.y; o.hp = d.hp; o.maxHp = d.mhp; o.r = 10;
      o.aim = d.aim; o.flip = !!d.fl; o.moving = !!d.mv; o.animT = d.an;
      o.swingT = d.sw; o.swingAngle = d.swa; o.iframes = d.ifr;
      o.downed = !!d.dn; o.downT = d.dnt; o.reviveP = d.rp; o.dead = !!d.dd;
      o.dying = !!d.dg; o.deathT = d.dgt;
      o.dashCd = d.dcd; o.killHeal = 0;
      return o;
    });

    // Reuse enemy objects by their host-assigned id (same reason as players).
    const seenEnemies = new Set();
    game.skeletons = s.en.map((d) => {
      seenEnemies.add(d.id);
      const proto = d.boss ? Boss.prototype : Skeleton.prototype;
      let o = guestEnemies.get(d.id);
      if (!o || Object.getPrototypeOf(o) !== proto) {
        o = Object.create(proto);
        guestEnemies.set(d.id, o);
      }
      o.x = d.x; o.y = d.y; o.hp = d.hp; o.maxHp = d.mhp;
      o.state = d.st; o.stateT = d.stt; o.animT = d.an; o.flip = !!d.fl;
      o.big = !!d.bg; o.elite = !!d.el; o.name = d.nm || null; o.kind = d.kd;
      o.drawSize = d.ds; o.r = d.r; o.flash = d.fs; o.dead = false;
      o.bossName = d.bn || null; o.slamT = d.sl || 0;
      o.faction = d.fc || "skeleton"; o.grade = d.gr || "regular"; o.enraged = !!d.eg;
      o.frozen = !!d.fz; // so the HUD hides the boss bar for a dormant boss
      if (d.boss) o.modelScale = 1.7; // keep the King's larger 3D size on the guest
      return o;
    });
    for (const id of guestEnemies.keys()) if (!seenEnemies.has(id)) guestEnemies.delete(id);

    game.projectiles = s.pr.map((d) => Object.assign(Object.create(Projectile.prototype), d, { dead: false }));
    game.enemyShots = s.es.map((d) => Object.assign(Object.create(EnemyShot.prototype), d, { dead: false }));
    game.pickups = s.pk.map((d) => Object.assign(Object.create(Pickup.prototype), d, { dead: false }));
    game.chests = s.ch.map((d) => Object.assign(Object.create(Chest.prototype), { x: d.x, y: d.y, opened: !!d.o, r: 12 }));
  },
};
