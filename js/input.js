"use strict";
(function (DD) {
  const keys = {};
  const mouse = { x: DD.WIDTH / 2, y: DD.HEIGHT / 2, down: false };

  DD.input = {
    keys,
    mouse,

    init(canvas) {
      window.addEventListener("keydown", (e) => {
        keys[e.key.toLowerCase()] = true;
        if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) {
          e.preventDefault();
        }
        DD.audio.unlock();
      });
      window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
      window.addEventListener("blur", () => {
        for (const k of Object.keys(keys)) keys[k] = false;
        mouse.down = false;
      });

      const toCanvas = (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
        mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
      };
      canvas.addEventListener("mousemove", toCanvas);
      canvas.addEventListener("mousedown", (e) => {
        toCanvas(e);
        if (e.button === 0) mouse.down = true;
        DD.audio.unlock();
      });
      window.addEventListener("mouseup", (e) => { if (e.button === 0) mouse.down = false; });
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    },

    moveVector() {
      let dx = 0, dy = 0;
      if (keys.w || keys.arrowup) dy -= 1;
      if (keys.s || keys.arrowdown) dy += 1;
      if (keys.a || keys.arrowleft) dx -= 1;
      if (keys.d || keys.arrowright) dx += 1;
      if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
      return { dx, dy };
    },

    attacking() {
      return mouse.down || keys[" "];
    },

    dashing() {
      return keys.shift;
    },
  };
})(window.DD);
