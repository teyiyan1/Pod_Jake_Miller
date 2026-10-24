const STORAGE_KEY = "encore-recovered-jake-miller-v1";
const LYRICS_STORAGE_KEY = "encore-jake-miller-lyrics-v1";
const LYRICS_DRAFT_STORAGE_KEY = "encore-jake-miller-lyric-drafts-v1";
const VIDEO_STORAGE_KEY = "encore-jake-miller-videos-v1";

const deck = document.querySelector("#deck");
const records = document.querySelector("#records");
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
let lyricsSyncDrafts = {};
const lyricsLookupRequests = new Map();
const lyricsLookupRetryAfter = new Map();
const lyricsSyncRefreshAttempted = new Set();
let activeVideoId = "";
let activeProvider = "";
let activeAppleTrackId = "";
let localAudio = null;
let localTrackId = "";
let localPlayAttempt = 0;
let localAction = "play";
let localLabel = "本地音频 · 点击播放";
let playbackAttempt = 0;
let ambientRequested = false;
let savedState = {};
let videoOverrides = {};
let filteredIndexes = [];
let activeLyricIndex = -1;
let lyricsSyncMode = false;
let lyricsSyncTrackId = "";
let lyricsSyncDraft = [];
let lyricsSyncHistory = [];
let pendingAutoplay = false;
let playbackRequested = false;
let videoBlocked = false;
let videoErrorCode = 0;
let apiUnavailable = false;
let apiReadyTimer = null;

try {
  savedState = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  if (Number.isInteger(savedState.index)) currentIndex = savedState.index;
} catch {}

try {
  lyricsByTrack = JSON.parse(localStorage.getItem(LYRICS_STORAGE_KEY) || "{}");
} catch {}

