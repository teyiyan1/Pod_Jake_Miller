(() => {
  const root = document.documentElement;
  const background = document.querySelector("#ambient-cover");
  if (!background) return;

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const layers = [...background.querySelectorAll(".ambient-layer")];
  const partiesArtwork = "https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/87/c1/e4/87c1e4a0-4cde-c332-b995-c06a2146d0a0/888915434383_cover.jpg/600x600bb.jpg";
  let playing = false;
  let dragging = false;

  function paintSound() {
    root.style.setProperty("--ambient-energy", "0");
    root.style.setProperty("--ambient-bass", "0");
    root.style.setProperty("--ambient-hit", "0");
  }

  function setPartiesArtwork() {
    layers.forEach(layer => {
      const flow = layer.querySelector(".ambient-flow");
      if (flow) flow.style.backgroundImage = `url(${JSON.stringify(partiesArtwork)})`;
      layer.style.setProperty("--light-1", "150, 78, 62");
      layer.style.setProperty("--light-2", "86, 70, 92");
      layer.style.setProperty("--light-3", "42, 82, 96");
      layer.style.setProperty("--light-x-1", "22%");
      layer.style.setProperty("--light-y-1", "28%");
      layer.style.setProperty("--light-x-2", "78%");
      layer.style.setProperty("--light-y-2", "58%");
      layer.style.setProperty("--light-x-3", "38%");
      layer.style.setProperty("--light-y-3", "84%");
      layer.style.setProperty("--drift-duration", "27s");
    });
    background.dataset.artwork = "Parties";
    background.dataset.artworkSource = partiesArtwork;
  }

  function updateMotion() {
    const visible = playing && !document.hidden;
    const active = visible && !reducedMotion.matches && !dragging;
    root.dataset.ambientPlaying = String(visible);
    root.dataset.ambientMotion = active ? "running" : "paused";
    root.dataset.ambientDragging = String(dragging);
    root.dataset.ambientAudio = "atmosphere";
    if (!active) paintSound();
  }

  reducedMotion.addEventListener("change", updateMotion);
  document.addEventListener("visibilitychange", updateMotion);
  setPartiesArtwork();
  updateMotion();

  window.encoreAmbient = {
    setTrack() {
      // The artwork stays on Parties so every song shares one visual language.
      setPartiesArtwork();
      playing = false;
      updateMotion();
    },
    setPlaying(value) {
      playing = Boolean(value);
      updateMotion();
    },
    setDragging(value) {
      dragging = Boolean(value);
      updateMotion();
    }
  };
})();
