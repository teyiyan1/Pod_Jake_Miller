const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function setup() {
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
  let timerId = 0;
  const window = { YT: { Player: function(host, options) {
    this.options = options;
    this.destroy = () => { this.destroyed = true; };
    this.mute = () => { this.muted = true; };
    this.playVideo = () => { this.started = true; };
    this.getIframe = () => ({});
    players.push(this);
  } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../ambient.js"), "utf8"), {
    document, window, location: { origin: "http://localhost" },
    matchMedia: () => media,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    setInterval: () => ++timerId, clearInterval() {}
  });
  return { api: window.encoreAmbient, root, background, media, document, players, timers };
}

test("background starts only during playback and stays muted", () => {
  const s = setup();
  s.api.setTrack({}, "oCkufmjcy3I");
  assert.equal(s.players.length, 0);
  s.api.setPlaying(true);
  const p = s.players[0];
  assert.equal(p.options.playerVars.mute, 1);
  p.options.events.onReady({ target: p });
  assert.ok(p.muted && p.started);
  p.options.events.onStateChange({ data: 1 });
  assert.equal(s.background.dataset.videoState, "playing");
  s.api.setPlaying(true);
  assert.equal(s.players.length, 1);
  s.api.setPlaying(false);
  assert.ok(p.destroyed);
  assert.equal(s.root.dataset.ambientPlaying, "false");
});

test("track changes discard old callbacks and missing videos use fallback", () => {
  const s = setup();
  s.api.setTrack({}, "oCkufmjcy3I");
  s.api.setPlaying(true);
  const old = s.players[0];
  s.api.setTrack({}, "x8Nh0rLS9yg");
  assert.ok(old.destroyed);
  old.options.events.onStateChange({ data: 1 });
  assert.equal(s.background.dataset.videoState, "fallback");
  s.api.setPlaying(true);
  assert.equal(s.players[1].options.videoId, "oCkufmjcy3I");
  s.api.setTrack({}, "");
  s.api.setPlaying(true);
  assert.equal(s.players.length, 3);
  assert.equal(s.players[2].options.videoId, "oCkufmjcy3I");
});

test("hidden pages and reduced motion stop decorative playback", () => {
  const s = setup();
  s.api.setTrack({}, "oCkufmjcy3I");
  s.api.setPlaying(true);
  s.document.hidden = true;
  s.document.change();
  assert.ok(s.players[0].destroyed);
  s.document.hidden = false;
  s.document.change();
  assert.equal(s.players.length, 2);
  s.media.matches = true;
  s.media.change();
  assert.ok(s.players[1].destroyed);
  assert.equal(s.root.dataset.ambientMotion, "paused");
});

test("video errors and loading timeouts fall back without retry loops", () => {
  for (const failure of ["error", "timeout"]) {
    const s = setup();
    s.api.setTrack({}, "oCkufmjcy3I");
    s.api.setPlaying(true);
    if (failure === "error") s.players[0].options.events.onError({});
    else [...s.timers.values()][0]();
    assert.ok(s.players[0].destroyed);
    assert.equal(s.background.dataset.videoState, "fallback");
    s.api.setPlaying(true);
    assert.equal(s.players.length, 1);
    s.api.setPlaying(false);
    s.api.setPlaying(true);
    assert.equal(s.players.length, 2);
  }
});