try {
  const savedDrafts = JSON.parse(localStorage.getItem(LYRICS_DRAFT_STORAGE_KEY) || "{}");
  if (savedDrafts && typeof savedDrafts === "object" && !Array.isArray(savedDrafts)) lyricsSyncDrafts = savedDrafts;
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

function setPlaybackAction(action, label) {
  ambientRequested = action === "pause";
  window.encoreAmbient?.setPlaying(ambientRequested);
  if (navigator.mediaSession) {
    try {
      navigator.mediaSession.playbackState = action === "pause" ? "playing" : action === "play" ? "paused" : "none";
    } catch {}
  }
  const button = document.querySelector("#play-toggle");
  const icons = { play: "play", pause: "pause", retry: "play", unavailable: "play", loading: "loader-circle", empty: "play" };
  const labels = { play: "播放", pause: "暂停", retry: "重试播放", unavailable: "暂不可播放", loading: "正在载入", empty: "没有匹配的歌曲" };
  const icon = icons[action];
  if (button.dataset.icon !== icon) {
    button.innerHTML = `<i data-lucide="${icon}"></i>`;
    button.dataset.icon = icon;
    renderIcons();
  }
  button.dataset.action = action;
  button.disabled = ["loading", "empty", "unavailable"].includes(action);
  button.setAttribute("aria-pressed", String(action === "pause"));
  button.setAttribute("aria-label", labels[action]);
  button.title = labels[action];
  const lyricsPlayButton = document.querySelector("#lyrics-sync-play");
  if (lyricsPlayButton) {
    const lyricsPlayLabel = action === "pause" ? "暂停音乐" : "播放音乐";
    if (lyricsPlayButton.dataset.icon !== icon) {
      lyricsPlayButton.innerHTML = `<i data-lucide="${icon}"></i>`;
      lyricsPlayButton.dataset.icon = icon;
      renderIcons();
    }
    lyricsPlayButton.disabled = button.disabled;
    lyricsPlayButton.setAttribute("aria-label", lyricsPlayLabel);
    lyricsPlayButton.title = lyricsPlayLabel;
  }
  if (label) document.querySelector("#playback-state").textContent = label;
}

function setPlaying(playing, label) {
  if (activeProvider === "apple" || currentTrack()?.audioUrl) return;
  if (!filteredIndexes.length) return setPlaybackAction("empty", "No matching tracks");
  if (!videoIdFor(currentTrack())) return setPlaybackAction("unavailable", "此歌曲暂无可用音源");
  if (apiUnavailable) return setPlaybackAction("unavailable", "无法连接 YouTube，请检查网络后刷新");
  if (videoBlocked) return setPlaybackAction("retry", youtubeErrorMessage(videoErrorCode));
  setPlaybackAction(playing ? "pause" : "play", label);
}

function youtubeErrorMessage(code) {
  const messages = {
    2: "YouTube 返回了无效视频编号（错误 2）",
    5: "YouTube HTML5 播放器无法播放此视频（错误 5）",
    100: "YouTube 视频不存在、已删除或设为私密（错误 100）",
    101: "YouTube 内嵌播放返回错误 101（嵌入限制）",
    150: "YouTube 内嵌播放返回错误 150（限制原因需进一步确认）",
    153: "YouTube 请求缺少来源标识（错误 153）"
  };
  return messages[code] || `YouTube 播放失败（错误 ${code || "未知"}）`;
}

function showConnectionFailure() {
  apiUnavailable = true;
  pendingAutoplay = false;
  clearTimeout(apiReadyTimer);
  playbackRequested = false;
  setPlaying(false);
}

function currentTrack() {
  return tracks[currentIndex];
}

function lyricsForTrack(track) {
  const saved = lyricsByTrack[track?.id];
  if (saved?.text?.trim()) return saved;
  const embedded = track?.embeddedLyricsLrc?.trim();
  return embedded ? { text: embedded, format: "lrc", source: "embedded" } : null;
}

function setLocalPlaybackAction(action, label) {
  localAction = action;
  localLabel = label;
  if (currentTrack()?.audioUrl && filteredIndexes.length) setPlaybackAction(action, label);
}

function releaseLocalAudio() {
  const previous = localAudio;
  localAudio = null;
  localTrackId = "";
  localPlayAttempt += 1;
  localAction = "play";
  localLabel = "本地音频 · 点击播放";
  if (previous) {
    previous.pause();
    previous.removeAttribute("src");
    previous.load();
    previous.remove();
  }
}

function pauseLocalPlayback() {
  localPlayAttempt += 1;
  localAudio?.pause();
  if (localAudio && !localAudio.error) setLocalPlaybackAction("play", "本地音频 · 已暂停");
}

function startLocalPlayback(track) {
  if (!localAudio || localTrackId !== track.id || localAudio.error) {
    releaseLocalAudio();
    const audio = document.createElement("audio");
    audio.id = "local-audio";
    audio.setAttribute("aria-hidden", "true");
    audio.className = "sr-only-media";
    audio.preload = "auto";
    audio.playsInline = true;
    localAudio = audio;
    localTrackId = track.id;
    // A removed player's late events must not affect a newly selected song.
    const isCurrent = () => localAudio === audio && currentTrack()?.id === track.id && activeProvider === "local";
    audio.addEventListener("playing", () => {
      if (!isCurrent()) return;
      if (!filteredIndexes.length) return pauseLocalPlayback();
      setLocalPlaybackAction("pause", "本地音频 · 正在播放");
    });
    audio.addEventListener("pause", () => {
      if (isCurrent() && !audio.ended && !audio.error) setLocalPlaybackAction("play", "本地音频 · 已暂停");
    });
    audio.addEventListener("waiting", () => {
      if (isCurrent() && !audio.paused) setLocalPlaybackAction("loading", "正在载入本地音频…");
    });
    audio.addEventListener("error", () => {
      if (isCurrent()) setLocalPlaybackAction("retry", "本地音频无法载入 · 点击重试");
    });
    audio.addEventListener("ended", () => {
      if (!isCurrent() || !filteredIndexes.length) return;
      if (lyricsSyncMode && lyricsSyncTrackId === track.id) {
        setLocalPlaybackAction("play", "播放结束 · 打点进度已保存");
        return;
      }
      if (repeat) {
        audio.currentTime = 0;
        startLocalPlayback(track);
      } else advanceTrack(1, true);
    });
    ["timeupdate", "seeking", "seeked"].forEach((eventName) => {
      audio.addEventListener(eventName, () => {
        if (isCurrent()) updateProgress();
      });
    });
    audio.src = track.audioUrl;
    document.body.append(audio);
  }
  const audio = localAudio;
  const attempt = ++localPlayAttempt;
  activeProvider = "local";
  activeAppleTrackId = "";
  activeVideoId = "";
  pendingAutoplay = false;
  playbackRequested = false;
  if (ytReady) ytPlayer.pauseVideo();
  audio.muted = muted;
  if (audio.ended) audio.currentTime = 0;
  setLocalPlaybackAction("loading", "正在载入本地音频…");
  audio.play().catch((error) => {
    if (localAudio !== audio || attempt !== localPlayAttempt || activeProvider !== "local") return;
    setLocalPlaybackAction("retry", error.name === "NotAllowedError"
      ? "请再次点击播放按钮以播放本地音频"
      : "本地音频无法播放 · 点击重试");
  });
}

function startYouTubePlayback(label = "") {
  const track = currentTrack();
  const videoId = videoIdFor(track);
  if (!videoId) {
    activeProvider = "";
    const appleState = window.EncAppleMusic?.readyState();
    const suffix = appleState === "needs-setup" ? "；Apple Music 尚未配置" : "";
    setPlaybackAction("unavailable", `此歌曲暂无可用音源${suffix}`);
    return false;
  }
  if (apiUnavailable) {
    activeProvider = "";
    setPlaybackAction("unavailable", "无法连接 YouTube，请检查网络后刷新");
    return false;
  }

  activeProvider = "youtube";
  activeAppleTrackId = "";
  videoBlocked = false;
  videoErrorCode = 0;
  playbackRequested = true;
  if (ytReady) {
    setPlaybackAction("loading", label || "Loading YouTube…");
    ytPlayer.loadVideoById(videoId);
  } else {
    pendingAutoplay = true;
    setPlaybackAction("loading", label || "Connecting to YouTube…");
  }
  return true;
}

async function startPreferredPlayback() {
  window.encoreAmbient?.preparePlayback();
  const track = currentTrack();
  const attempt = ++playbackAttempt;
  const appleMusic = window.EncAppleMusic;

  if (track.audioUrl) {
    startLocalPlayback(track);
    return;
  }

  if (appleMusic?.isReady()) {
    activeProvider = "apple";
    activeAppleTrackId = track.id;
    pendingAutoplay = false;
    playbackRequested = false;
    if (ytReady) ytPlayer.pauseVideo();
    setPlaybackAction("loading", "正在连接 Apple Music…");
    try {
      await appleMusic.play(track);
      if (attempt !== playbackAttempt || currentTrack()?.id !== track.id) {
        appleMusic.pause();
        return;
      }
      appleMusic.setMuted(muted);
    } catch (error) {
      if (attempt !== playbackAttempt || currentTrack()?.id !== track.id) return;
      activeProvider = "";
      activeAppleTrackId = "";
      const hasYouTube = Boolean(videoIdFor(track)) && !apiUnavailable;
      if (hasYouTube) startYouTubePlayback("Apple Music 暂不可用，正在尝试 YouTube…");
      else setPlaybackAction("retry", error.message || "Apple Music 暂时无法播放此歌曲");
    }
    return;
  }

  const loading = appleMusic?.readyState() === "loading";
  startYouTubePlayback(loading ? "Apple Music 正在准备，先尝试 YouTube…" : "");
}

function handleAppleMusicEvent(event) {
  const detail = event.detail || {};
  const connectButton = document.querySelector("#apple-connect");
  if (detail.type === "ready") {
    connectButton?.classList.toggle("is-on", detail.authorized);
    connectButton?.setAttribute("aria-label", detail.authorized ? "Apple Music 已连接" : "连接 Apple Music");
    connectButton?.setAttribute("title", detail.authorized ? "Apple Music 已连接" : "连接 Apple Music");
    if (!currentTrack()?.audioUrl && !videoIdFor(currentTrack())) setPlaybackAction("play", "Apple Music 已就绪 · 点击播放");
  } else if (detail.type === "authorized") {
    connectButton?.classList.toggle("is-on", detail.authorized);
    connectButton?.setAttribute("aria-label", detail.authorized ? "Apple Music 已连接" : "连接 Apple Music");
    connectButton?.setAttribute("title", detail.authorized ? "Apple Music 已连接" : "连接 Apple Music");
    if (detail.authorized && !currentTrack()?.audioUrl) {
      document.querySelector("#playback-state").textContent = "Apple Music 已连接";
      if (!videoIdFor(currentTrack())) setPlaybackAction("play", "Apple Music 已连接 · 点击播放");
    }
  } else if (detail.type === "setup-needed") {
    connectButton?.setAttribute("title", "请先配置 Apple MusicKit 开发者令牌");
  }

  if (detail.type === "playback" && activeProvider === "apple" && currentTrack()?.id === activeAppleTrackId) {
    if (detail.state === "playing") setPlaybackAction("pause", "Apple Music · 正在播放");
    else if (detail.state === "paused") setPlaybackAction("play", "Apple Music · 已暂停");
    else if (detail.state === "loading") setPlaybackAction("loading", "正在载入 Apple Music…");
    else if (detail.state === "ended") {
      if (lyricsSyncMode) setPlaybackAction("play", "播放结束 · 打点进度已保存");
      else if (repeat) startPreferredPlayback();
      else advanceTrack(1, true);
    }
  } else if (detail.type === "error" && activeProvider === "apple" && currentTrack()?.id === activeAppleTrackId) {
    const track = currentTrack();
    activeProvider = "";
    activeAppleTrackId = "";
    if (videoIdFor(track) && !apiUnavailable) startYouTubePlayback("Apple Music 播放失败，正在尝试 YouTube…");
    else setPlaybackAction("retry", detail.message || "Apple Music 暂时无法播放此歌曲");
  } else if (detail.type === "initialization-error") {
    connectButton?.setAttribute("title", "Apple MusicKit 初始化失败");
  }
}

window.addEventListener("encore:apple-music", handleAppleMusicEvent);

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
  playbackAttempt += 1;
  pendingAutoplay = false;
  playbackRequested = false;
  if (ytReady && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
  if (activeProvider === "apple") window.EncAppleMusic?.pause();
  if (localAudio) pauseLocalPlayback();
  activeProvider = localAudio ? "local" : "";
  activeAppleTrackId = "";
  document.querySelector("#source-track").textContent = `${currentTrack().title} · ${currentTrack().artist}`;
  document.querySelector("#video-url").value = videoIdFor(currentTrack());
  document.querySelector("#source-error").textContent = "";
  document.querySelector("#source-dialog").showModal();
}

function normalizeName(value) {
  return value.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/g, "");
}

