"use strict";
// URL flags. One place parses location.search so the rules about which flags
// are honoured live in one file rather than in whichever module happened to
// need one.

export const params = new URLSearchParams(location.search);
// freeze + disarm enemies for tweaking (?safe, or implied by ?camtest)
export const safeMode = params.has("camtest") || params.has("safe");
// Dungeons descend into connected floors by default; ?classic forces the old
// single-room-per-room run (kept as an escape hatch / comparison path).
export const classicRun = params.has("classic");
