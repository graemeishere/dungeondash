"use strict";
// The handful of DOM nodes more than one module touches. Everything else keeps
// its own inline document.getElementById where it is used - centralizing all 70
// of them would be churn without a reader.

export const canvas = document.getElementById("game");
export const ctx = canvas.getContext("2d");

export const menuEl = document.getElementById("menu");
export const resultEl = document.getElementById("result");
export const resultTitle = document.getElementById("result-title");
export const resultStats = document.getElementById("result-stats");
export const levelupEl = document.getElementById("levelup");
export const upgradeCardsEl = document.getElementById("upgrade-cards");
export const continueBtn = document.getElementById("btn-continue");
export const hubEl = document.getElementById("hub");