function updateMediaSessionMetadata(track) {
  if (!navigator.mediaSession || typeof MediaMetadata !== "function") return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artwork ? [{ src: track.artwork, sizes: "600x600", type: "image/jpeg" }] : []
    });
  } catch {}
}

function setupMediaSession() {
  if (!navigator.mediaSession?.setActionHandler) return;
  const actions = {
    play: () => togglePlayback(),
    pause: () => togglePlayback(),
    previoustrack: () => advanceTrack(-1, true),
    nexttrack: () => advanceTrack(1, true)
  };
  Object.entries(actions).forEach(([action, handler]) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  });
}

function loadYouTubeApi() {
  apiReadyTimer = setTimeout(() => {
    if (!ytReady) showConnectionFailure();
  }, 12000);
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
          apiUnavailable = false;
          clearTimeout(apiReadyTimer);
          if (muted) ytPlayer.mute();
          const autoplay = pendingAutoplay;
          pendingAutoplay = false;
          syncVideo(autoplay);
        },
        onStateChange: (event) => {
          if (activeProvider === "apple" || currentTrack()?.audioUrl) return;
          const reportedId = ytPlayer.getVideoData?.()?.video_id;
          if (!activeVideoId || (reportedId && reportedId !== activeVideoId)) return;
          const playing = event.data === YT.PlayerState.PLAYING;
          if (playing) {
            if (!playbackRequested) {
              ytPlayer.pauseVideo();
              return;
            }
            videoBlocked = false;
            document.querySelector("#play-toggle").disabled = !filteredIndexes.length;
            setPlaying(true, "Now Playing");
          } else if (event.data === YT.PlayerState.PAUSED) {
            setPlaying(false, "Paused");
          } else if (event.data === YT.PlayerState.BUFFERING) {
            if (!videoBlocked) setPlaybackAction("loading", "Loading…");
          } else if (event.data === YT.PlayerState.CUED) {
            document.querySelector("#play-toggle").disabled = !ytReady || !filteredIndexes.length;
            setPlaying(false, "Ready to play");
          }
          if (event.data === YT.PlayerState.ENDED) {
            setPlaying(false, "Finished");
            if (lyricsSyncMode) return;
            if (repeat) {
              ytPlayer.seekTo(0, true);
              ytPlayer.playVideo();
            } else {
              advanceTrack(1, true);
            }
          }
        },
        onError: (event) => {
          if (activeProvider === "apple" || currentTrack()?.audioUrl) return;
          const reportedId = ytPlayer.getVideoData?.()?.video_id;
          if (!activeVideoId || (reportedId && reportedId !== activeVideoId)) return;
          videoBlocked = true;
          videoErrorCode = Number(event.data) || 0;
          console.warn(`YouTube playback failed for ${currentTrack()?.title || "current track"}: ${youtubeErrorMessage(videoErrorCode)}`);
          setPlaybackAction("retry", youtubeErrorMessage(videoErrorCode));
        },
        onAutoplayBlocked: () => {
          if (activeVideoId && !videoBlocked) setPlaying(false, "播放被浏览器阻止，请再次点击播放按钮");
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
  script.onerror = showConnectionFailure;
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
  const art = document.createElement("span");
  art.className = "cover-art";
  art.append(face, reflection);
  button.append(art);
  return button;
}

