"use strict";
// Entry point. index.html loads this one module instead of a hand-ordered list
// of 15 classic <script> tags; the import graph below is the load order, and it
// is declared by the files themselves rather than by tag position in the HTML.
//
// Modules still being converted are pulled in for their side effects (they
// populate window.DD from an IIFE, exactly as they did as classic scripts).
// Import statements evaluate in source order, so this list reproduces the old
// tag order precisely.
import "./util.js?v=__BUILD__";
import "./sprites.js?v=__BUILD__";
import "./audio.js?v=__BUILD__";
import "./input.js?v=__BUILD__";
import "./particles.js?v=__BUILD__";
import "./net.js?v=__BUILD__";
import "./room.js?v=__BUILD__";
import "./floor.js?v=__BUILD__";
import "./entities.js?v=__BUILD__";
import "./profile.js?v=__BUILD__";
import "./stats.js?v=__BUILD__";
import "./items.js?v=__BUILD__";
import "./hud.js?v=__BUILD__";
import "./game3d.js?v=__BUILD__";
import "./game.js?v=__BUILD__";
