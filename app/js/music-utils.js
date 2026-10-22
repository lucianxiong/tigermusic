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
    deepClone: deepClone
  };
  if (typeof module !== 'undefined' && module.exports){
    module.exports = MusicUtils;
  }
  if (global) global.MusicUtils = MusicUtils;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