function renderQueue() {
  const list = document.querySelector("#queue-list");
  document.querySelector("#queue-heading span").textContent = `${tracks.length} tracks`;
  list.replaceChildren(...tracks.map((track, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-current", index === currentIndex ? "true" : "false");
    button.innerHTML = `<span class="queue-number">${String(index + 1).padStart(2, "0")}</span><img src="${track.artwork}" alt=""><span class="queue-text"><b></b><small></small></span>`;
    button.querySelector(".queue-text b").textContent = track.title;
    button.querySelector(".queue-text small").textContent = `${track.artist} · ${track.album}${track.audioUrl ? " · 本地音频" : ""}`;
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
  cancelLyricsSync({ render: false });
  playbackAttempt += 1;
  releaseLocalAudio();
  if (activeProvider === "apple") window.EncAppleMusic?.pause();
  if (activeProvider === "youtube" && ytReady) ytPlayer.pauseVideo();
  activeProvider = "";
  activeAppleTrackId = "";
  const track = currentTrack();
  if (!track) return;
  ambientRequested = false;
  document.querySelector("#track-title").textContent = track.title;
  document.querySelector("#track-artist").textContent = track.artist;
  document.querySelector("#track-album").textContent = track.album;
  updateMediaSessionMetadata(track);
  window.encoreAmbient?.setTrack();
  document.querySelector("#notes-track").textContent = track.title;
  document.querySelector("#notes-album").textContent = track.album;
  document.querySelector("#lyrics-dialog").style.setProperty("--lyrics-artwork", `url("${track.artwork}")`);
  renderLyrics(track);
  renderDeck();
  renderQueue();
  syncVideo(false);
  saveState();
  if (autoplay) startPreferredPlayback();
}

function syncVideo(autoplay = false) {
  const track = currentTrack();
  if (!track) return;
  const videoId = videoIdFor(track);
  const hasVideo = Boolean(videoId);
  pendingAutoplay = autoplay && !ytReady && hasVideo && !apiUnavailable;
  activeVideoId = videoId;
  videoBlocked = false;
  playbackRequested = autoplay && hasVideo && !apiUnavailable;
  const query = encodeURIComponent(`${track.artist} ${track.title} official music video`);
  const searchUrl = `https://www.youtube.com/results?search_query=${query}`;
  document.querySelector("#video-external").href = videoId ? `https://www.youtube.com/watch?v=${videoId}` : searchUrl;
  if (track.audioUrl) {
    activeVideoId = "";
    pendingAutoplay = false;
    playbackRequested = false;
    if (ytReady) ytPlayer.stopVideo();
    if (!filteredIndexes.length) setPlaybackAction("empty", "No matching tracks");
    else setPlaybackAction(localAction, localLabel);
    return;
  }
  if (!filteredIndexes.length) setPlaybackAction("empty", "No matching tracks");
  else if (activeProvider === "apple") return;
  else if (!hasVideo) setPlaybackAction("unavailable", "此歌曲暂无可用音源");
  else if (apiUnavailable) setPlaying(false);
  else if (!ytReady && !autoplay) setPlaybackAction("play", "Ready to play");
  else setPlaybackAction("loading", ytReady ? "Loading video…" : "Connecting to YouTube…");
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
  if (document.querySelector("#play-toggle").disabled) return;
  const track = currentTrack();
  if (!filteredIndexes.length) return;
  if (document.querySelector("#play-toggle").dataset.action !== "pause") window.encoreAmbient?.preparePlayback();
  if (track.audioUrl) {
    if (localAudio && !localAudio.paused) pauseLocalPlayback();
    else startPreferredPlayback();
    return;
  }
  if (activeProvider === "apple") {
    if (document.querySelector("#play-toggle").dataset.action === "pause") {
      window.EncAppleMusic?.pause();
      setPlaybackAction("play", "Apple Music · 已暂停");
    } else {
      const attempt = ++playbackAttempt;
      setPlaybackAction("loading", "正在恢复 Apple Music…");
      window.EncAppleMusic?.resume().catch((error) => {
        if (attempt !== playbackAttempt || currentTrack()?.id !== track.id || activeProvider !== "apple") return;
        activeProvider = "";
        activeAppleTrackId = "";
        setPlaybackAction("retry", error.message || "Apple Music 暂时无法恢复播放");
      });
    }
    return;
  }
  if (activeProvider !== "youtube") {
    startPreferredPlayback();
    return;
  }
  const videoId = videoIdFor(track);
  if (!videoId || apiUnavailable) {
    setPlaying(false);
    return;
  }
  playbackRequested = true;
  if (ytReady) {
    const state = ytPlayer.getPlayerState();
    if (videoBlocked) {
      videoBlocked = false;
      setPlaybackAction("loading", "Loading…");
      ytPlayer.loadVideoById(videoId);
    } else if (state === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
    else ytPlayer.playVideo();
  } else {
    pendingAutoplay = true;
    setPlaybackAction("loading", "Connecting to YouTube…");
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
    playbackAttempt += 1;
    pendingAutoplay = false;
    if (localAudio) pauseLocalPlayback();
    if (activeProvider === "apple") window.EncAppleMusic?.pause();
    if (ytReady) ytPlayer.pauseVideo();
    playbackRequested = false;
    setPlaybackAction("empty", "No matching tracks");
    renderDeck();
  } else if (!filteredIndexes.includes(currentIndex)) {
    selectTrack(filteredIndexes[0]);
  } else {
    if (currentTrack()?.audioUrl) {
      setPlaybackAction(localAction, localLabel);
      renderDeck();
      return;
    }
    if (activeProvider === "apple") {
      renderDeck();
      return;
    }
    const state = ytReady ? ytPlayer.getPlayerState() : -1;
    if (!videoIdFor(currentTrack()) || videoBlocked || apiUnavailable) setPlaying(false);
    else if ([1, 2, 5].includes(state)) setPlaying(state === 1, state === 1 ? "Now Playing" : state === 2 ? "Paused" : "Ready to play");
    else setPlaybackAction(ytReady ? "loading" : "play", ytReady ? "Loading video…" : "Ready to play");
    renderDeck();
  }
}

function parseLrc(text) {
  const lines = [];
  const offsetMatch = text.match(/^\[offset:([+-]?\d+)\]/im);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  for (const row of text.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const content = row.replace(/\[[^\]]+\]/g, "").trim();
    if (!content) continue;
    for (const stamp of stamps) {
      const fraction = Number(`0.${stamp[3] || "0"}`);
      const time = Number(stamp[1]) * 60 + Number(stamp[2]) + fraction + offset;
      lines.push({ time: Math.max(0, time), text: content });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function alignedLyricsForTrack(track, lyrics) {
  const timing = window.ENCORE_LYRIC_TIMINGS?.[track.id];
  if (!timing || !window.EncoreLyricTiming || !lyrics?.text) return null;
  if (timing.audioUrl && timing.audioUrl !== track.audioUrl) return null;
  if (timing.videoId && videoIdFor(track) !== timing.videoId) return null;
  const lines = window.EncoreLyricTiming.synchronize(lyrics.text, timing);
  return lines?.length ? { lines, source: timing.source || "audio-alignment" } : null;
}

function renderLyrics(track) {
  cancelLyricsSync({ render: false });
  const lyrics = lyricsForTrack(track);
  activeLyrics = [];
  activeLyricIndex = -1;
  lyricsView.replaceChildren();
  if (!lyrics?.text?.trim()) {
    lyricsView.hidden = true;
    document.querySelector("#lyrics-sync-start").hidden = true;
    noteCopy.hidden = false;
    noteCopy.textContent = "Lyrics unavailable";
    document.querySelector("#notes-disclaimer").hidden = false;
    document.querySelector("#notes-disclaimer").textContent = "LRC / TXT";
    return;
  }
  // Imported or manually saved LRC remains the listener's chosen timeline.
  if (lyrics.format === "lrc" && parseLrc(lyrics.text).length) {
    showLyrics(lyrics.text, "lrc", lyrics.source || "");
    return;
  }
  const aligned = alignedLyricsForTrack(track, lyrics);
  const syncedText = lyrics.syncedText?.trim();
  const timing = window.ENCORE_LYRIC_TIMINGS?.[track.id];
  const matchingVideo = !timing?.videoId || videoIdFor(track) === timing.videoId;
  if (aligned && !(aligned.source === "lrclib" && matchingVideo && syncedText && parseLrc(syncedText).length)) {
    showLyrics(lyrics.text, "lrc", aligned.source, aligned.lines);
  } else if (matchingVideo && syncedText && parseLrc(syncedText).length) {
    showLyrics(syncedText, "lrc", lyrics.source || "");
  } else {
    showLyrics(lyrics.text, lyrics.format, lyrics.source || "");
    if (!matchingVideo) document.querySelector("#notes-disclaimer").textContent = "TXT · 当前播放版本暂无同步时间轴";
  }
}

function showLyrics(text, format, source = "", timedLines = null) {
  const isLrc = format === "lrc";
  activeLyrics = timedLines || (isLrc ? parseLrc(text) : []);
  document.querySelector("#lyrics-sync-start").hidden = Boolean(activeLyrics.length);
  noteCopy.hidden = true;
  document.querySelector("#notes-disclaimer").hidden = false;
  const sourceLabel = source === "embedded" ? "MP3 内嵌" : source === "audio-alignment" ? "音频对齐" : source === "lrclib" ? "LRCLIB" : source === "lyrics.ovh" ? "Lyrics.ovh" : "On this device";
  document.querySelector("#notes-disclaimer").textContent = `${isLrc ? "LRC" : "TXT"} · ${sourceLabel}`;
  lyricsView.hidden = false;
  lyricsView.replaceChildren();
  const lines = activeLyrics.length ? activeLyrics : text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ text: line }));
  if (lines.length) {
    lines.forEach((line) => {
      const el = document.createElement("div");
      el.className = "lyrics-line";
      if (Number.isFinite(line.time)) el.dataset.time = line.time;
      el.textContent = line.text;
      lyricsView.append(el);
    });
  }
  requestAnimationFrame(() => {
    if (!activeLyrics.length && lyricsView.children.length) {
      const first = lyricsView.firstElementChild;
      lyricsView.scrollTop = Math.max(0, first.offsetTop - (lyricsView.clientHeight - first.clientHeight) / 2);
      updateStaticLyricsFocus();
    }
    updateProgress();
  });
}

function setLyricsMessage(message, source = "") {
  cancelLyricsSync({ render: false });
  activeLyrics = [];
  activeLyricIndex = -1;
  document.querySelector("#lyrics-sync-start").hidden = true;
  lyricsView.hidden = true;
  lyricsView.replaceChildren();
  noteCopy.hidden = false;
  noteCopy.textContent = message;
  const disclaimer = document.querySelector("#notes-disclaimer");
  disclaimer.hidden = !source;
  disclaimer.textContent = source;
}

function updateStaticLyricsFocus() {
  if (activeLyrics.length || lyricsSyncMode || lyricsView.hidden || !lyricsView.children.length) return;
  const center = lyricsView.getBoundingClientRect().top + lyricsView.clientHeight / 2;
  let closest = null;
  let closestDistance = Infinity;
  [...lyricsView.children].forEach((line) => {
    const rect = line.getBoundingClientRect();
    const distance = Math.abs(rect.top + rect.height / 2 - center);
    if (distance < closestDistance) {
      closest = line;
      closestDistance = distance;
    }
  });
  [...lyricsView.children].forEach((line) => line.classList.toggle("is-active", line === closest));
}

function buildLyricsQueryVariants(track) {
  const lyricsDuration = track.audioDurationSeconds || track.lyricsDurationSeconds;
  const variants = [];
  const seen = new Set();
  const addVariant = ({ includeAlbum, includeDuration }) => {
    const params = new URLSearchParams({
      track_name: track.title,
      artist_name: track.artist
    });
    if (includeAlbum && track.album) params.set("album_name", track.album);
    if (includeDuration && Number.isFinite(lyricsDuration) && lyricsDuration > 0) {
      params.set("duration", String(lyricsDuration));
    }
    if (window.ENCORE_LYRIC_TIMINGS?.[track.id]?.audioUrl === track.audioUrl && track.audioUrl) {
      params.set("prefer_plain", "1");
    }
    const key = params.toString();
    if (!seen.has(key)) {
      seen.add(key);
      variants.push(params);
    }
  };

  addVariant({ includeAlbum: true, includeDuration: true });
  addVariant({ includeAlbum: false, includeDuration: true });
  addVariant({ includeAlbum: false, includeDuration: false });
  return variants;
}

async function loadLyricsForTrack(track, { refresh = false, silent = false } = {}) {
  if (!track) return;
  const existing = lyricsForTrack(track);
  if (existing?.text?.trim() && !refresh) {
    if (currentTrack()?.id === track.id) renderLyrics(track);
    const isOnlineLyrics = ["lrclib", "lyrics.ovh"].includes(existing.source);
    const timing = window.ENCORE_LYRIC_TIMINGS?.[track.id];
    const completeAlignedText = timing?.audioUrl === track.audioUrl
      && window.EncoreLyricTiming?.matchesText(existing.text, timing);
    if (isOnlineLyrics && !completeAlignedText && !existing.syncedText?.trim() && existing.format !== "lrc" && !lyricsSyncRefreshAttempted.has(track.id)) {
      lyricsSyncRefreshAttempted.add(track.id);
      void loadLyricsForTrack(track, { refresh: true, silent: true });
    }
    return;
  }
  if (location.protocol === "file:") {
    if (!silent) setLyricsMessage("Open http://127.0.0.1:8766 to search online lyrics", "Run npm run serve");
    return;
  }
  const pending = lyricsLookupRequests.get(track.id);
  if (pending) return pending;
  const retryAfter = lyricsLookupRetryAfter.get(track.id) || 0;
  if (Date.now() < retryAfter) return;

  if (!silent) setLyricsMessage("Looking up lyrics…", "Searching LRCLIB");
  const queryVariants = buildLyricsQueryVariants(track);
  const isLocalPreview = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

  const request = (async () => {
    let cooldown = 15_000;
    let timeoutId;
    lyricsSyncRefreshAttempted.add(track.id);
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 15_000);
      let result = null;
      let lastFailure = null;
      for (const params of queryVariants) {
        const lyricsUrl = isLocalPreview
          ? `/api/lyrics?${params}`
          : `https://lrclib.net/api/get?${params}`;
        let response = await fetch(lyricsUrl, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
          cache: "no-store"
        });
        if (isLocalPreview && response.status >= 500) {
          response = await fetch(`https://lrclib.net/api/get?${params}`, {
            headers: { Accept: "application/json" },
            signal: controller.signal,
            cache: "no-store"
          });
        }
        if (response.status === 404) {
          lastFailure = "not-found";
          continue;
        }
        if (!response.ok) {
          lastFailure = `lyrics-request-${response.status}`;
          continue;
        }
        const candidate = await response.json();
        const expectedTitle = normalizeName(track.title);
        const expectedArtist = normalizeName(track.artist);
        const matchedTitle = normalizeName(candidate.trackName || candidate.name || "");
        const matchedArtist = normalizeName(candidate.artistName || "");
        const titleMatches = matchedTitle && (matchedTitle.includes(expectedTitle) || expectedTitle.includes(matchedTitle));
        const artistMatches = matchedArtist && (matchedArtist.includes(expectedArtist) || expectedArtist.includes(matchedArtist));
        const plainLyrics = candidate.plainLyrics?.trim();
        const syncedLyrics = candidate.syncedLyrics?.trim();
        const text = plainLyrics || (syncedLyrics ? syncedLyrics.replace(/\[[^\]]+\]/g, "").trim() : "");
        if (titleMatches && artistMatches && text) {
          result = candidate;
          break;
        }
        lastFailure = "lyrics-not-available";
      }

      if (!result && !isLocalPreview) {
        try {
          const plainUrl = `https://api.lyrics.ovh/v1/${encodeURIComponent(track.artist)}/${encodeURIComponent(track.title)}`;
          const plainResponse = await fetch(plainUrl, {
            headers: { Accept: "application/json" },
            signal: controller.signal,
            cache: "no-store"
          });
          if (plainResponse.ok) {
            const plainResult = await plainResponse.json();
            if (plainResult.lyrics?.trim()) {
              result = {
                trackName: track.title,
                artistName: track.artist,
                albumName: track.album,
                plainLyrics: plainResult.lyrics.trim(),
                syncedLyrics: "",
                provider: "lyrics.ovh"
              };
            }
          }
        } catch (error) {
          if (error.name === "AbortError") throw error;
          lastFailure = `lyrics-plain-request-${error.message}`;
        }
      }

      if (!result) {
        cooldown = 30 * 60_000;
        throw new Error(lastFailure === "not-found" || lastFailure === "lyrics-not-available" ? "not-found" : lastFailure || "lyrics-not-available");
      }

      const plainLyrics = result.plainLyrics?.trim();
      const syncedLyrics = result.syncedLyrics?.trim();
      const text = plainLyrics || (syncedLyrics ? syncedLyrics.replace(/\[[^\]]+\]/g, "").trim() : "");

      const latestLyrics = lyricsByTrack[track.id];
      if (["local-sync", "imported"].includes(latestLyrics?.source)) return;

      lyricsByTrack[track.id] = {
        text,
        format: "txt",
        source: result.provider || "lrclib",
        syncedText: syncedLyrics || ""
      };
      saveLyrics();
      if (currentTrack()?.id === track.id) {
        document.querySelector("#notes-track").textContent = track.title;
        document.querySelector("#notes-album").textContent = track.album;
        if (!lyricsSyncMode || lyricsSyncTrackId !== track.id) renderLyrics(track);
      }
    } catch (error) {
      lyricsLookupRetryAfter.set(track.id, Date.now() + cooldown);
      lyricsSyncRefreshAttempted.delete(track.id);
      if (currentTrack()?.id === track.id) {
        if (!silent) {
          const message = error.message === "not-found" || error.message === "lyrics-not-available"
            ? "Lyrics not found · Import a TXT or LRC file"
            : "Could not reach the lyrics service · Try again later";
          setLyricsMessage(message, "LRCLIB");
        }
      }
    } finally {
      clearTimeout(timeoutId);
      lyricsLookupRequests.delete(track.id);
    }
  })();
  lyricsLookupRequests.set(track.id, request);
  return request;
}

