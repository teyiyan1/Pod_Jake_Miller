const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const tracks = require("../data/tracks.js");
const verification = require("../research/video-verification.json");

test("rebuilt setlist has 28 unique tracks", () => {
  assert.equal(tracks.length, 28);
  assert.equal(new Set(tracks.map((track) => track.id)).size, 28);
});

test("Parties is restored as the eighth track with its known video", () => {
  assert.equal(tracks[7].title, "Parties");
  assert.equal(tracks[7].officialVideoId, "oCkufmjcy3I");
  assert.ok(tracks[7].note);
});

test("original listening notes are not fabricated", () => {
  const unknown = tracks.filter((track) => track.title !== "Parties");
  assert.ok(unknown.every((track) => !track.note));
});

test("all 23 published links have approved publisher, title and public metadata evidence", () => {
  const linked = tracks.filter(track => track.officialVideoId);
  assert.equal(linked.length, 23);
  assert.equal(new Set(linked.map(track => track.officialVideoId)).size, 23);
  for (const track of linked) {
    const record = verification.tracks.find(row => row.trackId === track.id);
    assert.equal(record.selectedVideoId, track.officialVideoId);
    assert.equal(track.videoVerification.status, "publisher-title-confirmed");
    const candidate = record.candidates.find(video => video.videoId === track.officialVideoId);
    assert.equal(candidate.metadata.httpStatus, 200);
    assert.ok(candidate.channelId);
    assert.equal(candidate.metadata.title, track.videoVerification.title);
    assert.notEqual(record.runtimeStatus, "full-playback-verified");
  }
});

test("the four unresolved tracks remain explicitly pending with no substitute video", () => {
  const pending = tracks.filter(track => !track.officialVideoId && track.id !== "local-the-girl-thats-underneath");
  assert.deepEqual(pending.map(track => track.title), ["ROSS AND RACHEL", "Momentum", "Waiting On August", "Spark"]);
  assert.ok(pending.every(track => track.videoVerification.status === "pending-official-full-version"));
  assert.equal(verification.environment.playabilityStatus, "LOGIN_REQUIRED");
});

test("Answers is linked to the matching Jake Miller upload", () => {
  const answers = tracks.find(track => track.title === "Answers");
  assert.equal(answers.officialVideoId, "Kr1xzr_dQ4Y");
  assert.equal(answers.videoVerification.title, "Jake Miller - Answers (Audio)");
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

test("selected header metadata and Apple Music control stay hidden", () => {
  const html = readFileSync(join(__dirname, "../index.html"), "utf8");
  assert.match(html, /id="result-count" hidden/);
  assert.match(html, /id="apple-connect"[^>]* hidden/);
});
