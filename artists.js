(() => {
  const root = document.documentElement;
  const home = document.querySelector("#artist-home");
  const room = document.querySelector(".listening-room");
  const header = document.querySelector(".topbar");
  let visited = false;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const overlay = document.createElement("div");
  overlay.className = "room-transition";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `<canvas></canvas>`;
  document.body.append(overlay);
  const draw = window.createRoomRipple?.(overlay.querySelector("canvas"));
  if (!draw) overlay.classList.add("ripple-fallback");
  let frame = 0;
  let clickOrigin = null;
  document.addEventListener("click", event => {
    const link = event.target.closest('a[href="#jake-miller"], a[href="#artists"]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const box = link.getBoundingClientRect();
    clickOrigin = event.detail ? { x: event.clientX / innerWidth, y: event.clientY / innerHeight }
      : { x: (box.left + box.width / 2) / innerWidth, y: (box.top + box.height / 2) / innerHeight };
  });

  function showView(focus = true) {
    const inRoom = location.hash === "#jake-miller";
    root.dataset.view = inRoom ? "room" : "artists";
    home.inert = inRoom;
    room.inert = !inRoom;
    header.inert = !inRoom;
    document.title = inRoom ? "Jake Miller · Listening Room" : "Encore · Artist Rooms";
    document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
    visited ||= inRoom;
    document.querySelector("#return-room").hidden = !visited;
    window.scrollTo(0, 0);
    if (inRoom) {
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
    if (focus) {
      (inRoom ? document.querySelector(".room-back") : document.querySelector("#enter-jake")).focus({ preventScroll: true });
    }
  }

  function finish() {
    cancelAnimationFrame(frame);
    overlay.hidden = true;
    delete root.dataset.transitioning;
    showView();
  }

  function transition() {
    cancelAnimationFrame(frame);
    const entering = location.hash === "#jake-miller";
    const target = entering ? "room" : "artists";
    const origin = clickOrigin || { x: .5, y: .5 };
    clickOrigin = null;
    if (reducedMotion.matches || root.dataset.view === target) return finish();
    const duration = entering ? 1450 : 780;
    const started = performance.now();
    let switched = false;
    overlay.hidden = false;
    overlay.style.opacity = "0";
    root.dataset.transitioning = "true";
    home.inert = room.inert = header.inert = true;
    function tick(now) {
      const p = Math.min((now - started) / duration, 1);
      const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
      overlay.style.opacity = String(smooth(p / .19) * (1 - smooth((p - .68) / .32)));
      draw?.(p, origin, !entering);
      if (p >= .56 && !switched) { showView(false); home.inert = room.inert = header.inert = true; switched = true; }
      if (p < 1) frame = requestAnimationFrame(tick);
      else finish();
    }
    frame = requestAnimationFrame(tick);
  }
  window.addEventListener("hashchange", transition);
  reducedMotion.addEventListener("change", () => { if (reducedMotion.matches && !overlay.hidden) finish(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && !overlay.hidden) finish(); });
  document.addEventListener("keydown", event => {
    if (!overlay.hidden && (event.code === "Space" || event.key.startsWith("Arrow") || event.key === "Tab")) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  showView(false);
})();