function updateLyrics(time) {
  if (!activeLyrics.length) {
    updateStaticLyricsFocus();
    return;
  }
  let active = -1;
  activeLyrics.forEach((line, index) => {
    if (line.time <= time) active = index;
  });
  if (active >= 0 && Number.isFinite(activeLyrics[active].end) && time > activeLyrics[active].end + 1) active = -1;
  if (active === activeLyricIndex) return;
  activeLyricIndex = active;
  const activeTime = active >= 0 ? activeLyrics[active].time : Number.NaN;
  const firstAtActiveTime = Number.isFinite(activeTime)
    ? activeLyrics.findIndex((line) => line.time === activeTime)
    : -1;
  [...lyricsView.children].forEach((line, index) => {
    const isActive = Number.isFinite(activeTime) && activeLyrics[index]?.time === activeTime;
    line.classList.toggle("is-active", isActive);
    if (isActive && index === firstAtActiveTime && document.querySelector("#lyrics-dialog").open) {
      lyricsView.scrollTo({ top: line.offsetTop - lyricsView.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
    }
  });
}

function currentPlaybackTime() {
  const track = currentTrack();
  if (activeProvider === "local" && localAudio) return Number(localAudio.currentTime) || 0;
  if (activeProvider === "apple") return Number(window.EncAppleMusic?.playbackTime()) || 0;
  if (activeProvider === "youtube" && ytReady && videoIdFor(track)) return Number(ytPlayer.getCurrentTime()) || 0;
  return null;
}

function updateProgress() {
  updateLyrics(currentPlaybackTime() ?? 0);
}

function formatLrcTime(time) {
  const totalHundredths = Math.round(Math.max(0, time) * 100);
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor(totalHundredths / 100) % 60;
  const hundredths = totalHundredths % 100;
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}]`;
}

function updateLyricsSyncControls() {
  const stampedCount = lyricsSyncDraft.filter((line) => Number.isFinite(line.time)).length;
  document.querySelector("#lyrics-sync-status").textContent =
    `听到每句开头时点击对应歌词打点 · 已标记 ${stampedCount} / ${lyricsSyncDraft.length} 句 · 进度自动保存`;
  document.querySelector("#lyrics-sync-undo").disabled = lyricsSyncHistory.length === 0;
  document.querySelector("#lyrics-sync-save").disabled = stampedCount !== lyricsSyncDraft.length;
}

function persistLyricsSyncDraft() {
  if (!lyricsSyncMode || !lyricsSyncTrackId) return;
  lyricsSyncDrafts[lyricsSyncTrackId] = {
    lines: lyricsSyncDraft.map(line => line.text),
    times: lyricsSyncDraft.map(line => line.time),
    history: [...lyricsSyncHistory]
  };
  try {
    localStorage.setItem(LYRICS_DRAFT_STORAGE_KEY, JSON.stringify(lyricsSyncDrafts));
  } catch {
    document.querySelector("#lyrics-sync-status").textContent = "浏览器空间不足，打点进度暂时无法保存。";
  }
}

function startLyricsSync() {
  const track = currentTrack();
  const lyrics = track && lyricsForTrack(track);
  const lines = lyrics?.text?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) || [];
  if (!track || !lines.length) return;

  lyricsSyncMode = true;
  lyricsSyncTrackId = track.id;
  const draft = lyricsSyncDrafts[track.id];
  const canResume = Array.isArray(draft?.lines) && Array.isArray(draft?.times)
    && draft.lines.length === lines.length && draft.lines.every((text, index) => text === lines[index]);
  lyricsSyncDraft = lines.map((text, index) => ({ text, time: canResume && Number.isFinite(draft.times[index]) ? draft.times[index] : null }));
  lyricsSyncHistory = canResume && Array.isArray(draft.history)
    ? draft.history.filter(index => Number.isInteger(index) && Number.isFinite(lyricsSyncDraft[index]?.time)) : [];
  activeLyrics = [];
  activeLyricIndex = -1;
  document.querySelector("#lyrics-sync-start").hidden = true;
  document.querySelector("#lyrics-sync-controls").hidden = false;
  lyricsView.hidden = false;
  noteCopy.hidden = true;
  lyricsView.replaceChildren(...lyricsSyncDraft.map((line, index) => {
    const el = document.createElement("div");
    el.className = `lyrics-line ${Number.isFinite(line.time) ? "is-stamped" : "is-sync-target"}`;
    el.dataset.syncIndex = String(index);
    el.textContent = line.text;
    if (Number.isFinite(line.time)) {
      const stamp = document.createElement("span");
      stamp.className = "lyrics-sync-time";
      stamp.textContent = formatLrcTime(line.time);
      el.append(stamp);
    }
    el.addEventListener("click", () => stampLyricsLine(index));
    return el;
  }));
  updateLyricsSyncControls();
  persistLyricsSyncDraft();
}

function stampLyricsLine(index) {
  if (!lyricsSyncMode || currentTrack()?.id !== lyricsSyncTrackId) return;
  const time = currentPlaybackTime();
  if (time === null) {
    document.querySelector("#lyrics-sync-status").textContent = "请先播放这首歌，再点击歌词句子打点。";
    return;
  }

  lyricsSyncHistory = lyricsSyncHistory.filter((item) => item !== index);
  lyricsSyncDraft[index].time = time;
  lyricsSyncHistory.push(index);
  const line = lyricsView.children[index];
  line.classList.add("is-stamped", "is-active");
  line.classList.remove("is-sync-target");
  let stamp = line.querySelector(".lyrics-sync-time");
  if (!stamp) {
    stamp = document.createElement("span");
    stamp.className = "lyrics-sync-time";
    line.append(stamp);
  }
  stamp.textContent = formatLrcTime(time);
  [...lyricsView.children].forEach((item, lineIndex) => item.classList.toggle("is-active", lineIndex === index));
  lyricsView.scrollTo({
    top: line.offsetTop - lyricsView.clientHeight / 2 + line.clientHeight / 2,
    behavior: "smooth"
  });
  updateLyricsSyncControls();
  persistLyricsSyncDraft();
}

function undoLyricsStamp() {
  const index = lyricsSyncHistory.pop();
  if (!Number.isInteger(index)) return;
  lyricsSyncDraft[index].time = null;
  const line = lyricsView.children[index];
  line.classList.remove("is-stamped", "is-active");
  line.classList.add("is-sync-target");
  line.querySelector(".lyrics-sync-time")?.remove();
  updateLyricsSyncControls();
  persistLyricsSyncDraft();
}

function cancelLyricsSync({ render = true } = {}) {
  if (!lyricsSyncMode && !lyricsSyncTrackId) return;
  persistLyricsSyncDraft();
  const trackId = lyricsSyncTrackId;
  lyricsSyncMode = false;
  lyricsSyncTrackId = "";
  lyricsSyncDraft = [];
  lyricsSyncHistory = [];
  document.querySelector("#lyrics-sync-controls").hidden = true;
  if (render && currentTrack()?.id === trackId) renderLyrics(currentTrack());
}

function saveLyricsSync() {
  if (!lyricsSyncMode || currentTrack()?.id !== lyricsSyncTrackId) return;
  if (lyricsSyncDraft.some((line) => !Number.isFinite(line.time))) return;
  const outOfOrder = lyricsSyncDraft.findIndex((line, index) => index > 0 && line.time < lyricsSyncDraft[index - 1].time);
  if (outOfOrder !== -1) {
    document.querySelector("#lyrics-sync-status").textContent = `第 ${outOfOrder + 1} 句早于上一句，请重新打点后保存。`;
    return;
  }
  const track = currentTrack();
  const lrcText = lyricsSyncDraft
    .map((line) => ({ ...line, lrcTime: formatLrcTime(line.time) }))
    .map((line) => `${line.lrcTime}${line.text}`)
    .join("\n");
  lyricsByTrack[track.id] = { text: lrcText, format: "lrc", source: "local-sync" };
  saveLyrics();
  delete lyricsSyncDrafts[track.id];
  try { localStorage.setItem(LYRICS_DRAFT_STORAGE_KEY, JSON.stringify(lyricsSyncDrafts)); } catch {}
  lyricsSyncMode = false;
  lyricsSyncTrackId = "";
  lyricsSyncDraft = [];
  lyricsSyncHistory = [];
  document.querySelector("#lyrics-sync-controls").hidden = true;
  renderLyrics(track);
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
  document.querySelector("#apple-connect").addEventListener("click", async () => {
    const appleMusic = window.EncAppleMusic;
    if (!appleMusic?.isReady()) {
      const state = appleMusic?.readyState();
      document.querySelector("#playback-state").textContent = state === "needs-setup"
        ? "请先配置 Apple MusicKit 开发者令牌"
        : "Apple Music 正在准备，请稍后再试";
      return;
    }
    document.querySelector("#playback-state").textContent = "正在连接 Apple Music…";
    try {
      const connected = await appleMusic.connect();
      document.querySelector("#playback-state").textContent = connected ? "Apple Music 已连接" : "Apple Music 尚未授权";
    } catch {
      document.querySelector("#playback-state").textContent = "Apple Music 授权未完成";
    }
  });
  document.querySelector("#queue-open").addEventListener("click", () => document.querySelector("#queue-dialog").showModal());
  document.querySelector("#lyrics-open").addEventListener("click", () => {
    document.querySelector("#lyrics-dialog").showModal();
    activeLyricIndex = -1;
    loadLyricsForTrack(currentTrack());
    updateProgress();
  });
  document.querySelector("#lyrics-sync-start").addEventListener("click", startLyricsSync);
  document.querySelector("#lyrics-sync-play").addEventListener("click", togglePlayback);
  document.querySelector("#lyrics-sync-undo").addEventListener("click", undoLyricsStamp);
  document.querySelector("#lyrics-sync-save").addEventListener("click", saveLyricsSync);
  document.querySelector("#lyrics-sync-cancel").addEventListener("click", () => cancelLyricsSync());
  document.querySelector("#lyrics-dialog").addEventListener("close", () => cancelLyricsSync({ render: false }));
  lyricsView.addEventListener("scroll", updateStaticLyricsFocus, { passive: true });
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
    window.EncAppleMusic?.setMuted(muted);
    if (localAudio) localAudio.muted = muted;
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
        format: file.name.toLowerCase().endsWith(".lrc") ? "lrc" : "txt",
        source: "imported"
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
    if (event.target.closest("#video-frame")) return;
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
    window.encoreAmbient?.setDragging(true);
    dragOffset = Math.max(-2, Math.min(2, dx / (window.innerWidth <= 700 ? 120 : 160)));
    deck.classList.add("is-dragging");
    renderDeck();
  });
  window.addEventListener("pointerup", (event) => {
    if (!isDragging) return;
    const delta = event.clientX - dragStartX;
    const vertical = gestureAxis === "vertical";
    isDragging = false;
    window.encoreAmbient?.setDragging(false);
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
    window.encoreAmbient?.setDragging(false);
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
  setupMediaSession();
  window.setInterval(updateProgress, 250);
}

async function init() {
  if (!Array.isArray(window.ENCORE_TRACKS)) throw new Error("Track data did not load");
  tracks = window.ENCORE_TRACKS;
  document.querySelector("#result-count").textContent = `· ${tracks.length} Tracks`;
  currentIndex = ((currentIndex % tracks.length) + tracks.length) % tracks.length;
  filteredIndexes = tracks.map((_, index) => index);
  records.replaceChildren(...tracks.map(makeCover));
  renderTrack();
  bindEvents();
  renderIcons();
  window.EncAppleMusic?.initialize().then((ready) => {
    if (ready && currentTrack() && !currentTrack().audioUrl && !videoIdFor(currentTrack())) {
      setPlaybackAction("play", "Apple Music 已就绪 · 点击播放");
    }
  });
  loadYouTubeApi();
}

init().catch((error) => {
  console.error(error);
  document.querySelector("#track-title").textContent = "无法载入歌单";
});
