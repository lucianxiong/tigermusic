/* 蓝虎听歌 · 纯逻辑工具（无 DOM 依赖）
 * 浏览器端挂到 window.MusicUtils；Node 端通过 require 加载（供单元测试）。
 * 在线曲目来源仅两类：iTunes 搜索试听（Apple，30 秒预览）与 Internet Archive 公共领域全曲。
 */
(function(global){
  'use strict';

  function clampNum(v, lo, hi){
    v = Number(v);
    if (isNaN(v)) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /* 秒 → "m:ss"（超一小时显示 "h:mm:ss"） */
  function fmtTime(sec){
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const ss = s < 10 ? '0' + s : '' + s;
    return h > 0 ? h + ':' + (m < 10 ? '0' + m : '' + m) + ':' + ss : m + ':' + ss;
  }

  /* 毫秒 → "m:ss" */
  function fmtMS(ms){
    return fmtTime((Number(ms) || 0) / 1000);
  }

  /* 返回打乱后的新数组（Fisher–Yates），不修改原数组 */
  function shuffleCopy(arr){
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /* 按歌曲 id 去重（保留首次出现的顺序） */
  function dedupeSongs(songs){
    const seen = {};
    const out = [];
    (songs || []).forEach(function(s){
      if (!s || !s.id || seen[s.id]) return;
      seen[s.id] = 1;
      out.push(s);
    });
    return out;
  }

  /* 清洗搜索词：去首尾空白与多余空格 */
  function cleanTerm(s){
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  /* 数值参数归一：undefined/非法 → 默认值；合法值进入范围钳制 */
  function normLimit(limit, def){
    const n = Number(limit);
    return Number.isFinite(n) ? n : def;
  }

  /* iTunes Search API 查询地址（无需密钥，服务端返回 CORS: *，30 秒预览） */
  function itunesSearchURL(term, limit){
    return 'https://itunes.apple.com/search?media=music&entity=song&limit=' +
      clampNum(normLimit(limit, 20), 1, 50) + '&term=' + encodeURIComponent(cleanTerm(term));
  }

  /* Internet Archive 高级搜索地址（公共领域 / 开放音频集合） */
  function iaSearchURL(term, rows){
    const q = 'mediatype:audio AND (collection:opensource_audio OR collection:etree OR collection:audio_music) AND (' +
      encodeURIComponent('title:(' + cleanTerm(term) + ')') + ')';
    return 'https://archive.org/advancedsearch.php?q=' + q +
      '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=downloads&fl%5B%5D=year' +
      '&rows=' + clampNum(normLimit(rows, 16), 1, 50) + '&page=1&output=json';
  }

  /* IA 元数据接口地址 */
  function iaMetaURL(identifier){
    return 'https://archive.org/metadata/' + encodeURIComponent(identifier);
  }

  /* IA 下载文件地址 */
  function iaFileURL(identifier, name){
    return 'https://archive.org/download/' + encodeURIComponent(identifier) + '/' + encodeURIComponent(name);
  }

  /* 从 IA 元数据中挑选最合适的音频文件：优先 mp3/ogg/flac/m4a，同格式取体积最大 */
  function pickAudioFile(files){
    if (!Array.isArray(files)) return null;
    const want = ['mp3', 'ogg', 'flac', 'm4a', 'wav', 'aac'];
    let best = null;
    files.forEach(function(f){
      if (!f || !f.name || f.name.indexOf(' ') === 0) return;
      const lower = String(f.name).toLowerCase();
      const ext = lower.split('.').pop();
      if (want.indexOf(ext) < 0) return;
      const size = Number(f.size) || 0;
      if (!best || want.indexOf(ext) < want.indexOf(best.ext) ||
          (ext === best.ext && size > best.size)){
        best = { name: f.name, ext: ext, size: size };
      }
    });
    return best;
  }

  /* 本地文件名解析：优先 "歌手 - 歌名"，否则整串当歌名 */
  function parseLocalName(name){
    const base = String(name || '').replace(/\.[^.]+$/, '');
    const m = base.match(/^(.*?)\s*[-–—]\s*(.+)$/);
    if (m && m[1].trim() && m[2].trim()){
      return { artist: m[1].trim(), title: m[2].trim() };
    }
    return { artist: '本地音乐', title: base.trim() || '未命名' };
  }

  /* 由任意文本生成稳定 id */
  function stableId(seed){
    let h = 2166136261;
    const s = String(seed);
    for (let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  /* 深拷贝（JSON 安全对象） */
  function deepClone(o){
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  /* LRCLIB 公共歌词接口地址（无需密钥，返回 plainLyrics / syncedLyrics） */
  function lrcURL(artist, title, album, duration){
    const p = [];
    if (artist) p.push('artist_name=' + encodeURIComponent(cleanTerm(artist)));
    if (title) p.push('track_name=' + encodeURIComponent(cleanTerm(title)));
    if (album) p.push('album_name=' + encodeURIComponent(cleanTerm(album)));
    if (duration && isFinite(Number(duration))) p.push('duration=' + Math.round(Number(duration)));
    return 'https://lrclib.net/api/get?' + p.join('&');
  }

  /* 解析 LRC 歌词文本 → [{ t: 秒, line: 文本 }]（按时间升序）
   * 时间戳支持 [mm:ss.xx]（百分秒）与 [mm:ss:xxx]（毫秒）两种写法。 */
  function parseLRC(text){
    const out = [];
    if (!text) return out;
    String(text).split(/\r?\n/).forEach(function(raw){
      const line = String(raw).trim();
      if (!line) return;
      const m = line.match(/^\[(\d{1,3}):(\d{1,2})([.:](\d{1,3}))?\]\s*(.*)$/);
      if (!m) return;
      const frac = m[4] == null ? 0 : (m[3] === ':' ? Number(m[4]) / 1000 : Number(m[4]) / Math.pow(10, m[4].length));
      const t = Number(m[1]) * 60 + Number(m[2]) + frac;
      if (m[5] !== undefined) out.push({ t: t, line: m[5] });
    });
    out.sort(function(a, b){ return a.t - b.t; });
    return out;
  }

  /* 取任意文本中第 i 个 LRC 行的播放位置（无则返回 0） */
  function lrcIndexAt(lines, t){
    if (!lines || !lines.length) return 0;
    let idx = 0;
    for (let i = 0; i < lines.length; i++){
      if (lines[i].t <= t) idx = i; else break;
    }
    return idx;
  }

  /* Jamendo 曲目搜索地址（需 client_id；返回直链音频与授权信息） */
  function jamendoSearchURL(term, limit, clientId){
    const p = [];
    p.push('client_id=' + encodeURIComponent(cleanTerm(clientId)));
    p.push('format=json');
    p.push('limit=' + clampNum(normLimit(limit, 16), 1, 50));
    p.push('search=' + encodeURIComponent(cleanTerm(term)));
    p.push('include=musicinfo');
    p.push('audioformat=mp32');
    return 'https://api.jamendo.com/v3.0/tracks/?' + p.join('&');
  }

  /* 播放统计：为 songId 累加播放次数与收听毫秒，返回新 stats 对象 */
  function bumpStats(stats, songId, incPlays, incMs){
    const prev = (stats && stats[songId]) || {};
    const rec = {
      plays: (Number(prev.plays) || 0) + (incPlays || 0),
      ms: (Number(prev.ms) || 0) + (incMs || 0),
      lastAt: Date.now()
    };
    const out = Object.assign({}, stats || {});
    out[songId] = rec;
    return out;
  }

  /* 统计排行：按播放次数（其次时长）降序，取前 n 条 [{id, plays, ms, lastAt}] */
  function topStats(stats, n){
    const arr = [];
    Object.keys(stats || {}).forEach(function(id){
      arr.push(Object.assign({ id: id }, stats[id] || {}));
    });
    arr.sort(function(a, b){
      return (Number(b.plays) || 0) - (Number(a.plays) || 0) ||
             (Number(b.ms) || 0) - (Number(a.ms) || 0) ||
             (Number(b.lastAt) || 0) - (Number(a.lastAt) || 0);
    });
    return arr.slice(0, n || 10);
  }

  /* 统计总览：{ plays: 总次数, ms: 总毫秒, songs: 听过的不同歌曲数 } */
  function statsSummary(stats){
    let plays = 0, ms = 0, songs = 0;
    Object.keys(stats || {}).forEach(function(id){
      plays += Number(stats[id].plays) || 0;
      ms += Number(stats[id].ms) || 0;
      songs++;
    });
    return { plays: plays, ms: ms, songs: songs };
  }

  const MusicUtils = {
    clampNum: clampNum,
    fmtTime: fmtTime,
    fmtMS: fmtMS,
    shuffleCopy: shuffleCopy,
    dedupeSongs: dedupeSongs,
    cleanTerm: cleanTerm,
    itunesSearchURL: itunesSearchURL,
    iaSearchURL: iaSearchURL,
    iaMetaURL: iaMetaURL,
    iaFileURL: iaFileURL,
    pickAudioFile: pickAudioFile,
    parseLocalName: parseLocalName,
    stableId: stableId,
    deepClone: deepClone,
    lrcURL: lrcURL,
    parseLRC: parseLRC,
    lrcIndexAt: lrcIndexAt,
    jamendoSearchURL: jamendoSearchURL,
    bumpStats: bumpStats,
    topStats: topStats,
    statsSummary: statsSummary
  };
  if (typeof module !== 'undefined' && module.exports){
    module.exports = MusicUtils;
  }
  if (global) global.MusicUtils = MusicUtils;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
