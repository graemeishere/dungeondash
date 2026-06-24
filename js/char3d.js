"use strict";
// KayKit 3D character loading + animation.
//
// Key fact that makes this cheap: the Adventurer meshes, the Skeletons and the
// "Mannequin" all share the SAME 23-joint Rig_Medium, so every clip retargets
// onto any model by bone name. We load the clip library once and bind per
// character via AnimationMixer.
//
// ES module; the host page's importmap resolves the bare "three" specifier.
import * as THREE from "three";
import { GLTFLoader } from "./lib/three/GLTFLoader.js";
import { clone as skeletonClone } from "./lib/three/SkeletonUtils.js";

const ANIM_DIR = "KayKit Character Animations/Animations/gltf/Rig_Medium/";
const ANIM_PACKS = ["General", "MovementBasic", "MovementAdvanced", "CombatMelee", "CombatRanged", "Special"];

const HERO = "KayKit Adventurers/Characters/gltf/";
const GEAR = "KayKit Adventurers/Assets/gltf/";
const SKEL = "KayKit Skeletons/characters/gltf/";
const SKGEAR = "KayKit Skeletons/assets/gltf/";
const MANNEQUIN = "KayKit Character Animations/Mannequin Character/characters/Mannequin_Medium.glb";

// ---------------------------------------------------------------------------
// One registry per "rig": model + held weapon + which hand + the clip names for
// each logical state. attacks[] is a COMBO (cycled one per swing) unless seq:true
// (played in order as a single attack, e.g. bow Draw -> Release). Edit freely.
export const RIG = {
  "class:warrior": {
    model: HERO + "Knight.glb", scale: 1.42, weapon: GEAR + "sword_1handed.gltf", hand: "r",
    idle: "Idle_A", run: "Running_A", spawn: "Spawn_Ground", death: "Death_A", attackSpeed: 1,
    attacks: ["Melee_1H_Attack_Slice_Diagonal", "Melee_1H_Attack_Stab", "Melee_2H_Attack_Chop", "Melee_Unarmed_Attack_Punch_A"],
  },
  "class:rogue": {
    model: HERO + "Rogue.glb", scale: 1.42, weapon: GEAR + "dagger.gltf", hand: "r",
    idle: "Idle_A", run: "Running_A", spawn: "Spawn_Ground", death: "Death_A", attackSpeed: 1.21,
    attacks: ["Melee_Unarmed_Attack_Punch_A", "Melee_Unarmed_Attack_Kick", "Melee_1H_Attack_Slice_Horizontal", "Melee_1H_Attack_Stab"],
  },
  "class:mage": {
    model: HERO + "Mage.glb", scale: 1.42, weapon: GEAR + "staff.gltf", hand: "r", ranged: true,
    idle: "Idle_A", run: "Running_A", spawn: "Spawn_Ground", death: "Death_A", attackSpeed: 1,
    attacks: ["Ranged_Magic_Shoot"],
  },
  "class:ranger": {
    model: HERO + "Ranger.glb", scale: 1.42, weapon: GEAR + "bow_withString.gltf", hand: "l", ranged: true, seq: true,
    weaponRot: [4.97, 9.69, 6.28], // user-tuned in anim3d
    idle: "Idle_A", run: "Running_HoldingBow", spawn: "Spawn_Ground", death: "Death_A", attackSpeed: 0.32,
    attacks: ["Ranged_Bow_Draw", "Ranged_Bow_Release"],
  },
  // ---- skeleton enemies (share Rig_Medium) ----
  "enemy:minion": {
    model: SKEL + "Skeleton_Minion.glb", scale: 1.33, weapon: SKGEAR + "Skeleton_Blade.gltf", hand: "r",
    idle: "Skeletons_Idle", run: "Running_A", spawn: "Spawn_Ground", death: "Skeletons_Death", attackSpeed: 1.32,
    inactive: "Skeletons_Inactive_Floor_Pose", awaken: "Skeletons_Awaken_Floor",
    attacks: ["Melee_1H_Attack_Stab", "Melee_1H_Attack_Slice_Horizontal"],
  },
  "enemy:warrior": {
    model: SKEL + "Skeleton_Warrior.glb", scale: 1.42, weapon: SKGEAR + "Skeleton_Axe.gltf", hand: "r",
    idle: "Skeletons_Idle", run: "Running_A", spawn: "Spawn_Ground", death: "Skeletons_Death", attackSpeed: 2.01,
    inactive: "Skeletons_Inactive_Floor_Pose", awaken: "Skeletons_Awaken_Floor",
    attacks: ["Melee_1H_Attack_Chop", "Melee_2H_Attack_Chop"],
  },
  "enemy:archer": {
    model: SKEL + "Skeleton_Rogue.glb", scale: 1.33, weapon: GEAR + "bow_withString.gltf", hand: "l", ranged: true, seq: true,
    weaponRot: [4.97, 9.69, 6.28],
    idle: "Skeletons_Idle", run: "Running_HoldingBow", spawn: "Spawn_Ground", death: "Skeletons_Death", attackSpeed: 1,
    inactive: "Skeletons_Inactive_Floor_Pose", awaken: "Skeletons_Awaken_Floor",
    attacks: ["Ranged_Bow_Draw", "Ranged_Bow_Release"],
  },
  "enemy:mage": {
    model: SKEL + "Skeleton_Mage.glb", scale: 1.33, weapon: SKGEAR + "Skeleton_Staff.gltf", hand: "r", ranged: true,
    idle: "Skeletons_Idle", run: "Running_A", spawn: "Spawn_Ground", death: "Skeletons_Death", attackSpeed: 1,
    inactive: "Skeletons_Inactive_Floor_Pose", awaken: "Skeletons_Awaken_Floor",
    attacks: ["Ranged_Magic_Shoot"],
  },
  "fallback": {
    model: MANNEQUIN, scale: 1.42, weapon: null, hand: "r",
    idle: "Idle_A", run: "Running_A", spawn: "Spawn_Ground", death: "Death_A", attackSpeed: 1,
    attacks: ["Melee_1H_Attack_Chop"],
  },
};

