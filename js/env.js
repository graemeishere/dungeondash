"use strict";
// URL flags. One place parses location.search so the rules about which flags
// are honoured live in one file rather than in whichever module needed one.

export const params = new URLSearchParams(location.search);

// Development-only flags are honoured on a dev host and nowhere else.
//
// ?safe skips every enemy's update(), which also stalls the spawn queue, while
// leaving the player's attacks live - on the deployed site that let anyone farm
// kills, XP, gold, quest progress and dungeon clears at zero risk. ?dev=combat
// drops straight into a combat room past every menu. Neither was ever meant to
// ship; there is no build step to strip them, so the gate is a runtime one.
//
// A hostname allowlist rather than a build-stamped constant, because the two
// fail in opposite directions. Testing "is the 428b9b89 token still literal"
// fails OPEN: if the deploy sed ever misses a file, the shipped build looks
// un-stamped, reads as "not production", and quietly re-opens the exploit this
// gate exists to close. An unrecognised hostname fails CLOSED. That is not a
// free win - if this check is ever deleted or miscoded the regression is silent
// rather than loud - but deny-by-default is the safer of the two directions.
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", ""]);
export const devFlagsAllowed =
  DEV_HOSTS.has(location.hostname) || location.protocol === "file:";

// Honour a dev flag only on a dev host, and say so when we don't: a developer
// on an unexpected hostname gets an explanation instead of behaviour that
// silently differs from what they asked for.
function devFlag(name) {
  if (!params.has(name)) return false;
  if (!devFlagsAllowed) {
    console.warn(`?${name} ignored — dev flags are only honoured on a dev host ` +
      `(this is ${location.hostname || location.protocol})`);
    return false;
  }
  return true;
}

// freeze + disarm enemies for tweaking (?safe, or implied by ?camtest).
// Gating the derived flag rather than the ?safe name means ?camtest's
// enemy-freeze side effect is gated identically; camtest's other effects (the
// on-screen tuning buttons and readout) are cosmetic and stay ungated.
export const safeMode = devFlag("camtest") || devFlag("safe");

// ?dev=combat drops straight into a solo combat room past every menu.
export const devBoot = devFlag("dev") ? params.get("dev") : null;

// ?floors boots a connected-floor run — the only traversal system now that
// Phase 1 retired the classic single-room path and ?classic. Deliberately
// UNGATED: the roadmap's decision log names only ?safe and ?dev, and this is
// not an exploit surface - it starts an ordinary tier-0 run that the dungeon
// lobby reaches anyway, disabling nothing.
export const floorsBoot = params.has("floors");

