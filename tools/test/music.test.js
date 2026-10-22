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
