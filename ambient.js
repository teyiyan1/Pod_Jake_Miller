(() => {
  const root = document.documentElement;
  const background = document.querySelector("#ambient-cover");
  if (!background) return;

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const artistId = window.ENCORE_LIBRARY_ID || "jake-miller";
  const artistBackgrounds = {
    "jake-miller": "./artwork/artists/jake-miller.jpg",
    "justin-bieber": "./artwork/artists/justin-bieber.jpg",
    "christian-kuria": "./artwork/artists/christian-kuria.jpg",
    "the-weeknd": "./artwork/artists/the-weeknd.jpg",
    keshi: "./artwork/artists/keshi.jpg",
    sza: "./artwork/artists/sza.jpg",
    "jhene-aiko": "./artwork/artists/jhene-aiko.jpg",
    laufey: "./artwork/artists/laufey.jpg",
    "fujii-kaze": "./artwork/artists/fujii-kaze.jpg"
  };
  background.style.setProperty("--artist-background", `url("${artistBackgrounds[artistId] || artistBackgrounds["jake-miller"]}")`);
  // Jake's room keeps its original muted Parties video; other rooms use their own artist portrait.
  const sharedVideoId = "oCkufmjcy3I";
  const useSharedVideo = artistId === "jake-miller";
  let playing = false;
  let dragging = false;
  let player = null;
  let ready = false;
  let mounted = false;
  let failed = false;
  let generation = 0;
  let poll = 0;
  let timeout = 0;

  if (useSharedVideo) background.dataset.videoId = sharedVideoId;
  background.dataset.videoState = useSharedVideo ? "idle" : "image";

  const canMove = () => !document.hidden && !reducedMotion.matches && !dragging;

  function clearTimers() {
    clearInterval(poll);
    clearTimeout(timeout);
    poll = timeout = 0;
  }

  function removeVideo() {
    generation++;
    clearTimers();
    player?.destroy();
    player = null;
    ready = mounted = false;
    background.replaceChildren();
  }

  function failVideo(state, code) {
    removeVideo();
    failed = true;
    background.dataset.videoState = state;
    if (code !== undefined) background.dataset.videoError = String(code);
  }

  function armTimeout(token) {
    if (timeout) return;
    timeout = setTimeout(() => {
      if (token === generation) failVideo("unavailable", "timeout");
    }, 20000);
  }

  function syncPlayer() {
    if (!ready || !player) return;
    if (playing && canMove()) {
      player.mute();
      armTimeout(generation);
      player.playVideo();
    } else {
      clearTimeout(timeout);
      timeout = 0;
      player.pauseVideo();
      background.dataset.videoState = "paused";
    }
  }

  function mountVideo() {
    if (!useSharedVideo || mounted || failed || !canMove()) return;
    mounted = true;
    const token = ++generation;
    background.dataset.videoState = "loading";
    delete background.dataset.videoError;
    armTimeout(token);
    const initialize = () => {
      if (token !== generation || !window.YT?.Player) return;
      clearInterval(poll);
      poll = 0;
      const host = document.createElement("div");
      background.append(host);
      const origin = /^https?:$/.test(location.protocol) ? { origin: location.origin } : {};
      player = new window.YT.Player(host, {
        videoId: sharedVideoId,
        playerVars: {
          autoplay: 0, mute: 1, controls: 0, disablekb: 1,
          playsinline: 1, loop: 1, playlist: sharedVideoId, rel: 0, fs: 0,
          ...origin
        },
        events: {
          onReady(event) {
            if (token !== generation) return;
            const iframe = event.target.getIframe();
            iframe.title = "Parties background video";
            iframe.tabIndex = -1;
            iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
            iframe.setAttribute("playsinline", "");
            ready = true;
            event.target.mute();
            syncPlayer();
          },
          onStateChange(event) {
            if (token !== generation) return;
            if (event.data === 1) {
              clearTimeout(timeout);
              timeout = 0;
              if (!playing || !canMove()) {
                syncPlayer();
                return;
              }
              background.dataset.videoState = "playing";
            } else if (event.data === 0 && playing && canMove()) {
              player.seekTo(0, true);
              player.playVideo();
            }
          },
          onError(event) {
            if (token === generation) failVideo("unavailable", event.data);
          },
          onAutoplayBlocked() {
            if (token === generation) failVideo("blocked", "autoplay");
          }
        }
      });
    };
    // The main audio player owns loading the shared YouTube API.
    poll = setInterval(initialize, 100);
    initialize();
  }

  function updateMotion() {
    const visible = playing && !document.hidden;
    const active = playing && canMove();
    root.dataset.ambientPlaying = String(visible);
    root.dataset.ambientMotion = active ? "running" : "paused";
    root.dataset.ambientDragging = String(dragging);
    if (active && !mounted) mountVideo();
    syncPlayer();
  }

  reducedMotion.addEventListener("change", updateMotion);
  document.addEventListener("visibilitychange", updateMotion);
  window.encoreAmbient = {
    // Prepare the muted inline player in the playback gesture on mobile.
    // Actual video playback still waits for the active audio provider to start.
    preparePlayback() {
      if (failed) {
        failed = false;
        background.dataset.videoState = "idle";
      }
      mountVideo();
    },
    setTrack() {
      playing = false;
      updateMotion();
    },
    setPlaying(value) {
      const next = Boolean(value);
      if (next && !playing) failed = false;
      playing = next;
      updateMotion();
    },
    setDragging(value) {
      dragging = Boolean(value);
      updateMotion();
    }
  };
  updateMotion();
})();