// Map a hero classKey / enemy kind -> rig key.
export function classModelKey(classKey) {
  const k = "class:" + classKey;
  return RIG[k] ? k : "class:warrior";
}
export function enemyModelKey(kind = "") {
  if (/mage|warlock|necromancer|shaman|shade/i.test(kind)) return "enemy:mage";
  if (/arch|bow|ranger|rogue/i.test(kind))                 return "enemy:archer";
  if (/zombie|berserker|brute|warrior|goblin/i.test(kind)) return "enemy:warrior";
  return "enemy:minion";
}

export class CharacterFactory {
  constructor() {
    this.loader = new GLTFLoader();
    this.clips = new Map();    // name -> THREE.AnimationClip (shared library)
    this.protos = new Map();   // rig key -> loaded gltf.scene (prototype to clone)
    this.weaponProtos = {};    // weapon url -> loaded scene
  }

  async loadClips() {
    const packs = await Promise.all(
      ANIM_PACKS.map((f) => this.loader.loadAsync(encodeURI(ANIM_DIR + "Rig_Medium_" + f + ".glb")))
    );
    for (const g of packs) for (const clip of g.animations) {
      if (!this.clips.has(clip.name)) this.clips.set(clip.name, clip);
    }
    return this;
  }

  async loadWeapons() {
    const urls = [...new Set(Object.values(RIG).map((r) => r.weapon).filter(Boolean))];
    await Promise.allSettled(urls.map((u) =>
      this.loader.loadAsync(encodeURI(u))
        .then((g) => { this.weaponProtos[u] = g.scene; })
        .catch((e) => console.error("weapon load failed:", u, e))
    ));
    return this;
  }

  async loadModelByKey(key, url) {
    if (!this.protos.has(key)) {
      const g = await this.loader.loadAsync(encodeURI(url));
      this.protos.set(key, g.scene);
    }
    return this.protos.get(key);
  }

  clipNames() { return [...this.clips.keys()]; }

