const STORAGE_KEY = "encore-recovered-jake-miller-v1";
const LYRICS_STORAGE_KEY = "encore-jake-miller-lyrics-v1";
const VIDEO_STORAGE_KEY = "encore-jake-miller-videos-v1";

const deck = document.querySelector("#deck");
const records = document.querySelector("#records");
const videoFrame = document.querySelector("#video-frame");
const videoEmpty = document.querySelector("#video-empty");
const lyricsView = document.querySelector("#lyrics-view");
const noteCopy = document.querySelector("#note-copy");

let tracks = [];
let currentIndex = 7;
let ytPlayer = null;
let ytReady = false;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOffset = 0;
let gestureAxis = "";
let suppressClick = false;
let shuffle = false;
let repeat = false;
let muted = false;
let activeLyrics = [];
let lyricsByTrack = {};
let activeVideoId = "";
let savedState = {};
let videoOverrides = {};
let filteredIndexes = [];
let activeLyricIndex = -1;
let pendingAutoplay = false;
let videoBlocked = false;

try {
  savedState = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  if (Number.isInteger(savedState.index)) currentIndex = savedState.index;
} catch {}

try {
  lyricsByTrack = JSON.parse(localStorage.getItem(LYRICS_STORAGE_KEY) || "{}");
} catch {}

try {
  const saved = JSON.parse(localStorage.getItem(VIDEO_STORAGE_KEY) || "{}");
  if (saved && typeof saved === "object" && !Array.isArray(saved)) videoOverrides = saved;
} catch {}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...savedState, index: currentIndex }));
  } catch {}
}

function saveLyrics() {
  localStorage.setItem(LYRICS_STORAGE_KEY, JSON.stringify(lyricsByTrack));
}

function renderIcons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.6, "aria-hidden": "true" } });
}

function setPlaying(playing, label) {
  const button = document.querySelector("#play-toggle");
  const icon = playing ? "pause" : "play";
  if (button.dataset.icon !== icon) {
    button.innerHTML = `<i data-lucide="${icon}"></i>`;
    button.dataset.icon = icon;
    renderIcons();
  }
  button.setAttribute("aria-pressed", String(playing));
  button.setAttribute("aria-label", playing ? "暂停" : "播放");
  button.title = playing ? "暂停" : "播放";
  if (label) document.querySelector("#playback-state").textContent = label;
}

function currentTrack() {
  return tracks[currentIndex];
}

function videoIdFor(track) {
  return videoOverrides[track.id] || track.officialVideoId || "";
}

