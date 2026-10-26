// An original, finite water-refraction transition. No audio or playback state is touched.
window.createRoomRipple = function (canvas) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false });
  if (!gl) return null;
  function shader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("Ripple shader unavailable");
    return s;
  }
  try {
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `
      attribute vec2 position;
      varying vec2 uv;
      void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
    `));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 uv;
      uniform sampler2D photo;
      uniform vec2 resolution;
      uniform vec2 origin;
      uniform float progress;
      uniform float reverse;
      float wave(float d, float t) {
        float front = t * 1.8;
        float envelope = exp(-pow((d - front) * 4.0, 2.0));
        return sin((d - front) * 48.0) * envelope;
      }
      void main() {
        float aspect = resolution.x / resolution.y;
        vec2 p = uv * vec2(aspect, 1.);
        vec2 center = origin * vec2(aspect, 1.);
        float t = mix(progress, 1. - progress, reverse);
        vec2 delta = p - center;
        float d = length(delta);
        vec2 dir = delta / max(d, .001);
        float w = wave(d, t) + .48 * wave(d, max(0., t - .12));
        vec2 warped = uv + dir * w * .027 / vec2(aspect, 1.);
        // Slow underlying currents keep the surface liquid between the wave crests.
        warped += vec2(sin(uv.y * 8. + t * 3.), cos(uv.x * 7. - t * 2.)) * .013;
        vec2 cover = vec2(min(1., aspect), min(1., 1. / aspect));
        vec2 imageUV = (warped - .5) * cover * .88 + .5;
        vec3 art = texture2D(photo, imageUV).rgb * .30;
        art += texture2D(photo, imageUV + vec2(.012, .008)).rgb * .13;
        art += texture2D(photo, imageUV - vec2(.012, .008)).rgb * .13;
        float cloud = .5 + .5 * sin(warped.x * 5. + warped.y * 3. + t);
        vec3 water = mix(vec3(.025, .10, .18), vec3(.18, .43, .48), cloud);
        vec3 color = mix(water, art + water * .55, .6);
        float light = wave(d + .008, t) - wave(d - .008, t);
        color += vec3(.30, .64, .66) * light * .26;
        color += vec3(.28, .46, .40) * pow(max(w, 0.), 3.) * .20;
        float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);
        color += (grain - .5) * .018;
        color *= 1. - .32 * smoothstep(.25, .85, distance(uv, vec2(.5)));
        gl_FragColor = vec4(color, 1.);
      }
    `));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([25,65,75,255]));
    let activeImage = null;
    function setArtwork(img) {
      if (!img || img === activeImage) return;
      activeImage = img;
      const upload = () => {
        if (activeImage !== img || gl.isContextLost()) return;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      };
      if (img.complete && img.naturalWidth) upload();
      else img.decode().then(upload).catch(() => {});
    }
    setArtwork(document.querySelector("#enter-jake img"));
    const uniforms = Object.fromEntries(["resolution", "origin", "progress", "reverse"].map(key => [key, gl.getUniformLocation(program, key)]));
    return (progress, origin, reverse, artwork) => {
      if (gl.isContextLost()) return;
      setArtwork(artwork);
      const ratio = Math.min(devicePixelRatio || 1, 1.5, 1600 / innerWidth);
      const width = Math.round(innerWidth * ratio), height = Math.round(innerHeight * ratio);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uniforms.resolution, width, height);
      gl.uniform2f(uniforms.origin, origin.x, 1 - origin.y);
      gl.uniform1f(uniforms.progress, progress);
      gl.uniform1f(uniforms.reverse, reverse ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
  } catch {
    return null;
  }
};
