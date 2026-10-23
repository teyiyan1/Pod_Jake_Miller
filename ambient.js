(() => {
  const root = document.documentElement;
  const background = document.querySelector("#ambient-cover");
  if (!background) return;
  // Mobile WebViews can suspend Web Audio in the background. Keep the media
  // element on its native output there so background playback remains possible.
  const useReactiveAudio = !(/Android|iPhone|iPad|iPod|MicroMessenger/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const layers = [...background.querySelectorAll(".ambient-layer")];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const cache = new Map();
  const audioGraphs = new WeakMap();
  let selectedArtwork = "";
  let visibleLayer = 0;
  let playing = false;
  let dragging = false;
  let audioContext = null;
  let attachedAudio = null;
  let analyser = null;
  let spectrum = null;
  let waveform = null;
  let frame = 0;
  let lastFrame = 0;
  let energy = 0;
  let bass = 0;
  let hit = 0;
  let previousBass = 0;

  function paintSound() {
    root.style.setProperty("--ambient-energy", energy.toFixed(3));
    root.style.setProperty("--ambient-bass", bass.toFixed(3));
    root.style.setProperty("--ambient-hit", hit.toFixed(3));
  }

  function sampleSound(now) {
    frame = requestAnimationFrame(sampleSound);
    if (now - lastFrame < 32) return;
    lastFrame = now;
    analyser.getByteFrequencyData(spectrum);
    analyser.getFloatTimeDomainData(waveform);
    let power = 0;
    for (const value of waveform) power += value * value;
    const rms = Math.sqrt(power / waveform.length);
    const nextEnergy = rms / (.22 + rms);
    // Bass energy, rather than a fixed timer, controls the size of the light pools.
    const binHz = audioContext.sampleRate / analyser.fftSize;
    let low = 0;
    let count = 0;
    for (let i = Math.max(1, Math.ceil(35 / binHz)); i <= Math.floor(190 / binHz); i++) {
      low += (spectrum[i] / 255) ** 2;
      count++;
    }
    const nextBass = count ? Math.sqrt(low / count) : 0;
    energy += (nextEnergy - energy) * (nextEnergy > energy ? .42 : .1);
    bass += (nextBass - bass) * (nextBass > bass ? .5 : .12);
    hit = Math.max(hit * .8, Math.min(1, (nextBass - previousBass) * 4));
    previousBass = nextBass;
    paintSound();
  }

  function updateMotion() {
    const active = playing && !document.hidden && !reducedMotion.matches && !dragging;
    root.dataset.ambientMotion = active ? "running" : "paused";
    root.dataset.ambientPlaying = String(playing && !document.hidden);
    root.dataset.ambientDragging = String(dragging);
    root.dataset.ambientAudio = analyser && audioContext?.state === "running" ? "reactive" : "atmosphere";
    cancelAnimationFrame(frame);
    frame = 0;
    if (active && analyser && audioContext.state === "running") {
      lastFrame = 0;
      frame = requestAnimationFrame(sampleSound);
    } else {
      energy = bass = hit = previousBass = 0;
      paintSound();
    }
  }

  async function attachAudio(audio) {
    attachedAudio = audio;
    if (!useReactiveAudio) {
      analyser = spectrum = waveform = null;
      updateMotion();
      return;
    }
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioContext) {
        audioContext = new AudioContextClass();
        audioContext.addEventListener("statechange", updateMotion);
      }
      // Resume in the play-button gesture, before creating any media source. If
      // Web Audio is unavailable, the media element keeps its normal output.
      if (audioContext.state !== "running") await audioContext.resume();
      if (attachedAudio !== audio || audioContext.state !== "running") return;
      let graph = audioGraphs.get(audio);
      if (!graph) {
        const meter = audioContext.createAnalyser();
        meter.fftSize = 2048;
        meter.smoothingTimeConstant = .5;
        meter.minDecibels = -80;
        meter.maxDecibels = -10;
        meter.connect(audioContext.destination);
        const source = audioContext.createMediaElementSource(audio);
        source.connect(meter);
        graph = { source, meter };
        audioGraphs.set(audio, graph);
      }
      analyser = graph.meter;
      spectrum = new Uint8Array(analyser.frequencyBinCount);
      waveform = new Float32Array(analyser.fftSize);
      updateMotion();
    } catch {
      // Local audio continues through its existing output if analysis is denied.
      updateMotion();
    }
  }

  function detachAudio() {
    const graph = attachedAudio && audioGraphs.get(attachedAudio);
    if (graph) {
      graph.source.disconnect();
      graph.meter.disconnect();
      audioGraphs.delete(attachedAudio);
    }
    attachedAudio = analyser = spectrum = waveform = null;
    updateMotion();
  }

  function sampleArtwork(url) {
    if (cache.has(url)) return cache.get(url);
    const result = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      const fallback = {
        colors: [[76, 86, 94], [92, 76, 84], [65, 88, 94]],
        positions: [[22, 28], [78, 58], [36, 84]], texture: url, duration: 28, sampled: false
      };
      const timeout = setTimeout(() => resolve(fallback), 8000);
      const finish = value => { clearTimeout(timeout); resolve(value); };
      image.onerror = () => finish(fallback);
      image.onload = () => {
        try {
          // Preserve the cover's broad shapes in a small cached texture. Color
          // centroids also place each pool where that color occurs in the art.
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 64;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0, 64, 64);
          const pixels = context.getImageData(0, 0, 64, 64).data;
          const bins = new Map();
          for (let i = 0; i < pixels.length; i += 4) {
            const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
            const high = Math.max(...rgb), low = Math.min(...rgb);
            if (pixels[i + 3] < 128 || high < 30 || low > 235) continue;
            const key = rgb.map(value => value >> 5).join(",");
            const bin = bins.get(key) || { sum: [0, 0, 0], x: 0, y: 0, count: 0, score: 0 };
            rgb.forEach((value, channel) => { bin.sum[channel] += value; });
            bin.x += (i / 4) % 64;
            bin.y += Math.floor(i / 4 / 64);
            bin.count++;
            bin.score += 1 + (high - low) / 80;
            bins.set(key, bin);
          }
          const ranked = [...bins.values()].sort((a, b) => b.score - a.score).map(bin => ({
            color: bin.sum.map(value => Math.round(value / bin.count)),
            position: [bin.x, bin.y].map(value => Math.round(12 + value / bin.count / 63 * 76))
          }));
          const chosen = [];
          for (const candidate of ranked) {
            if (chosen.every(item => item.color.reduce((distance, value, i) => distance + (value - candidate.color[i]) ** 2, 0) > 3600)) chosen.push(candidate);
            if (chosen.length === 3) break;
          }
          if (!chosen.length) chosen.push({ color: fallback.colors[0], position: fallback.positions[0] });
          while (chosen.length < 3) chosen.push(ranked[chosen.length] || chosen[0]);
          finish({
            colors: chosen.map(item => item.color), positions: chosen.map(item => item.position),
            texture: canvas.toDataURL(), duration: 24 + chosen[0].color[0] % 13, sampled: true
          });
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
    const colors = palette.colors.map(color => color.join(", "));
    layer.querySelector(".ambient-flow").style.backgroundImage =
      `linear-gradient(125deg, rgba(${colors[0]}, .22), transparent 45%, rgba(${colors[1]}, .28)), url(${JSON.stringify(palette.texture)})`;
    palette.colors.forEach((color, i) => {
      layer.style.setProperty(`--light-${i + 1}`, color.join(", "));
      layer.style.setProperty(`--light-x-${i + 1}`, `${palette.positions[i][0]}%`);
      layer.style.setProperty(`--light-y-${i + 1}`, `${palette.positions[i][1]}%`);
    });
    layer.style.setProperty("--drift-duration", `${palette.duration}s`);
    layer.style.setProperty("--breathe-duration", `${8 + palette.duration / 5}s`);
    layers.forEach((item, index) => item.classList.toggle("is-current", index === visibleLayer));
    root.style.setProperty("--cover-glow", colors[0]);
    background.dataset.artwork = url;
    background.dataset.palette = palette.colors.map(color => color.join(",")).join(";");
    background.dataset.paletteSource = palette.sampled ? "artwork" : "fallback";
  }

  reducedMotion.addEventListener("change", updateMotion);
  document.addEventListener("visibilitychange", updateMotion);
  updateMotion();
  window.encoreAmbient = {
    setTrack, attachAudio, detachAudio,
    setPlaying(value) { playing = Boolean(value); updateMotion(); },
    setDragging(value) { dragging = Boolean(value); updateMotion(); }
  };
})();
