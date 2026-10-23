const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');
const helper = require('../lyric-timing.js');
const catalog = require('../data/tracks.js');
const timings = require('../data/lyric-timings.js');
function fixture(text, stamps) {
  const lines = helper.splitLines(text);
  return {
    textFingerprint: helper.fingerprint(lines.map(line => helper.words(line).join(' ')).join('\n')),
    lines: stamps,
    words: lines.flatMap((line, index) => stamps[index] ? helper.words(line).map(word => [helper.fingerprint(word), ...stamps[index]]) : [])
  };
}

test('exact text retains acoustic line timestamps and omits untimed credits', () => {
  const text = 'WRITTEN BY: Sample Person\nFirst imagined phrase\nAnother imagined phrase';
  const record = fixture(text, [null, [1.2, 3.4], [5.6, 8.9]]);
  assert.deepEqual(helper.synchronize(text, record), [
    {text:'First imagined phrase',time:1.2,end:3.4},
    {text:'Another imagined phrase',time:5.6,end:8.9}
  ]);
});

test('punctuation changes and alternative line breaks retain word associations', () => {
  const record = fixture('Our bright morning comes\nAcross the quiet valley', [[2,5],[6,9]]);
  const result = helper.synchronize('OUR bright morning comes! Across\nthe quiet valley.', record);
  assert.equal(result.length, 2);
  assert.equal(result[0].time, 2);
  assert.equal(result[1].time, 6);
  assert.equal(helper.synchronize('A completely unrelated song has different words', record), null);
});

test('concatenated lyric lines are separated before matching', () => {
  assert.deepEqual(helper.splitLines('First phraseSecond phrase'), ['First phrase','Second phrase']);
});

test('all five requested tracks have ordered, bounded, recording-specific timelines', () => {
  const expected = ['Parties','Wait for You','Momentum','Waiting On August','Spark'];
  assert.deepEqual(catalog.filter(track => timings[track.id]).map(track => track.title), expected);
  for (const track of catalog.filter(track => timings[track.id])) {
    const timing = timings[track.id];
    const rows = timing.lines.filter(Boolean);
    assert.ok(rows.length >= 30, track.title);
    let previousEnd = 0;
    for (const [start,end] of rows) {
      assert.ok(Number.isFinite(start) && end > start && start >= previousEnd - .03, `${track.title}: ${start}, ${end}`);
      assert.ok(end <= timing.durationSeconds + .1);
      previousEnd = end;
    }
    if (track.audioUrl) {
      assert.equal(timing.audioUrl, track.audioUrl);
      assert.equal(createHash('sha256').update(readFileSync(path.resolve(__dirname,'..',track.audioUrl))).digest('hex'),timing.audioSha256);
    } else {
      assert.equal(timing.videoId, track.lyricsVideoId);
      assert.ok(Math.abs(timing.durationSeconds - track.lyricsDurationSeconds) < 1);
    }
  }
});

test('every line follows playback time, including backward seeks and instrumental gaps', () => {
  const code = readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const updateFunction = code.slice(code.indexOf('function updateLyrics(time)'),code.indexOf('function currentPlaybackTime()'));
  for (const timing of Object.values(timings)) {
    const rows = timing.lines.filter(Boolean).map(([time,end]) => ({time,end}));
    const children = rows.map(() => ({active:false,classList:{toggle(_,value){children[this.index].active=value;},index:0},offsetTop:100,clientHeight:20}));
    children.forEach((row,index)=>row.classList.index=index);
    const context = {
      activeLyrics:rows, activeLyricIndex:-1,
      lyricsView:{children,clientHeight:400,scrollTo(){}},
      document:{querySelector:()=>({open:true})},updateStaticLyricsFocus(){}
    };
    vm.createContext(context);vm.runInContext(updateFunction,context);
    for (const index of [...rows.keys(),...[...rows.keys()].reverse()]) {
      context.updateLyrics(rows[index].time + .001);
      assert.equal(context.activeLyricIndex,index);
      assert.equal(children.filter(row=>row.active).length,1);
    }
    context.updateLyrics(timing.durationSeconds+2);
    assert.equal(children.filter(row=>row.active).length,0);
  }
});

function appFunction(name, nextName) {
  const code = readFileSync(path.join(__dirname,'../app.js'),'utf8');
  return code.slice(code.indexOf(`function ${name}(`),code.indexOf(`function ${nextName}(`));
}

test('a timeline is applied only to its associated audio or video recording', () => {
  const text='An imagined lyric phrase';
  const record=fixture(text,[[2,5]]);
  const context={window:{EncoreLyricTiming:helper,ENCORE_LYRIC_TIMINGS:{audio:{...record,audioUrl:'./same.mp3'},video:{...record,videoId:'album-audio'}}},videoIdFor:track=>track.selectedVideo};
  vm.createContext(context);vm.runInContext(appFunction('alignedLyricsForTrack','renderLyrics'),context);
  assert.equal(context.alignedLyricsForTrack({id:'audio',audioUrl:'./changed.mp3'},{text}),null);
  assert.equal(context.alignedLyricsForTrack({id:'video',selectedVideo:'different-edit'},{text}),null);
  assert.equal(context.alignedLyricsForTrack({id:'video',selectedVideo:'album-audio'},{text}).lines[0].time,2);
});

test('imported and manually timed LRC takes precedence over automatic metadata', () => {
  let rendered;
  const text='[00:08.00]Imagined custom phrase';
  const context={lyricsByTrack:{sample:{format:'lrc',source:'local-sync',text}},activeLyrics:[],activeLyricIndex:-1,lyricsView:{replaceChildren(){}},cancelLyricsSync(){},parseLrc:()=>[{time:8,text:'Imagined custom phrase'}],showLyrics:(...args)=>{rendered=args;}};
  vm.createContext(context);vm.runInContext(appFunction('renderLyrics','showLyrics'),context);
  context.renderLyrics({id:'sample'});
  assert.equal(rendered[0],text);
  assert.equal(rendered[1],'lrc');
  assert.equal(rendered[2],'local-sync');
});

test('unfinished manual stamps are persisted with their original line order', () => {
  let saved;
  const context={lyricsSyncMode:true,lyricsSyncTrackId:'sample',lyricsSyncDrafts:{},lyricsSyncDraft:[{text:'First imagined phrase',time:1.2},{text:'Second imagined phrase',time:null}],lyricsSyncHistory:[0],LYRICS_DRAFT_STORAGE_KEY:'drafts',localStorage:{setItem:(key,value)=>{saved=JSON.parse(value);}}};
  vm.createContext(context);vm.runInContext(appFunction('persistLyricsSyncDraft','startLyricsSync'),context);
  context.persistLyricsSyncDraft();
  assert.deepEqual(saved.sample.times,[1.2,null]);
  assert.deepEqual(saved.sample.history,[0]);
});
