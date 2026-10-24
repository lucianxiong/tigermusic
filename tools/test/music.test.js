/* 蓝虎听歌 · 纯逻辑单元测试（node --test）
 * 覆盖 app/js/music-utils.js：时间/数值工具、去重、曲库接口地址、IA 文件挑选、本地文件名、
 * 歌词接口与 LRC 解析、声纹（FFT / 峰值 / 哈希 / 匹配）、播放统计；
 * 覆盖 app/js/audio-fx.js：均衡预设表与音效偏好归一化。 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../app/js/music-utils.js');
const FX = require('../../app/js/audio-fx.js');

test('fmtTime 秒转 m:ss', function(){
  assert.equal(U.fmtTime(0), '0:00');
  assert.equal(U.fmtTime(59), '0:59');
  assert.equal(U.fmtTime(61), '1:01');
  assert.equal(U.fmtTime(3599), '59:59');
});

test('fmtTime 超过一小时显示 h:mm:ss', function(){
  assert.equal(U.fmtTime(3600), '1:00:00');
  assert.equal(U.fmtTime(3661), '1:01:01');
});

test('fmtTime 非法输入回退 0:00', function(){
  assert.equal(U.fmtTime('abc'), '0:00');
  assert.equal(U.fmtTime(-5), '0:00');
});

test('fmtMS 毫秒转 m:ss', function(){
  assert.equal(U.fmtMS(61000), '1:01');
  assert.equal(U.fmtMS(180000), '3:00');
});

test('clampNum 钳制', function(){
  assert.equal(U.clampNum(5, 0, 10), 5);
  assert.equal(U.clampNum(-1, 0, 10), 0);
  assert.equal(U.clampNum(99, 0, 10), 10);
  assert.equal(U.clampNum('x', 0, 10), 0);
});

test('shuffleCopy 返回新数组且元素不变', function(){
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = U.shuffleCopy(src);
  assert.notEqual(out, src);
  assert.equal(out.length, src.length);
  assert.deepEqual(out.slice().sort(function(a, b){ return a - b; }), src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8], '原数组不被修改');
});

test('dedupeSongs 按 id 去重保序', function(){
  const songs = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'a', title: 'A2' },
    { id: 'c', title: 'C' }
  ];
  const out = U.dedupeSongs(songs);
  assert.deepEqual(out.map(function(s){ return s.id; }), ['a', 'b', 'c']);
  assert.equal(out[0].title, 'A');
});

test('cleanTerm 清洗搜索词', function(){
  assert.equal(U.cleanTerm('  周杰伦  晴天  '), '周杰伦 晴天');
  assert.equal(U.cleanTerm('  '), '');
});

test('iaSearchURL 包含音乐集合、标题条件与音频格式字段', function(){
  const url = U.iaSearchURL('古琴', 10);
  assert.ok(url.indexOf('advancedsearch.php') >= 0);
  assert.ok(url.indexOf('mediatype%3Aaudio') >= 0);
  assert.ok(url.indexOf('opensource_audio') >= 0);
  assert.ok(url.indexOf('78rpm') >= 0);
  assert.ok(url.indexOf('title%3A(') >= 0);
  assert.ok(url.indexOf('fl%5B%5D=format') >= 0);
  assert.ok(url.indexOf('rows=10') >= 0);
  assert.ok(url.indexOf('output=json') >= 0);
  assert.ok(url.indexOf('downloads+desc') >= 0);
});

test('iaSearchURL 空关键词只按集合搜索', function(){
  const url = U.iaSearchURL('', 5);
  assert.ok(url.indexOf('title%3A(') < 0);
  assert.ok(url.indexOf('rows=5') >= 0);
});

test('audiusSearchURL 免密钥搜索参数', function(){
  const url = U.audiusSearchURL('piano', 20);
  assert.ok(url.indexOf('api.audius.co/v1/tracks/search') >= 0);
  assert.ok(url.indexOf('query=piano') >= 0);
  assert.ok(url.indexOf('app_name=TigerMusic') >= 0);
  assert.ok(url.indexOf('limit=20') >= 0);
  assert.ok(U.audiusSearchURL('x', 999).indexOf('limit=100') >= 0);
});

test('audiusStreamURL 生成流地址', function(){
  const url = U.audiusStreamURL('abc123');
  assert.ok(url.indexOf('/v1/tracks/abc123/stream') >= 0);
  assert.ok(url.indexOf('app_name=TigerMusic') >= 0);
});

test('openverseSearchURL 免密钥音频搜索', function(){
  const url = U.openverseSearchURL('violin', 15);
  assert.ok(url.indexOf('api.openverse.org/v1/audio/') >= 0);
  assert.ok(url.indexOf('q=violin') >= 0);
  assert.ok(url.indexOf('page_size=15') >= 0);
  assert.ok(U.openverseSearchURL('x', 999).indexOf('page_size=50') >= 0);
});

test('pickAudioFile hq 优先 m4a', function(){
  const files = [
    { name: 'a.mp3', size: 100 },
    { name: 'a.m4a', size: 200 },
    { name: 'a.flac', size: 300 }
  ];
  const r = U.pickAudioFile(files, 'hq');
  assert.strictEqual(r.ext, 'm4a');
});

test('pickAudioFile lossless 优先 flac', function(){
  const files = [
    { name: 'a.mp3', size: 100 },
    { name: 'a.flac', size: 300 }
  ];
  const r = U.pickAudioFile(files, 'lossless');
  assert.strictEqual(r.ext, 'flac');
});
test('pickAudioFile 优先 mp3 且同格式取最大', function(){
  const files = [
    { name: 'a.flac', size: 500 },
    { name: 'b.mp3', size: 100 },
    { name: 'c.mp3', size: 900 },
    { name: 'd.jpg', size: 999 },
    { name: 'e.txt', size: 10 }
  ];
  const best = U.pickAudioFile(files);
  assert.equal(best.name, 'c.mp3');
  assert.equal(U.pickAudioFile([]), null);
  assert.equal(U.pickAudioFile(null), null);
});

test('parseLocalName 歌手 - 歌名', function(){
  const m = U.parseLocalName('周杰伦 - 晴天.mp3');
  assert.equal(m.artist, '周杰伦');
  assert.equal(m.title, '晴天');
  const n = U.parseLocalName('单曲名.mp3');
  assert.equal(n.title, '单曲名');
  assert.equal(n.artist, '本地音乐');
  const o = U.parseLocalName('无扩展名');
  assert.equal(o.title, '无扩展名');
});

test('stableId 稳定且区分输入', function(){
  const a = U.stableId('晴天');
  const b = U.stableId('晴天');
  const c = U.stableId('阴天');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(/^[a-z0-9]+$/.test(a));
});

test('lrcURL 仅含非空参数', function(){
  const url = U.lrcURL('Taylor Swift', 'Love Story', 'Fearless', 235);
  assert.ok(url.indexOf('lrclib.net/api/get') >= 0);
  assert.ok(url.indexOf('artist_name=Taylor%20Swift') >= 0);
  assert.ok(url.indexOf('track_name=Love%20Story') >= 0);
  assert.ok(url.indexOf('duration=235') >= 0);
  const bare = U.lrcURL('', 'Only Title', '', 0);
  assert.ok(bare.indexOf('artist_name') < 0);
  assert.ok(bare.indexOf('track_name=Only%20Title') >= 0);
  assert.ok(bare.indexOf('duration') < 0);
});

test('lrcSearchURL 与 lyricsOvhURL 编码', function(){
  const s = U.lrcSearchURL('Coldplay', 'Yellow');
  assert.ok(s.indexOf('/api/search?') >= 0);
  assert.ok(s.indexOf('track_name=Yellow') >= 0);
  assert.ok(s.indexOf('artist_name=Coldplay') >= 0);
  const o = U.lyricsOvhURL('Coldplay', 'Yellow');
  assert.equal(o, 'https://api.lyrics.ovh/v1/Coldplay/Yellow');
  assert.ok(U.lyricsOvhURL('', 'Yellow').indexOf('/Unknown/') >= 0);
});

test('cleanSongTitle 去掉括号与版本后缀', function(){
  assert.equal(U.cleanSongTitle('Love Story (Taylor’s Version)'), 'Love Story');
  assert.equal(U.cleanSongTitle('晴天（Live）'), '晴天');
  assert.equal(U.cleanSongTitle('Yellow - Remastered 2011'), 'Yellow');
  assert.equal(U.cleanSongTitle('Song feat. Somebody'), 'Song');
  assert.equal(U.cleanSongTitle('  A   B  '), 'A B');
});

test('cleanArtistName 去掉括号与合作歌手', function(){
  assert.equal(U.cleanArtistName('周杰伦 (Jay Chou)'), '周杰伦');
  assert.equal(U.cleanArtistName('A feat. B'), 'A');
  assert.equal(U.cleanArtistName('Taylor Swift - Topic'), 'Taylor Swift');
  assert.equal(U.cleanArtistName('Taylor Swift'), 'Taylor Swift');
});

test('normTitleKey / sameTitle 判断同一首歌', function(){
  assert.equal(U.normTitleKey('Love Story (Taylor’s Version)'), 'love story');
  assert.equal(U.normTitleKey('  晴天  '), '晴天');
  assert.equal(U.sameTitle('Yellow', 'yellow'), true);
  assert.equal(U.sameTitle('Love Story (Live)', 'Love Story'), true);
  assert.equal(U.sameTitle('Hello', 'Hello, Goodbye'), false);
  assert.equal(U.sameTitle('', 'x'), false);
});

test('pickLyricCandidate 同名优先、时长接近、同步歌词优先', function(){
  const list = [
    { id: 1, trackName: 'Yellow', duration: 268, syncedLyrics: '[00:01.00]a', plainLyrics: 'a' },
    { id: 2, trackName: 'Yellow', duration: 266, plainLyrics: 'b' },
    { id: 3, trackName: 'Yellow', duration: 520, syncedLyrics: '[00:01.00]c' },
    { id: 4, trackName: 'Other Song', duration: 267, syncedLyrics: '[00:01.00]d' }
  ];
  assert.equal(U.pickLyricCandidate(list, 'Yellow', 267).id, 1);
  assert.equal(U.pickLyricCandidate(list, 'Yellow', 266).id, 1);
  assert.equal(U.pickLyricCandidate(list, 'Other Song', 267).id, 4);
  assert.equal(U.pickLyricCandidate([], 'Yellow', 267), null);
  assert.equal(U.pickLyricCandidate(list, 'Unknown', 999), null);
});

test('pickLyricCandidate 保留纯音乐结果', function(){
  const list = [{ trackName: 'Piano Piece', duration: 180, instrumental: true, syncedLyrics: null, plainLyrics: null }];
  assert.equal(U.pickLyricCandidate(list, 'Piano Piece', 180).trackName, 'Piano Piece');
});

test('parseLRC 解析时间戳并升序', function(){
  const lines = U.parseLRC('[00:17.44] We were both young\n[00:21.38] I close my eyes\n[00:24.84] I\'m standing there');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].t, 17.44);
  assert.equal(lines[0].line, 'We were both young');
  assert.equal(lines[1].t, 21.38);
  assert.ok(lines[1].t > lines[0].t);
  assert.deepEqual(U.parseLRC(''), []);
  assert.equal(U.parseLRC('无时间戳的一行').length, 0);
});

test('parseLRC 支持分钟与纯文本行', function(){
  const lines = U.parseLRC('[01:02.500] long line\n[0:59] near one minute\n[01:02.000] earlier');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].t, 59);
  assert.equal(lines[1].t, 62);
  assert.equal(lines[2].t, 62.5);
  assert.equal(lines[2].line, 'long line');
});

test('parseLRC 一行多个时间戳（修复重复段歌词错位）', function(){
  const lines = U.parseLRC('[00:12.00][00:45.00]Same chorus line');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].t, 12);
  assert.equal(lines[1].t, 45);
  assert.equal(lines[1].line, 'Same chorus line');
});

test('parseLRC 支持 offset 偏移（修复整体错位）', function(){
  const lines = U.parseLRC('[offset:-500]\n[00:10.00]Hi\n[00:20.00]There');
  assert.equal(lines[0].t, 9.5);
  assert.equal(lines[1].t, 19.5);
  const plus = U.parseLRC('[offset:+1000]\n[00:10.00]Hi');
  assert.equal(plus[0].t, 11);
});

test('parseLRC 忽略元数据标签与空行', function(){
  const lines = U.parseLRC('[ar:周杰伦]\n[ti:晴天]\n[00:01.00]故事的小黄花\n[00:03.00]');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].line, '故事的小黄花');
  assert.equal(lines[1].line, '');
});

test('parseLRC 去掉增强型逐字时间戳', function(){
  const lines = U.parseLRC('[00:01.00]<00:01.00>Hello <00:01.50>world');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].line, 'Hello world');
});

test('lrcIndexAt 返回当前行下标，前奏返回 -1', function(){
  const lines = [{ t: 0, line: 'A' }, { t: 10, line: 'B' }, { t: 20, line: 'C' }];
  assert.equal(U.lrcIndexAt(lines, -1), -1);
  assert.equal(U.lrcIndexAt(lines, 5), 0);
  assert.equal(U.lrcIndexAt(lines, 10), 1);
  assert.equal(U.lrcIndexAt(lines, 99), 2);
  assert.equal(U.lrcIndexAt([], 5), -1);
  assert.equal(U.lrcIndexAt([{ t: 5, line: 'x' }], 1), -1);
});

test('bumpStats 累加播放与时长', function(){
  let s = {};
  s = U.bumpStats(s, 'a', 1, 30000);
  s = U.bumpStats(s, 'a', 1, 120000);
  s = U.bumpStats(s, 'b', 1, 60000);
  assert.equal(s.a.plays, 2);
  assert.equal(s.a.ms, 150000);
  assert.equal(s.b.plays, 1);
  assert.ok(s.a.lastAt > 0);
});

test('topStats 按播放次数排序取前 n', function(){
  const s = { x: { plays: 3, ms: 100 }, y: { plays: 9, ms: 50 }, z: { plays: 3, ms: 900 } };
  const top = U.topStats(s, 2);
  assert.equal(top[0].id, 'y');
  assert.equal(top.length, 2);
  assert.equal(U.topStats(null, 3).length, 0);
});

test('statsSummary 汇总', function(){
  const s = { a: { plays: 2, ms: 30000 }, b: { plays: 5, ms: 120000 } };
  const sum = U.statsSummary(s);
  assert.equal(sum.plays, 7);
  assert.equal(sum.ms, 150000);
  assert.equal(sum.songs, 2);
  assert.deepEqual(U.statsSummary({}), { plays: 0, ms: 0, songs: 0 });
});

test('youtubeSearchURL 拼接歌手与歌名', function(){
  const u = U.youtubeSearchURL('周杰伦', '晴天');
  assert.ok(u.indexOf('results?search_query=') >= 0);
  assert.ok(decodeURIComponent(u).indexOf('晴天 MV') >= 0);
});

test('biliSearchURL 拼接哔哩搜索', function(){
  const u = U.biliSearchURL('周杰伦', '晴天');
  assert.ok(u.indexOf('search.bilibili.com/all?keyword=') >= 0);
  assert.ok(decodeURIComponent(u).indexOf('晴天 MV') >= 0);
});
/* ---------- ccMixter 音频源 ---------- */

