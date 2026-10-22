/* 蓝虎听歌 · 纯逻辑单元测试（node --test）
 * 覆盖 app/js/music-utils.js：时间格式化、洗牌、去重、搜索词清洗、在线接口地址、IA 音频挑选、本地文件名解析、稳定 id。 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../app/js/music-utils.js');

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

test('itunesSearchURL 编码与 limit 钳制', function(){
  const url = U.itunesSearchURL('周杰伦 晴天', 25);
  assert.ok(url.indexOf('media=music') >= 0);
  assert.ok(url.indexOf('entity=song') >= 0);
  assert.ok(url.indexOf('limit=25') >= 0);
  assert.ok(url.indexOf('term=') >= 0);
  assert.ok(/\bterm=/.test(url));
  assert.equal(U.itunesSearchURL('x', 999).indexOf('limit=50') >= 0, true);
  assert.equal(U.itunesSearchURL('x', 0).indexOf('limit=1') >= 0, true);
});

test('iaSearchURL 包含集合与 title 条件', function(){
  const url = U.iaSearchURL('古琴', 10);
  assert.ok(url.indexOf('advancedsearch.php') >= 0);
  assert.ok(url.indexOf('mediatype:audio') >= 0);
  assert.ok(url.indexOf('rows=10') >= 0);
  assert.ok(url.indexOf('output=json') >= 0);
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

test('deepClone 深拷贝', function(){
  const o = { a: 1, b: { c: [1, 2] } };
  const c = U.deepClone(o);
  assert.deepEqual(c, o);
  c.b.c.push(3);
  assert.equal(o.b.c.length, 2);
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

test('lrcIndexAt 返回当前行下标', function(){
  const lines = [{ t: 0, line: 'A' }, { t: 10, line: 'B' }, { t: 20, line: 'C' }];
  assert.equal(U.lrcIndexAt(lines, -1), 0);
  assert.equal(U.lrcIndexAt(lines, 5), 0);
  assert.equal(U.lrcIndexAt(lines, 10), 1);
  assert.equal(U.lrcIndexAt(lines, 99), 2);
  assert.equal(U.lrcIndexAt([], 5), 0);
});

test('jamendoSearchURL 携带 client_id 与参数', function(){
  const url = U.jamendoSearchURL('piano', 12, 'demo-key');
  assert.ok(url.indexOf('api.jamendo.com/v3.0/tracks/') >= 0);
  assert.ok(url.indexOf('client_id=demo-key') >= 0);
  assert.ok(url.indexOf('search=piano') >= 0);
  assert.ok(url.indexOf('limit=12') >= 0);
  assert.ok(url.indexOf('include=musicinfo') >= 0);
  assert.equal(U.jamendoSearchURL('x', 999, 'k').indexOf('limit=50') >= 0, true);
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

test('wikiTitleFor 规范化条目名', function(){
  assert.equal(U.wikiTitleFor('周杰伦（歌手）'), '周杰伦');
  assert.equal(U.wikiTitleFor('Taylor Swift'), 'Taylor_Swift');
  assert.equal(U.wikiTitleFor('甲, 乙'), '甲');
  assert.equal(U.wikiTitleFor('  A   B  '), 'A_B');
  assert.ok(U.wikiTitleFor('x').length <= 120);
});

test('baikeTitleFor 规范化百度百科名', function(){
  assert.equal(U.baikeTitleFor('周杰伦（歌手）'), '周杰伦');
  assert.equal(U.baikeTitleFor('Taylor Swift'), 'Taylor Swift');
  assert.equal(U.baikeTitleFor('甲,乙'), '甲');
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

test('externalLinks 生成权威站入口', function(){
  const l = U.externalLinks('周杰伦', '叶惠美');
  assert.ok(l.rymArtist.indexOf('rateyourmusic.com') >= 0);
  assert.ok(decodeURIComponent(l.rymAlbum).indexOf('叶惠美') >= 0);
  assert.ok(l.baike.indexOf('baike.baidu.com/item/') >= 0);
  assert.ok(l.wiki.indexOf('zh.wikipedia.org/wiki/') >= 0);
  assert.ok(l.metacritic.indexOf('metacritic.com/search/') >= 0);
  assert.ok(l.lastfm.indexOf('last.fm/music/') >= 0);
  assert.ok(l.douban.indexOf('music.douban.com') >= 0);
});