function parseVideoId(value) {
  const input = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    let id = "";
    if (host === "youtu.be" || host === "www.youtu.be") id = url.pathname.split("/")[1];
    else if (["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].includes(host)) {
      id = url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] || "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function openSourceEditor() {
  if (ytReady && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
  document.querySelector("#source-track").textContent = `${currentTrack().title} · ${currentTrack().artist}`;
  document.querySelector("#video-url").value = videoIdFor(currentTrack());
  document.querySelector("#source-error").textContent = "";
  document.querySelector("#source-dialog").showModal();
}

function normalizeName(value) {
  return value.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/g, "");
}

function loadYouTubeApi() {
  const initialize = () => {
    if (ytPlayer) return;
    const track = currentTrack();
    const origin = /^https?:$/.test(location.protocol) ? { origin: location.origin } : {};
    ytPlayer = new YT.Player("youtube-player", {
      width: "100%",
      height: "100%",
      videoId: videoIdFor(track),
      playerVars: { playsinline: 1, rel: 0, controls: 1, ...origin },
      events: {
        onReady: () => {
          ytReady = true;
          if (muted) ytPlayer.mute();
          const autoplay = pendingAutoplay;
          pendingAutoplay = false;
          syncVideo(autoplay);
        },
        onStateChange: (event) => {
          const reportedId = ytPlayer.getVideoData?.().video_id;
          if (!activeVideoId || (reportedId && reportedId !== activeVideoId)) return;
          const playing = event.data === YT.PlayerState.PLAYING;
          if (playing) {
            videoEmpty.hidden = true;
            videoBlocked = false;
            document.querySelector("#play-toggle").disabled = !filteredIndexes.length;
            setPlaying(true, "Now Playing");
            document.querySelector("#video-status").textContent = currentTrack().title;
          } else if (event.data === YT.PlayerState.PAUSED) {
            setPlaying(false, "Paused");
          } else if (event.data === YT.PlayerState.BUFFERING) {
            setPlaying(false, "Loading…");
          } else if (event.data === YT.PlayerState.CUED) {
            document.querySelector("#play-toggle").disabled = !ytReady || !filteredIndexes.length;
            setPlaying(false, "Ready to play");
          }
          if (event.data === YT.PlayerState.ENDED) {
            setPlaying(false, "Finished");
            if (repeat) {
              ytPlayer.seekTo(0, true);
              ytPlayer.playVideo();
            } else {
              advanceTrack(1, true);
            }
          }
        },
        onError: (event) => {
          const reportedId = ytPlayer.getVideoData?.().video_id;
          if (!activeVideoId || (reportedId && reportedId !== activeVideoId)) return;
          videoBlocked = true;
          videoEmpty.hidden = false;
          document.querySelector("#play-toggle").disabled = true;
          setPlaying(false, "Video unavailable");
          document.querySelector("#video-status").textContent = `YouTube · ${event.data}`;
          document.querySelector("#video-empty-title").textContent = "Unavailable in embedded player";
        }
      }
    });
  };
  window.onYouTubeIframeAPIReady = initialize;
  if (window.YT?.Player) {
    initialize();
    return;
  }
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.async = true;
  script.onerror = () => {
    videoEmpty.hidden = false;
    document.querySelector("#video-empty-title").textContent = "YouTube connection unavailable";
    document.querySelector("#video-status").textContent = "Connection unavailable";
    setPlaying(false, "YouTube unavailable");
  };
  document.head.append(script);
}

function makeCover(track, index) {
  const button = document.createElement("button");
  button.className = "cover-card";
  button.type = "button";
  button.dataset.index = index;
  button.setAttribute("aria-label", `${track.title}, ${track.artist}`);
  const face = document.createElement("span");
  face.className = "cover-face";
  const image = document.createElement("img");
  image.src = track.artwork;
  image.alt = "";
  image.draggable = false;
  face.append(image);
  const reflection = document.createElement("span");
  reflection.className = "cover-reflection";
  reflection.setAttribute("aria-hidden", "true");
  reflection.append(image.cloneNode());
  button.append(face, reflection);
  return button;
}

function renderQueue() {
  const list = document.querySelector("#queue-list");
  list.replaceChildren(...tracks.map((track, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-current", index === currentIndex ? "true" : "false");
    button.innerHTML = `<span class="queue-number">${String(index + 1).padStart(2, "0")}</span><img src="${track.artwork}" alt=""><span class="queue-text"><b></b><small></small></span>`;
    button.querySelector(".queue-text b").textContent = track.title;
    button.querySelector(".queue-text small").textContent = `${track.artist} · ${track.album}`;
    button.addEventListener("click", () => {
      resetSearch();
      selectTrack(index, true);
      document.querySelector("#queue-dialog").close();
    });
    item.append(button);
    return item;
  }));
}

function renderDeck() {
  const currentPosition = filteredIndexes.indexOf(currentIndex);
  [...records.children].forEach((card) => {
    const index = Number(card.dataset.index);
    const position = filteredIndexes.indexOf(index);
    const distance = position - currentPosition;
    const visible = position !== -1 && Math.abs(distance) <= 7;
    const offset = distance + dragOffset;
    const depth = Math.abs(offset);
    const proximity = Math.min(depth, 1);
    const mobile = window.innerWidth <= 700;
    const x = offset * (mobile ? 120 : 160);
    const z = 300 * (1 - proximity) - 80 * depth;
    const scale = 1.3 * (1 - proximity) + Math.max(.8, 1.15 - depth * .04) * proximity;
    const rotate = -Math.sign(offset) * proximity * 55;
    const selected = index === currentIndex && position !== -1;
    card.classList.toggle("is-active", selected);
    card.classList.toggle("is-hidden", !visible);
    card.setAttribute("aria-pressed", String(selected));
    card.tabIndex = selected ? 0 : -1;
    card.style.zIndex = String(1000 - Math.round(depth * 100));
    card.style.transform = `translateX(${x}px) translateZ(${z}px) rotateY(${rotate}deg) scale(${scale})`;
  });
}

function renderTrack(autoplay = false) {
  const track = currentTrack();
  if (!track) return;
  document.querySelector("#track-title").textContent = track.title;
  document.querySelector("#track-artist").textContent = track.artist;
  document.querySelector("#track-album").textContent = track.album;
  document.querySelector("#ambient-cover").style.backgroundImage = `url("${track.artwork}")`;
  document.querySelector("#notes-track").textContent = track.title;
  document.querySelector("#notes-album").textContent = track.album;
  renderLyrics(track);
  renderDeck();
  renderQueue();
  syncVideo(autoplay);
  saveState();
}

function syncVideo(autoplay = false) {
  const track = currentTrack();
  if (!track) return;
  const videoId = videoIdFor(track);
  const hasVideo = Boolean(videoId);
  activeVideoId = videoId;
  videoBlocked = false;
  document.querySelector("#video-poster").src = track.artwork;
  document.querySelector("#video-poster").alt = `${track.album} 专辑封面`;
  videoFrame.classList.toggle("no-video", !hasVideo);
  videoEmpty.hidden = hasVideo;
  document.querySelector("#video-status").textContent = hasVideo ? track.title : "No linked video";
  document.querySelector("#video-empty-title").textContent = "No video linked to this track";
  const query = encodeURIComponent(`${track.artist} ${track.title} official music video`);
  const searchUrl = `https://www.youtube.com/results?search_query=${query}`;
  document.querySelector("#video-search").href = searchUrl;
  document.querySelector("#video-external").href = videoId ? `https://www.youtube.com/watch?v=${videoId}` : searchUrl;
  document.querySelector("#play-toggle").disabled = true;
  setPlaying(false, hasVideo ? (ytReady ? "Loading video…" : "Connecting to YouTube…") : "Video source needed");
  if (ytReady) {
    if (hasVideo) {
      if (autoplay) ytPlayer.loadVideoById(videoId);
      else ytPlayer.cueVideoById(videoId);
    } else {
      ytPlayer.stopVideo();
    }
  }
}

function selectTrack(index, autoplay = false) {
  currentIndex = (index + tracks.length) % tracks.length;
  pendingAutoplay = autoplay && !ytReady && Boolean(videoIdFor(currentTrack()));
  renderTrack(autoplay);
}

function advanceTrack(direction, autoplay = false) {
  if (!filteredIndexes.length) return;
  const position = filteredIndexes.indexOf(currentIndex);
  let nextPosition = (position + direction + filteredIndexes.length) % filteredIndexes.length;
  if (shuffle && filteredIndexes.length > 1) {
    do { nextPosition = Math.floor(Math.random() * filteredIndexes.length); } while (nextPosition === position);
  }
  selectTrack(filteredIndexes[nextPosition], autoplay);
}

function togglePlayback() {
  const track = currentTrack();
  if (videoIdFor(track) && ytReady && !videoBlocked) {
    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
    else ytPlayer.playVideo();
  } else {
    openSourceEditor();
  }
}

function resetSearch() {
  document.querySelector("#track-search").value = "";
  document.querySelector("#search-clear").hidden = true;
  filteredIndexes = tracks.map((_, index) => index);
  document.querySelector("#result-count").textContent = `· ${tracks.length} Tracks`;
  document.querySelector("#search-empty").hidden = true;
  document.querySelector(".track-caption").hidden = false;
  document.querySelector("#control-prev").disabled = false;
  document.querySelector("#control-next").disabled = false;
}

function filterTracks() {
  const query = document.querySelector("#track-search").value.trim().toLowerCase();
  filteredIndexes = tracks.flatMap((track, index) =>
    `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query) ? [index] : []);
  document.querySelector("#search-clear").hidden = !query;
  document.querySelector("#result-count").textContent = query
    ? `· ${filteredIndexes.length} Results` : `· ${tracks.length} Tracks`;
  const empty = !filteredIndexes.length;
  document.querySelector("#search-empty").hidden = !empty;
  document.querySelector(".track-caption").hidden = empty;
  document.querySelector("#control-prev").disabled = empty;
  document.querySelector("#control-next").disabled = empty;
  if (empty) {
    if (ytReady) ytPlayer.pauseVideo();
    setPlaying(false, "No matching tracks");
    document.querySelector("#play-toggle").disabled = true;
    renderDeck();
  } else if (!filteredIndexes.includes(currentIndex)) {
    selectTrack(filteredIndexes[0]);
  } else {
    const state = ytReady ? ytPlayer.getPlayerState() : -1;
    document.querySelector("#play-toggle").disabled = !videoIdFor(currentTrack()) || !ytReady || videoBlocked || ![1, 2, 5].includes(state);
    renderDeck();
  }
}

function parseLrc(text) {
  const lines = [];
  for (const row of text.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const content = row.replace(/\[[^\]]+\]/g, "").trim();
    for (const stamp of stamps) {
      const fraction = Number(`0.${stamp[3] || "0"}`);
      lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction, text: content });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function renderLyrics(track) {
  const lyrics = lyricsByTrack[track.id];
  activeLyrics = [];
  activeLyricIndex = -1;
  lyricsView.replaceChildren();
  if (!lyrics?.text?.trim()) {
    lyricsView.hidden = true;
    noteCopy.hidden = false;
    noteCopy.textContent = "Lyrics unavailable";
    document.querySelector("#notes-disclaimer").hidden = false;
    document.querySelector("#notes-disclaimer").textContent = "LRC / TXT";
    return;
  }
  showLyrics(lyrics.text, lyrics.format);
}

function showLyrics(text, format) {
  const isLrc = format === "lrc";
  activeLyrics = isLrc ? parseLrc(text) : [];
  noteCopy.hidden = true;
  document.querySelector("#notes-disclaimer").hidden = false;
  document.querySelector("#notes-disclaimer").textContent = isLrc
    ? "LRC · On this device"
    : "TXT · On this device";
  lyricsView.hidden = false;
  lyricsView.replaceChildren();
  if (activeLyrics.length) {
    activeLyrics.forEach((line) => {
      const el = document.createElement("div");
      el.className = "lyrics-line";
      el.dataset.time = line.time;
      el.textContent = line.text;
      lyricsView.append(el);
    });
  } else {
    lyricsView.textContent = text;
  }
}

function updateLyrics(time) {
  if (!activeLyrics.length) return;
  let active = -1;
  activeLyrics.forEach((line, index) => {
    if (line.time <= time) active = index;
  });
  if (active === activeLyricIndex) return;
  activeLyricIndex = active;
  [...lyricsView.children].forEach((line, index) => {
    const isActive = index === active;
    line.classList.toggle("is-active", isActive);
    if (isActive && document.querySelector("#lyrics-dialog").open) {
      lyricsView.scrollTo({ top: line.offsetTop - lyricsView.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
    }
  });
}

function updateProgress() {
  const track = currentTrack();
  const time = ytReady && videoIdFor(track) ? ytPlayer.getCurrentTime() || 0 : 0;
  updateLyrics(time);
}

function bindEvents() {
  document.querySelector("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    filterTracks();
  });
  document.querySelector("#track-search").addEventListener("input", filterTracks);
  document.querySelector("#search-clear").addEventListener("click", () => {
    resetSearch();
    filterTracks();
    document.querySelector("#track-search").focus();
  });
  records.addEventListener("click", (event) => {
    const cover = event.target.closest(".cover-card");
    if (!cover || suppressClick) return;
    selectTrack(Number(cover.dataset.index), true);
  });
  document.querySelector("#control-prev").addEventListener("click", () => advanceTrack(-1, true));
  document.querySelector("#control-next").addEventListener("click", () => advanceTrack(1, true));
  document.querySelector("#play-toggle").addEventListener("click", togglePlayback);
  document.querySelector("#queue-open").addEventListener("click", () => document.querySelector("#queue-dialog").showModal());
  document.querySelector("#lyrics-open").addEventListener("click", () => {
    document.querySelector("#lyrics-dialog").showModal();
    activeLyricIndex = -1;
    updateProgress();
  });
  document.querySelector("#source-open").addEventListener("click", openSourceEditor);
  document.querySelector("#source-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const id = parseVideoId(document.querySelector("#video-url").value);
    if (!id) {
      document.querySelector("#source-error").textContent = "Enter a valid YouTube video URL or 11-character ID.";
      return;
    }
    videoOverrides[currentTrack().id] = id;
    try {
      localStorage.setItem(VIDEO_STORAGE_KEY, JSON.stringify(videoOverrides));
    } catch {}
    syncVideo();
    document.querySelector("#source-dialog").close();
  });
  document.querySelector("#source-reset").addEventListener("click", () => {
    delete videoOverrides[currentTrack().id];
    try {
      localStorage.setItem(VIDEO_STORAGE_KEY, JSON.stringify(videoOverrides));
    } catch {}
    syncVideo();
    document.querySelector("#source-dialog").close();
  });
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.close).close());
  });
  document.querySelector("#shuffle-toggle").addEventListener("click", (event) => {
    shuffle = !shuffle;
    event.currentTarget.classList.toggle("is-on", shuffle);
    event.currentTarget.setAttribute("aria-pressed", String(shuffle));
  });
  document.querySelector("#repeat-toggle").addEventListener("click", (event) => {
    repeat = !repeat;
    event.currentTarget.classList.toggle("is-on", repeat);
    event.currentTarget.setAttribute("aria-pressed", String(repeat));
  });
  document.querySelector("#volume-toggle").addEventListener("click", (event) => {
    muted = !muted;
    if (ytReady) {
      if (muted) ytPlayer.mute();
      else ytPlayer.unMute();
    }
    event.currentTarget.classList.toggle("is-on", muted);
    event.currentTarget.setAttribute("aria-label", muted ? "取消静音" : "静音");
    event.currentTarget.setAttribute("aria-pressed", String(muted));
    event.currentTarget.innerHTML = `<i data-lucide="${muted ? "volume-x" : "volume-2"}"></i>`;
    renderIcons();
  });
  document.querySelector("#lyrics-import").addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    let imported = 0;
    for (const file of files) {
      const normalized = normalizeName(file.name);
      const track = tracks.find((item) => normalized.includes(normalizeName(item.title)))
        || (files.length === 1 ? currentTrack() : null);
      if (!track) continue;
      lyricsByTrack[track.id] = {
        text: await file.text(),
        format: file.name.toLowerCase().endsWith(".lrc") ? "lrc" : "txt"
      };
      imported++;
    }
    if (imported) {
      saveLyrics();
      renderLyrics(currentTrack());
    } else {
      document.querySelector("#notes-disclaimer").textContent = "No matching track filenames";
    }
    event.target.value = "";
  });
  deck.addEventListener("pointerdown", (event) => {
    if (event.button && event.button !== 0) return;
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    gestureAxis = "";
  });
  window.addEventListener("pointermove", (event) => {
    if (!isDragging) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    if (!gestureAxis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
      gestureAxis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }
    if (gestureAxis !== "horizontal") return;
    dragOffset = Math.max(-2, Math.min(2, dx / (window.innerWidth <= 700 ? 120 : 160)));
    deck.classList.add("is-dragging");
    renderDeck();
  });
  window.addEventListener("pointerup", (event) => {
    if (!isDragging) return;
    const delta = event.clientX - dragStartX;
    const vertical = gestureAxis === "vertical";
    isDragging = false;
    dragOffset = 0;
    deck.classList.remove("is-dragging");
    if (!vertical && Math.abs(delta) > 35) {
      suppressClick = true;
      advanceTrack(delta < 0 ? 1 : -1);
      setTimeout(() => { suppressClick = false; }, 80);
    } else {
      renderDeck();
    }
  });
  window.addEventListener("pointercancel", () => {
    isDragging = false;
    dragOffset = 0;
    deck.classList.remove("is-dragging");
    renderDeck();
  });
  window.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select") || document.querySelector("dialog[open]")) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); advanceTrack(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); advanceTrack(1); }
    if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
  });
  window.addEventListener("resize", renderDeck);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && ytReady) ytPlayer.pauseVideo();
  });
  window.setInterval(updateProgress, 500);
}

async function init() {
  if (!Array.isArray(window.ENCORE_TRACKS)) throw new Error("Track data did not load");
  tracks = window.ENCORE_TRACKS;
  currentIndex = ((currentIndex % tracks.length) + tracks.length) % tracks.length;
  filteredIndexes = tracks.map((_, index) => index);
  records.replaceChildren(...tracks.map(makeCover));
  renderTrack();
  bindEvents();
  renderIcons();
  loadYouTubeApi();
}

init().catch((error) => {
  console.error(error);
  document.querySelector("#track-title").textContent = "无法载入歌单";
});