test('ccmixterSearchURL 免密钥搜索参数', () => {
  const u = U.ccmixterSearchURL('love', 10);
  assert.ok(u.startsWith('https://ccmixter.org/api/query?f=json'));
  assert.ok(u.includes('search=love'));
  assert.ok(u.includes('limit=10'));
  assert.ok(!/client_id|api_key|token|secret/i.test(u));
});

test('ccmixterFilesFrom lossless 优先 flac（Altnerate 别名 + download_url 判定）', () => {
  const files = [
    { download_url: 'http://x/a.mp3', file_nicname: 'mp3', file_rawsize: 100, file_name: 'a.mp3' },
    { download_url: 'http://x/a.flac', file_nicname: 'Altnerate File Format', file_rawsize: 200, file_name: 'a.flac' }
  ];
  const r = U.ccmixterFilesFrom({ files: files }, 'lossless');
  assert.strictEqual(r.ext, 'flac');
  assert.strictEqual(r.url, 'http://x/a.flac');
});

test('ccmixterFilesFrom auto 优先 mp3', () => {
  const files = [
    { download_url: 'http://x/a.mp3', file_nicname: 'mp3', file_rawsize: 100, file_name: 'a.mp3' },
    { download_url: 'http://x/a.flac', file_nicname: 'Altnerate File Format', file_rawsize: 200, file_name: 'a.flac' }
  ];
  const r = U.ccmixterFilesFrom({ files: files }, 'auto');
  assert.strictEqual(r.ext, 'mp3');
  assert.strictEqual(r.url, 'http://x/a.mp3');
});

