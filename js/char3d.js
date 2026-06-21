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
const ANIM = "KayKit Character Animations/Animations/gltf/Rig_Medium/";
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
      ANIM_PACKS.map((f) => this.loader.loadAsync(encodeURI(ANIM + "Rig_Medium_" + f + ".glb")))
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
