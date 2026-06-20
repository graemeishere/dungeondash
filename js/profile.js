"use strict";
(function (DD) {
  const PROFILE_KEY = "dungeondash_profile_v2";
  const PROFILE_VERSION = 3;

  function makeHero(classKey) {
    return {
      id: "h" + Date.now() + Math.floor(Math.random() * 9999),
      classKey,
      level: 1,
      xp: 0,
      gold: 0,
      attrPoints: 0,
      attrs: { might: 0, agility: 0, focus: 0, vitality: 0 },
      equipped: { weapon: null, armor: null, trinket: null },
      inventory: [],
      stash: [],
      kills: 0,
      deaths: 0,
    };
  }

  // quests: active = accepted (max ACTIVE_CAP), completed = ids done.
  // The "available" pool is derived (all defs not active/completed).
  const ACTIVE_CAP = 3;
  const ABANDON_COST = 100;

  const profile = {
    version: PROFILE_VERSION,
    heroes: [],
    activeHeroId: null,
    meta: { shards: 0 },
    quests: { active: [], completed: [] },
    unlocks: {},
  };

  function save() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) { /* private browsing */ }
  }

  function migrate(raw) {
    try {
      const v1 = JSON.parse(localStorage.getItem("dungeondash_save_v1"));
      if (v1 && typeof v1.classKey === "string") {
        const hero = makeHero(v1.classKey);
        hero.level = v1.level || 1;
        hero.xp = v1.xp || 0;
        hero.gold = v1.gold || 0;
        hero.kills = v1.kills || 0;
        profile.heroes = [hero];
        profile.activeHeroId = hero.id;
      }
    } catch (e) { }
    save();
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(PROFILE_KEY));
      if (raw && Array.isArray(raw.heroes)) {
        profile.heroes = raw.heroes;
        profile.activeHeroId = raw.activeHeroId;
        profile.meta = raw.meta || { shards: 0 };
        profile.unlocks = raw.unlocks || {};
        const q = raw.quests || {};
        // v2 auto-assigned every quest to "active"; quests are now NPC-accepted,
        // so on upgrade keep completed but clear the auto-assigned active list.
        profile.quests = {
          completed: Array.isArray(q.completed) ? q.completed : [],
          active: (raw.version === PROFILE_VERSION && Array.isArray(q.active)) ? q.active : [],
        };
        if (raw.version !== PROFILE_VERSION) { profile.version = PROFILE_VERSION; save(); }
      } else {
        migrate(raw);
      }
    } catch (e) { }
  }

  function getActiveHero() {
    if (!profile.activeHeroId) return null;
    return profile.heroes.find((h) => h.id === profile.activeHeroId) || null;
  }

  function createHero(classKey) {
    const hero = makeHero(classKey);
    profile.heroes.push(hero);
    profile.activeHeroId = hero.id;
    save();
    return hero;
  }

  function getOrCreateHero(classKey) {
    const existing = profile.heroes.find((h) => h.classKey === classKey);
    if (existing) {
      profile.activeHeroId = existing.id;
      save();
      return existing;
    }
    return createHero(classKey);
  }

  function clear() {
    profile.heroes = [];
    profile.activeHeroId = null;
    save();
  }

  // ---- quests ----

  // Goal types: kills (optional faction), bossKill (dungeon id), clearDungeon
  // (dungeon id), wonRuns, repelRaid. Rewards grant gold (+ optional xp).
  const QUEST_DEFS = [
    { id: "first_blood",  title: "First Blood",   desc: "Defeat 1 enemy.",                   goal: { kills: 1 },                        reward: { gold: 20 } },
    { id: "bone_hunter",  title: "Bone Hunter",   desc: "Defeat 25 skeletons.",              goal: { kills: 25, faction: "skeleton" },  reward: { gold: 75 } },
    { id: "goblin_slayer",title: "Goblin Slayer", desc: "Defeat 25 goblins.",                goal: { kills: 25, faction: "goblin" },    reward: { gold: 80 } },
    { id: "ghost_hunter", title: "Ghost Hunter",  desc: "Defeat 20 undead.",                 goal: { kills: 20, faction: "undead" },    reward: { gold: 90 } },
    { id: "slay_king",    title: "Slay the King", desc: "Defeat the Skeleton King.",          goal: { bossKill: "catacombs" },           reward: { gold: 200, xp: 60 } },
    { id: "warlord_end",  title: "Warlord's End", desc: "Defeat the Goblin Warlord.",         goal: { bossKill: "goblinMines" },         reward: { gold: 220, xp: 70 } },
    { id: "lich_hunter",  title: "Lich Hunter",   desc: "Defeat the Lich.",                  goal: { bossKill: "crypt" },               reward: { gold: 250, xp: 90 } },
    { id: "mine_clear",   title: "Clear the Mines", desc: "Clear every floor of the Goblin Mines.", goal: { clearDungeon: "goblinMines" }, reward: { gold: 180, xp: 50 } },
    { id: "survivor",     title: "Survivor",      desc: "Complete a full dungeon run.",      goal: { wonRuns: 1 },                      reward: { gold: 120 } },
    { id: "defender",     title: "Town Defender", desc: "Repel a town raid.",                goal: { repelRaid: 1 },                    reward: { gold: 120, xp: 40 } },
  ];

  function questDef(id) { return QUEST_DEFS.find((d) => d.id === id) || null; }

  // Quests the player can still accept: not active, not completed.
  function availableQuests() {
    const active = profile.quests.active;
    const completed = profile.quests.completed;
    return QUEST_DEFS.filter((d) => !completed.includes(d.id) && !active.find((q) => q.id === d.id));
  }

  function acceptQuest(id) {
    if (profile.quests.active.length >= ACTIVE_CAP) return false;
    if (profile.quests.completed.includes(id)) return false;
    if (profile.quests.active.find((q) => q.id === id)) return false;
    if (!questDef(id)) return false;
    profile.quests.active.push({ id, progress: {} });
    save();
    return true;
  }

  // Drop an active quest for a gold fee. Returns true if abandoned.
  function abandonQuest(id, hero) {
    const idx = profile.quests.active.findIndex((q) => q.id === id);
    if (idx < 0) return false;
    if (hero && (hero.gold || 0) < ABANDON_COST) return false;
    if (hero) hero.gold -= ABANDON_COST;
    profile.quests.active.splice(idx, 1);
    save();
    return true;
  }

  // Advance accepted quests. `update` may include kills, killsByFaction, won,
  // bossKill (dungeon id), clearDungeon (dungeon id), repelRaid.
  function progressQuests(update) {
    const { kills = 0, killsByFaction = {}, won, bossKill, clearDungeon, repelRaid } = update;
    let changed = false;
    for (const q of profile.quests.active) {
      const def = questDef(q.id);
      if (!def) continue;
      const g = def.goal;
      if (g.kills) {
        const inc = g.faction ? (killsByFaction[g.faction] || 0) : kills;
        q.progress.kills = (q.progress.kills || 0) + inc;
        if (q.progress.kills >= g.kills) { completeQuest(q, def); changed = true; }
      }
      if (g.bossKill && bossKill === g.bossKill) { completeQuest(q, def); changed = true; }
      if (g.clearDungeon && clearDungeon === g.clearDungeon) { completeQuest(q, def); changed = true; }
      if (g.wonRuns && won) {
        q.progress.wonRuns = (q.progress.wonRuns || 0) + 1;
        if (q.progress.wonRuns >= g.wonRuns) { completeQuest(q, def); changed = true; }
      }
      if (g.repelRaid && repelRaid) {
        q.progress.repelRaid = (q.progress.repelRaid || 0) + 1;
        if (q.progress.repelRaid >= g.repelRaid) { completeQuest(q, def); changed = true; }
      }
    }
    profile.quests.active = profile.quests.active.filter(
      (q) => !profile.quests.completed.includes(q.id)
    );
    if (changed) save();
  }

  function completeQuest(q, def) {
    if (profile.quests.completed.includes(q.id)) return;
    profile.quests.completed.push(q.id);
    const hero = getActiveHero();
    if (hero) {
      if (def.reward.gold) hero.gold = (hero.gold || 0) + def.reward.gold;
      if (def.reward.xp) hero.xp = (hero.xp || 0) + def.reward.xp;
    }
  }

  DD.profile = {
    load,
    save,
    getActiveHero,
    createHero,
    getOrCreateHero,
    clear,
    migrate,
    data: profile,
    questDefs: QUEST_DEFS,
    questDef,
    availableQuests,
    acceptQuest,
    abandonQuest,
    progressQuests,
    ABANDON_COST,
    ACTIVE_CAP,
  };

  load();
})(window.DD = window.DD || {});
