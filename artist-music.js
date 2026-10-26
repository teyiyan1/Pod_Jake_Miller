(() => {
  const button = document.querySelector("#artist-sound");
  const status = document.querySelector("#artist-music-status");
  const storageKey = "encore-artist-intro-enabled";
  // Official iTunes catalog preview, not a full-track download.
  const audio = new Audio("https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/4a/1d/e9/4a1de930-f0f2-484c-eea9-7d46bcd89de8/mzaf_11582686532983847296.plus.aac.p.m4a");
  audio.loop = true;
  audio.preload = "none";
  audio.volume = .18;
  let enabled = true;
  try { enabled = localStorage.getItem(storageKey) !== "false"; } catch {}
  let roomBusy = ["pause", "loading"].includes(document.querySelector("#play-toggle")?.dataset.action);
  let blocked = false;
  let pending = false;
  let failed = false;
  let generation = 0;
  let fade = 0;
  const onWall = () => !location.hash || location.hash === "#artists";
  const allowed = () => enabled && onWall() && !roomBusy && !document.hidden;

  function render() {
    const playing = !audio.paused && !blocked && !failed;
    button.disabled = roomBusy;
    button.setAttribute("aria-pressed", String(playing));
    button.querySelector("span").textContent = roomBusy ? "Room audio" : pending ? "Cancel" : playing ? "Sound off" : "Sound on";
    button.title = roomBusy ? "Your song is playing — use the room controls" : playing ? "Turn off opening music" : "Play The xx — Intro (preview)";
    status.textContent = failed ? "PREVIEW UNAVAILABLE · TAP SOUND ON TO RETRY" : pending ? "LOADING INTRO…" : playing ? "THE XX · INTRO · PREVIEW ↻" : "THE XX · INTRO · PREVIEW";
  }

  function stop(soft = false) {
    generation++;
    pending = false;
    cancelAnimationFrame(fade);
    if (!soft || audio.paused || document.hidden) {
      audio.pause();
      audio.volume = .18;
      render();
      return;
    }
    const started = performance.now();
    const volume = audio.volume;
    function tick(now) {
      const progress = Math.min(1, (now - started) / 850);
      audio.volume = volume * (1 - progress);
      if (progress < 1) fade = requestAnimationFrame(tick);
      else { audio.pause(); audio.volume = .18; render(); }
    }
    fade = requestAnimationFrame(tick);
  }

  function start(userGesture = false) {
    if (!allowed() || pending || (blocked && !userGesture) || (failed && !userGesture)) return render();
    cancelAnimationFrame(fade);
    audio.volume = .18;
    if (!audio.paused) return render();
    const token = ++generation;
    pending = true;
    failed = blocked = false;
    if (audio.error) audio.load();
    render();
    audio.play().then(() => {
      if (token !== generation) { if (!allowed()) audio.pause(); return; }
      pending = false;
      if (!allowed()) stop();
      else render();
    }).catch(error => {
      if (token !== generation) return;
      pending = false;
      blocked = error.name === "NotAllowedError";
      failed = !blocked && error.name !== "AbortError";
      render();
    });
  }

  button.addEventListener("click", () => {
    if (roomBusy) return;
    enabled = pending || !audio.paused ? false : true;
    try { localStorage.setItem(storageKey, String(enabled)); } catch {}
    if (enabled) start(true); else stop();
  });
  audio.addEventListener("playing", () => { if (!allowed()) stop(); else { pending = false; render(); } });
  audio.addEventListener("error", () => { failed = true; stop(); });
  window.addEventListener("hashchange", () => { if (onWall()) start(); else stop(true); });
  window.addEventListener("encore:playback", event => {
    roomBusy = event.detail.busy;
    if (roomBusy) stop(); else start();
    render();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else start(); });
  window.addEventListener("pagehide", () => stop());
  render();
  start();
})();