test('ccmixterFilesFrom 无扩展名 url 时回退 file_name', () => {
  const files = [ { download_url: 'http://x/download', file_name: 'b.flac', file_nicname: 'Altnerate File Format', file_rawsize: 300 } ];
  const r = U.ccmixterFilesFrom({ files: files }, 'lossless');
  assert.strictEqual(r.ext, 'flac');
});

test('ccmixterFilesFrom 空输入返回 null', () => {
  assert.strictEqual(U.ccmixterFilesFrom(null, 'fast'), null);
  assert.strictEqual(U.ccmixterFilesFrom({ files: [] }, 'fast'), null);
  assert.strictEqual(U.ccmixterFilesFrom({ files: [{ file_nicname: 'png' }] }, 'fast'), null);
});

/* ---------- audio-fx.js：均衡预设与音效偏好 ---------- */

test('EQ 预设表：每个预设恰好 10 段且增益在 ±12dB', () => {
  assert.strictEqual(FX.EQ_FREQS.length, 10);
  const names = Object.keys(FX.PRESETS);
  assert.ok(names.length >= 5, '至少 5 个预设');
  names.forEach(function(name){
    const p = FX.PRESETS[name];
    assert.ok(Array.isArray(p.eq) && p.eq.length === 10, name + ' 应有 10 段 EQ');
    p.eq.forEach(function(g){
      assert.ok(Number.isFinite(g) && g >= -12 && g <= 12, name + ' 增益越界: ' + g);
    });
    assert.ok(Number.isFinite(p.bass) && p.bass >= -12 && p.bass <= 12, name + ' bass 越界');
    assert.ok(Number.isFinite(p.treble) && p.treble >= -12 && p.treble <= 12, name + ' treble 越界');
  });
});

