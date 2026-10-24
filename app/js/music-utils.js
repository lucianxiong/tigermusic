/* 蓝虎听歌 · 纯逻辑工具（无 DOM 依赖）
 * 浏览器端挂到 window.MusicUtils；Node 端通过 require 加载（供单元测试）。
 * 在线曲库仅收录可完整播放的免费来源：Internet Archive、Audius、Openverse（CC 授权）。
 * 歌词来自 LRCLIB（同步歌词）与 lyrics.ovh（纯文本兜底）。
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

  /* ---------- 在线曲库接口 ---------- */

  /* Internet Archive 高级搜索：公共领域 / 开放授权音频（音乐类集合，按下载量排序） */
  function iaSearchURL(term, rows){
    const t = cleanTerm(term).replace(/"/g, '');
    const base = 'mediatype:audio AND (collection:opensource_audio OR collection:etree OR ' +
      'collection:audio_music OR collection:78rpm OR collection:netlabels)';
    const q = t ? base + ' AND (title:("' + t + '") OR creator:("' + t + '"))' : base;
    const fields = ['identifier', 'title', 'creator', 'downloads', 'year', 'format', 'licenseurl'];
    return 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) +
      fields.map(function(f){ return '&fl%5B%5D=' + f; }).join('') +
      '&rows=' + clampNum(normLimit(rows, 20), 1, 50) +
      '&page=1&output=json&sort%5B%5D=downloads+desc';
  }

  /* IA 元数据接口地址 */
  function iaMetaURL(identifier){
    return 'https://archive.org/metadata/' + encodeURIComponent(identifier);
  }

  /* IA 下载文件地址 */
  function iaFileURL(identifier, name){
    return 'https://archive.org/download/' + encodeURIComponent(identifier) + '/' + encodeURIComponent(name);
  }

  /* 从 IA 元数据中挑选最合适的音频文件。
   * quality=fast（默认）优先小体积通用格式（mp3 > ogg > m4a > aac > wav > flac）；
   * quality=hq 优先中高码率格式（m4a > mp3 > ogg > aac > wav > flac）；
   * quality=lossless 优先无损格式（flac > wav > m4a > aac > ogg > mp3）。
   * 同格式取体积最大（通常码率最高）。 */
  function pickAudioFile(files, quality){
    if (!Array.isArray(files)) return null;
    const WANT = {
      fast:     ['mp3', 'ogg', 'm4a', 'aac', 'wav', 'flac'],
      hq:       ['m4a', 'mp3', 'ogg', 'aac', 'wav', 'flac'],
      lossless: ['flac', 'wav', 'm4a', 'aac', 'ogg', 'mp3']
    };
    const want = WANT[quality] || WANT.fast;
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

  /* Audius 曲库搜索（免密钥；独立音乐人作品，可全曲流式播放） */
  function audiusSearchURL(term, limit){
    return 'https://api.audius.co/v1/tracks/search?query=' + encodeURIComponent(cleanTerm(term)) +
      '&app_name=TigerMusic&limit=' + clampNum(normLimit(limit, 20), 1, 100);
  }

  /* Audius 曲目流地址（搜索结果的 stream.url 缺失时兜底） */
  function audiusStreamURL(trackId){
    return 'https://api.audius.co/v1/tracks/' + encodeURIComponent(trackId) + '/stream?app_name=TigerMusic';
  }

  /* Openverse 音频搜索（CC 授权音频聚合：Freesound / Jamendo 等，免密钥） */
  function openverseSearchURL(term, limit){
    return 'https://api.openverse.org/v1/audio/?q=' + encodeURIComponent(cleanTerm(term)) +
      '&page_size=' + clampNum(normLimit(limit, 50), 1, 50);
  }

  /* ccMixter 音频搜索（免密钥；CC 授权，含 mp3 与 flac 多格式） */
  function ccmixterSearchURL(term, limit){
    return 'https://ccmixter.org/api/query?f=json&search=' + encodeURIComponent(cleanTerm(term)) +
      '&limit=' + clampNum(normLimit(limit, 15), 1, 20);
  }

  /* 从 ccMixter 记录中挑最优音频文件：quality 决定 mp3/flac 优先；
   * files 数组每项含 download_url、file_nicname（mp3/flac 等）、file_rawsize。 */
  function ccmixterFilesFrom(item, quality){
    if (!item || !Array.isArray(item.files)) return null;
    const WANT = {
      fast:     ['mp3', 'ogg', 'm4a', 'aac', 'wav', 'flac'],
      hq:       ['m4a', 'mp3', 'ogg', 'aac', 'wav', 'flac'],
      lossless: ['flac', 'wav', 'm4a', 'aac', 'ogg', 'mp3']
    };
    const want = WANT[quality] || WANT.fast;
    let best = null;
    item.files.forEach(function(f){
      if (!f || !f.download_url) return;
      /* 格式判定优先级：download_url 尾缀 > file_name 尾缀 > file_nicname。
       * ccMixter 的 file_nicname 对 FLAC 返回 "Altnerate File Format"（原站拼写错误），
       * 不可作为主判定依据，仅作最后兜底。 */
      const extOf = function(f){
        const u = String(f.download_url || '');
        const uExt = u.indexOf('.') >= 0 ? u.split('.').pop().toLowerCase() : '';
        if (uExt && uExt.length <= 4) return uExt;
        const n = String(f.file_name || '');
        const nExt = n.indexOf('.') >= 0 ? n.split('.').pop().toLowerCase() : '';
        if (nExt && nExt.length <= 4) return nExt;
        const nic = String(f.file_nicname || '').toLowerCase();
        if (nic === 'altnerate file format') return 'flac';
        return nic;
      };
      const ext = extOf(f);
      if (want.indexOf(ext) < 0) return;
      const size = Number(f.file_rawsize) || 0;
      if (!best || want.indexOf(ext) < want.indexOf(best.ext) ||
          (ext === best.ext && size > best.size)){
        best = { url: f.download_url, ext: ext, size: size, name: f.file_name || '' };
      }
    });
    return best;
  }
  /* ---------- 歌词接口 ---------- */

  /* LRCLIB 精确查询地址（无需密钥，返回 plainLyrics / syncedLyrics；duration 为秒） */
  function lrcURL(artist, title, album, duration){
    const p = [];
    if (artist) p.push('artist_name=' + encodeURIComponent(cleanTerm(artist)));
    if (title) p.push('track_name=' + encodeURIComponent(cleanTerm(title)));
    if (album) p.push('album_name=' + encodeURIComponent(cleanTerm(album)));
    if (duration && isFinite(Number(duration))) p.push('duration=' + Math.round(Number(duration)));
    return 'https://lrclib.net/api/get?' + p.join('&');
  }

  /* LRCLIB 模糊搜索地址（精确查询失败或时长不一致时兜底） */
  function lrcSearchURL(artist, title){
    const p = [];
    if (title) p.push('track_name=' + encodeURIComponent(cleanTerm(title)));
    if (artist) p.push('artist_name=' + encodeURIComponent(cleanTerm(artist)));
    return 'https://lrclib.net/api/search?' + p.join('&');
  }

  /* lyrics.ovh 纯文本歌词地址（免密钥兜底；需歌手与歌名） */
  function lyricsOvhURL(artist, title){
    return 'https://api.lyrics.ovh/v1/' + encodeURIComponent(cleanTerm(artist) || 'Unknown') +
      '/' + encodeURIComponent(cleanTerm(title));
  }

  /* 清洗歌名：去掉括号注释、feat. 与版本后缀，便于歌词精确匹配 */
  function cleanSongTitle(title){
    return String(title || '')
      .replace(/[（([][^)）\]]*[)）\]]/g, ' ')
      /* feat./ft. 前必须有空格，避免把 "Swift" 里的 ft 当成合作歌手 */
      .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, ' ')
      .replace(/\s*[-–—]\s*(?:remaster(?:ed)?(?:\s+\d{4})?|live|acoustic|demo|radio edit|version|deluxe|explicit|clean|bonus track|instrumental|karaoke|mono|stereo)\b.*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* 清洗歌手名：去掉括号注释与 feat. 之后的合作歌手 */
  function cleanArtistName(artist){
    return String(artist || '')
      .replace(/[（([][^)）\]]*[)）\]]/g, ' ')
      .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, ' ')
      .replace(/\s*[-–—]\s*(?:topic|official|vevo)\s*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* 标题归一：先去掉版本后缀与标点，用于判断歌词搜索结果是否真是同一首歌 */
  function normTitleKey(s){
    return cleanSongTitle(s).toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* 两个标题是否指向同一首歌（归一后完全相等；不做包含匹配，避免 Hello / Hello, Goodbye 误判） */
  function sameTitle(a, b){
    const x = normTitleKey(a);
    const y = normTitleKey(b);
    return !!x && x === y;
  }

  /* 从 LRCLIB 搜索结果中挑最可信的一条：
   * 同名优先、时长接近优先、同步歌词优先；标题不同时必须时长几乎一致，避免匹配到另一首歌。 */
  function pickLyricCandidate(list, title, durationSec){
    const dur = Number(durationSec) || 0;
    let best = null;
    let bestScore = -Infinity;
    (Array.isArray(list) ? list : []).forEach(function(it){
      if (!it) return;
      const synced = !!it.syncedLyrics;
      const plain = !!it.plainLyrics;
      if (!synced && !plain && !it.instrumental) return;
      const same = sameTitle(it.trackName, title);
      const itDur = Number(it.duration) || 0;
      const diff = dur > 0 && itDur > 0 ? Math.abs(itDur - dur) : 999;
      if (dur > 0 && itDur > 0){
        if (same && diff > 15) return;
        if (!same && diff > 3) return;
      }
      if (!same && !(dur > 0 && itDur > 0)) return;
      const score = (same ? 100 : 0) + (synced ? 30 : 0) + (it.instrumental ? 15 : 0) - Math.min(diff, 120) / 10;
      if (score > bestScore){ bestScore = score; best = it; }
    });
    return best;
  }

  /* 解析 LRC 歌词文本 → [{ t: 秒, line: 文本 }]（按时间升序）
   * 支持：一行多个时间戳、[mm:ss]、[mm:ss.xx]、[mm:ss:xxx]、[offset:±毫秒]。
   * 带同步时间戳的行按时间排序；无时间戳的元数据行（[ar:]/[ti:] 等）忽略。 */
  function parseLRC(text){
    const out = [];
    if (!text) return out;
    let offset = 0;
    const tagRe = /^\[(\d{1,3}):(\d{1,2})(?:([.:])(\d{1,3}))?\]/;
    String(text).split(/\r?\n/).forEach(function(raw){
      let line = String(raw).trim();
      if (!line) return;
      const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
      if (off){ offset = Number(off[1]) / 1000; return; }
      const tags = [];
      let m;
      while ((m = tagRe.exec(line))){
        const digits = m[4] == null ? 0 : m[4].length;
        const frac = m[4] == null ? 0 : (m[3] === ':' ? Number(m[4]) / 1000 : Number(m[4]) / Math.pow(10, digits));
        tags.push(Number(m[1]) * 60 + Number(m[2]) + frac);
        line = line.slice(m[0].length);
      }
      if (!tags.length) return;
      /* 去掉增强型逐字时间戳 <mm:ss.xx>，只保留歌词文本 */
      const rest = line.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
      tags.forEach(function(t){
        out.push({ t: Math.max(0, Math.round((t + offset) * 1000) / 1000), line: rest });
      });
    });
    out.sort(function(a, b){ return a.t - b.t; });
    return out;
  }

  /* 取当前播放位置对应的歌词行下标（二分查找；第一行之前返回 -1，避免前奏就高亮第一句） */
  function lrcIndexAt(lines, t){
    if (!lines || !lines.length) return -1;
    if (t < lines[0].t) return -1;
    let lo = 0, hi = lines.length - 1, idx = 0;
    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      if (lines[mid].t <= t){ idx = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return idx;
  }

  /* ---------- 本地导入 ---------- */

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

  /* ---------- 播放统计 ---------- */

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

  /* MV 视频入口（新标签打开，搜索页链接，不嵌入第三方播放器） */
  function youtubeSearchURL(artist, title){
    const q = [artist, title, 'MV'].filter(Boolean).join(' ');
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
  }

  function biliSearchURL(artist, title){
    const q = [artist, title, 'MV'].filter(Boolean).join(' ');
    return 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(q);
  }

  const MusicUtils = {
    clampNum: clampNum,
    fmtTime: fmtTime,
    fmtMS: fmtMS,
    shuffleCopy: shuffleCopy,
    dedupeSongs: dedupeSongs,
    cleanTerm: cleanTerm,
    iaSearchURL: iaSearchURL,
    iaMetaURL: iaMetaURL,
    iaFileURL: iaFileURL,
    pickAudioFile: pickAudioFile,
    audiusSearchURL: audiusSearchURL,
    audiusStreamURL: audiusStreamURL,
    openverseSearchURL: openverseSearchURL,
    ccmixterSearchURL: ccmixterSearchURL,
    ccmixterFilesFrom: ccmixterFilesFrom,
    lrcURL: lrcURL,
    lrcSearchURL: lrcSearchURL,
    lyricsOvhURL: lyricsOvhURL,
    cleanSongTitle: cleanSongTitle,
    cleanArtistName: cleanArtistName,
    normTitleKey: normTitleKey,
    sameTitle: sameTitle,
    pickLyricCandidate: pickLyricCandidate,
    parseLRC: parseLRC,
    lrcIndexAt: lrcIndexAt,
    parseLocalName: parseLocalName,
    stableId: stableId,
    bumpStats: bumpStats,
    topStats: topStats,
    statsSummary: statsSummary,
    youtubeSearchURL: youtubeSearchURL,
    biliSearchURL: biliSearchURL
  };
  if (typeof module !== 'undefined' && module.exports){
    module.exports = MusicUtils;
  }
  if (global) global.MusicUtils = MusicUtils;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
