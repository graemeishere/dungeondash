"use strict";
// KayKit 3D character loading + animation (Phase 2, the real version that
// replaces the 2D-sprite billboards).
//
// Key fact that makes this cheap: the Adventurer meshes and the Character
// Animation "Mannequin" share the SAME 23-joint rig, so the animation clips
// retarget onto any hero by bone name with no remapping. We load the clips
// once into a shared library, then bind them per-character via AnimationMixer.
//
// ES module; the host page's importmap resolves the bare "three" specifier.
import * as THREE from "three";
import { GLTFLoader } from "./lib/three/GLTFLoader.js";
import { clone as skeletonClone } from "./lib/three/SkeletonUtils.js";

const HEROES = "KayKit Adventurers/Characters/gltf/";
const ANIM_DIR = "KayKit Character Animations/Animations/gltf/Rig_Medium/";
// Animation packs to pull clips from (Rig_Medium = the hero rig).
const ANIM_PACKS = ["General", "MovementBasic", "MovementAdvanced", "CombatMelee", "CombatRanged", "Special"];

export class CharacterFactory {
  constructor() {
    this.loader = new GLTFLoader();
    this.clips = new Map();   // name -> THREE.AnimationClip (shared library)
    this.protos = new Map();  // modelName -> loaded gltf.scene (prototype to clone)
  }

  // Load the clip library; call once before spawning.
  async loadClips() {
    const packs = await Promise.all(
      ANIM_PACKS.map((f) => this.loader.loadAsync(encodeURI(ANIM_DIR + "Rig_Medium_" + f + ".glb")))
    );
    for (const g of packs) {
      for (const clip of g.animations) {
        if (!this.clips.has(clip.name)) this.clips.set(clip.name, clip);
      }
    }
    return this;
  }

  async loadModel(name) {
    if (!this.protos.has(name)) {
      const g = await this.loader.loadAsync(encodeURI(HEROES + name + ".glb"));
      this.protos.set(name, g.scene);
    }
    return this.protos.get(name);
  }

  // Load a model under an arbitrary key (used by the swappable registry below).
  async loadModelByKey(key, url) {
    if (!this.protos.has(key)) {
      const g = await this.loader.loadAsync(encodeURI(url));
      this.protos.set(key, g.scene);
    }
    return this.protos.get(key);
  }

  clipNames() { return [...this.clips.keys()]; }

  // Spawn an independently-animated instance of a previously-loaded model.
  spawn(modelName) {
    const proto = this.protos.get(modelName);
    if (!proto) throw new Error("model not loaded: " + modelName);
    const root = skeletonClone(proto); // proper clone for skinned meshes
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
  play(name, { fade = 0.2, once = false, timeScale = 1 } = {}) {
    if (this.currentName === name) return this.current;
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

// ---------------------------------------------------------------------------
// Swappable model registry. To change which 3D model represents a hero class
// or an enemy, edit MODELS / enemyModelKey() here — nothing else needs to know.
// Skeletons are a temporary stand-in for all enemies (all share Rig_Medium, so
// the same clip library animates them).
export const MODELS = {
  // player classes
  "class:warrior": { url: "KayKit Adventurers/Characters/gltf/Knight.glb",  scale: 1.76 },
  "class:mage":    { url: "KayKit Adventurers/Characters/gltf/Mage.glb",    scale: 1.76 },
  "class:ranger":  { url: "KayKit Adventurers/Characters/gltf/Ranger.glb",  scale: 1.76 },
  "class:rogue":   { url: "KayKit Adventurers/Characters/gltf/Rogue.glb",   scale: 1.76 },
  // enemies — KayKit Skeletons (temporary; swap freely)
  "enemy:default": { url: "KayKit Skeletons/characters/gltf/Skeleton_Minion.glb",  scale: 1.6 },
  "enemy:warrior": { url: "KayKit Skeletons/characters/gltf/Skeleton_Warrior.glb", scale: 1.7 },
  "enemy:rogue":   { url: "KayKit Skeletons/characters/gltf/Skeleton_Rogue.glb",   scale: 1.6 },
  "enemy:mage":    { url: "KayKit Skeletons/characters/gltf/Skeleton_Mage.glb",    scale: 1.6 },
};

// Map a hero classKey -> registry key (falls back to warrior/Knight).
export function classModelKey(classKey) {
  const k = "class:" + classKey;
  return MODELS[k] ? k : "class:warrior";
}

// Map an enemy kind string -> registry key. Pure routing; edit freely.
export function enemyModelKey(kind = "") {
  if (/mage|warlock|necromancer|shaman|shade/i.test(kind)) return "enemy:mage";
  if (/arch|rogue|bomber|bomb/i.test(kind))                return "enemy:rogue";
  if (/zombie|berserker|brute|warrior|melee|goblin/i.test(kind)) return "enemy:warrior";
  return "enemy:default";
}

// Shared clip names per logical animation state (Rig_Medium clip library).
export const ANIM = {
  idle: "Idle_A", walk: "Walking_A", run: "Running_A",
  attack: "Melee_1H_Attack_Chop", hit: "Hit_A", death: "Death_A", spawn: "Spawn_Ground",
};

// Drives a pool of Characters from a per-frame list of placement items. Each
// item: { entity, modelKey, x, z, rotationY, clip, once }. Entities not present
// in a sync() call are removed from the scene.
export class CharacterManager {
  constructor(scene, factory) {
    this.scene = scene;
    this.factory = factory;
    this.chars = new Map(); // entity -> Character
  }

  // Preload the clip library + every registry model. Resilient: a single bad
  // model is logged and skipped rather than disabling all characters.
  async preloadAll() {
    await this.factory.loadClips();
    console.log("char3d: clips loaded:", this.factory.clips.size);
    const entries = Object.entries(MODELS);
    const results = await Promise.allSettled(
      entries.map(([k, c]) => this.factory.loadModelByKey(k, c.url))
    );
    results.forEach((r, i) => {
      if (r.status === "rejected") console.error("char3d: model FAILED", entries[i][0], entries[i][1].url, r.reason);
    });
    console.log("char3d: models loaded", results.filter((r) => r.status === "fulfilled").length, "/", entries.length);
    return this;
  }

  sync(items, dt) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.entity);
      let ch = this.chars.get(it.entity);
      if (!ch) {
        if (!this.factory.protos.has(it.modelKey)) continue; // not loaded yet
        ch = this.factory.spawn(it.modelKey);
        ch.root.scale.setScalar((MODELS[it.modelKey] || { scale: 1 }).scale);
        this.scene.add(ch.root);
        this.chars.set(it.entity, ch);
      }
      ch.root.position.set(it.x, 0, it.z);
      ch.root.rotation.y = it.rotationY;
      ch.play(it.clip, { once: it.once });
      ch.update(dt);
    }
    for (const [ent, ch] of this.chars) {
      if (!seen.has(ent)) { this.scene.remove(ch.root); this.chars.delete(ent); }
    }
  }
}
