const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function setup() {
  const root = { dataset: {}, style: { setProperty() {} } };
  const makeLayer = () => ({
    style: { setProperty() {} },
    querySelector: () => ({ style: {} })
  });
  const layers = [makeLayer(), makeLayer()];
  const background = {
    dataset: {},
    querySelectorAll: () => layers
  };
  const media = { matches: false, addEventListener(_, fn) { this.change = fn; } };
  const document = {
    documentElement: root,
    hidden: false,
    querySelector: () => background,
    addEventListener(_, fn) { this.change = fn; }
  };
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../ambient.js"), "utf8"), {
    document, window,
    matchMedia: () => media
  });
  return { api: window.encoreAmbient, root, background, media, document };
}

test("background uses Parties and starts only during playback", () => {
  const s = setup();
  s.api.setTrack();
  assert.equal(s.background.dataset.artwork, "Parties");
  assert.equal(s.root.dataset.ambientPlaying, "false");
  s.api.setPlaying(true);
  assert.equal(s.root.dataset.ambientPlaying, "true");
  assert.equal(s.root.dataset.ambientMotion, "running");
  s.api.setPlaying(false);
  assert.equal(s.root.dataset.ambientPlaying, "false");
  assert.equal(s.root.dataset.ambientMotion, "paused");
});

test("hidden pages and reduced motion pause the background without losing playback state", () => {
  const s = setup();
  s.api.setPlaying(true);
  s.document.hidden = true;
  s.document.change();
  assert.equal(s.root.dataset.ambientPlaying, "false");
  assert.equal(s.root.dataset.ambientMotion, "paused");
  s.document.hidden = false;
  s.document.change();
  assert.equal(s.root.dataset.ambientPlaying, "true");
  s.media.matches = true;
  s.media.change();
  assert.equal(s.root.dataset.ambientPlaying, "true");
  assert.equal(s.root.dataset.ambientMotion, "paused");
});

test("dragging pauses motion and the shared artwork remains unchanged", () => {
  const s = setup();
  s.api.setPlaying(true);
  s.api.setDragging(true);
  assert.equal(s.root.dataset.ambientMotion, "paused");
  assert.equal(s.background.dataset.artwork, "Parties");
  s.api.setDragging(false);
  assert.equal(s.root.dataset.ambientMotion, "running");
});
