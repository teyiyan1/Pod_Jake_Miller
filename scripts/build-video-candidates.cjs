const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const tracks = require("../data/tracks.js");
const approved = require("../research/approved-video-ids.json");
const directory = path.join(__dirname, "../research");
const evidence = fs.readdirSync(directory)
  .filter(name => name.startsWith("youtube-search-") && name.endsWith(".json"))
  .flatMap(name => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")));
const publishers = new Set([
  "UCemWUaSsUwgeYpGfkbvSQjg",
  "UC_BdnSer2n7N-lIf8pd6MEQ",
  "UCWQB5QgiVIiuGLvQ1kuI5TA",
  "UCWNVPfzSAAJr2L4GyvF6y7g",
  "UCDCCLsZ0OBG8Dt-3JMc3hkA",
  "UCJDQtPgwh6oV5MbPmclqIAg"
]);
const candidates = tracks.map(track => ({
  trackId: track.id,
  title: track.title,
  artist: track.artist,
  candidates: (approved[track.id] || []).map(id => {
    const source = evidence.find(record => record.trackId === track.id && record.results?.some(video => video.videoId === id));
    const video = source?.results.find(value => value.videoId === id);
    assert.ok(video, `No search evidence for ${track.title}: ${id}`);
    assert.ok(publishers.has(video.channelId), `Publisher needs review for ${track.title}: ${video.channel}`);
    return { ...video, searchUrl: source.searchUrl };
  })
}));
fs.writeFileSync(path.join(directory, "video-candidates.json"), JSON.stringify(candidates, null, 2) + "\n");
console.log(`${candidates.filter(item => item.candidates.length).length}/${tracks.length} tracks have approved publisher/title matches`);
