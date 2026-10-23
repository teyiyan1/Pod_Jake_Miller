// Build portable timing metadata from local alignment work. No lyric text is
// copied into the project: fingerprints associate online text with timestamps.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const timing = require('../lyric-timing.js');
const tracks = require('../data/tracks.js');
const work = process.argv[2];
if (!work) throw new Error('Usage: node scripts/build-lyric-timings.cjs <alignment-work-directory>');
const read = name => JSON.parse(fs.readFileSync(path.join(work, name), 'utf8'));
const output = {};
const fingerprint = lines => timing.fingerprint(lines.map(line => timing.words(line).join(' ')).join('\n'));
const round = value => Math.round(value * 100) / 100;
for (const item of read('inputs.json')) {
  if (!item.audioPath) continue;
  const { lines, plan } = read(`${item.id}.plan.json`);
  const { segments } = read(`${item.id}.refined.json`);
  if (segments.length !== plan.length) throw new Error(`${item.title}: segment count differs from lyric plan`);
  const stamps = lines.map(() => null);
  const words = [];
  let previous = -1;
  segments.forEach((segment, index) => {
    const start = round(segment.start), end = round(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previous || end > item.audioDurationSeconds + .1) {
      throw new Error(`${item.title}: invalid timestamp at segment ${index}`);
    }
    if (end - start < .25) return;
    previous = start;
    stamps[plan[index].index] = [start, end];
    for (const word of segment.words) {
      for (const normalized of timing.words(word.word)) {
        words.push([timing.fingerprint(normalized), round(word.start), round(word.end)]);
      }
    }
  });
  output[item.id] = {
    source: 'audio-alignment', audioUrl: item.audioUrl,
    audioSha256: crypto.createHash('sha256').update(fs.readFileSync(item.audioPath)).digest('hex'),
    durationSeconds: item.audioDurationSeconds,
    textFingerprint: fingerprint(lines), lines: stamps, words
  };
}
// Parties uses the approved official audio, whose duration matches this LRCLIB
// recording. Its music-video edit has a different timeline.
const parties = read('parties-11279170.json');
const catalog = tracks.find(track => track.title === 'Parties');
const rows = parties.syncedLyrics.split(/\r?\n/).flatMap(row => {
  const match = row.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
  return match ? [{ time: Number(match[1]) * 60 + Number(match[2]), text: match[3].trim() }] : [];
});
const sung = rows.flatMap((row, index) => row.text ? [{...row, end: rows[index + 1]?.time || parties.duration}] : []);
output[catalog.id] = {
  source: 'lrclib', recordId: parties.id, videoId: catalog.lyricsVideoId,
  durationSeconds: parties.duration,
  textFingerprint: fingerprint(sung.map(row => row.text)),
  lines: sung.map(row => [round(row.time), round(row.end)]),
  // These are line timestamps supplied by LRCLIB, not estimated word timings.
  words: sung.flatMap(row => timing.words(row.text).map(word => [timing.fingerprint(word), round(row.time), round(row.end)]))
};
const target = path.join(__dirname, '../data/lyric-timings.js');
const serialized = JSON.stringify(output, null, 2).replace(/\[\n\s+([\d.,\s]+)\n\s+\]/g,
  (_, values) => `[${values.trim().split(/,\s*/).join(', ')}]`);
fs.writeFileSync(target, `// Timing metadata only; lyric text is fetched or imported by the listener.\n(function (root) {\n  const timings = ${serialized};\n  if (typeof module !== "undefined") module.exports = timings;\n  if (root) root.ENCORE_LYRIC_TIMINGS = timings;\n})(typeof window !== "undefined" ? window : null);\n`);
console.log(JSON.stringify(Object.entries(output).map(([id, record]) => ({id, lines: record.lines.filter(Boolean).length, words:record.words.length}))));