  // Spawn an independently-animated instance, attaching the rig's weapon to the
  // configured hand bone (handslot.r / handslot.l -> sanitised "handslotr"/"l").
  spawn(key) {
    const rig = RIG[key];
    const proto = this.protos.get(key);
    if (!proto) throw new Error("model not loaded: " + key);
    const root = skeletonClone(proto);
    if (rig && rig.weapon) {
      const wproto = this.weaponProtos[rig.weapon];
      if (!wproto) {
        console.warn("char3d: weapon NOT loaded:", rig.weapon, "for", key);
      } else {
        const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const want = rig.hand === "l" ? "handslotl" : "handslotr";
        const alt = rig.hand === "l" ? "handl" : "handr";
        let hand = null;
        root.traverse((o) => { if (!hand && norm(o.name) === want) hand = o; });
        if (!hand) root.traverse((o) => { if (!hand && norm(o.name) === alt) hand = o; });
        if (hand) {
          const w = wproto.clone(true);
          w.userData.weapon = true; // tag so tools (anim test) can toggle it
          if (rig.weaponRot) w.rotation.set(rig.weaponRot[0], rig.weaponRot[1], rig.weaponRot[2]);
          if (rig.weaponPos) w.position.set(rig.weaponPos[0], rig.weaponPos[1], rig.weaponPos[2]);
          hand.add(w);
        } else {
          console.warn("char3d: no hand bone found for", key);
        }
      }
    }
    return new Character(root, this.clips);
  }
}

class Character {
  constructor(root, clips) {
    this.root = root;
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();
    this.current = null;
    this.currentName = null;
  }

  // Crossfade to a clip. once=true plays a one-shot (clamped on last frame).
  // restart=true forces a replay even if the same clip is already current — used
  // to re-trigger a one-shot attack whose name didn't change (e.g. mage casting
  // the same clip every swing), which would otherwise clamp and freeze.
  play(name, { fade = 0.15, once = false, timeScale = 1, restart = false } = {}) {
    if (this.currentName === name && !restart) { if (this.current) this.current.timeScale = timeScale; return this.current; }
    const clip = this.clips.get(name);
    if (!clip) return null;
    let action = this.actions.get(name);
    if (!action) { action = this.mixer.clipAction(clip); this.actions.set(name, action); }
    action.reset();
    action.timeScale = timeScale;
    if (once) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    else action.setLoop(THREE.LoopRepeat, Infinity);
    action.fadeIn(fade).play();
    if (this.current && this.current !== action) this.current.fadeOut(fade);
    this.current = action;
    this.currentName = name;
    return action;
  }

  update(dt) { this.mixer.update(dt); }
}

// Drives a pool of Characters from a per-frame list of placement items:
//   { entity, modelKey, x, z, rotationY, clip, once, timeScale }
export class CharacterManager {
  constructor(scene, factory) {
    this.scene = scene;
    this.factory = factory;
    this.chars = new Map(); // entity -> Character
    this.scaleMul = 1;      // live global scale multiplier (camera-tuning)
  }

  async preloadAll() {
    await this.factory.loadClips();
    await this.factory.loadWeapons();
    console.log("char3d: clips", this.factory.clips.size, "weapons", Object.keys(this.factory.weaponProtos).length);
    const keys = Object.keys(RIG);
    const results = await Promise.allSettled(keys.map((k) => this.factory.loadModelByKey(k, RIG[k].model)));
    results.forEach((r, i) => { if (r.status === "rejected") console.error("char3d: model FAILED", keys[i], r.reason); });
    console.log("char3d: models", results.filter((r) => r.status === "fulfilled").length, "/", keys.length);
    return this;
  }

  sync(items, dt) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.entity);
      let ch = this.chars.get(it.entity);
      if (!ch) {
        const key = this.factory.protos.has(it.modelKey) ? it.modelKey
          : (this.factory.protos.has("fallback") ? "fallback" : null);
        if (!key) continue;
        ch = this.factory.spawn(key);
        ch._baseScale = (RIG[key] || { scale: 1 }).scale;
        this.scene.add(ch.root);
        this.chars.set(it.entity, ch);
      }
      ch.root.scale.setScalar(ch._baseScale * this.scaleMul);
      ch.root.position.set(it.x, 0, it.z);
      ch.root.rotation.y = it.rotationY;
      ch.play(it.clip, { once: it.once, timeScale: it.timeScale || 1, restart: it.restart });
      ch.update(dt);
    }
    for (const [ent, ch] of this.chars) {
      if (!seen.has(ent)) { this.scene.remove(ch.root); this.chars.delete(ent); }
    }
  }
}
