(() => {
  const root = document.documentElement;
  const background = document.querySelector("#ambient-cover");
  if (!background) return;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  // Use Parties as the single shared visual layer for every track.
  const sharedVideoId = "oCkufmjcy3I";
  let playing = false;
  let videoId = "";
  let player = null;
  let poll = 0;
  let timeout = 0;
  let generation = 0;
  let mounted = false;

  function removeVideo() {
    generation++;
    clearInterval(poll);
    clearTimeout(timeout);
    player?.destroy();
    player = null;
    background.replaceChildren();
    background.dataset.videoState = "fallback";
    mounted = false;
  }

  function mountVideo() {
    mounted = true;
    const token = ++generation;
    background.dataset.videoState = "loading";
    const fail = () => {
      if (token !== generation) return;
      removeVideo();
      // Retry only after another playback/visibility change.
      mounted = true;
    };
    timeout = setTimeout(fail, 15000);
    const initialize = () => {
      if (token !== generation || !window.YT?.Player) return;
      clearInterval(poll);
      const host = document.createElement("div");
      background.append(host);
      player = new window.YT.Player(host, {
        videoId,
        playerVars: {
          autoplay: 1, mute: 1, controls: 0, disablekb: 1,
          playsinline: 1, loop: 1, playlist: videoId, rel: 0, fs: 0,
          origin: location.origin
        },
        events: {
          onReady(event) {
            if (token !== generation) return;
            const iframe = event.target.getIframe();
            iframe.title = "Background video";
            iframe.tabIndex = -1;
            event.target.mute();
            event.target.playVideo();
          },
          onStateChange(event) {
            if (token !== generation) return;
            if (event.data === 1) {
              clearTimeout(timeout);
              background.dataset.videoState = "playing";
            }
          },
          onError: fail
        }
      });
    };
    // Reuse the main player's API script without replacing its ready callback.
    poll = setInterval(initialize, 100);
    initialize();
  }

  function updateMotion() {
    const visible = playing && !document.hidden;
    const active = visible && !reducedMotion.matches;
    root.dataset.ambientPlaying = String(visible);
    root.dataset.ambientMotion = active ? "running" : "paused";
    if (active && videoId) {
      if (!mounted) mountVideo();
    } else if (mounted) {
      removeVideo();
    }
  }

  reducedMotion.addEventListener("change", updateMotion);
  document.addEventListener("visibilitychange", updateMotion);
  window.encoreAmbient = {
    setTrack() {
      const next = sharedVideoId;
      if (next !== videoId) {
        removeVideo();
        videoId = next;
      }
      // Track selection must not start the decorative video before audio plays.
      playing = false;
      updateMotion();
    },
    setPlaying(value) { playing = Boolean(value); updateMotion(); },
    setDragging(value) { root.dataset.ambientDragging = String(Boolean(value)); }
  };
  updateMotion();
})();
