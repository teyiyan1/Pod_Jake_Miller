const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const helperSource = code.slice(
  code.indexOf('function buildLyricsQueryVariants('),
  code.indexOf('async function loadLyricsForTrack(')
);

test('lyrics lookup relaxes album matching for public previews', () => {
  const context = {
    URLSearchParams,
    window: { ENCORE_LYRIC_TIMINGS: {} }
  };
  vm.createContext(context);
  vm.runInContext(`${helperSource}; this.buildLyricsQueryVariants = buildLyricsQueryVariants;`, context);

  const rawVariants = Array.from(context.buildLyricsQueryVariants({
    id: 'steven',
    title: 'Steven',
    artist: 'Jake Miller',
    album: 'The Road Less Traveled - EP',
    audioDurationSeconds: 185.939592,
    audioUrl: './audio/steven.mp3'
  }));
  const variants = rawVariants.map(params => JSON.parse(JSON.stringify(Object.fromEntries(params.entries()))));

  assert.deepEqual(variants, [
    {
      track_name: 'Steven',
      artist_name: 'Jake Miller',
      album_name: 'The Road Less Traveled - EP',
      duration: '185.939592'
    },
    {
      track_name: 'Steven',
      artist_name: 'Jake Miller',
      duration: '185.939592'
    },
    {
      track_name: 'Steven',
      artist_name: 'Jake Miller'
    }
  ]);
});
