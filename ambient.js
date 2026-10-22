(() => {
  const root = document.documentElement;
  const background = document.querySelector("#ambient-cover");
  const layers = [...background.querySelectorAll(".ambient-layer")];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const cache = new Map();
  let selectedArtwork = "";
  let visibleLayer = 0;
  let playing = false;
  let dragging = false;

  function updateMotion() {
    const active = playing && !document.hidden && !reducedMotion.matches;
    root.dataset.ambientMotion = active && !dragging ? "running" : "paused";
    root.dataset.ambientPlaying = String(playing && !document.hidden);
    root.dataset.ambientDragging = String(dragging);
  }

  function sampleArtwork(url) {
    if (cache.has(url)) return cache.get(url);
    const result = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      const fallback = { colors: [[76, 86, 94], [92, 76, 84]], texture: url, sampled: false };
      const timeout = setTimeout(() => resolve(fallback), 8000);
      const finish = value => { clearTimeout(timeout); resolve(value); };
      image.onerror = () => finish(fallback);
      image.onload = () => {
        try {
          // One small sample per artwork; no pixel reads in the animation loop.
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 32;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0, 32, 32);
          const pixels = context.getImageData(0, 0, 32, 32).data;
          const bins = new Map();
          for (let i = 0; i < pixels.length; i += 4) {
            const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
            const high = Math.max(...rgb), low = Math.min(...rgb);
            if (pixels[i + 3] < 128 || high < 45 || low > 225) continue;
            const key = rgb.map(value => value >> 5).join(",");
            const bin = bins.get(key) || { sum: [0, 0, 0], count: 0, score: 0 };
            rgb.forEach((value, channel) => { bin.sum[channel] += value; });
            bin.count++;
            bin.score += 1 + (high - low) / 65;
            bins.set(key, bin);
          }
          const ranked = [...bins.values()].sort((a, b) => b.score - a.score)
            .map(bin => bin.sum.map(value => Math.round(value / bin.count)));
          const first = ranked[0] || fallback.colors[0];
          const second = ranked.find(color => color.reduce((distance, value, i) => distance + (value - first[i]) ** 2, 0) > 6500)
            || ranked[1] || first;
          finish({ colors: [first, second], texture: canvas.toDataURL(), sampled: true });
        } catch {
          finish(fallback);
        }
      };
      image.src = url;
    });
    cache.set(url, result);
    return result;
  }

  async function setTrack(track) {
    if (track.artwork === selectedArtwork) return;
    const url = selectedArtwork = track.artwork;
    const palette = await sampleArtwork(url);
    if (url !== selectedArtwork) return;
    visibleLayer = 1 - visibleLayer;
    const layer = layers[visibleLayer];
    const [primary, secondary] = palette.colors.map(color => color.join(", "));
    layer.querySelector(".ambient-flow").style.backgroundImage =
      `linear-gradient(115deg, rgba(${primary}, .6), transparent 48%, rgba(${secondary}, .65)), url("${palette.texture}")`;
    layers.forEach((item, index) => item.classList.toggle("is-current", index === visibleLayer));
    root.style.setProperty("--cover-glow", primary);
    background.dataset.artwork = url;
    background.dataset.palette = palette.colors.map(color => color.join(",")).join(";");
    background.dataset.paletteSource = palette.sampled ? "artwork" : "fallback";
  }

  reducedMotion.addEventListener("change", updateMotion);
  document.addEventListener("visibilitychange", updateMotion);
  updateMotion();
  window.encoreAmbient = {
    setTrack,
    setPlaying(value) { playing = Boolean(value); updateMotion(); },
    setDragging(value) { dragging = Boolean(value); updateMotion(); }
  };
})();