test('normalizeEq 空输入回退默认（关闭）', () => {
  const e = FX.normalizeEq(null);
  assert.strictEqual(e.on, false);
  assert.strictEqual(e.preset, 'off');
  assert.strictEqual(e.bass, 0);
  assert.strictEqual(e.treble, 0);
  assert.strictEqual(e.bands.length, 10);
  e.bands.forEach(function(g){ assert.strictEqual(g, 0); });
});

test('normalizeEq 保留合法预设与自定义', () => {
  assert.strictEqual(FX.normalizeEq({ on: true, preset: 'rock' }).preset, 'rock');
  assert.strictEqual(FX.normalizeEq({ on: true, preset: 'custom', bands: [1, 2] }).preset, 'custom');
  assert.strictEqual(FX.normalizeEq({ preset: 'unknown' }).preset, 'off');
});

test('normalizeEq 钳制越界增益与 bands', () => {
  const e = FX.normalizeEq({ on: true, preset: 'custom', bass: 99, treble: -99, bands: [20, -20] });
  assert.strictEqual(e.bass, 12);
  assert.strictEqual(e.treble, -12);
  assert.strictEqual(e.bands[0], 12);
  assert.strictEqual(e.bands[1], -12);
});

test('neutralParams 全 0dB 直通', () => {
  const n = FX.neutralParams();
  assert.strictEqual(n.bass, 0);
  assert.strictEqual(n.treble, 0);
  n.eq.forEach(function(g){ assert.strictEqual(g, 0); });
});


