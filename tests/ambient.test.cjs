const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function setup(protocol = "http:") {
  const root = { dataset: {} };
  const background = { dataset: {}, append() {}, replaceChildren() {} };
  const media = { matches: false, addEventListener(_, fn) { this.change = fn; } };
  const document = {
    documentElement: root, hidden: false,
    querySelector: () => background, createElement: () => ({}),
    addEventListener(_, fn) { this.change = fn; }
  };
  const players = [];
  const timers = new Map();
  const intervals = new Map();
  let timerId = 0;
  const window = { onYouTubeIframeAPIReady() {}, YT: { Player: function(host, options) {
    this.options = options;
    this.plays = this.pauses = 0;
    this.attributes = {};
    this.destroy = () => { this.destroyed = true; };
    this.mute = () => { this.muted = true; };
    this.playVideo = () => { this.plays++; };
    this.pauseVideo = () => { this.pauses++; };
    this.seekTo = time => { this.seek = time; };
    this.getIframe = () => ({ setAttribute: (key, value) => { this.attributes[key] = value; } });
    players.push(this);
  } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../ambient.js"), "utf8"), {
    document, window, location: { protocol, origin: protocol === "file:" ? "null" : "http://localhost" },
    matchMedia: () => media,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    setInterval: fn => { intervals.set(++timerId, fn); return timerId; },
    clearInterval: id => intervals.delete(id)
  });
  return { api: window.encoreAmbient, root, background, media, document, players, timers, intervals, window };
}

function readyPlayer(s) {
  const p = s.players.at(-1);
  p.options.events.onReady({ target: p });
  return p;
}

test("preparing the muted inline Parties video never starts it before the music", () => {
  const s = setup();
  s.api.setTrack();
  assert.equal(s.players.length, 0);
  s.api.preparePlayback();
  const p = readyPlayer(s);
  assert.equal(p.options.videoId, "oCkufmjcy3I");
  assert.equal(p.options.playerVars.autoplay, 0);
  assert.equal(p.options.playerVars.mute, 1);
  assert.equal(p.options.playerVars.playsinline, 1);
  assert.equal(p.options.playerVars.playlist, "oCkufmjcy3I");
  assert.equal(p.plays, 0);
  assert.ok(p.muted);
  assert.match(p.attributes.allow, /autoplay/);
  s.api.setPlaying(true);
  assert.equal(p.plays, 1);
  p.options.events.onStateChange({ data: 1 });
  assert.equal(s.background.dataset.videoState, "playing");
  assert.equal(s.root.dataset.ambientMotion, "running");
  s.api.setPlaying(false);
  assert.equal(s.root.dataset.ambientPlaying, "false");
  assert.equal(s.background.dataset.videoState, "paused");
  assert.ok(p.pauses > 0);
});

test("all track changes and resumes retain the same Parties player", () => {
  const s = setup();
  s.api.setPlaying(true);
  const p = readyPlayer(s);
  for (const title of ["Parties", "Wait for You", "Momentum", "Still Dancing"]) {
    s.api.setTrack({ title, officialVideoId: "different-id" });
    assert.equal(s.root.dataset.ambientPlaying, "false");
    s.api.setPlaying(true);
    assert.equal(s.players.length, 1);
    assert.equal(s.background.dataset.videoId, "oCkufmjcy3I");
  }
  p.options.events.onStateChange({ data: 0 });
  assert.equal(p.seek, 0, "the shared video loops independently of song duration");
});

test("hidden pages, reduced motion and dragging pause only the background and resume it", () => {
  const s = setup();
  s.api.setPlaying(true);
  const p = readyPlayer(s);
  for (const [pause, resume] of [
    [() => { s.document.hidden = true; s.document.change(); }, () => { s.document.hidden = false; s.document.change(); }],
    [() => { s.media.matches = true; s.media.change(); }, () => { s.media.matches = false; s.media.change(); }],
    [() => s.api.setDragging(true), () => s.api.setDragging(false)]
  ]) {
    const plays = p.plays;
    pause();
    assert.equal(s.root.dataset.ambientMotion, "paused");
    assert.equal(s.timers.size, 0);
    resume();
    assert.equal(s.root.dataset.ambientMotion, "running");
    assert.ok(p.plays > plays);
    assert.equal(s.players.length, 1);
  }
});

test("API initialization waits without replacing the main player's ready callback", () => {
  const s = setup("file:");
  const api = s.window.YT;
  const callback = s.window.onYouTubeIframeAPIReady;
  delete s.window.YT;
  s.api.setPlaying(true);
  assert.equal(s.players.length, 0);
  s.window.YT = api;
  [...s.intervals.values()][0]();
  assert.equal(s.players.length, 1);
  assert.equal(s.window.onYouTubeIframeAPIReady, callback);
  assert.equal("origin" in s.players[0].options.playerVars, false, "file pages must not send an invalid null origin");
});

test("video failures ignore stale callbacks and retry on the next playback attempt", () => {
  for (const failure of ["error", "timeout", "blocked"]) {
    const s = setup();
    s.api.setPlaying(true);
    const p = readyPlayer(s);
    if (failure === "error") p.options.events.onError({ data: 150 });
    else if (failure === "blocked") p.options.events.onAutoplayBlocked();
    else [...s.timers.values()][0]();
    assert.ok(p.destroyed);
    assert.ok(["blocked", "unavailable"].includes(s.background.dataset.videoState));
    p.options.events.onStateChange({ data: 1 });
    assert.notEqual(s.background.dataset.videoState, "playing");
    s.api.setPlaying(true);
    assert.equal(s.players.length, 1, "no retry loop during the same playback attempt");
    s.api.setPlaying(false);
    s.api.setPlaying(true);
    assert.equal(s.players.length, 2);
    assert.equal(s.players[1].options.videoId, "oCkufmjcy3I");
  }
});
