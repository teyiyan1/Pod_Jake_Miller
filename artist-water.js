// A single photo mosaic refracted in wall coordinates; DOM labels stay crisp.
(() => {
  const wall = document.querySelector(".artist-wall");
  if (!wall) return;
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const canvas = document.createElement("canvas");
  canvas.className = "artist-water";
  canvas.setAttribute("aria-hidden", "true");
  wall.prepend(canvas);
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, powerPreference: "low-power" });
  if (!gl) return;
  const photos = [...wall.querySelectorAll(".artist-tile img")];
  const atlas = document.createElement("canvas");
  const ctx = atlas.getContext("2d");
  const waveCount = 10;
  const waves = new Float32Array(waveCount * 4);
  for (let i = 0; i < waveCount; i++) waves[i * 4 + 2] = -100;
  let nextWave = 0;
  let frame = 0;
  let ready = false;
  let lost = false;
  let width = 0;
  let height = 0;
  let dirty = true;
  let nextDrop = 0;
  let lastFrame = 0;
  let lastPointer = null;
  const epoch = performance.now();
  const seconds = () => (performance.now() - epoch) / 1000;
  const active = () => ready && !lost && !reduced.matches && !document.hidden && root.dataset.view === "artists";

  function shader(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      gl.deleteShader(result);
      throw new Error("Water shader unavailable");
    }
    return result;
  }

  let program;
  let texture;
  let uniforms;
  try {
    program = gl.createProgram();
    const vertex = shader(gl.VERTEX_SHADER, `
      attribute vec2 position;
      varying vec2 uv;
      void main() {
        uv = position * .5 + .5;
        gl_Position = vec4(position, 0., 1.);
      }
    `);
    const fragment = shader(gl.FRAGMENT_SHADER, `
      precision highp float;
      varying vec2 uv;
      uniform sampler2D photo;
      uniform vec2 size;
      uniform float time;
      uniform vec4 waves[10];
      void main() {
        vec2 p = vec2(uv.x, 1. - uv.y) * size;
        // Broad, slow currents below the finer circular ripples.
        vec2 flow = vec2(
          sin(p.y * .012 + p.x * .004 + time * .42),
          cos(p.x * .009 - p.y * .005 - time * .34)
        );
        vec2 displacement = flow * .85;
        float reflection = 0.;
        for (int i = 0; i < 10; i++) {
          float age = time - waves[i].z;
          if (age >= 0. && age < 5.) {
            vec2 delta = p - waves[i].xy * size;
            float distance = length(delta);
            float radius = age * 82.;
            float band = 30. + age * 6.;
            float offset = distance - radius;
            float envelope = exp(-offset * offset / (band * band));
            float fade = smoothstep(0., .2, age) * pow(1. - age / 5., 1.7);
            float strength = envelope * fade * waves[i].w;
            float phase = offset * .29;
            float slope = cos(phase) * strength;
            vec2 normal = delta / max(distance, 1.);
            displacement += normal * slope * 5.5;
            // Paired light and shadow crests give the rings a water surface.
            reflection += slope * .065 + sin(phase) * strength * .022 * dot(normal, vec2(-.6, -.8));
          }
        }
        vec2 sampleUV = uv + displacement * vec2(1., -1.) / size;
        vec3 color = texture2D(photo, clamp(sampleUV, vec2(0.), vec2(1.))).rgb;
        color += reflection * vec3(.88, .94, 1.);
        color += (flow.x + flow.y) * .003;
        gl_FragColor = vec4(color, 1.);
      }
    `);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Water program unavailable");
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    uniforms = Object.fromEntries(["size", "time", "waves[0]"].map(name => [name, gl.getUniformLocation(program, name)]));
  } catch {
    canvas.remove();
    return;
  }

  function rebuild() {
    const bounds = wall.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
    width = bounds.width;
    height = bounds.height;
    // Bound texture cost on tall mobile walls and high-density desktop screens.
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const ratio = Math.min(devicePixelRatio || 1, 1.5, 1800 / width, 2600 / height, maxTexture / Math.max(width, height));
    atlas.width = canvas.width = Math.round(width * ratio);
    atlas.height = canvas.height = Math.round(height * ratio);
    ctx.setTransform(atlas.width / width, 0, 0, atlas.height / height, 0, 0);
    ctx.fillStyle = "#11110f";
    ctx.fillRect(0, 0, width, height);
    for (const img of photos) {
      if (!img.naturalWidth) continue;
      const tile = img.closest(".artist-tile");
      const rect = tile.getBoundingClientRect();
      const x = rect.left - bounds.left, y = rect.top - bounds.top;
      const style = getComputedStyle(img);
      const [px, py] = style.objectPosition.split(" ").map(value => parseFloat(value) / 100);
      const scale = Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
      const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
      const zoom = tile.classList.contains("artist-jay") ? 1.1 : 1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, rect.width, rect.height);
      ctx.clip();
      ctx.filter = "saturate(.65) brightness(.8)";
      ctx.translate(x + rect.width / 2, y + rect.height / 2);
      ctx.scale(zoom, zoom);
      ctx.drawImage(img, -rect.width / 2 + (rect.width - iw) * px, -rect.height / 2 + (rect.height - ih) * py, iw, ih);
      ctx.restore();
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.size, width, height);
    dirty = false;
    return true;
  }

  function drop(x, y, strength = 1) {
    waves.set([x, y, seconds(), strength], nextWave * 4);
    nextWave = (nextWave + 1) % waveCount;
  }

  function render(now) {
    frame = 0;
    if (!active()) { sync(); return; }
    // 30fps is sufficient for the gentle surface; input still records immediately.
    if (now - lastFrame >= 1000 / 30) {
      lastFrame = now;
      try {
        if (dirty && !rebuild()) return;
        const time = seconds();
        if (time > nextDrop) {
          const bounds = wall.getBoundingClientRect();
          const top = Math.max(0, -bounds.top);
          const bottom = Math.min(height, innerHeight - bounds.top);
          if (bottom > top) drop(.15 + Math.random() * .7, (top + (bottom - top) * (.2 + Math.random() * .6)) / height, .75);
          nextDrop = time + 3.8 + Math.random() * 2.2;
        }
        gl.uniform1f(uniforms.time, time);
        gl.uniform4fv(uniforms["waves[0]"], waves);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        wall.classList.add("has-water");
      } catch {
        lost = true;
        wall.classList.remove("has-water");
        return;
      }
    }
    frame = requestAnimationFrame(render);
  }

  function sync() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (active()) {
      dirty = true;
      nextDrop = seconds() + .7;
      frame = requestAnimationFrame(render);
    } else {
      wall.classList.remove("has-water");
      lastPointer = null;
    }
  }

  wall.addEventListener("pointermove", event => {
    if (!active() || event.pointerType === "touch") return;
    const now = performance.now();
    if (lastPointer && (now - lastPointer.time < 160 || Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y) < 30)) return;
    const bounds = wall.getBoundingClientRect();
    drop((event.clientX - bounds.left) / width, (event.clientY - bounds.top) / height, .65);
    lastPointer = { x: event.clientX, y: event.clientY, time: now };
  });
  wall.addEventListener("pointerleave", () => { lastPointer = null; });
  wall.addEventListener("pointerdown", event => {
    if (!active() || event.button !== 0) return;
    const bounds = wall.getBoundingClientRect();
    drop((event.clientX - bounds.left) / width, (event.clientY - bounds.top) / height, 1.3);
  }, { passive: true });
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    lost = true;
    sync();
  });
  // Leave the original images as a usable fallback after a lost graphics context.
  new ResizeObserver(() => { dirty = true; if (active() && !frame) sync(); }).observe(wall);
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-view"] });
  reduced.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", () => { cancelAnimationFrame(frame); frame = 0; });
  window.addEventListener("pageshow", sync);
  Promise.allSettled(photos.map(img => img.decode())).then(() => { ready = true; sync(); });
})();
