(function () {
  const SDK_URL = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
  let music = null;
  let state = "idle";
  let initialization = null;

  function announce(detail) {
    window.dispatchEvent(new CustomEvent("encore:apple-music", { detail }));
  }

  function playbackName(value) {
    if (typeof value === "string") {
      const normalized = value.toLowerCase();
      if (normalized.includes("play") && !normalized.includes("pause")) return "playing";
      if (normalized.includes("pause") || normalized.includes("stop") || normalized === "none") return "paused";
      if (normalized.includes("end") || normalized.includes("complete")) return "ended";
      if (["loading", "waiting", "seeking", "stalled"].some((name) => normalized.includes(name))) return "loading";
    }

    const states = window.MusicKit?.PlaybackStates || window.MusicKit?.PlayerPlaybackStates || {};
    for (const [name, code] of Object.entries(states)) {
      if (code === value) return playbackName(name);
    }

    const numeric = Number(value);
    if (numeric === 2) return "playing";
    if (numeric === 3 || numeric === 4) return "paused";
    if (numeric === 5 || numeric === 9) return "ended";
    if (numeric === 1 || numeric === 6 || numeric === 7 || numeric === 8) return "loading";
    return "unknown";
  }

  function listen(eventName, handler) {
    const name = window.MusicKit?.Events?.[eventName] || eventName;
    music.addEventListener(name, handler);
  }

  function loadSdk() {
    if (window.MusicKit?.configure) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onLoaded = () => resolve();
      const onError = () => reject(new Error("Could not load the Apple MusicKit library."));
      document.addEventListener("musickitloaded", onLoaded, { once: true });
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onerror = onError;
      document.head.append(script);
    });
  }

  async function initialize() {
    if (initialization) return initialization;
    state = "loading";
    initialization = (async () => {
      try {
        const response = await fetch("/api/apple-music-token", { cache: "no-store" });
        const configuration = await response.json();
        if (!response.ok) throw new Error(configuration.error || "Apple Music credentials need attention.");
        if (!configuration.configured || !configuration.developerToken) {
          state = "needs-setup";
          announce({ type: "setup-needed" });
          return false;
        }

        await loadSdk();
        await window.MusicKit.configure({
          developerToken: configuration.developerToken,
          app: { name: "Jake Miller Listening Room", build: "1.5.0" }
        });
        music = window.MusicKit.getInstance();
        listen("playbackStateDidChange", (event) => {
          announce({ type: "playback", state: playbackName(event?.state ?? music.playbackState) });
        });
        listen("mediaPlaybackError", (event) => {
          announce({
            type: "error",
            message: event?.error?.message || event?.message || "Apple Music could not play this track."
          });
        });
        state = "ready";
        announce({ type: "ready", authorized: Boolean(music.isAuthorized) });
        return true;
      } catch (error) {
        state = "error";
        initialization = null;
        announce({ type: "initialization-error", message: error.message });
        return false;
      }
    })();
    return initialization;
  }

  async function connect() {
    if (state !== "ready" && !(await initialize())) return false;
    if (!music.isAuthorized) await music.authorize();
    announce({ type: "authorized", authorized: Boolean(music.isAuthorized) });
    return Boolean(music.isAuthorized);
  }

  async function play(track) {
    if (state !== "ready") throw new Error("Apple MusicKit is not configured yet.");
    if (!music.isAuthorized) await music.authorize();
    const songId = track.appleMusicId || track.id;
    await music.setQueue({ song: String(songId) });
    await music.play();
  }

  async function resume() {
    if (!music) throw new Error("Apple MusicKit is not ready.");
    await music.play();
  }

  function pause() {
    music?.pause();
  }

  function setMuted(muted) {
    if (music && "volume" in music) music.volume = muted ? 0 : 1;
  }

  window.EncAppleMusic = {
    connect,
    initialize,
    isAuthorized: () => Boolean(music?.isAuthorized),
    isReady: () => state === "ready",
    pause,
    play,
    playbackTime: () => Number(music?.playbackTime) || 0,
    readyState: () => state,
    resume,
    setMuted
  };

  initialize();
})();
