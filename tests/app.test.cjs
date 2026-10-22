const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const tracks = require("../data/tracks.js");

test("rebuilt setlist has 27 unique tracks", () => {
  assert.equal(tracks.length, 27);
  assert.equal(new Set(tracks.map((track) => track.id)).size, 27);
});

test("Parties is restored as the eighth track with its known video", () => {
  assert.equal(tracks[7].title, "Parties");
  assert.equal(tracks[7].officialVideoId, "oCkufmjcy3I");
  assert.ok(tracks[7].note);
});

test("unverified video and note data stay empty instead of being fabricated", () => {
  const unknown = tracks.filter((track) => track.title !== "Parties");
  assert.ok(unknown.every((track) => !track.officialVideoId));
  assert.ok(unknown.every((track) => !track.note));
});

test("removed controls have no remaining markup or script references", () => {
  const html = readFileSync(join(__dirname, "../index.html"), "utf8");
  const script = readFileSync(join(__dirname, "../app.js"), "utf8");
  for (const id of ["seek", "source-label", "playback-status", "audio-import", "local-audio",
    "apple-link", "familiar-toggle", "familiar-count", "help-open",
    "track-prev", "track-next", "track-number", "album-label"]) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`));
    assert.doesNotMatch(script, new RegExp(`#${id}\\b`));
  }
  for (const selector of ["brand-caption", "source-row", "timeline", "notes-actions",
    "brand-mark", "deck-pagination"]) {
    assert.doesNotMatch(html, new RegExp(`class="${selector}"`));
  }
});
