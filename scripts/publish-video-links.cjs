const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const tracks = require("../data/tracks.js");
const candidates = require("../research/video-candidates.json");
const supplemental = require("../research/supplemental-metadata.json");
const environment = require("../research/playback-environment.json");
const research = path.join(__dirname, "../research");
const attempts = fs.readdirSync(research)
  .filter(name => /^video-playback-\d+-\d+\.json$/.test(name))
  .flatMap(name => JSON.parse(fs.readFileSync(path.join(research, name), "utf8")))
  .flatMap(record => record.attempts);
const normalize = text => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const checkedAt = new Date().toISOString();
const report = { checkedAt, environment, policy: "Only manually approved publisher/title matches with successful public metadata responses are linked. No third-party lyric reuploads, previews, acoustic alternatives or unrelated videos are substituted.", tracks: [] };

for (const track of tracks) {
  const approved = candidates.find(item => item.trackId === track.id)?.candidates || [];
  const title = normalize(track.title.replace(/\s*\(feat\..*?\)/i, ""));
  const confirmed = approved.flatMap(candidate => {
    const attempt = attempts.find(value => value.videoId === candidate.videoId);
    const metadata = attempt?.metadata || supplemental[candidate.videoId];
    if (metadata?.httpStatus !== 200) return [];
    assert.ok(normalize(metadata.title).includes(title), `Title mismatch for ${track.title}`);
    assert.ok(normalize(metadata.title).includes("jakemiller"), `Artist mismatch for ${track.title}`);
    return [{ ...candidate, metadata, runtimeAttempt: attempt?.playback || null }];
  });
  const selected = confirmed[0];
  const runtime = selected?.runtimeAttempt;
  const sampleVerified = runtime?.state === 1 && runtime.currentTime >= 1.5
    && runtime.videoId === selected.videoId && runtime.error === null;
  const row = {
    trackId: track.id,
    title: track.title,
    status: selected ? "publisher-title-confirmed" : "pending-official-full-version",
    selectedVideoId: selected?.videoId || "",
    candidates: confirmed,
    runtimeStatus: sampleVerified ? "playback-sample-verified" : selected ? "not-certified" : "not-tested",
    note: selected
      ? "Publisher and title confirmed. Automated playback was blocked by sign-in verification; this is not a guarantee of full playback."
      : "No approved full-version official upload found in the recorded searches. Unrelated results and third-party lyric uploads were not linked."
  };
  report.tracks.push(row);
  track.officialVideoId = row.selectedVideoId;
  track.videoVerification = {
    status: row.status,
    checkedAt,
    ...(selected ? {
      title: selected.metadata.title,
      publisher: selected.metadata.author,
      publisherUrl: selected.metadata.authorUrl,
      channelId: selected.channelId,
      watchUrl: selected.url,
      runtimeStatus: row.runtimeStatus
    } : {})
  };
}
report.summary = {
  total: tracks.length,
  sourceMatched: report.tracks.filter(track => track.selectedVideoId).length,
  pending: report.tracks.filter(track => !track.selectedVideoId).map(track => track.title),
  runtimeSamplesVerifiedThisRun: report.tracks.filter(track => track.runtimeStatus === "playback-sample-verified").length
};
fs.writeFileSync(path.join(research, "video-verification.json"), JSON.stringify(report, null, 2) + "\n");
const rows = report.tracks.map((track, index) => {
  const video = track.candidates.find(candidate => candidate.videoId === track.selectedVideoId);
  return `| ${index + 1} | ${track.title} | ${video?.metadata.author || "Pending"} | ${video ? `[YouTube](${video.url})` : "No approved full-version match"} |`;
});
fs.writeFileSync(path.join(research, "VIDEO_VERIFICATION.md"), [
  "# YouTube Source Verification",
  "",
  `Checked: ${checkedAt}`,
  "",
  `${report.summary.sourceMatched} of ${report.summary.total} tracks have manually reviewed official publisher/title matches, cross-checked against public YouTube metadata.`,
  "",
  "## Playback Limitation",
  "",
  "The automated playback environment requested sign-in to confirm the browser was not a bot. The previously working Parties control video also failed. Error 150 from this run must not be interpreted as a blanket owner prohibition on embedding.",
  "",
  "These source associations do not certify full-song playback, availability in every country, or playback without platform verification. Playback tests were stopped rather than attempting to bypass the verification.",
  "",
  "The four pending tracks have no approved official full-version match in the recorded searches. This does not establish that none exists anywhere; no unrelated, teaser, acoustic replacement or third-party lyric upload was used.",
  "",
  "## Associations",
  "",
  "| # | Track | Publisher | Source |",
  "| --- | --- | --- | --- |",
  ...rows,
  "",
  "## Evidence",
  "",
  "- `video-verification.json`: per-track metadata and runtime evidence",
  "- `playback-environment.json`: known-control failure and platform sign-in message",
  "- `youtube-search-*.json`: public search results and channel identities",
  "- `video-playback-*.json`: initial raw playback attempts (subject to the environment limitation above)",
  ""
].join("\n"));
fs.writeFileSync(path.join(__dirname, "../data/tracks.js"),
  `const encoreTracks = ${JSON.stringify(tracks, null, 2)};\nif (typeof module !== "undefined") module.exports = encoreTracks;\nif (typeof window !== "undefined") window.ENCORE_TRACKS = encoreTracks;\n`);
console.log(JSON.stringify(report.summary, null, 2));
