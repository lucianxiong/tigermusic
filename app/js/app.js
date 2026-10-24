/* 蓝虎听歌 · 主应用逻辑
 * 免费全曲曲库（Internet Archive / Audius / Openverse，全部可完整收听）+ 本地音乐导入；
 * 歌词（LRCLIB 同步歌词 + lyrics.ovh 兜底，支持逐句校正、滚动浏览、点击跳转）。
 * 收藏 / 最近播放 / 自定义歌单全部保存在本机 localStorage，不注册账号、不收集个人信息。
 * 依赖 js/version.js 与 js/music-utils.js（window.MusicUtils）。
 */
(function(){
  'use strict';

  window.__blueTigerMusic = true;

  const U = window.MusicUtils;
  const APP_VERSION = window.TIGER_MUSIC_VERSION || '1.3.0';
  const STORE_PREFIX = 'ltm:';

  /* ---------- 基础工具 ---------- */
  function $(s, r){ return (r || document).querySelector(s); }
  function $$(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(html){ const d = document.createElement('div'); d.innerHTML = String(html).trim(); return d.firstElementChild; }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  const store = {
    get: function(k, d){ try { const v = localStorage.getItem(STORE_PREFIX + k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
    set: function(k, v){ try { localStorage.setItem(STORE_PREFIX + k, JSON.stringify(v)); } catch(e){} },
    del: function(k){ try { localStorage.removeItem(STORE_PREFIX + k); } catch(e){} }
  };

  function toast(msg, type){
    let t = $('.rt-toast');
    if (!t){
      t = document.createElement('div');
      t.className = 'rt-toast' + (type ? ' ' + type : '');
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._timer);
    t._timer = setTimeout(function(){ t.classList.remove('on'); }, 2400);
  }

  /* ---------- 偏好（主题 / 语言 / 音量 / 循环 / 音质 / 音效） ---------- */
  const PREF = Object.assign({
    lang: 'zh',
    theme: 'auto',
    volume: 0.8,
    repeat: 'all',
    shuffle: false,
    region: 'auto',
    quality: 'fast',
    eq: { on: false, preset: 'off', bass: 0, treble: 0, bands: [] }
  }, store.get('pref', {}));

  /* 旧版本数据可能越界或缺失，启动 / 导入备份时归一化 */
  function normalizePref(){
    if (['zh', 'en'].indexOf(PREF.lang) < 0) PREF.lang = 'zh';
    if (['auto', 'dark', 'light'].indexOf(PREF.theme) < 0) PREF.theme = 'auto';
    if (['all', 'one', 'off'].indexOf(PREF.repeat) < 0) PREF.repeat = 'all';
    if (['auto', 'cn', 'intl'].indexOf(PREF.region) < 0) PREF.region = 'auto';
    if (['fast', 'hq', 'lossless'].indexOf(PREF.quality) < 0) PREF.quality = 'fast';
    PREF.eq = window.AudioFX ? window.AudioFX.normalizeEq(PREF.eq) : { on: false, preset: 'off', bass: 0, treble: 0, bands: [] };
    PREF.volume = U.clampNum(PREF.volume, 0, 1);
    PREF.shuffle = !!PREF.shuffle;
  }
  normalizePref();

  /* ---------- 版本迁移：新版本启动时清理旧版本的技术性缓存 ----------
   * 保留：收藏 / 最近播放 / 歌单 / 听歌统计 / 用户偏好（这些是用户资产）
   * 清理：搜索历史 / 临时标记 / 旧版本遗留键（这些是缓存痕迹）
   * 记录版本号到 localStorage，下次版本变化时再次触发清理 */
  const STORE_VERSION_KEY = STORE_PREFIX + 'appVersion';
  (function migrateVersion(){
    let prev = null;
    try { prev = localStorage.getItem(STORE_VERSION_KEY); } catch(e){}
    if (prev && prev !== APP_VERSION){
      // 版本变化：清理非用户数据缓存
      try {
        // 只清缓存类键，保留 favorites/recent/playlists/stats/pref
        const cacheKeys = ['searchHistory'];
        cacheKeys.forEach(function(k){ try { localStorage.removeItem(STORE_PREFIX + k); } catch(e){} });
        // 清理所有带 "cache:" 前缀的临时键
        for (let i = localStorage.length - 1; i >= 0; i--){
          const key = localStorage.key(i);
          if (key && key.indexOf(STORE_PREFIX + 'cache:') === 0){
            try { localStorage.removeItem(key); } catch(e){}
          }
        }
        console.log('[migrate] 旧版本缓存已清理：' + prev + ' -> ' + APP_VERSION);
      } catch(e){}
    }
    try { localStorage.setItem(STORE_VERSION_KEY, APP_VERSION); } catch(e){}
  })();

  function savePref(){
    store.set('pref', {
      lang: PREF.lang, theme: PREF.theme, volume: PREF.volume,
      repeat: PREF.repeat, shuffle: PREF.shuffle, region: PREF.region,
      quality: PREF.quality, eq: PREF.eq
    });
  }

  function T(zh, en){ return PREF.lang === 'en' ? en : zh; }

  /* ---------- 主题 ---------- */
  function applyTheme(){
    let mode = PREF.theme;
    if (mode === 'auto'){
      try { mode = window.matchMedia && !window.matchMedia('(prefers-color-scheme: light)').matches ? 'dark' : 'light'; } catch(e){ mode = 'dark'; }
    }
    document.documentElement.setAttribute('data-theme', mode);
  }

  /* ---------- 数据（收藏 / 最近 / 歌单） ---------- */
  function loadList(key, def){ return store.get(key, def); }
  function saveList(key, list){ store.set(key, list); }

  function asArray(v){ return Array.isArray(v) ? v : []; }

  /* 本地文件仅在本次会话内有效：重启后 File 引用已不存在，不能把这类歌曲留在收藏 / 最近 / 歌单里 */
  function keepPlayableSong(song){ return !!song && !!song.id && song.source !== 'local'; }
  function cleanSongList(list){ return U.dedupeSongs(asArray(list).filter(keepPlayableSong)); }

  let favorites = cleanSongList(loadList('favorites', []));
  let recent = cleanSongList(loadList('recent', []));
  let playlists = asArray(loadList('playlists', [])).filter(function(p){ return p && p.id && Array.isArray(p.songs); }).map(function(p){
    return { id: p.id, name: p.name || T('未命名歌单', 'Untitled playlist'), songs: cleanSongList(p.songs), created: Number(p.created) || Date.now() };
  });
  let stats = loadList('stats', {});
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) stats = {};
  let searchHistory = asArray(loadList('searchHistory', [])).filter(function(s){ return typeof s === 'string' && s.trim(); });
  let localSongs = [];        // 本次使用内导入的本地歌曲（含 File 引用）
  const localUrls = {};       // local id -> objectURL

  function persistFavorites(){ saveList('favorites', favorites); }
  function persistRecent(){ saveList('recent', recent); }
  function persistPlaylists(){ saveList('playlists', playlists); }
  function persistStats(){ saveList('stats', stats); }
  function persistSearchHistory(){ saveList('searchHistory', searchHistory); }

  /* 搜索历史：去重置顶，最多 8 条 */
  function pushSearchHistory(term){
    const t = U.cleanTerm(term);
    if (!t) return;
    searchHistory = [t].concat(searchHistory.filter(function(h){ return h.toLowerCase() !== t.toLowerCase(); })).slice(0, 8);
    persistSearchHistory();
  }

  function clearSearchHistory(){
    searchHistory = [];
    persistSearchHistory();
  }

  /* 当前歌单页的重绘钩子（只在歌单页收藏区变化时使用，避免整页跳动） */
  let plRepaint = null;

  function isFav(song){ return !!song && favorites.some(function(s){ return s.id === song.id; }); }

  function toggleFav(song){
    if (!song) return;
    if (isFav(song)){
      favorites = favorites.filter(function(s){ return s.id !== song.id; });
      toast(T('已取消收藏', 'Removed from favorites'));
    } else {
      favorites = U.dedupeSongs([song].concat(favorites));
      toast(T('已收藏', 'Added to favorites'));
    }
    persistFavorites();
    refreshFavUI(song);
  }

  function pushRecent(song){
    recent = U.dedupeSongs([song].concat(recent)).slice(0, 50);
    persistRecent();
  }

  function savePlaylist(p){
    const i = playlists.findIndex(function(x){ return x.id === p.id; });
    if (i >= 0) playlists[i] = p; else playlists.push(p);
    persistPlaylists();
  }

  /* ---------- 播放器 ---------- */
  let queue = [];
  let qIndex = -1;
  let playFailStreak = 0;
  /* 正常播放元素：永不接入 Web Audio 音效图（避免 CORS 污染导致静音） */
  const baseAudio = new Audio();
  baseAudio.preload = 'metadata';
  /* 当前播放元素：默认 baseAudio；开启音效时切换为 fxEl（走音效链） */
  let audio = baseAudio;
  let fx = null;            // AudioFX 实例（挂载后常驻，不销毁）
  let fxEl = null;          // 音效播放元素（懒创建；同一元素只允许挂一次 MediaElementSource）
  let fxBroken = false;     // 音效初始化失败（不再重试）
  let eqRetried = false;    // 当前曲目是否已因音效 CORS 失败回退过

  function songSrc(song){
    if (song.source === 'local'){
      const f = song.file;
      if (!f) return '';
      if (!localUrls[song.id]){
        try { localUrls[song.id] = URL.createObjectURL(f); } catch(e){ return ''; }
      }
      return localUrls[song.id];
    }
    return song.src || '';
  }

  function coverOf(song){
    return song.cover || 'assets/logo/logo-64.png';
  }

  function songDisplay(song){
    return { title: song.title || T('未知歌曲', 'Unknown'), artist: song.artist || T('未知歌手', 'Unknown artist') };
  }

  function sourceName(source){
    if (source === 'ia') return 'Internet Archive';
    if (source === 'audius') return 'Audius';
    if (source === 'openverse') return 'Openverse';
    if (source === 'ccmixter') return 'ccMixter';
    if (source === 'local') return T('本地导入', 'Local import');
    return '';
  }

  function renderPlayerBar(){
    const bar = $('#playerbar');
    if (qIndex < 0 || !queue[qIndex]){
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const song = queue[qIndex];
    const d = songDisplay(song);
    $('#pbCover').src = coverOf(song);
    $('#pbTitle').textContent = d.title;
    $('#pbArtist').textContent = d.artist + (song.album ? ' · ' + song.album : '');
    $('#pbDur').textContent = song.duration ? U.fmtMS(song.duration) : '--:--';
    if (bar._songId !== song.id){
      bar._songId = song.id;
      $('#pbSeek').value = '0';
      $('#pbCur').textContent = '0:00';
    }
    $('#pbRepeat').setAttribute('aria-pressed', String(PREF.repeat !== 'off'));
    const rt = $('#pbRepeat .pb-repeat-txt');
    if (rt) rt.textContent = PREF.repeat === 'one' ? '1' : (PREF.repeat === 'off' ? '×' : '');
    $('#pbShuffle').setAttribute('aria-pressed', String(!!PREF.shuffle));
    $('#pbShuffle').classList.toggle('on', !!PREF.shuffle);
    $('#pbToggle').classList.toggle('playing', !audio.paused && !audio.ended);
    applyVolume();
    $('#pbVol').value = Math.round(PREF.volume * 100);
    $('#pbMute').classList.toggle('on', audio.muted || PREF.volume === 0);
    renderQueuePanel();
    syncMiniPlayer();
    syncPlayingRows();
  }

  function playQueue(songs, index){
    if (!songs || !songs.length) return;
    queue = songs.slice();
    qIndex = U.clampNum(index == null ? 0 : index, 0, queue.length - 1);
    playFailStreak = 0;
    startCurrent();
  }

  /* ---------- 媒体会话（锁屏 / 系统媒体控制） ---------- */
  function updateMediaSession(song){
    if (!('mediaSession' in navigator)) return;
    try {
      if (!song){
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        return;
      }
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || '',
        artist: song.artist || '',
        album: song.album || '',
        artwork: [{ src: coverOf(song), sizes: '512x512', type: 'image/png' }]
      });
    } catch(e){}
  }

  function bindMediaSession(){
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', function(){ togglePlay(); });
      navigator.mediaSession.setActionHandler('pause', function(){ togglePlay(); });
      navigator.mediaSession.setActionHandler('previoustrack', function(){ prev(); });
      navigator.mediaSession.setActionHandler('nexttrack', function(){ next(false); });
      navigator.mediaSession.setActionHandler('seekto', function(d){
        if (d && isFinite(d.seekTime)){ audio.currentTime = d.seekTime; }
      });
      navigator.mediaSession.setActionHandler('seekbackward', function(){
        if (isFinite(audio.duration)){ audio.currentTime = Math.max(0, audio.currentTime - 10); }
      });
      navigator.mediaSession.setActionHandler('seekforward', function(){
        if (isFinite(audio.duration)){ audio.currentTime = Math.min(audio.duration, audio.currentTime + 10); }
      });
    } catch(e){}
  }

  /* ---------- 歌词（LRCLIB 同步歌词 + lyrics.ovh 兜底，可逐句校正） ---------- */
  const LYR = {};                 // songId -> { state, lines, plain, synced, instrumental, source }
  const lyricSeq = {};            // songId -> 最近一次请求序号
  let lyricsOffset = loadList('lyricOffset', {});   // songId -> 校正秒数
  if (!lyricsOffset || typeof lyricsOffset !== 'object' || Array.isArray(lyricsOffset)) lyricsOffset = {};

  function lyrOffsetOf(song){
    const v = song ? Number(lyricsOffset[song.id]) : 0;
    return isFinite(v) ? U.clampNum(v, -30, 30) : 0;
  }

  function lyrOffsetLabel(song){
    const v = lyrOffsetOf(song);
    return T('同步校正 ', 'Sync ') + (v > 0 ? '+' : '') + v.toFixed(1) + 's';
  }

  /* 带超时的 JSON 请求：歌词服务偶尔无响应，不能让“正在获取歌词”一直挂着 */
  function fetchJSON(url, timeoutMs){
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(function(){ if (ctrl) ctrl.abort(); }, timeoutMs || 7000);
    return fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
      .then(function(r){
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .finally(function(){ clearTimeout(timer); });
  }

  function lrcResultFromGet(j){
    if (!j) return null;
    if (j.instrumental && !j.syncedLyrics && !j.plainLyrics){
      return { lines: [], plain: '', synced: false, instrumental: true, source: 'LRCLIB' };
    }
    if (!j.syncedLyrics && !j.plainLyrics) return null;
    return {
      lines: U.parseLRC(j.syncedLyrics || ''),
      plain: j.plainLyrics || '',
      synced: !!j.syncedLyrics,
      source: 'LRCLIB'
    };
  }

  function applyLyrics(song, res){
    LYR[song.id] = Object.assign({ state: 'ok' }, res);
    if (queue[qIndex] && queue[qIndex].id === song.id) lyricsRefresh();
  }

  function markLyricsNone(song, failed){
    LYR[song.id] = { state: 'none', failed: !!failed };
    if (queue[qIndex] && queue[qIndex].id === song.id) lyricsRefresh();
  }

  function loadLyrics(song, force){
    if (!song) return;
    const st = LYR[song.id];
    /* 已加载过（包括确认无歌词）就直接复用，用户点“重新获取”才再次请求 */
    if (!force && st){ lyricsRefresh(); return; }
    const title = U.cleanSongTitle(song.title) || U.cleanTerm(song.title);
    const artist = U.cleanArtistName(song.artist);
    if (!title && !artist){ markLyricsNone(song, false); return; }
    const seq = (lyricSeq[song.id] || 0) + 1;
    lyricSeq[song.id] = seq;
    LYR[song.id] = { state: 'loading' };
    lyricsRefresh();

    const durSec = Number(song.duration) > 0 ? Number(song.duration) / 1000 : 0;
    const tries = [];

    function acceptGet(j){
      const r = lrcResultFromGet(j);
      if (r) return r;
      throw new Error('no lyrics');
    }
    function acceptSearch(j){
      const best = U.pickLyricCandidate(j, title, durSec);
      if (!best) throw new Error('no match');
      if (best.instrumental && !best.syncedLyrics && !best.plainLyrics){
        return { lines: [], plain: '', synced: false, instrumental: true, source: 'LRCLIB' };
      }
      return {
        lines: U.parseLRC(best.syncedLyrics || ''),
        plain: best.plainLyrics || '',
        synced: !!best.syncedLyrics,
        source: 'LRCLIB'
      };
    }
    function acceptOvh(j){
      const text = j && j.lyrics ? String(j.lyrics).replace(/\r/g, '').trim() : '';
      if (!text) throw new Error('no lyrics');
      return { lines: [], plain: text, synced: false, source: 'lyrics.ovh' };
    }

    /* 1) 精确查询（清洗后的歌手 / 歌名，带时长；来源标签不是专辑名，不能传给 LRCLIB） */
    tries.push(function(){
      return fetchJSON(U.lrcURL(artist, title, '', durSec)).then(acceptGet);
    });
    /* 2) 原始标题（含括号、版本后缀等原样）再试一次 */
    if (U.cleanTerm(song.title) !== title || U.cleanTerm(song.artist) !== artist){
      tries.push(function(){
        return fetchJSON(U.lrcURL(U.cleanTerm(song.artist), U.cleanTerm(song.title))).then(acceptGet);
      });
    }
    /* 3) 模糊搜索（同名 / 时长校验，避免匹配到同名的另一首歌） */
    tries.push(function(){
      return fetchJSON(U.lrcSearchURL(artist, title)).then(acceptSearch);
    });
    /* 4) lyrics.ovh 纯文本兜底 */
    if (artist && title){
      tries.push(function(){ return fetchJSON(U.lyricsOvhURL(artist, title)).then(acceptOvh); });
    }

    (function run(i){
      if (seq !== lyricSeq[song.id]) return;
      if (i >= tries.length){ markLyricsNone(song, true); return; }
      tries[i]().then(function(res){
        if (seq !== lyricSeq[song.id]) return;
        applyLyrics(song, res);
      }).catch(function(){ run(i + 1); });
    })(0);
  }

  function lyricsRefresh(){
    paintLyricBox($('#mpLyrics'));
    paintLyricBox($('#pbLyrics'));
  }

  function paintLyricBox(box){
    if (!box) return;
    bindLyricBox(box);
    const song = queue[qIndex];
    if (!song){
      box.innerHTML = '<div class="mp-lyr-empty">' + T('播放歌曲后显示歌词', 'Lyrics will show while playing.') + '</div>';
      return;
    }
    const st = LYR[song.id];
    if (!st || st.state === 'loading'){
      box.innerHTML = '<div class="mp-lyr-empty">' + T('正在获取歌词…', 'Loading lyrics…') + '</div>';
      return;
    }
    if (st.state === 'none'){
      const msg = st.failed
        ? T('暂无歌词，或歌词服务暂不可用', 'No lyrics found, or the lyrics service is unavailable.')
        : T('暂无歌词', 'No lyrics available.');
      box.innerHTML = '<div class="mp-lyr-empty">' + msg +
        ' <button class="link-btn" type="button" data-lyr-retry>' + T('重新获取', 'Retry') + '</button></div>';
      return;
    }
    if (st.instrumental){
      box.innerHTML = '<div class="mp-lyr-empty">♪ ' + T('纯音乐，请欣赏', 'Instrumental') + '</div>';
      return;
    }
    if (st.lines && st.lines.length){
      const off = lyrOffsetOf(song);
      box.innerHTML =
        '<div class="mp-lyr-tools">' +
          '<button type="button" data-lyr-off="-0.5" title="' + T('歌词提前 0.5 秒', 'Lyrics 0.5s earlier') + '">−0.5s</button>' +
          '<button type="button" data-lyr-off="0.5" title="' + T('歌词延后 0.5 秒', 'Lyrics 0.5s later') + '">+0.5s</button>' +
          (off ? '<button type="button" data-lyr-reset title="' + T('复位同步校正', 'Reset sync offset') + '">' + esc(lyrOffsetLabel(song)) + '</button>' : '<span class="mp-lyr-off">' + esc(lyrOffsetLabel(song)) + '</span>') +
          '<span class="mp-lyr-src">' + esc(st.source || '') + '</span>' +
        '</div>' +
        '<button class="mp-lyr-follow" type="button" data-lyr-follow hidden>' + T('回到当前', 'Back to current') + '</button>' +
        st.lines.map(function(ln, i){
          return '<button class="mp-lyr-line" type="button" data-li="' + i + '">' + (ln.line ? esc(ln.line) : '&nbsp;') + '</button>';
        }).join('');
      box._lyrIdx = -1;
      if (box._lyrFollow === undefined) box._lyrFollow = true;
      highlightLyric(U.lrcIndexAt(st.lines, audio.currentTime - lyrOffsetOf(song)));
    } else {
      box.innerHTML = '<div class="mp-lyr-tools"><span class="mp-lyr-src">' + esc(st.source || '') + '</span></div>' +
        '<div class="mp-lyr-plain">' + esc(st.plain || '').split('\n').join('<br>') + '</div>';
    }
  }

  function setLyricFollow(box, follow){
    if (!box) return;
    box._lyrFollow = !!follow;
    const btn = $('[data-lyr-follow]', box);
    if (btn) btn.hidden = !!follow;
  }

  function bindLyricBox(box){
    if (box._lyrBound) return;
    box._lyrBound = true;
    box.addEventListener('click', function(e){
      const song = queue[qIndex];
      if (!song) return;
      const off = e.target.closest('[data-lyr-off]');
      if (off){ setLyricOffset(Number(off.dataset.lyrOff)); return; }
      if (e.target.closest('[data-lyr-reset]')){ setLyricOffsetValue(0); return; }
      if (e.target.closest('[data-lyr-retry]')){ loadLyrics(song, true); return; }
      if (e.target.closest('[data-lyr-follow]')){
        setLyricFollow(box, true);
        box._lyrIdx = -1;
        highlightLyric(U.lrcIndexAt(LYR[song.id] && LYR[song.id].lines, audio.currentTime - lyrOffsetOf(song)));
        return;
      }
      const line = e.target.closest('.mp-lyr-line');
      if (line){
        const st = LYR[song.id];
        const i = Number(line.dataset.li);
        if (st && st.lines && st.lines[i]){
          setLyricFollow(box, true);
          audio.currentTime = Math.max(0, st.lines[i].t + lyrOffsetOf(song));
          if (audio.paused) audio.play().catch(function(){});
        }
      }
    });
    /* 用户手动滚动时暂停自动跟随，点“回到当前”恢复 */
    box.addEventListener('wheel', function(){ setLyricFollow(box, false); }, { passive: true });
    box.addEventListener('touchmove', function(){ setLyricFollow(box, false); }, { passive: true });
  }

  function setLyricOffset(delta){
    setLyricOffsetValue(lyrOffsetOf(queue[qIndex]) + delta);
  }

  function setLyricOffsetValue(value){
    const song = queue[qIndex];
    if (!song) return;
    const next = U.clampNum(Math.round(Number(value) * 10) / 10, -30, 30);
    if (next) lyricsOffset[song.id] = next;
    else delete lyricsOffset[song.id];
    saveList('lyricOffset', lyricsOffset);
    toast(next
      ? T('歌词同步校正：' + (next > 0 ? '+' : '') + next.toFixed(1) + ' 秒', 'Lyrics sync: ' + (next > 0 ? '+' : '') + next.toFixed(1) + 's')
      : T('已复位歌词同步', 'Lyrics sync reset'));
    lyricsRefresh();
  }

  function highlightLyric(idx){
    ['#mpLyrics', '#pbLyrics'].forEach(function(sel){
      const box = $(sel);
      if (!box) return;
      if (box._lyrIdx === idx) return;
      box._lyrIdx = idx;
      $$('.mp-lyr-line', box).forEach(function(l, i){ l.classList.toggle('on', i === idx); });
      const followBtn = $('[data-lyr-follow]', box);
      if (followBtn) followBtn.hidden = box._lyrFollow !== false;
      if (box._lyrFollow === false || idx < 0) return;
      const cur = $('.mp-lyr-line.on', box);
      if (!cur || box.scrollHeight <= box.clientHeight) return;
      const top = cur.offsetTop - box.clientHeight / 2 + cur.offsetHeight / 2;
      try { box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); }
      catch(e){ box.scrollTop = Math.max(0, top); }
    });
  }

  /* 播放时用 rAF 平滑高亮（timeupdate 每秒只有 4 次，逐句跳会显得卡顿） */
  let lyricRAF = 0;
  function lyricTick(){
    lyricRAF = 0;
    const song = queue[qIndex];
    if (song){
      const st = LYR[song.id];
      if (st && st.state === 'ok' && st.lines && st.lines.length){
        highlightLyric(U.lrcIndexAt(st.lines, audio.currentTime - lyrOffsetOf(song)));
      }
    }
    if (!audio.paused) lyricRAF = requestAnimationFrame(lyricTick);
  }
  function startLyricTicker(){
    if (!lyricRAF) lyricRAF = requestAnimationFrame(lyricTick);
  }
  function stopLyricTicker(){
    if (lyricRAF){ cancelAnimationFrame(lyricRAF); lyricRAF = 0; }
  }
  function refreshLyricHighlight(){
    const song = queue[qIndex];
    const st = song ? LYR[song.id] : null;
    if (st && st.state === 'ok' && st.lines && st.lines.length){
      highlightLyric(U.lrcIndexAt(st.lines, audio.currentTime - lyrOffsetOf(song)));
    }
  }

  function startCurrent(){
    const song = queue[qIndex];
    if (!song) return;
    eqRetried = false;
    pushRecent(song);
    /* 播放统计：每次开始播放记一次 */
    stats = U.bumpStats(stats, song.id, 1, 0);
    persistStats();
    /* 媒体会话（锁屏 / 系统媒体控制） */
    updateMediaSession(song);
    const src = songSrc(song);
    if (!src){ failCurrent(); return; }
    audio.src = src;
    audio.play().catch(function(){
      toast(T('播放失败，请检查网络后重试', 'Playback failed, check network and retry'));
      renderPlayerBar();
    });
    renderPlayerBar();
    /* 异步拉取歌词（LRCLIB 公共歌词库） */
    loadLyrics(song);
  }

  /* 播放失败时跳过当前曲目；整队都失败就停下，避免无限递归切歌 */
  function failCurrent(){
    if (qIndex < 0 || !queue.length) return;
    playFailStreak++;
    if (playFailStreak >= queue.length){
      playFailStreak = 0;
      audio.pause();
      toast(T('队列中的歌曲都无法播放', 'None of the tracks in the queue can be played'));
      renderPlayerBar();
      return;
    }
    if (queue.length > 1) toast(T('当前歌曲无法播放，已跳到下一首', 'Track unavailable, skipping to next'));
    setTimeout(function(){
      if (qIndex < 0 || !queue.length) return;
      qIndex = (qIndex + 1) % queue.length;
      startCurrent();
    }, 30);
  }

  function togglePlay(){
    if (qIndex < 0) return;
    if (audio.paused){
      audio.play().catch(function(){ toast(T('播放失败', 'Playback failed')); });
    } else {
      audio.pause();
    }
  }

  function step(dir){
    if (!queue.length) return;
    playFailStreak = 0;
    if (dir > 0 && PREF.shuffle && queue.length > 1){
      let n = qIndex;
      while (n === qIndex) n = Math.floor(Math.random() * queue.length);
      qIndex = n;
    } else {
      let n = qIndex + dir;
      if (n < 0) n = PREF.repeat === 'all' ? queue.length - 1 : qIndex;
      if (n >= queue.length){
        if (PREF.repeat === 'all') n = 0;
        else { n = queue.length - 1; audio.pause(); audio.currentTime = 0; qIndex = n; renderPlayerBar(); return; }
      }
      qIndex = n;
    }
    startCurrent();
  }

  function next(auto){
    const song = queue[qIndex];
    if (auto && PREF.repeat === 'one' && song){ audio.currentTime = 0; audio.play().catch(function(){}); return; }
    step(1);
  }

  function prev(){
    if (audio.currentTime > 3){ audio.currentTime = 0; return; }
    step(-1);
  }

  function seekTo(v){
    if (!isFinite(audio.duration)) return;
    audio.currentTime = audio.duration * (U.clampNum(v, 0, 1000) / 1000);
  }

  /* 音量路由：音效链激活时由 master 增益控制（元素音量保持 1），否则走元素音量 */
  function applyVolume(){
    if (fx && fx.isReady()) fx.setVolume(PREF.volume);
    else audio.volume = U.clampNum(PREF.volume, 0, 1);
  }

  function setVolume(v){
    PREF.volume = U.clampNum(v, 0, 1);
    applyVolume();
    audio.muted = false;
    savePref();
    renderPlayerBar();
  }

  function toggleMute(){
    audio.muted = !audio.muted;
    if (fx && fx.isReady()) fx.setVolume(audio.muted ? 0 : PREF.volume);
    else audio.volume = U.clampNum(PREF.volume, 0, 1);
    renderPlayerBar();
  }

  /* ---------- 音效（10 段 EQ + 低音/高音，Web Audio API） ----------
   * 设计要点：
   * 1) 默认关闭：正常播放走 baseAudio，永不接入音效图，任何音源行为与之前完全一致；
   * 2) 开启后播放切换到独立 fxEl 元素并经音效链输出（CORS 模式加载）；
   * 3) 音源不支持跨域时 audio error 触发 → 自动回退到 baseAudio 直连播放并提示；
   * 4) fxEl 创建后常驻，避免对同一元素重复 createMediaElementSource 抛错。 */
  function fxActive(){ return PREF.eq.on && fx && fx.isReady(); }

  function ensureFx(){
    if (fxBroken || !window.AudioFX) return false;
    if (fx && fx.isReady()) return true;
    if (!fxEl){
      fxEl = new Audio();
      fxEl.preload = 'metadata';
      bindPlayerEvents(fxEl);
    }
    if (!fx) fx = window.TigerAudioFX || new window.AudioFX();
    if (fx.attach(fxEl)) return true;
    fx = null;
    fxBroken = true;
    return false;
  }

  function eqParams(){
    const e = PREF.eq;
    if (!window.AudioFX) return null;
    if (e.preset === 'off') return window.AudioFX.neutralParams();
    if (e.preset === 'custom') return { eq: e.bands, bass: e.bass, treble: e.treble };
    const p = window.AudioFX.PRESETS[e.preset] || {};
    return { eq: p.eq || e.bands, bass: e.bass, treble: e.treble };
  }

  /* 保留进度重载当前曲目（元素或 CORS 模式切换后调用） */
  function reloadForFx(pos, wasPlaying){
    const song = queue[qIndex];
    if (!song) return;
    if (pos == null || !isFinite(pos)) pos = audio.currentTime;
    if (wasPlaying == null) wasPlaying = !audio.paused;
    audio.pause();
    const src = songSrc(song);
    if (!src){ renderPlayerBar(); return; }
    audio.src = src;
    const onMeta = function(){
      audio.removeEventListener('loadedmetadata', onMeta);
      try { if (pos > 0 && isFinite(pos)) audio.currentTime = pos; } catch(e){}
      if (wasPlaying) audio.play().catch(function(){});
      renderPlayerBar();
    };
    audio.addEventListener('loadedmetadata', onMeta);
    renderPlayerBar();
  }

  function enableEq(silent){
    if (!ensureFx()){
      PREF.eq.on = false;
      savePref();
      if (!silent) toast(T('当前环境不支持音效', 'Sound effects unavailable'));
      return;
    }
    PREF.eq.on = true;
    const pos = audio.currentTime;
    const wasPlaying = !audio.paused;
    audio.pause();
    audio = fxEl;
    fxEl.muted = baseAudio.muted;
    fxEl.crossOrigin = 'anonymous';
    fxEl.volume = 1;
    if (fx) fx.applyPreset(eqParams(), PREF.volume);
    if (fx) fx.resume();
    savePref();
    reloadForFx(pos, wasPlaying);
    if (!silent) toast(T('音效已开启', 'Sound effects on'));
  }

  function disableEq(auto){
    const wasFxEl = audio === fxEl;
    const song = queue[qIndex];
    const pos = audio.currentTime;
    const wasPlaying = !audio.paused;
    audio.pause();
    PREF.eq.on = false;
    audio = baseAudio;
    baseAudio.muted = wasFxEl && fxEl ? fxEl.muted : baseAudio.muted;
    baseAudio.crossOrigin = '';
    applyVolume();
    if (fx && fx.isReady()) fx.applyPreset(window.AudioFX.neutralParams(), PREF.volume);
    savePref();
    if (song) reloadForFx(pos, wasPlaying);
    renderPlayerBar();
    toast(auto ? T('当前音源不支持音效，已自动关闭', 'FX off: this source lacks CORS support') : T('音效已关闭', 'Sound effects off'));
  }

  /* 按当前 PREF.eq 应用 / 关闭音效（设置页与启动时调用） */
  function applyEq(silent){
    if (!window.AudioFX) return;
    PREF.eq = window.AudioFX.normalizeEq(PREF.eq);
    if (PREF.eq.on && audio === fxEl && fx && fx.isReady()){
      fx.applyPreset(eqParams(), PREF.volume);
      return;
    }
    if (PREF.eq.on) enableEq(silent);
    else if (audio === fxEl) disableEq(false);
  }

  function cycleRepeat(){
    const order = ['all', 'one', 'off'];
    const i = order.indexOf(PREF.repeat);
    PREF.repeat = order[(i + 1) % order.length];
    savePref();
    renderPlayerBar();
  }

  function toggleShuffle(){
    PREF.shuffle = !PREF.shuffle;
    savePref();
    renderPlayerBar();
  }

  function clearQueue(){
    queue = [];
    qIndex = -1;
    playFailStreak = 0;
    stopLyricTicker();
    audio.pause();
    audio.removeAttribute('src');
    try { audio.load(); } catch(e){}
    localUrlsCleanup();
    if (miniPlayerMask){ miniPlayerMask.remove(); miniPlayerMask = null; }
    const panel = $('#pbQueuePanel');
    if (panel){ panel.hidden = true; panel.innerHTML = ''; }
    const qbtn = $('#pbQueue');
    if (qbtn){ qbtn.classList.remove('on'); qbtn.setAttribute('aria-pressed', 'false'); }
    renderPlayerBar();
  }

  function localUrlsCleanup(){
    Object.keys(localUrls).forEach(function(k){
      try { URL.revokeObjectURL(localUrls[k]); } catch(e){}
    });
    for (const k in localUrls) delete localUrls[k];
  }

  /* 流媒体时长以实际加载到的元数据为准，并回填收藏 / 最近 / 歌单里的同一首歌 */
  function backfillDuration(id, ms){
    if (!id || !(ms > 0)) return;
    let changed = false;
    function fix(list){
      list.forEach(function(s){
        if (s && s.id === id && Math.abs((Number(s.duration) || 0) - ms) > 1500){
          s.duration = ms;
          changed = true;
        }
      });
    }
    fix(favorites); fix(recent);
    playlists.forEach(function(p){ fix(p.songs); });
    if (changed){ persistFavorites(); persistRecent(); persistPlaylists(); }
  }

  function updateProgressUI(){
    if (qIndex < 0) return;
    const song = queue[qIndex];
    const hasDur = isFinite(audio.duration) && audio.duration > 0;
    if (hasDur){
      const ratio = Math.min(1, Math.max(0, audio.currentTime / audio.duration));
      $('#pbCur').textContent = U.fmtTime(audio.currentTime);
      $('#pbSeek').value = Math.round(ratio * 1000);
      try { document.documentElement.style.setProperty('--seek-fill', Math.round(ratio*100)+'%'); } catch(e){}
      $('#pbDur').textContent = U.fmtTime(audio.duration);
    } else if (song){
      $('#pbDur').textContent = song.duration ? U.fmtMS(song.duration) : '--:--';
    }
    if (miniPlayerMask){
      const cur = $('#mpCur', miniPlayerMask);
      const dur = $('#mpDur', miniPlayerMask);
      const seek = $('#mpSeek', miniPlayerMask);
      if (hasDur){
        if (cur) cur.textContent = U.fmtTime(audio.currentTime);
        if (dur) dur.textContent = U.fmtTime(audio.duration);
        if (seek){
          seek.max = '1000';
          seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
        }
      } else if (dur && song){
        dur.textContent = song.duration ? U.fmtMS(song.duration) : '--:--';
      }
    }
    /* 锁屏进度（不支持 setPositionState 的浏览器直接忽略） */
    if (hasDur && 'mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function'){
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate || 1,
          position: Math.min(audio.currentTime, audio.duration)
        });
      } catch(e){}
    }
  }

  /* 播放元素事件：baseAudio 与 fxEl 共用（按当前播放元素触发） */
  function bindHotkeys(){
    if (window._hotkeysBound) return;
    window._hotkeysBound = true;
    document.addEventListener('keydown', function(e){
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space'){ e.preventDefault(); if (qIndex >= 0) togglePlay(); return; }
      if (e.code === 'ArrowLeft'){ e.preventDefault(); if (qIndex >= 0 && isFinite(audio.currentTime)) audio.currentTime = Math.max(0, audio.currentTime - 5); return; }
      if (e.code === 'ArrowRight'){ e.preventDefault(); if (qIndex >= 0 && isFinite(audio.currentTime)) audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + 5); return; }
      if (e.code === 'KeyN'){ e.preventDefault(); if (qIndex >= 0) next(false); return; }
      if (e.code === 'KeyP'){ e.preventDefault(); if (qIndex >= 0) prev(); return; }
    });
  }

  function bindPlayerEvents(el){
    el.addEventListener('timeupdate', function(){
      updateProgressUI();
      refreshLyricHighlight();
    });

    el.addEventListener('loadedmetadata', function(){
      const song = queue[qIndex];
      if (song && isFinite(el.duration) && el.duration > 0){
        const ms = Math.round(el.duration * 1000);
        if (!song.duration || Math.abs(song.duration - ms) > 1500){
          song.duration = ms;
          backfillDuration(song.id, ms);
        }
      }
      updateProgressUI();
      renderQueuePanel();
    });

    el.addEventListener('seeked', function(){
      refreshLyricHighlight();
      updateProgressUI();
    });

    el.addEventListener('ended', function(){
      /* 播放统计：歌曲播完累计收听时长 */
      const song = queue[qIndex];
      if (song && isFinite(el.duration)){
        stats = U.bumpStats(stats, song.id, 0, Math.round(el.duration * 1000));
        persistStats();
      }
      next(true);
    });

    el.addEventListener('error', function(){
      /* 音效开启时音源不支持跨域（CORS）→ 自动回退到直连播放当前曲目一次 */
      if (el === fxEl && PREF.eq.on && !eqRetried){
        eqRetried = true;
        disableEq(true);
        return;
      }
      if (qIndex >= 0) failCurrent();
    });

    el.addEventListener('play', function(){
      $('#pbToggle').classList.add('playing');
      /* 浏览器自动播放策略可能让 AudioContext 处于 suspended：播放时恢复 */
      if (fx && fx.isReady()) fx.resume();
      startLyricTicker();
      try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; } catch(e){}
    });
    el.addEventListener('playing', function(){
      playFailStreak = 0;
    });
    el.addEventListener('pause', function(){
      $('#pbToggle').classList.remove('playing');
      stopLyricTicker();
      try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; } catch(e){}
    });
  }
  bindPlayerEvents(baseAudio);
  /* 启动时按上次偏好恢复音效状态（静默；无歌曲时不触发重载） */
  applyEq(true);

  function syncPlayingRows(){
    const curId = qIndex >= 0 && queue[qIndex] ? String(queue[qIndex].id) : '';
    ('.song-row').forEach(function(row){ row.classList.toggle('playing', !!curId && row.dataset.id === curId); });
  }

  /* ---------- 渲染：歌曲行 ---------- */
  function songRowHTML(song, opts){
    opts = opts || {};
    const d = songDisplay(song);
    const dur = song.duration ? U.fmtMS(song.duration) : '--:--';
    const fav = isFav(song);
    return '<div class="song-row" data-id="' + esc(song.id) + '">' +
      '<img class="song-cover" src="' + esc(coverOf(song)) + '" alt="" loading="lazy">' +
      '<div class="song-meta">' +
        '<div class="song-title">' + esc(d.title) + '</div>' +
        '<div class="song-artist">' + esc(d.artist) + (song.album ? ' · ' + esc(song.album) : '') + '</div>' +
      '</div>' +
      '<span class="song-src-tag" title="' + esc(sourceName(song.source)) + '">' + (song.source === 'local' ? T('本地', 'Local') : T('全曲', 'Full')) + '</span>' +
      '<span class="song-dur">' + dur + '</span>' +
      '<div class="row-actions">' +
        '<button class="icon-btn" data-act="fav" type="button" title="' + T('收藏', 'Favorite') + '" aria-pressed="' + fav + '">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="' + (fav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-9.2-9A5.4 5.4 0 0 1 12 5.5 5.4 5.4 0 0 1 21.2 11C19 15.6 12 20 12 20z"/></svg>' +
        '</button>' +
        '<button class="icon-btn" data-act="add" type="button" title="' + T('加入歌单', 'Add to playlist') + '">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' +
        '</button>' +
        (opts.canRemove ?
          '<button class="icon-btn danger" data-act="remove" type="button" title="' + T('移除', 'Remove') + '">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' : '') +
      '</div>' +
    '</div>';
  }

  /* 事件委托：歌曲行点击播放 / 按钮动作（同一容器只绑定一次监听） */
  function bindSongList(host, songs, onRemove){
    const handler = function(e){
      const row = e.target.closest('.song-row');
      if (!row) return;
      const idx = Number(row.dataset.idx);
      const song = songs[idx];
      if (!song) return;
      const actBtn = e.target.closest('[data-act]');
      if (actBtn){
        const act = actBtn.dataset.act;
        if (act === 'fav'){ actBtn.classList.add('pop'); setTimeout(function(){ actBtn.classList.remove('pop'); }, 400); toggleFav(song); return; }
        if (act === 'add'){ openPlaylistPicker(song); return; }
        if (act === 'remove'){
          if (onRemove) onRemove(song, idx);
          return;
        }
        return;
      }
      playQueue(songs, idx);
    };
    if (host._songHandler) host.removeEventListener('click', host._songHandler);
    host._songHandler = handler;
    host.addEventListener('click', handler);
  }

  /* ---------- 渲染：首页 ---------- */
  const HOT_TERMS = ['周杰伦', '邓紫棋', 'Taylor Swift', '钢琴', '轻音乐', '古典'];

  /* Internet Archive 条目解析并播放（公共曲库 / 精选推荐 / 随机一听共用） */
  function loadIAItem(it){
    return fetchJSON(U.iaMetaURL(it.identifier), 8000)
      .then(function(meta){
        const file = U.pickAudioFile(meta.files, PREF.quality);
        if (!file) throw new Error('no audio file');
        const song = {
          id: 'ia-' + it.identifier + '-' + U.stableId(file.name),
          title: it.title,
          artist: it.creator || it.identifier,
          album: 'Internet Archive',
          cover: '',
          src: U.iaFileURL(it.identifier, file.name),
          duration: 0,
          source: 'ia'
        };
        playQueue([song], 0);
        return true;
      });
  }

  /* 精选推荐：预设公共领域主题词，优先 Internet Archive；不可用时回退 Audius */
  const CURATED_QUERIES = ['Beethoven', 'Mozart classical', 'Chopin piano', 'Bach organ', 'Jazz standards', 'Folk guitar'];

  function fetchRecommendations(){
    const q = CURATED_QUERIES[Math.floor(Math.random() * CURATED_QUERIES.length)];
    return fetchJSON(U.iaSearchURL(q, 8), 5000).then(function(j){
      const docs = ((j.response && j.response.docs) || []).filter(function(d){
        if (!d || !d.identifier) return false;
        const formats = Array.isArray(d.format) ? d.format : (d.format ? [d.format] : []);
        return formats.some(function(f){ return /mp3|ogg|flac|m4a|wav|aac|audio/i.test(String(f)); });
      });
      if (!docs.length) throw new Error('no IA picks');
      return {
        source: 'ia',
        items: docs.map(function(d){
          return { kind: 'ia', identifier: d.identifier, title: d.title || d.identifier, creator: d.creator || '' };
        })
      };
    }).catch(function(){
      return fetchJSON(U.audiusSearchURL(q, 8), 5000).then(function(j){
        const songs = (j.data || []).map(audiusSongFrom).filter(Boolean);
        if (!songs.length) throw new Error('no Audius picks');
        return { source: 'audius', items: songs.map(function(s){ return { kind: 'song', song: s, title: s.title, creator: s.artist }; }) };
      });
    });
  }

  function randomDiscover(){
    fetchRecommendations()
      .then(function(res){
        if (!res.items.length){ toast(T('暂无可随机推荐的歌曲', 'No tracks to shuffle right now')); return; }
        const pick = res.items[Math.floor(Math.random() * res.items.length)];
        toast(T('随机一听：' + pick.title, 'Shuffle: ' + pick.title));
        if (pick.kind === 'song'){ playQueue([pick.song], 0); return; }
        loadIAItem({ identifier: pick.identifier, title: pick.title, creator: pick.creator })
          .catch(function(){ toast(T('该条目暂无可播放的音频文件', 'No playable audio found for this item')); });
      })
      .catch(function(){ toast(T('随机推荐失败，请检查网络', 'Shuffle failed, check network')); });
  }

  function renderHomePage(host){
    const recentRows = recent.slice(0, 6);
    const favRows = favorites.slice(0, 6);
    const histChips = searchHistory.length
      ? '<div class="search-hist"><span class="sh-label">' + T('搜索历史', 'History') + '</span>' +
        searchHistory.map(function(h){ return '<button class="chip" type="button" data-term="' + esc(h) + '">' + esc(h) + '</button>'; }).join('') +
        '<button class="link-btn" type="button" id="histClear">' + T('清除', 'Clear') + '</button></div>'
      : '';
    host.innerHTML =
      '<section class="page home">' +
        '<div class="hero">' +
          '<h1 class="hero-title">' + T('听喜欢的歌，<br>也发现新的旋律', 'Play what you love,<br>discover what is new.') + '</h1>' +
          '<div class="hero-sub">' + T('免费曲库全曲播放、在线搜索、本地导入，收藏与歌单都保存在本机。', 'Free catalogs in full length, online search, local import. Favorites and playlists stay on your device.') + '</div>' +
          '<form class="search-box" id="homeSearch">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
            '<input class="search-input" id="homeSearchInput" type="search" placeholder="' + T('搜索歌曲、歌手（免费全曲）', 'Search songs or artists (free full tracks)') + '" autocomplete="off">' +
            '<button class="btn primary" type="submit">' + T('搜索', 'Search') + '</button>' +
          '</form>' +
          '<div class="hero-actions">' +
            '<button class="btn ghost" type="button" id="randomListen">' + T('随机一听', 'Shuffle play') + '</button>' +
            '<span class="hint-note inline">' + T('从公共领域曲库随机播放一首', 'Play a random public-domain track') + '</span>' +
          '</div>' +

          histChips +
          '<div class="hot-chips">' +
            HOT_TERMS.map(function(t){ return '<button class="chip" type="button" data-term="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') +
          '</div>' +
        '</div>' +
        '<section class="card rec-card">' +
          '<div class="card-h"><div class="card-t">' + T('精选推荐', 'Curated picks') + '</div>' +
          '<button class="link-btn" type="button" id="recRefresh">' + T('换一批', 'Refresh') + '</button></div>' +
          '<div class="song-list" id="homeRec"><div class="spinner-wrap"><div class="spinner"></div><div class="spinner-txt">' + T('正在加载推荐…', 'Loading picks…') + '</div></div></div>' +
        '</section>' +
        '<div class="home-cols grid-2">' +
          '<section class="card">' +
            '<div class="card-h"><div class="card-t">' + T('最近播放', 'Recently played') + '</div>' +
            (recentRows.length ? '<button class="link-btn" type="button" data-go-playlists="recent">' + T('全部', 'All') + '</button>' : '') + '</div>' +
            (recentRows.length ? '<div class="song-list" id="homeRecent"></div>' : '<div class="list-empty">' + T('还没有播放记录，去搜一首歌吧', 'No history yet. Search a song to start.') + '</div>') +
          '</section>' +
          '<section class="card">' +
            '<div class="card-h"><div class="card-t">' + T('我的收藏', 'Favorites') + '</div>' +
            (favRows.length ? '<button class="link-btn" type="button" data-go-playlists="fav">' + T('全部', 'All') + '</button>' : '') + '</div>' +
            (favRows.length ? '<div class="song-list" id="homeFav"></div>' : '<div class="list-empty">' + T('还没有收藏，点歌曲旁的 ♥ 收藏', 'Nothing here yet. Tap the heart on a song.') + '</div>') +
          '</section>' +
        '</div>' +
        '<div class="card about-card" style="text-align:center;margin-top:16px;">' +
          '<div class="card-t" style="margin-bottom:12px;">' + T('下载客户端', 'Download apps') + '</div>' +
          '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
            '<a class="btn primary" href="https://github.com/lucianxiong/tigermusic/releases/download/v1.0.0/Tiger-Music-v1.0.0-setup.exe" target="_blank" rel="noopener noreferrer">' + T('Windows 安装版', 'Windows Setup') + '</a>' +
            '<a class="btn ghost" href="https://github.com/lucianxiong/tigermusic/releases/download/v1.0.0/Tiger-Music-v1.0.0-portable.exe" target="_blank" rel="noopener noreferrer">' + T('Windows 便携版', 'Portable') + '</a>' +
            '<a class="btn ghost" href="https://github.com/lucianxiong/tigermusic/releases/download/v1.0.0/tigermusic-debug.apk" target="_blank" rel="noopener noreferrer">' + T('Android APK', 'Android APK') + '</a>' +
          '</div>' +
        '</div>' +
      '</section>';
    if (recentRows.length){
      const box = $('#homeRecent', host);
      box.innerHTML = recentRows.map(function(s, i){ return songRowHTML(s).replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"'); }).join('');
      bindSongList(box, recentRows);
    }
    if (favRows.length){
      const box = $('#homeFav', host);
      box.innerHTML = favRows.map(function(s, i){ return songRowHTML(s).replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"'); }).join('');
      bindSongList(box, favRows);
    }
    const form = $('#homeSearch', host);
    form.addEventListener('submit', function(e){
      e.preventDefault();
      const term = U.cleanTerm($('#homeSearchInput', host).value);
      if (term){ pushSearchHistory(term); goLibrarySearch(term); }
    });
    $$('.chip', host).forEach(function(c){
      c.addEventListener('click', function(){ pushSearchHistory(c.dataset.term); goLibrarySearch(c.dataset.term); });
    });
    const histClear = $('#histClear', host);
    if (histClear) histClear.addEventListener('click', function(){ clearSearchHistory(); go('home'); });
    $$('[data-go-playlists]', host).forEach(function(b){
      b.addEventListener('click', function(){ plFocus = b.dataset.goPlaylists; go('playlists'); });
    });
    $('#randomListen', host).addEventListener('click', randomDiscover);
    const recBox = $('#homeRec', host);
    let recSeq = 0;
    function paintRec(){
      const my = ++recSeq;
      recBox.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><div class="spinner-txt">' + T('正在加载推荐…', 'Loading picks…') + '</div></div>';
      fetchRecommendations()
        .then(function(res){
          if (my !== recSeq) return;
          if (!res.items.length){
            recBox.innerHTML = '<div class="list-empty">' + T('暂未加载到推荐曲目', 'No picks loaded right now.') + '</div>';
            return;
          }
          const items = res.items;
          recBox.innerHTML = items.map(function(it, i){
            const cover = it.kind === 'song' ? coverOf(it.song) : 'assets/logo/logo-64.png';
            return '<div class="ia-row" data-idx="' + i + '">' +
              '<img class="song-cover" src="' + esc(cover) + '" alt="" loading="lazy">' +
              '<div class="song-meta"><div class="song-title">' + esc(it.title) + '</div>' +
              '<div class="song-artist">' + esc(it.creator || '') + '</div></div>' +
              '<span class="song-src-tag">' + (res.source === 'audius' ? 'Audius' : T('全曲', 'Full')) + '</span>' +
              '<div class="row-actions"><span class="ia-loading" hidden></span>' +
              '<button class="btn small primary" type="button" data-act="play">' + T('播放', 'Play') + '</button></div>' +
            '</div>';
          }).join('');
          if (recBox._recHandler) recBox.removeEventListener('click', recBox._recHandler);
          recBox._recHandler = function(e){
            const row = e.target.closest('.ia-row');
            if (!row) return;
            const it = items[Number(row.dataset.idx)];
            if (!it || it.loading) return;
            const actBtn = e.target.closest('[data-act]');
            if (!actBtn || actBtn.dataset.act !== 'play') return;
            if (it.kind === 'song'){ playQueue([it.song], 0); return; }
            it.loading = true;
            const btn = $('[data-act="play"]', row);
            if (btn){ btn.disabled = true; btn.textContent = T('加载中…', 'Loading…'); }
            loadIAItem({ identifier: it.identifier, title: it.title, creator: it.creator })
              .catch(function(){ toast(T('该条目暂无可播放的音频文件', 'No playable audio found for this item')); })
              .finally(function(){
                it.loading = false;
                if (btn){ btn.disabled = false; btn.textContent = T('播放', 'Play'); }
              });
          };
          recBox.addEventListener('click', recBox._recHandler);
        })
        .catch(function(){
          if (my !== recSeq) return;
          recBox.innerHTML = '<div class="err-banner"><span>' + T('推荐曲库暂时无法连接，请检查网络后重试。', 'Picks are unavailable. Check your network and retry.') + '</span>' +
            '<button class="btn small ghost" type="button" id="recRetry">' + T('重试', 'Retry') + '</button></div>';
          const retry = $('#recRetry', recBox);
          if (retry) retry.addEventListener('click', paintRec);
        });
    }
    paintRec();
    $('#recRefresh', host).addEventListener('click', paintRec);
  }

  /* ---------- 渲染：曲库 ---------- */
  /* ---------- 网络区域：大陆优先国内资源，国际优先国外资源 ---------- */
  const CN_TZ = /^(Asia\/Shanghai|Asia\/Hong_Kong|Asia\/Macau|Asia\/Taipei|Asia\/Urumqi|Asia\/Chongqing|Asia\/Harbin)$/;
  function detectRegion(){
    try {
      const lang = String(navigator.language || navigator.userLanguage || '').toLowerCase();
      const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').replace(/\s/g, '');
      if (lang.indexOf('zh') === 0 || CN_TZ.test(tz)) return 'cn';
    } catch(e){}
    return 'intl';
  }
  function regionNow(){
    return PREF.region === 'cn' || PREF.region === 'intl' ? PREF.region : detectRegion();
  }
  /* MV 视频入口：大陆用户优先 Bilibili，国际用户优先 YouTube */
  function mvURLFor(artist, title){
    return regionNow() === 'cn' ? U.biliSearchURL(artist, title) : U.youtubeSearchURL(artist, title);
  }

  function renderLibraryPage(host, initialTab, initialTerm){
    let tab = initialTab === 'local' ? 'local' : 'online';
    host.innerHTML =
      '<section class="page">' +
        '<div class="page-head"><div class="page-title">' + T('曲库', 'Library') + '</div>' +
          '<div class="ph-right">' +
            '<span class="hint-note inline">' + T('全部为可完整播放的免费曲目', 'Every result plays in full') + '</span>' +
          '</div></div>' +
        '<div class="tabbar" role="tablist">' +
          '<button class="tab" type="button" role="tab" data-ltab="online">' + T('在线全曲', 'Online') + '</button>' +
          '<button class="tab" type="button" role="tab" data-ltab="local">' + T('本地导入', 'Local files') + '</button>' +
        '</div>' +
        '<div id="libBody"></div>' +
      '</section>';
    const body = $('#libBody', host);
    function paint(nextTab){
      tab = nextTab;
      libraryTab = tab;
      $$('.tab', host).forEach(function(b){
        const on = b.dataset.ltab === tab;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      if (tab === 'local') renderLocal(body);
      else renderOnline(body, libraryTerm || initialTerm || '');
    }
    $$('.tab', host).forEach(function(b){
      b.addEventListener('click', function(){ paint(b.dataset.ltab); });
    });
    paint(tab);
  }

  /* 搜索历史条（曲库搜索框下方复用） */
  function searchHistHTML(host){
    if (!searchHistory.length) return '';
    return '<div class="search-hist">' +
      '<span class="sh-label">' + T('搜索历史', 'History') + '</span>' +
      searchHistory.map(function(h){ return '<button class="chip" type="button" data-term="' + esc(h) + '">' + esc(h) + '</button>'; }).join('') +
      '<button class="link-btn" type="button" id="histClear">' + T('清除', 'Clear') + '</button></div>';
  }

  function bindSearchHist(container, onPick){
    const el = container;
    $$('.chip', el).forEach(function(c){
      c.addEventListener('click', function(){
        const t = c.dataset.term;
        pushSearchHistory(t);
        onPick(t);
      });
    });
    const clear = $('#histClear', el);
    if (clear) clear.addEventListener('click', function(){ clearSearchHistory(); el.innerHTML = ''; });
  }

  function searchBoxHTML(ph, id, btn){
    return '<form class="search-box" id="' + id + '">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
      '<input class="search-input" type="search" placeholder="' + esc(ph) + '" autocomplete="off">' +
      '<button class="btn primary" type="submit">' + btn + '</button>' +
      '</form>';
  }

  /* Audius 搜索结果 → 应用内歌曲对象（stream.url 缺失时用官方流地址兜底） */
  function audiusSongFrom(x){
    if (!x || !x.id || !x.title) return null;
    if (x.is_streamable === false || x.is_stream_gated) return null;
    if (x.access && x.access.stream === false) return null;
    const art = x.artwork && (x.artwork['480x480'] || x.artwork['150x150']);
    return {
      id: 'au-' + x.id,
      title: x.title,
      artist: (x.user && x.user.name) || '',
      album: 'Audius',
      cover: art || '',
      src: (x.stream && x.stream.url) || U.audiusStreamURL(x.id),
      duration: Number(x.duration) > 0 ? Number(x.duration) * 1000 : 0,
      source: 'audius'
    };
  }

  /* Openverse 音频结果 → 应用内歌曲对象（duration 单位为毫秒） */
  function openverseSongFrom(r){
    if (!r || !r.id || !r.url) return null;
    if (r.mature) return null;
    const ft = String(r.filetype || '').toLowerCase();
    if (['mp3', 'mp32', 'ogg', 'flac', 'm4a', 'wav', 'opus', 'aac'].indexOf(ft) < 0) return null;
    const lic = [r.license, r.license_version].filter(Boolean).join(' ').toUpperCase();
    return {
      id: 'ov-' + r.id,
      title: r.title || '',
      artist: r.creator || '',
      album: lic ? 'CC ' + lic : 'Openverse',
      cover: r.thumbnail || '',
      src: r.url,
      duration: Number(r.duration) || 0,
      source: 'openverse',
      license: lic,
      link: r.foreign_landing_url || ''
    };
  }

  /* ccMixter 搜索结果 → 应用内歌曲对象（files 内挑选最优格式） */
  function ccmixterSongFrom(item){
    if (!item || !item.upload_id) return null;
    const file = U.ccmixterFilesFrom(item, PREF.quality);
    if (!file) return null;
    const lic = String(item.license_name || '').trim();
    return {
      id: 'cc-' + item.upload_id + '-' + U.stableId(file.name || file.url),
      title: item.upload_name || '',
      artist: item.user_real_name || item.user_name || '',
      album: lic ? 'CC ' + lic : 'ccMixter',
      cover: '',
      src: file.url,
      duration: 0,
      source: 'ccmixter',
      license: lic,
      link: item.file_page_url || ''
    };
  }

  /* 搜索：聚合三个可完整播放的免费曲库（不再提供 30 秒试听片段） */
  function renderOnline(body, initialTerm){
    const box = el(searchBoxHTML(T('搜索歌曲、歌手（免费全曲）', 'Search songs or artists (free full tracks)'), 'onlineSearch', T('搜索', 'Search')));
    const hist = el('<div id="onlineHist"></div>');
    const list = el('<div id="onlineList"></div>');
    body.innerHTML = '';
    body.appendChild(box);
    body.appendChild(hist);
    body.appendChild(list);
    if (initialTerm) $('.search-input', box).value = initialTerm;
    let searchSeq = 0;
    let lastTerm = '';

    function paintHist(){
      hist.innerHTML = searchHistHTML(body);
      bindSearchHist(hist, function(t){ doSearch(t); });
    }
    paintHist();

    box.addEventListener('submit', function(e){
      e.preventDefault();
      const t = U.cleanTerm($('.search-input', box).value);
      if (t) doSearch(t);
    });

    /* 搜索结果内存缓存：同关键词 5 分钟内直接命中，避免重复联网 */
    const searchCache = new Map();
    const SEARCH_CACHE_MS = 5 * 60 * 1000;

    function doSearch(t){
      t = U.cleanTerm(t);
      if (!t) return;
      const my = ++searchSeq;
      lastTerm = t;
      libraryTerm = t;
      pushSearchHistory(t);
      paintHist();
      const hit = searchCache.get(t);
      if (hit && (Date.now() - hit.ts) < SEARCH_CACHE_MS){
        renderResults(hit.ia, hit.audius, hit.openverse, hit.ccmixter, hit.failed);
        toast(T('缓存命中：5 分钟内重复搜索直接加载', 'Cache hit: loaded within 5 min'));
        return;
      }
      list.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><div class="spinner-txt">' + T('正在搜索免费全曲…', 'Searching free full tracks…') + '</div></div>';
      Promise.allSettled([
        iaRowsFor(t),
        audiusRowsFor(t),
        openverseRowsFor(t),
        ccmixterRowsFor(t)
      ]).then(function(results){
        if (my !== searchSeq) return;   /* 防止旧请求覆盖新结果 */
        const ia        = results[0].status === 'fulfilled' ? results[0].value : [];
        const audius    = results[1].status === 'fulfilled' ? results[1].value : [];
        const openverse = results[2].status === 'fulfilled' ? results[2].value : [];
        const ccmixter  = results[3].status === 'fulfilled' ? results[3].value : [];
        const failed    = results.map(function(r){ return r.status === 'rejected'; });
        searchCache.set(t, { ts: Date.now(), ia: ia, audius: audius, openverse: openverse, ccmixter: ccmixter, failed: failed });
        if (searchCache.size > 20){ searchCache.delete(searchCache.keys().next().value); }
        renderResults(ia, audius, openverse, ccmixter, failed);
      });
    }

    /* Internet Archive：只保留确实带音频文件的条目，避免出现点开不能播放的结果 */
    function iaRowsFor(t){
      return fetchJSON(U.iaSearchURL(t, 40), 5000).then(function(j){
        return ((j.response && j.response.docs) || []).map(function(d){
          if (!d || !d.identifier) return null;
          const formats = Array.isArray(d.format) ? d.format : (d.format ? [d.format] : []);
          const playable = formats.some(function(f){ return /mp3|ogg|flac|m4a|wav|aac|audio/i.test(String(f)); });
          if (!playable) return null;
          return {
            identifier: d.identifier,
            title: d.title || d.identifier,
            creator: d.creator || '',
            downloads: Number(d.downloads) || 0,
            year: d.year || ''
          };
        }).filter(Boolean);
      });
    }

    /* Audius：只保留可完整流式播放的作品（排除付费门槛 / 不可播放条目） */
    function audiusRowsFor(t){
      return fetchJSON(U.audiusSearchURL(t, 20), 5000).then(function(j){
        return (j.data || []).map(audiusSongFrom).filter(Boolean);
      });
    }

    /* Openverse：CC 授权音频聚合（Freesound / Jamendo 等），过滤成人内容与非音频格式 */
    function openverseRowsFor(t){
      return fetchJSON(U.openverseSearchURL(t, 50), 5000).then(function(j){
        return (j.results || []).map(openverseSongFrom).filter(Boolean);
      });
    }

    function ccmixterRowsFor(t){

      return fetchJSON(U.ccmixterSearchURL(t, 20), 5000).then(function(j){

        return (Array.isArray(j) ? j : []).map(ccmixterSongFrom).filter(Boolean);

      });

    }


    function srcBlock(dot, name, count, id, failed){
      return '<div class="src-block"><div class="src-head"><span class="src-dot ' + dot + '"></span><span class="src-name">' + name + '</span>' +
        (failed ? '<span class="src-note">' + T('连接失败', 'unavailable') + '</span>' : '') +
        '<span class="src-count">' + count + '</span></div><div class="song-list" id="' + id + '"></div></div>';
    }

    function renderResults(ia, audius, openverse, ccmixter, failed){
      const total = ia.length + audius.length + openverse.length + ccmixter.length;
      if (!total){
        const allFailed = failed && failed.length === 4 && failed.every(Boolean);
        list.innerHTML =
          '<div class="err-banner"><span>' + (allFailed
            ? T('四个免费曲库都无法连接，请检查网络后重试。', 'All four free catalogs are unreachable. Check your network and retry.')
            : T('没有找到可完整播放的免费曲目，换个关键词试试', 'No full-length free tracks found. Try another keyword.')) + '</span>' +
          (lastTerm ? '<button class="btn small ghost" type="button" data-search-retry>' + T('重试', 'Retry') + '</button>' : '') +
          '</div>';
        const retry = $('[data-search-retry]', list);
        if (retry) retry.addEventListener('click', function(){ doSearch(lastTerm); });
        return;
      }
      list.innerHTML =
        srcBlock('ia', T('Internet Archive · 公共领域全曲', 'Internet Archive · public domain'), ia.length, 'iaList', failed[0]) +
        srcBlock('audius', T('Audius · 独立音乐人全曲', 'Audius · independent artists'), audius.length, 'audiusList', failed[1]) +
        srcBlock('openverse', T('Openverse · CC 授权全曲', 'Openverse · CC licensed'), openverse.length, 'openverseList', failed[2]) +
          srcBlock('ccmixter', T('ccMixter · CC 混音全曲', 'ccMixter · CC remix'), ccmixter.length, 'ccmixterList', failed[3]);
      paintIARows($('#iaList', list), ia, failed[0]);
      paintSongRows($('#audiusList', list), audius, failed[1] ? T('Audius 连接失败', 'Audius unavailable') : T('没有匹配的 Audius 曲目', 'No Audius matches'));
      paintSongRows($('#openverseList', list), openverse, failed[2] ? T('Openverse 连接失败', 'Openverse unavailable') : T('没有匹配的 Openverse 曲目', 'No Openverse matches'));
        paintSongRows($('#ccmixterList', list), ccmixter, failed[3] ? T('ccMixter 连接失败', 'ccMixter unavailable') : T('没有匹配的 ccMixter 曲目', 'No ccMixter matches'));
    }

    function paintSongRows(box, songs, emptyText){
      if (!songs.length){ box.innerHTML = '<div class="list-empty">' + emptyText + '</div>'; return; }
      box.innerHTML = songs.map(function(s, i){
        return songRowHTML(s).replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"');
      }).join('');
      bindSongList(box, songs);
    }

    function paintIARows(box, items, failed){
      if (!items.length){
        box.innerHTML = '<div class="list-empty">' + (failed
          ? T('Internet Archive 连接失败', 'Internet Archive unavailable')
          : T('当前网络或关键词没有匹配的公共领域曲目', 'No public-domain matches for this keyword')) + '</div>';
        return;
      }
      box.innerHTML = items.map(function(it, i){
        return '<div class="ia-row" data-idx="' + i + '">' +
          '<img class="song-cover" src="assets/logo/logo-64.png" alt="">' +
          '<div class="song-meta"><div class="song-title">' + esc(it.title) + '</div>' +
          '<div class="song-artist">' + esc(it.creator || it.identifier) + (it.year ? ' · ' + esc(it.year) : '') + '</div></div>' +
          '<span class="song-src-tag">' + T('全曲', 'Full') + '</span>' +
          '<span class="song-dur">' + (it.downloads ? T('下载 ' + it.downloads, it.downloads + ' downloads') : '') + '</span>' +
          '<div class="row-actions"><span class="ia-loading" hidden></span>' +
          '<button class="btn small primary" type="button" data-act="play">' + T('播放', 'Play') + '</button></div>' +
        '</div>';
      }).join('');
      if (box._iaHandler) box.removeEventListener('click', box._iaHandler);
      box._iaHandler = function(e){
        const row = e.target.closest('.ia-row');
        if (!row) return;
        const it = items[Number(row.dataset.idx)];
        if (!it || it.loading) return;
        if (e.target.closest('[data-act="play"]')){
          it.loading = true;
          const btn = $('[data-act="play"]', row);
          if (btn){ btn.disabled = true; btn.textContent = T('加载中…', 'Loading…'); }
          loadIAItem({ identifier: it.identifier, title: it.title, creator: it.creator })
            .catch(function(){ toast(T('该条目暂无可播放的音频文件', 'No playable audio found for this item')); })
            .finally(function(){
              it.loading = false;
              if (btn){ btn.disabled = false; btn.textContent = T('播放', 'Play'); }
            });
        }
      };
      box.addEventListener('click', box._iaHandler);
    }

    if (initialTerm) doSearch(initialTerm);
    else list.innerHTML = '<div class="list-empty">' + T('输入关键词，搜索可完整播放的免费歌曲', 'Type a keyword to search full-length free songs.') + '</div>';
  }

  function renderLocal(body){
    body.innerHTML = '';
    const card = el(
      '<section class="card local-card">' +
        '<div class="card-h"><div class="card-t">' + T('导入本地音乐', 'Import local music') + '</div></div>' +
        '<div class="local-drop" id="localDrop">' +
          '<div class="local-actions">' +
            '<button class="btn primary" id="localPick" type="button">' + T('选择音频文件…', 'Choose audio files…') + '</button>' +
            '<span class="hint-note">' + T('也可以把文件拖到这里。支持 mp3 / m4a / ogg / wav / flac 等格式；导入的歌曲仅在本次使用内可播放。', 'Or drop files here. Supports mp3 / m4a / ogg / wav / flac; imported songs are playable for this session only.') + '</span>' +
          '</div>' +
        '</div>' +
        '<input type="file" id="localInput" accept="audio/*" multiple hidden>' +
        '<div class="song-list" id="localList"></div>' +
      '</section>');
    body.appendChild(card);
    const input = $('#localInput', card);
    const drop = $('#localDrop', card);
    const list = $('#localList', card);

    function paintLocal(){
      if (!localSongs.length){
        list.innerHTML = '<div class="list-empty">' + T('还没有导入本地音乐', 'No local music imported yet.') + '</div>';
        return;
      }
      list.innerHTML = localSongs.map(function(s, i){
        return songRowHTML(s, { canRemove: true }).replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"');
      }).join('');
      bindSongList(list, localSongs, removeLocalSong);
    }

    function removeLocalSong(song){
      const current = queue[qIndex] || null;
      const wasCurrent = current && current.id === song.id;
      localSongs = localSongs.filter(function(s){ return s.id !== song.id; });
      if (wasCurrent) clearQueue();
      else if (current){
        queue = queue.filter(function(s){ return s.id !== song.id; });
        qIndex = queue.findIndex(function(s){ return s.id === current.id; });
      }
      if (localUrls[song.id]){ try { URL.revokeObjectURL(localUrls[song.id]); } catch(e){} delete localUrls[song.id]; }
      paintLocal();
      toast(T('已移除本地歌曲', 'Local track removed'));
    }

    /* 读取音频元数据补全时长；失败不影响导入，只保留 --:-- */
    function probeDurations(songs){
      if (!songs.length) return;
      let left = songs.length;
      function done(){
        left--;
        if (left <= 0) paintLocal();
      }
      songs.forEach(function(song){
        let url = '';
        try { url = URL.createObjectURL(song.file); } catch(e){ done(); return; }
        const probe = new Audio();
        let settled = false;
        function finish(ok){
          if (settled) return;
          settled = true;
          if (ok && isFinite(probe.duration) && probe.duration > 0) song.duration = Math.round(probe.duration * 1000);
          probe.removeAttribute('src');
          try { probe.load(); } catch(e){}
          try { URL.revokeObjectURL(url); } catch(e){}
          done();
        }
        probe.addEventListener('loadedmetadata', function(){ finish(true); });
        probe.addEventListener('error', function(){ finish(false); });
        setTimeout(function(){ finish(false); }, 10000);
        probe.preload = 'metadata';
        probe.src = url;
      });
    }

    function addFiles(files){
      const added = [];
      let duplicated = 0;
      files.forEach(function(f){
        if (!f || !/^audio\//i.test(f.type || '') && !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(f.name || '')) return;
        const id = 'local-' + U.stableId(f.name + ':' + f.size + ':' + f.lastModified);
        if (localSongs.some(function(s){ return s.id === id; })){ duplicated++; return; }
        const meta = U.parseLocalName(f.name);
        const song = {
          id: id,
          title: meta.title,
          artist: meta.artist === '本地音乐' ? T('本地音乐', 'Local music') : meta.artist,
          album: T('本地导入', 'Local import'),
          cover: '',
          src: '',
          duration: 0,
          source: 'local',
          file: f
        };
        localSongs.push(song);
        added.push(song);
      });
      if (!added.length){
        if (duplicated) toast(T('这些歌曲已经导入过了', 'Those tracks are already imported'));
        return;
      }
      paintLocal();
      probeDurations(added);
      toast(T('已导入 ' + added.length + ' 首' + (duplicated ? '，跳过 ' + duplicated + ' 首重复' : ''), added.length + ' imported' + (duplicated ? ', ' + duplicated + ' skipped' : '')));
    }

    $('#localPick', card).addEventListener('click', function(){ input.click(); });
    input.addEventListener('change', function(){
      const files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      if (files.length) addFiles(files);
    });
    ['dragenter', 'dragover'].forEach(function(ev){
      drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function(ev){
      drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function(e){
      const dt = e.dataTransfer;
      if (!dt || !dt.files) return;
      addFiles(Array.prototype.slice.call(dt.files));
    });
    paintLocal();
  }

  /* ---------- 渲染：歌单 ---------- */
  function renderPlaylistsPage(host, focus){
    host.innerHTML =
      '<section class="page">' +
        '<div class="page-head"><div class="page-title">' + T('歌单', 'Playlists') + '</div>' +
        '<div class="ph-right"><button class="btn small primary" id="newPlaylist" type="button">' + T('新建歌单', 'New playlist') + '</button></div></div>' +
        '<div class="stat-grid">' +
          '<div class="stat-card" data-go="fav"><div class="stat-num">' + favorites.length + '</div><div class="stat-label">' + T('收藏', 'Favorites') + '</div></div>' +
          '<div class="stat-card" data-go="recent"><div class="stat-num">' + recent.length + '</div><div class="stat-label">' + T('最近播放', 'Recent') + '</div></div>' +
          '<div class="stat-card" data-go="custom"><div class="stat-num">' + playlists.length + '</div><div class="stat-label">' + T('自定义歌单', 'Custom') + '</div></div>' +
        '</div>' +
        '<div class="pl-body" id="plBody"></div>' +
      '</section>';
    const body = $('#plBody', host);
    $$('.stat-card', host).forEach(function(c){
      c.addEventListener('click', function(){ renderPlSection(c.dataset.go); });
    });
    $('#newPlaylist', host).addEventListener('click', function(){
      openNameModal(T('新建歌单', 'New playlist'), '', function(name){
        const p = { id: 'pl-' + U.stableId(name + Date.now()), name: name, songs: [], created: Date.now() };
        playlists.push(p);
        persistPlaylists();
        toast(T('已创建歌单', 'Playlist created'));
        renderPlSection('custom');
      });
    });
    function renderPlSection(sec){
      plRepaint = null;
      if (sec === 'fav'){
        body.innerHTML = '<div class="card"><div class="card-h"><div class="card-t">' + T('我的收藏', 'Favorites') + '</div>' +
          (favorites.length ? '<button class="link-btn" type="button" data-pl-play-all="fav">' + T('播放全部', 'Play all') + '</button>' : '') + '</div>' +
          (favorites.length ? '<div class="song-list"></div>' : '<div class="list-empty">' + T('还没有收藏的歌曲', 'No favorites yet.') + '</div>') + '</div>';
        if (favorites.length){
          const list = $('.song-list', body);
          list.innerHTML = favorites.map(function(s, i){ return songRowHTML(s, { canRemove: true }).replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"'); }).join('');
          bindSongList(list, favorites, function(song){ if (isFav(song)) toggleFav(song); });
          plRepaint = function(){ renderPlSection('fav'); };
        }
        const all = $('[data-pl-play-all]', body);
        if (all) all.addEventListener('click', function(){ playQueue(favorites, 0); });
      } else if (sec === 'recent'){
        body.innerHTML = '<div class="card"><div class="card-h"><div class="card-t">' + T('最近播放', 'Recently played') + '</div>' +
          (recent.length ? '<button class="link-btn" type="button" data-pl-play-all="recent">' + T('播放全部', 'Play all') + '</button>' : '') + '</div>' +
          (recent.length ? '<div class="song-list"></div>' : '<div class="list-empty">' + T('还没有播放记录', 'No play history yet.') + '</div>') + '</div>';
        if (recent.length){
          const list = $('.song-list', body);
          list.innerHTML = recent.map(function(s, i){ return songRowHTML(s).replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"'); }).join('');
          bindSongList(list, recent);
        }
        const all = $('[data-pl-play-all]', body);
        if (all) all.addEventListener('click', function(){ playQueue(recent, 0); });
      } else {
        if (!playlists.length){
          body.innerHTML = '<div class="list-empty">' + T('还没有自定义歌单，点右上角「新建歌单」开始', 'No custom playlists yet. Tap "New playlist" to start.') + '</div>';
          return;
        }
        body.innerHTML = '<div class="pl-grid">' + playlists.map(function(p, i){
          return '<div class="playlist-card" data-plidx="' + i + '">' +
            '<div class="pl-cover"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h4v14H4zM10 5h4v14h-4zM16 5.5l4 1v12.5l-4-1z"/></svg></div>' +
            '<div class="pl-name">' + esc(p.name) + '</div>' +
            '<div class="pl-count">' + p.songs.length + ' ' + T('首', 'songs') + '</div>' +
          '</div>';
        }).join('') + '</div>';
        $$('.playlist-card', body).forEach(function(card){
          card.addEventListener('click', function(){
            renderPlaylistDetail(playlists[Number(card.dataset.plidx)]);
          });
        });
      }
    }
    renderPlSection(focus === 'recent' ? 'recent' : focus === 'fav' ? 'fav' : 'custom');
  }

  function renderPlaylistDetail(p){
    const host = $('#main');
    let manageMode = false;
    const selected = {};

    function paint(){
      host.innerHTML =
        '<section class="page">' +
          '<div class="page-head"><div class="page-title">' + esc(p.name) + '</div>' +
          '<div class="ph-right">' +
            '<button class="btn small primary" type="button" data-pl-back>' + T('返回', 'Back') + '</button>' +
            (p.songs.length ? '<button class="btn small primary" type="button" data-pl-all>' + T('播放全部', 'Play all') + '</button>' : '') +
            (p.songs.length ? '<button class="btn small ghost" type="button" data-pl-manage>' + (manageMode ? T('完成', 'Done') : T('管理', 'Manage')) + '</button>' : '') +
          '</div></div>' +
          '<div class="card"><div class="card-h"><div class="card-t">' + p.songs.length + ' ' + T('首', 'songs') + '</div>' +
            '<button class="btn small ghost danger" type="button" data-pl-del>' + T('删除歌单', 'Delete playlist') + '</button></div>' +
            (p.songs.length ? '<div class="song-list"></div>' : '<div class="list-empty">' + T('歌单还是空的，去曲库加几首歌吧', 'This playlist is empty. Add songs from the library.') + '</div>') +
          '</div>' +
          (manageMode ? '<div class="pl-manage-bar">' +
            '<span id="plSelCount">' + T('已选 0 首', '0 selected') + '</span>' +
            '<button class="btn small ghost danger" type="button" id="plRemoveSel" disabled>' + T('移除所选', 'Remove selected') + '</button>' +
            '<button class="btn small ghost danger" type="button" id="plClearAll">' + T('清空歌单', 'Clear playlist') + '</button>' +
          '</div>' : '') +
        '</section>';
      if (p.songs.length){
        const list = $('.song-list', host);
        list.innerHTML = p.songs.map(function(s, i){
          let row = songRowHTML(s, { canRemove: !manageMode });
          if (manageMode){
            row = row.replace('class="song-row"', 'class="song-row' + (selected[s.id] ? ' sel' : '') + '"');
          }
          return row.replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"');
        }).join('');
        if (manageMode){
          /* 管理模式：点击行切换选中 */
          list.addEventListener('click', function(e){
            const row = e.target.closest('.song-row');
            if (!row) return;
            const song = p.songs[Number(row.dataset.idx)];
            if (!song) return;
            if (e.target.closest('[data-act="add"]')){ openPlaylistPicker(song); return; }
            if (selected[song.id]) delete selected[song.id]; else selected[song.id] = 1;
            paint();
          });
        } else {
          bindSongList(list, p.songs, function(song){
            p.songs = p.songs.filter(function(s){ return s.id !== song.id; });
            savePlaylist(p);
            toast(T('已从歌单移除', 'Removed from playlist'));
            renderPlaylistDetail(p);
          });
        }
      }
      $('[data-pl-back]', host).addEventListener('click', function(){ go('playlists'); });
      const all = $('[data-pl-all]', host);
      if (all) all.addEventListener('click', function(){ playQueue(p.songs, 0); });
      const man = $('[data-pl-manage]', host);
      if (man) man.addEventListener('click', function(){ manageMode = !manageMode; paint(); });
      $('[data-pl-del]', host).addEventListener('click', function(){
        openConfirmModal(T('删除歌单', 'Delete playlist'), T('确定删除歌单「' + p.name + '」吗？此操作不可撤销。', 'Delete playlist "' + p.name + '"? This cannot be undone.'), function(){
          playlists = playlists.filter(function(x){ return x.id !== p.id; });
          persistPlaylists();
          toast(T('已删除歌单', 'Playlist deleted'));
          go('playlists');
        });
      });
      const rs = $('#plRemoveSel', host);
      if (rs){
        const n = Object.keys(selected).length;
        $('#plSelCount', host).textContent = T('已选 ' + n + ' 首', n + ' selected');
        rs.disabled = n === 0;
        rs.addEventListener('click', function(){
          p.songs = p.songs.filter(function(s){ return !selected[s.id]; });
          savePlaylist(p);
          toast(T('已移除 ' + n + ' 首', n + ' removed'));
          manageMode = false;
          renderPlaylistDetail(p);
        });
      }
      const clr = $('#plClearAll', host);
      if (clr) clr.addEventListener('click', function(){
        openConfirmModal(T('清空歌单', 'Clear playlist'), T('确定清空歌单「' + p.name + '」中的全部歌曲吗？', 'Clear all songs in "' + p.name + '"?'), function(){
          p.songs = [];
          savePlaylist(p);
          toast(T('已清空歌单', 'Playlist cleared'));
          renderPlaylistDetail(p);
        });
      });
    }
    paint();
  }

  /* ---------- 渲染：我的 ---------- */
  function findSongById(id){
    let i = favorites.findIndex(function(s){ return s.id === id; });
    if (i >= 0) return favorites[i];
    i = recent.findIndex(function(s){ return s.id === id; });
    if (i >= 0) return recent[i];
    for (let k = 0; k < playlists.length; k++){
      i = playlists[k].songs.findIndex(function(s){ return s.id === id; });
      if (i >= 0) return playlists[k].songs[i];
    }
    return null;
  }

  function exportBackup(){
    function exportSongs(list){
      return cleanSongList(list).map(function(s){
        const copy = Object.assign({}, s);
        delete copy.file;   /* File 无法写入 JSON，本地歌曲也不会随备份恢复 */
        return copy;
      });
    }
    const data = {
      app: 'tiger-music',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      pref: { lang: PREF.lang, theme: PREF.theme, volume: PREF.volume, repeat: PREF.repeat, shuffle: PREF.shuffle, region: PREF.region },
      favorites: exportSongs(favorites),
      recent: exportSongs(recent),
      playlists: playlists.map(function(p){
        return { id: p.id, name: p.name, songs: exportSongs(p.songs), created: p.created };
      }),
      stats: stats,
      lyricOffset: lyricsOffset,
      searchHistory: searchHistory
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tiger-music-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ try { URL.revokeObjectURL(a.href); } catch(e){} }, 4000);
    toast(T('已导出备份文件', 'Backup exported'));
  }

  function importBackup(file){
    const reader = new FileReader();
    reader.onload = function(){
      try {
        const data = JSON.parse(reader.result);
        if (!data || data.app !== 'tiger-music' || !Array.isArray(data.favorites) || !Array.isArray(data.recent) || !Array.isArray(data.playlists)){
          toast(T('备份文件无效', 'Invalid backup file'));
          return;
        }
        favorites = cleanSongList(data.favorites);
        recent = cleanSongList(data.recent);
        playlists = data.playlists.filter(function(p){ return p && p.id && p.name && Array.isArray(p.songs); }).map(function(p){
          return { id: p.id, name: String(p.name).slice(0, 30), songs: cleanSongList(p.songs), created: Number(p.created) || Date.now() };
        });
        stats = data.stats && typeof data.stats === 'object' && !Array.isArray(data.stats) ? data.stats : {};
        if (data.lyricOffset && typeof data.lyricOffset === 'object' && !Array.isArray(data.lyricOffset)) lyricsOffset = data.lyricOffset;
        if (Array.isArray(data.searchHistory)){
          searchHistory = data.searchHistory.filter(function(s){ return typeof s === 'string' && s.trim(); }).slice(0, 8);
        }
        if (data.pref && typeof data.pref === 'object') Object.assign(PREF, data.pref);
        normalizePref();

  /* ---------- 版本迁移：新版本启动时清理旧版本的技术性缓存 ----------
   * 保留：收藏 / 最近播放 / 歌单 / 听歌统计 / 用户偏好（这些是用户资产）
   * 清理：搜索历史 / 临时标记 / 旧版本遗留键（这些是缓存痕迹）
   * 记录版本号到 localStorage，下次版本变化时再次触发清理 */
  const STORE_VERSION_KEY = STORE_PREFIX + 'appVersion';
  (function migrateVersion(){
    let prev = null;
    try { prev = localStorage.getItem(STORE_VERSION_KEY); } catch(e){}
    if (prev && prev !== APP_VERSION){
      // 版本变化：清理非用户数据缓存
      try {
        // 只清缓存类键，保留 favorites/recent/playlists/stats/pref
        const cacheKeys = ['searchHistory'];
        cacheKeys.forEach(function(k){ try { localStorage.removeItem(STORE_PREFIX + k); } catch(e){} });
        // 清理所有带 "cache:" 前缀的临时键
        for (let i = localStorage.length - 1; i >= 0; i--){
          const key = localStorage.key(i);
          if (key && key.indexOf(STORE_PREFIX + 'cache:') === 0){
            try { localStorage.removeItem(key); } catch(e){}
          }
        }
        console.log('[migrate] 旧版本缓存已清理：' + prev + ' -> ' + APP_VERSION);
      } catch(e){}
    }
    try { localStorage.setItem(STORE_VERSION_KEY, APP_VERSION); } catch(e){}
  })();
        persistFavorites(); persistRecent(); persistPlaylists(); persistStats(); savePref();
        saveList('lyricOffset', lyricsOffset);
        persistSearchHistory();
        applyTheme();
        applyStaticI18n();
        paintLangButton();
        applyVolume();
        applyEq(true);
        toast(T('已导入备份', 'Backup imported'));
        go('mine');
      } catch(e){
        toast(T('备份文件解析失败', 'Cannot parse backup file'));
      }
    };
    reader.onerror = function(){ toast(T('读取文件失败', 'Read failed')); };
    reader.readAsText(file);
  }

  function renderMinePage(host){
    const sum = U.statsSummary(stats);
    const top = U.topStats(stats, 10);
    const topRows = top.map(function(r, i){
      const s = findSongById(r.id);
      const name = s ? (s.title + (s.artist ? ' · ' + s.artist : '')) : r.id;
      return '<div class="rank-row' + (i < 3 ? ' top' : '') + '">' +
        '<span class="rank-no">' + (i + 1) + '</span>' +
        '<span class="rank-name">' + esc(name) + '</span>' +
        '<span class="rank-num">' + r.plays + ' ' + T('次', 'plays') + '</span>' +
      '</div>';
    }).join('');
    host.innerHTML =
      '<section class="page">' +
        '<div class="page-head"><div class="page-title">' + T('我的', 'Mine') + '</div></div>' +
        '<div class="grid-2">' +
          '<section class="card">' +
            '<div class="card-h"><div class="card-t">' + T('外观与语言', 'Appearance & language') + '</div></div>' +
            '<div class="set-row"><span>' + T('主题', 'Theme') + '</span>' +
              '<select id="setTheme">' +
                '<option value="auto">' + T('跟随系统', 'Auto') + '</option>' +
                '<option value="dark">' + T('深色', 'Dark') + '</option>' +
                '<option value="light">' + T('浅色', 'Light') + '</option>' +
              '</select></div>' +
            '<div class="set-row"><span>' + T('语言', 'Language') + '</span>' +
              '<select id="setLang">' +
                '<option value="zh">中文</option>' +
                '<option value="en">English</option>' +
              '</select></div>' +
            '<div class="set-row"><span>' + T('默认音量', 'Default volume') + '</span>' +
              '<input type="range" min="0" max="100" step="1" value="' + Math.round(PREF.volume * 100) + '" id="setVol"></div>' +
            '<div class="set-row"><span>' + T('网络区域', 'Network region') + '</span>' +
              '<select id="setRegion">' +
                '<option value="auto">' + T('自动检测', 'Auto') + '</option>' +
                '<option value="cn">' + T('中国大陆', 'Mainland China') + '</option>' +
                '<option value="intl">' + T('国际', 'International') + '</option>' +
              '</select></div>' +
            '<div class="set-row"><span>' + T('音质模式', 'Audio quality') + '</span>' +
              '<select id="setQuality">' +
                '<option value="fast">' + T('标准（MP3，加载快）', 'Standard (MP3, fast load)') + '</option>' +
                '<option value="hq">' + T('高品质（M4A/320k，均衡）', 'High quality (M4A/320k, balanced)') + '</option>' +
                '<option value="lossless">' + T('高音质（FLAC，加载慢）', 'High quality (FLAC, slower load)') + '</option>' +
              '</select></div>' +
          '</section>' +
          '<section class="card">' +
            '<div class="card-h"><div class="card-t">' + T('本地数据', 'Local data') + '</div></div>' +
            '<div class="set-row"><span>' + T('收藏', 'Favorites') + '</span><b>' + favorites.length + '</b></div>' +
            '<div class="set-row"><span>' + T('最近播放', 'Recent') + '</span><b>' + recent.length + '</b></div>' +
            '<div class="set-row"><span>' + T('自定义歌单', 'Playlists') + '</span><b>' + playlists.length + '</b></div>' +
            '<div class="set-row backup-row">' +
              '<button class="btn small primary" type="button" id="exportData">' + T('导出备份', 'Export backup') + '</button>' +
              '<button class="btn small ghost" type="button" id="importData">' + T('导入备份', 'Import backup') + '</button>' +
              '<input type="file" id="importInput" accept=".json,application/json" hidden>' +
            '</div>' +
            '<div class="set-row"><button class="btn small ghost" type="button" id="localMusicBtn">' + T('本地音乐', 'Local music') + '</button></div>' +
            '<div class="set-row"><button class="btn small ghost danger" type="button" id="clearData">' + T('清空本地数据', 'Clear local data') + '</button></div>' +
          '</section>' +
        '</div>' +
        '<div class="grid-2">' +
          '<section class="card">' +
            '<div class="card-h"><div class="card-t">' + T('听歌统计', 'Listening stats') + '</div></div>' +
            '<div class="stat-inline">' +
              '<div class="stat-mini"><b>' + sum.plays + '</b><span>' + T('总播放次数', 'Total plays') + '</span></div>' +
              '<div class="stat-mini"><b>' + U.fmtTime(Math.round(sum.ms / 1000)) + '</b><span>' + T('累计收听', 'Listening time') + '</span></div>' +
              '<div class="stat-mini"><b>' + sum.songs + '</b><span>' + T('听过的歌曲', 'Songs heard') + '</span></div>' +
            '</div>' +
            (topRows ? '<div class="rank-list">' + topRows + '</div>' : '<div class="list-empty">' + T('多听几首歌，这里会出现你的听歌排行', 'Play some songs and your chart appears here.') + '</div>') +
          '</section>' +
          '<section class="card">' +
            '<div class="card-h"><div class="card-t">' + T('音效', 'Sound effects') + '</div></div>' +
            '<div class="set-row"><span>' + T('均衡器预设', 'EQ preset') + '</span>' +
              '<select id="setEqPreset">' +
                '<option value="off">' + T('关闭', 'Off') + '</option>' +
                '<option value="pop">' + T('流行', 'Pop') + '</option>' +
                '<option value="rock">' + T('摇滚', 'Rock') + '</option>' +
                '<option value="classical">' + T('古典', 'Classical') + '</option>' +
                '<option value="jazz">' + T('爵士', 'Jazz') + '</option>' +
                '<option value="vocal">' + T('人声', 'Vocal') + '</option>' +
                '<option value="custom">' + T('自定义', 'Custom') + '</option>' +
              '</select></div>' +
            '<div class="set-row"><span>' + T('低音', 'Bass') + '</span>' +
              '<input type="range" min="-12" max="12" step="1" value="0" id="setEqBass" aria-label="' + T('低音', 'Bass') + '"></div>' +
            '<div class="set-row"><span>' + T('高音', 'Treble') + '</span>' +
              '<input type="range" min="-12" max="12" step="1" value="0" id="setEqTreble" aria-label="' + T('高音', 'Treble') + '"></div>' +
            '<div class="set-hint">' + T('音效基于 Web Audio API，开启后对支持跨域加载的音源生效；不支持的音源会自动关闭。', 'FX uses the Web Audio API and works with CORS-enabled sources; unsupported sources fall back automatically.') + '</div>' +
          '</section>' +
        '</div>' +
        '<section class="card about-card">' +
          '<div class="card-h"><div class="card-t">' + T('关于', 'About') + '</div></div>' +
          '<div class="about-line">蓝虎听歌 v' + APP_VERSION + '</div>' +
          '<div class="about-line">' + T('免费全曲 · 在线搜索 · 本地导入 · Windows / Android / 浏览器三端通用', 'Free full tracks · online search · local import · Windows / Android / Web') + '</div>' +
          '<div class="about-line"><a href="PRIVACY.md" target="_blank" rel="noopener noreferrer">' + T('隐私说明', 'Privacy') + '</a></div>' +
        '</section>' +
      '</section>';
    const selTheme = $('#setTheme', host);
    selTheme.value = PREF.theme;
    selTheme.addEventListener('change', function(){ PREF.theme = selTheme.value; savePref(); applyTheme(); });
    const selLang = $('#setLang', host);
    selLang.value = PREF.lang;
    selLang.addEventListener('change', function(){ setLang(selLang.value); });
    const setVol = $('#setVol', host);
    setVol.addEventListener('input', function(){ setVolume(Number(setVol.value) / 100); });
    const selRegion = $('#setRegion', host);
    selRegion.value = PREF.region || 'auto';
    selRegion.addEventListener('change', function(){
      PREF.region = selRegion.value;
      savePref();
      toast(T('网络区域已更新：', 'Network region: ') +
        (PREF.region === 'cn' ? T('中国大陆', 'Mainland China') : (PREF.region === 'intl' ? T('国际', 'International') : T('自动检测', 'Auto'))));
    });
    const selQuality = $('#setQuality', host);
    if (selQuality) {
      selQuality.value = PREF.quality || 'fast';
      selQuality.addEventListener('change', function(){
        const v = selQuality.value;
        PREF.quality = (v === 'lossless' || v === 'hq') ? v : 'fast';
        savePref();
        const qLabels = {
          fast: T('标准（MP3）', 'Standard (MP3)'),
          hq: T('高品质（M4A/320k）', 'High quality (M4A/320k)'),
          lossless: T('无损（FLAC/WAV）', 'Lossless (FLAC/WAV)')
        };
        toast(T('音质模式：', 'Quality: ') + qLabels[PREF.quality]);
      });
    }
    const eqSel = $('#setEqPreset', host);
    const eqBass = $('#setEqBass', host);
    const eqTreble = $('#setEqTreble', host);
    if (eqSel && eqBass && eqTreble){
      eqSel.value = PREF.eq.preset;
      eqBass.value = PREF.eq.bass;
      eqTreble.value = PREF.eq.treble;
      const commitEq = function(restart){
        PREF.eq = window.AudioFX ? window.AudioFX.normalizeEq(PREF.eq) : PREF.eq;
        savePref();
        if (restart || !fxActive()) applyEq(false);
        else if (fx) fx.applyPreset(eqParams(), PREF.volume);
        renderPlayerBar();
      };
      eqSel.addEventListener('change', function(){
        const v = eqSel.value;
        PREF.eq.preset = v;
        if (v === 'off'){
          PREF.eq.on = false;
        } else if (window.AudioFX && window.AudioFX.PRESETS[v]){
          PREF.eq.on = true;
          PREF.eq.bands = (window.AudioFX.PRESETS[v].eq || []).slice();
          PREF.eq.bass = window.AudioFX.PRESETS[v].bass;
          PREF.eq.treble = window.AudioFX.PRESETS[v].treble;
          eqBass.value = PREF.eq.bass;
          eqTreble.value = PREF.eq.treble;
        } else {
          PREF.eq.on = true;   /* custom */
        }
        commitEq(true);
      });
      eqBass.addEventListener('input', function(){
        PREF.eq.bass = Number(eqBass.value);
        if (PREF.eq.preset !== 'off' && PREF.eq.preset !== 'custom'){ PREF.eq.preset = 'custom'; eqSel.value = 'custom'; }
        PREF.eq.on = true;
        commitEq(false);
      });
      eqTreble.addEventListener('input', function(){
        PREF.eq.treble = Number(eqTreble.value);
        if (PREF.eq.preset !== 'off' && PREF.eq.preset !== 'custom'){ PREF.eq.preset = 'custom'; eqSel.value = 'custom'; }
        PREF.eq.on = true;
        commitEq(false);
      });
    }
    const localBtn = $('#localMusicBtn', host);
    if (localBtn) localBtn.addEventListener('click', function(){
      libraryTab = 'local';
      go('library');
    });
    $('#exportData', host).addEventListener('click', exportBackup);
    $('#importData', host).addEventListener('click', function(){ $('#importInput', host).click(); });
    $('#importInput', host).addEventListener('change', function(){
      const f = $('#importInput', host).files && $('#importInput', host).files[0];
      if (f) importBackup(f);
      $('#importInput', host).value = '';
    });
    $('#clearData', host).addEventListener('click', function(){
      openConfirmModal(T('清空本地数据', 'Clear local data'), T('将删除收藏、最近播放、自定义歌单、听歌统计、搜索历史、歌词校正与偏好设置。', 'This deletes favorites, history, playlists, stats, search history, lyric offsets and preferences.'), function(){
        store.del('favorites'); store.del('recent'); store.del('playlists'); store.del('pref'); store.del('stats');
        store.del('searchHistory'); store.del('lyricOffset');
        favorites = []; recent = []; playlists = []; stats = {}; searchHistory = []; lyricsOffset = {};
        localSongs = [];
        clearQueue();
        Object.assign(PREF, { lang: 'zh', theme: 'auto', volume: 0.8, repeat: 'all', shuffle: false, region: 'auto', quality: 'fast', eq: { on: false, preset: 'off', bass: 0, treble: 0, bands: [] } });
        normalizePref();

  /* ---------- 版本迁移：新版本启动时清理旧版本的技术性缓存 ----------
   * 保留：收藏 / 最近播放 / 歌单 / 听歌统计 / 用户偏好（这些是用户资产）
   * 清理：搜索历史 / 临时标记 / 旧版本遗留键（这些是缓存痕迹）
   * 记录版本号到 localStorage，下次版本变化时再次触发清理 */
  const STORE_VERSION_KEY = STORE_PREFIX + 'appVersion';
  (function migrateVersion(){
    let prev = null;
    try { prev = localStorage.getItem(STORE_VERSION_KEY); } catch(e){}
    if (prev && prev !== APP_VERSION){
      // 版本变化：清理非用户数据缓存
      try {
        // 只清缓存类键，保留 favorites/recent/playlists/stats/pref
        const cacheKeys = ['searchHistory'];
        cacheKeys.forEach(function(k){ try { localStorage.removeItem(STORE_PREFIX + k); } catch(e){} });
        // 清理所有带 "cache:" 前缀的临时键
        for (let i = localStorage.length - 1; i >= 0; i--){
          const key = localStorage.key(i);
          if (key && key.indexOf(STORE_PREFIX + 'cache:') === 0){
            try { localStorage.removeItem(key); } catch(e){}
          }
        }
        console.log('[migrate] 旧版本缓存已清理：' + prev + ' -> ' + APP_VERSION);
      } catch(e){}
    }
    try { localStorage.setItem(STORE_VERSION_KEY, APP_VERSION); } catch(e){}
  })();
        /* 音效链路复位：切回正常播放元素，直连输出 */
        if (audio === fxEl) audio = baseAudio;
        baseAudio.crossOrigin = '';
        baseAudio.muted = false;
        if (fxEl) fxEl.muted = false;
        applyVolume();
        if (fx && fx.isReady()) fx.applyPreset(window.AudioFX.neutralParams(), PREF.volume);
        applyTheme();
        applyStaticI18n();
        paintLangButton();
        toast(T('已清空本地数据', 'Local data cleared'));
        go('mine');
      });
    });
  }

  /* ---------- 路由与导航 ---------- */
  let currentModule = 'home';
  let libraryTab = 'online';
  let libraryTerm = '';
  let plFocus = null;
  let lastRenderedHash = '';

  function readRoute(){
    const h = (location.hash || '#/home').replace(/^#\/?/, '');
    return ['home', 'library', 'playlists', 'mine'].indexOf(h) >= 0 ? h : 'home';
  }

  function go(name, fromHistory){
    name = ['home', 'library', 'playlists', 'mine'].indexOf(name) >= 0 ? name : 'home';
    const host = $('#main');
    host.innerHTML = '';
    plRepaint = null;
    currentModule = name;
    $$('.tnav-btn').forEach(function(b){ b.classList.toggle('on', b.dataset.page === name); });
    if (name === 'home') renderHomePage(host);
    else if (name === 'library') renderLibraryPage(host, libraryTab, libraryTerm);
    else if (name === 'playlists'){ renderPlaylistsPage(host, plFocus); plFocus = null; }
    else renderMinePage(host);
    window.scrollTo(0, 0);
    const target = '#/' + name;
    if (!fromHistory && location.hash !== target){
      try { history.pushState(null, '', target); } catch(e){ location.hash = target; }
    }
    lastRenderedHash = target;
  }

  function goLibrarySearch(term){
    libraryTerm = term;
    libraryTab = 'online';
    go('library');
  }

  /* 支持浏览器前进 / 后退与直接修改 hash 导航 */
  function onLocationChange(){
    const target = '#/' + readRoute();
    if (target === lastRenderedHash) return;
    go(readRoute(), true);
  }
  window.addEventListener('hashchange', onLocationChange);
  window.addEventListener('popstate', onLocationChange);

  /* 顶部品牌按钮 */
  $('#brandHome').addEventListener('click', function(){ go('home'); });

  /* 顶部导航 */
  $$('.tnav-btn').forEach(function(b){
    b.addEventListener('click', function(){
      if (b.dataset.page === 'library' && currentModule === 'library'){
        /* 已在曲库：重新渲染以保留当前 tab/关键词 */
      }
      go(b.dataset.page);
    });
  });

  /* ---------- 顶部按钮：语言 / 主题 ---------- */
  function paintLangButton(){
    const b = $('#langToggle');
    b.textContent = PREF.lang === 'en' ? 'EN' : '中';
  }

  /* 静态外壳文案（顶栏 / 播放器）跟随语言切换 */
  function applyStaticI18n(){
    const en = PREF.lang === 'en';
    document.documentElement.lang = en ? 'en' : 'zh-CN';
    document.title = en ? 'Tiger Music' : '蓝虎听歌';
    const brand = $('#brandHome');
    if (brand){
      brand.title = en ? 'Back to home' : '返回首页';
      const brandName = $('.tb-name', brand);
      if (brandName) brandName.textContent = en ? 'Tiger Music' : '蓝虎听歌';
    }
    const nav = { home: [en ? 'Home' : '首页'], library: [en ? 'Library' : '曲库'], playlists: [en ? 'Playlists' : '歌单'], mine: [en ? 'Mine' : '我的'] };
    $$('.tnav-btn').forEach(function(b){
      const s = $('span', b);
      if (s && nav[b.dataset.page]) s.textContent = nav[b.dataset.page][0];
    });
    function setAttrs(sel, title, aria){
      const node = $(sel);
      if (!node) return;
      if (title != null) node.title = title;
      if (aria != null) node.setAttribute('aria-label', aria);
    }
    setAttrs('#langToggle', en ? 'Switch language (whole app)' : '中英双语切换（全站生效）', en ? 'Switch language' : '切换中英文');
    setAttrs('#themeToggle', en ? 'Toggle light / dark theme' : '深浅色切换（全站生效）', en ? 'Toggle theme' : '切换深浅色');
    setAttrs('#pbPrev', en ? 'Previous' : '上一首', en ? 'Previous' : '上一首');
    setAttrs('#pbToggle', en ? 'Play / Pause' : '播放/暂停', en ? 'Play / Pause' : '播放/暂停');
    setAttrs('#pbNext', en ? 'Next' : '下一首', en ? 'Next' : '下一首');
    setAttrs('#pbSeek', null, en ? 'Seek' : '播放进度');
    setAttrs('#pbShuffle', en ? 'Shuffle' : '随机播放', en ? 'Shuffle' : '随机播放');
    setAttrs('#pbRepeat', en ? 'Repeat' : '循环模式', en ? 'Repeat' : '循环模式');
    setAttrs('#pbMute', en ? 'Mute' : '静音', en ? 'Mute' : '静音');
    setAttrs('#pbVol', null, en ? 'Volume' : '音量');
    setAttrs('#pbSleep', en ? 'Sleep timer' : '睡眠定时器', en ? 'Sleep timer' : '睡眠定时器');
    setAttrs('#pbQueue', en ? 'Play queue' : '播放队列', en ? 'Play queue' : '播放队列');
  }

  function setLang(v){
    PREF.lang = v === 'en' ? 'en' : 'zh';
    savePref();
    paintLangButton();
    applyStaticI18n();
    const route = readRoute();
    go(route);
  }

  $('#langToggle').addEventListener('click', function(){ setLang(PREF.lang === 'en' ? 'zh' : 'en'); });
  $('#themeToggle').addEventListener('click', function(){
    PREF.theme = PREF.theme === 'auto' ? 'dark' : (PREF.theme === 'dark' ? 'light' : 'auto');
    savePref();
    applyTheme();
    toast(T('主题已切换：' + (PREF.theme === 'auto' ? '跟随系统' : PREF.theme === 'dark' ? '深色' : '浅色'), 'Theme: ' + PREF.theme));
  });

  /* ---------- 播放器控件绑定 ---------- */
  $('#pbToggle').addEventListener('click', togglePlay);
  $('#pbNext').addEventListener('click', function(){ next(false); });
  $('#pbPrev').addEventListener('click', prev);
  $('#pbSeek').addEventListener('input', function(){ seekTo(Number($('#pbSeek').value)); });
  $('#pbVol').addEventListener('input', function(){ setVolume(Number($('#pbVol').value) / 100); });
  $('#pbMute').addEventListener('click', toggleMute);
  $('#pbRepeat').addEventListener('click', cycleRepeat);
  $('#pbShuffle').addEventListener('click', toggleShuffle);
  $('#pbSleep').addEventListener('click', openSleepPicker);
  /* 点击封面 / 元信息打开迷你播放器大图页 */
  $('.pb-cover').addEventListener('click', openMiniPlayer);
  $('#pbTitle').addEventListener('click', openMiniPlayer);
  $('#pbArtist').addEventListener('click', openMiniPlayer);
  $('#pbQueue').addEventListener('click', function(){
    const panel = $('#pbQueuePanel');
    panel.hidden = !panel.hidden;
    $('#pbQueue').classList.toggle('on', !panel.hidden);
    if (!panel.hidden) renderQueuePanel();
  });

  /* 键盘快捷键：空格 播放/暂停 · ←/→ 上一首/下一首 · M 静音（输入框内不触发） */
  document.addEventListener('keydown', function(e){
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) return;
    if (e.key === ' ' || e.code === 'Space'){
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowRight'){
      e.preventDefault();
      next(false);
    } else if (e.key === 'ArrowLeft'){
      e.preventDefault();
      prev();
    } else if (e.key === 'm' || e.key === 'M'){
      toggleMute();
    }
  });

  function renderQueuePanel(){
    const panel = $('#pbQueuePanel');
    if (!panel || panel.hidden) return;
    if (!queue.length){
      panel.innerHTML = '<div class="list-empty">' + T('队列为空', 'Queue is empty.') + '</div>';
      return;
    }
    panel.innerHTML =
      '<div class="pq-head"><span>' + T('播放队列', 'Up next') + '（' + queue.length + '）</span>' +
      '<button class="link-btn" type="button" id="pqClear">' + T('清空', 'Clear') + '</button></div>' +
      '<div class="pq-list">' + queue.map(function(s, i){
        const d = songDisplay(s);
        return '<div class="pq-row' + (i === qIndex ? ' on' : '') + '" data-qidx="' + i + '">' +
          '<span class="pq-idx">' + (i === qIndex ? '♪' : (i + 1)) + '</span>' +
          '<img class="song-cover sm" src="' + esc(coverOf(s)) + '" alt="">' +
          '<div class="pq-meta"><div class="pq-title">' + esc(d.title) + '</div><div class="pq-artist">' + esc(d.artist) + '</div></div>' +
          (i === qIndex ? '<span class="pq-now">' + T('正在播放', 'Playing') + '</span>' : '') +
        '</div>';
      }).join('') + '</div>';
  }

  (function bindQueuePanel(){
    const panel = $('#pbQueuePanel');
    if (!panel) return;
    panel.addEventListener('click', function(e){
      const clear = e.target.closest('#pqClear');
      if (clear){ clearQueue(); return; }
      const row = e.target.closest('.pq-row');
      if (!row) return;
      qIndex = Number(row.dataset.qidx);
      startCurrent();
    });
  })();

  /* ---------- 睡眠定时器 ---------- */
  let sleepTimer = null; // { until: ts, mins: n }

  function renderSleepBtn(){
    const b = $('#pbSleep');
    if (!b) return;
    b.classList.toggle('on', !!sleepTimer);
    if (sleepTimer){
      const left = Math.max(1, Math.ceil((sleepTimer.until - Date.now()) / 60000));
      b.textContent = left + '′';
      b.title = T('睡眠定时 ' + sleepTimer.mins + ' 分钟 · 点击修改', 'Sleep timer ' + sleepTimer.mins + ' min · click to change');
    } else {
      b.textContent = 'Zz';
      b.title = T('睡眠定时器', 'Sleep timer');
    }
  }

  function clearSleepTimer(){
    sleepTimer = null;
    renderSleepBtn();
  }

  function setSleepTimer(mins){
    sleepTimer = { until: Date.now() + mins * 60000, mins: mins };
    renderSleepBtn();
    toast(T('睡眠定时：' + mins + ' 分钟后暂停播放', 'Sleep timer: pause in ' + mins + ' min'));
  }

  function openSleepPicker(){
    const opts = [15, 30, 45, 60, 90].map(function(m){
      return '<button class="pl-pick-row" type="button" data-mins="' + m + '"><span class="pl-pick-name">' + m + ' ' + T('分钟', 'min') + '</span></button>';
    }).join('');
    const mask = openModal(
      '<div class="modal-title">' + T('睡眠定时', 'Sleep timer') + '</div>' +
      '<div class="modal-body"><div class="pl-pick-list">' + opts + '</div></div>' +
      '<div class="modal-actions">' +
        (sleepTimer ? '<button class="btn ghost danger" type="button" id="mSleepOff">' + T('取消定时', 'Turn off') + '</button>' : '') +
        '<button class="btn ghost" type="button" data-m-close>' + T('关闭', 'Close') + '</button>' +
      '</div>');
    $$('.pl-pick-row', mask).forEach(function(b){
      b.addEventListener('click', function(){
        mask.remove();
        setSleepTimer(Number(b.dataset.mins));
      });
    });
    const off = $('#mSleepOff', mask);
    if (off) off.addEventListener('click', function(){
      mask.remove();
      clearSleepTimer();
      toast(T('已取消睡眠定时', 'Sleep timer off'));
    });
  }

  setInterval(function(){
    if (!sleepTimer) return;
    if (Date.now() >= sleepTimer.until){
      audio.pause();
      toast(T('睡眠定时已到，播放已暂停', 'Sleep timer reached, playback paused'));
      clearSleepTimer();
    } else {
      renderSleepBtn();
    }
  }, 5000);

  /* ---------- 迷你播放器（大图播放页 + 歌词） ---------- */
  let miniPlayerMask = null;

  function openMiniPlayer(){
    const song = queue[qIndex];
    if (!song) return;
    const d = songDisplay(song);
    const dur = isFinite(Number(song.duration)) && Number(song.duration) > 0 ? U.fmtMS(song.duration) : '--:--';
    miniPlayerMask = openModal(
      '<div class="mini-player" data-theme-scope>'
      + '<div class="mp-bg" style="background-image:url(\'' + esc(coverOf(song)) + '\')"></div>'
      + '<button class="mp-close" type="button" data-m-close aria-label="' + T('关闭', 'Close') + '">✕</button>'
      + '<div class="mp-cover"><img id="mpCoverImg" src="' + esc(coverOf(song)) + '" alt=""></div>'
      + '<div class="mp-meta"><div class="mp-title" id="mpTitle">' + esc(d.title) + '</div>'
      + '<div class="mp-artist" id="mpArtist">' + esc(d.artist) + (song.album ? ' · ' + esc(song.album) : '') + '</div></div>'
      + '<div class="mp-lyrics" id="mpLyrics"><div class="mp-lyr-empty">' + T('播放歌曲后显示歌词', 'Lyrics will show while playing.') + '</div></div>'
      + '<div class="mp-extras">'
      +   '<a class="mp-mv-btn" id="mpMvBtn" href="' + esc(mvURLFor(d.artist, d.title)) + '" target="_blank" rel="noopener noreferrer">'
      +     '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>'
      +     '<span>' + T('观看 MV', 'Watch MV') + '</span></a>'
      + '</div>'
      + '<div class="mp-ctrl">'
      +   '<button class="pb-btn" type="button" id="mpPrev" title="' + T('上一首', 'Previous') + '">'
      +     '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 6h2v12H6zM20 6v12L9.5 12z"/></svg></button>'
      +   '<button class="pb-btn pb-play" type="button" id="mpToggle" title="' + T('播放/暂停', 'Play / Pause') + '">'
      +     '<svg class="ico-play" viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>'
      +     '<svg class="ico-pause" viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg></button>'
      +   '<button class="pb-btn" type="button" id="mpNext" title="' + T('下一首', 'Next') + '">'
      +     '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16 6h2v12h-2zM4 6v12l10.5-6z"/></svg></button>'
      + '</div>'
      + '<div class="mp-progress">'
      +   '<span class="pb-time" id="mpCur">0:00</span>'
      +   '<input class="pb-range" id="mpSeek" type="range" min="0" max="1000" value="0" step="1" aria-label="' + T('播放进度', 'Seek') + '">'
      +   '<span class="pb-time" id="mpDur">' + dur + '</span>'
      + '</div>'
      + '<div class="mp-tools">'
      +   '<button class="pb-btn" type="button" id="mpShuffle" title="' + T('随机播放', 'Shuffle') + '" aria-pressed="' + (!!PREF.shuffle) + '">'
      +     '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3.5a8 8 0 0 1 6 2.8M13.5 14.2a8 8 0 0 0 6 2.8H20M4 17h3.5c1.5 0 2.8-.6 3.8-1.6"/><path d="M17 5l3 3-3 3M17 13l3 3-3 3"/></svg></button>'
      +   '<button class="pb-btn" type="button" id="mpRepeat" title="' + T('循环模式', 'Repeat') + '" aria-pressed="' + (PREF.repeat !== 'off') + '">'
      +     '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9a6 6 0 0 1 10.5-3.5L17 8M20 15a6 6 0 0 1-10.5 3.5L7 16"/><path d="M17 4v4h-4M7 20v-4h4"/></svg>'
      +     '<span class="pb-repeat-txt"></span></button>'
      +   '<button class="pb-btn" type="button" id="mpSleep" title="' + T('睡眠定时器', 'Sleep timer') + '">Zz</button>'
      + '</div>'
      + '</div>');
    const mpCard = $('.modal-card', miniPlayerMask);
    if (mpCard) mpCard.classList.add('mp-modal-card');
    /* 迷你页打开即同步当前状态 */
    syncMiniPlayer();
    lyricsRefresh();
    $('#mpToggle', miniPlayerMask).addEventListener('click', togglePlay);
    $('#mpPrev', miniPlayerMask).addEventListener('click', prev);
    $('#mpNext', miniPlayerMask).addEventListener('click', function(){ next(false); });
    $('#mpSeek', miniPlayerMask).addEventListener('input', function(){ seekTo(Number($('#mpSeek', miniPlayerMask).value)); });
    $('#mpShuffle', miniPlayerMask).addEventListener('click', toggleShuffle);
    $('#mpRepeat', miniPlayerMask).addEventListener('click', cycleRepeat);
    $('#mpSleep', miniPlayerMask).addEventListener('click', openSleepPicker);
    loadLyrics(song);
  }

  function syncMiniPlayer(){
    if (!miniPlayerMask) return;
    const song = queue[qIndex];
    if (!song){
      if (miniPlayerMask) miniPlayerMask.remove();
      miniPlayerMask = null;
      return;
    }
    const d = songDisplay(song);
    const img = $('#mpCoverImg', miniPlayerMask);
    if (img) img.src = coverOf(song);
    const bg = $('.mp-bg', miniPlayerMask);
    if (bg) bg.style.backgroundImage = 'url(\'' + coverOf(song) + '\')';
    const t = $('#mpTitle', miniPlayerMask);
    if (t) t.textContent = d.title;
    const a = $('#mpArtist', miniPlayerMask);
    if (a) a.textContent = d.artist + (song.album ? ' · ' + song.album : '');
    const tk = $('#mpToggle', miniPlayerMask);
    if (tk) tk.classList.toggle('playing', !audio.paused && !audio.ended);
    const sh = $('#mpShuffle', miniPlayerMask);
    if (sh) sh.classList.toggle('on', !!PREF.shuffle);
    const rp = $('#mpRepeat', miniPlayerMask);
    if (rp){
      rp.classList.toggle('on', PREF.repeat !== 'off');
      const rt = $('#mpRepeat .pb-repeat-txt', miniPlayerMask);
      if (rt) rt.textContent = PREF.repeat === 'one' ? '1' : (PREF.repeat === 'off' ? '×' : '');
    }
    const sl = $('#mpSleep', miniPlayerMask);
    if (sl) sl.textContent = sleepTimer ? Math.max(1, Math.ceil((sleepTimer.until - Date.now()) / 60000)) + '′' : 'Zz';
    /* 切歌时刷新 MV 链接与歌词 */
    if (miniPlayerMask._songKey !== song.id){
      miniPlayerMask._songKey = song.id;
      const mv = $('#mpMvBtn', miniPlayerMask);
      if (mv) mv.href = mvURLFor(d.artist, d.title);
      lyricsRefresh();
    }
    if (isFinite(audio.duration)){
      const cur = $('#mpCur', miniPlayerMask);
      if (cur) cur.textContent = U.fmtTime(audio.currentTime);
      const dur = $('#mpDur', miniPlayerMask);
      if (dur) dur.textContent = U.fmtTime(audio.duration);
      const seek = $('#mpSeek', miniPlayerMask);
      if (seek) seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
    }
  }

  /* ---------- 收藏 / 歌单操作后刷新 UI ---------- */
  /* 只更新当前页面对应歌曲的爱心，不整页重绘，避免列表跳动和播放中断 */
  function refreshFavUI(song){
    if (!song) return;
    $$('.song-row').forEach(function(row){
      if (row.dataset.id !== song.id) return;
      const btn = $('[data-act="fav"]', row);
      if (!btn) return;
      const fav = isFav(song);
      btn.setAttribute('aria-pressed', String(fav));
      const svg = $('svg', btn);
      if (svg) svg.setAttribute('fill', fav ? 'currentColor' : 'none');
    });
    /* 收藏页需要在取消收藏后移除整行 */
    if (plRepaint){ try { plRepaint(); } catch(e){} }
  }

  /* ---------- 模态框 ---------- */
  function openModal(innerHTML){
    const mask = el('<div class="modal-mask" role="dialog" aria-modal="true"><div class="modal-card">' + innerHTML + '</div></div>');
    document.body.appendChild(mask);
    mask.addEventListener('click', function(e){
      if (e.target === mask || e.target.closest('[data-m-close]')) mask.remove();
    });
    return mask;
  }

  function openConfirmModal(title, text, onOK){
    const mask = openModal(
      '<div class="modal-title">' + esc(title) + '</div>' +
      '<div class="modal-body">' + esc(text) + '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn ghost" type="button" data-m-close>' + T('取消', 'Cancel') + '</button>' +
        '<button class="btn primary danger" type="button" id="mOk">' + T('确定', 'OK') + '</button>' +
      '</div>');
    $('#mOk', mask).addEventListener('click', function(){ mask.remove(); onOK(); });
  }

  function openNameModal(title, def, onOK){
    const mask = openModal(
      '<div class="modal-title">' + esc(title) + '</div>' +
      '<div class="modal-body"><input class="search-input" id="mName" type="text" value="' + esc(def) + '" maxlength="30" placeholder="' + T('歌单名称', 'Playlist name') + '"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn ghost" type="button" data-m-close>' + T('取消', 'Cancel') + '</button>' +
        '<button class="btn primary" type="button" id="mOk">' + T('确定', 'OK') + '</button>' +
      '</div>');
    const input = $('#mName', mask);
    input.focus();
    input.select();
    function submit(){
      const name = U.cleanTerm(input.value);
      if (!name){ toast(T('名称不能为空', 'Name cannot be empty')); return; }
      mask.remove();
      onOK(name);
    }
    $('#mOk', mask).addEventListener('click', submit);
    input.addEventListener('keydown', function(e){ if (e.key === 'Enter') submit(); });
  }

  function openPlaylistPicker(song){
    const rows = playlists.map(function(p, i){
      return '<button class="pl-pick-row" type="button" data-pli="' + i + '">' +
        '<span class="pl-pick-name">' + esc(p.name) + '</span><span class="pl-pick-count">' + p.songs.length + '</span></button>';
    }).join('');
    const mask = openModal(
      '<div class="modal-title">' + T('加入歌单', 'Add to playlist') + '</div>' +
      '<div class="modal-body">' +
        '<div class="pl-pick-list">' + (rows || '<div class="list-empty">' + T('还没有歌单', 'No playlists yet.') + '</div>') + '</div>' +
        '<button class="btn small primary" type="button" id="plNew">' + T('新建歌单', 'New playlist') + '</button>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn ghost" type="button" data-m-close>' + T('取消', 'Cancel') + '</button></div>');
    $$('.pl-pick-row', mask).forEach(function(b){
      b.addEventListener('click', function(){
        const p = playlists[Number(b.dataset.pli)];
        p.songs = U.dedupeSongs(p.songs.concat([song]));
        savePlaylist(p);
        mask.remove();
        toast(T('已加入「' + p.name + '」', 'Added to "' + p.name + '"'));
      });
    });
    $('#plNew', mask).addEventListener('click', function(){
      mask.remove();
      openNameModal(T('新建歌单', 'New playlist'), '', function(name){
        const p = { id: 'pl-' + U.stableId(name + Date.now()), name: name, songs: [song], created: Date.now() };
        playlists.push(p);
        persistPlaylists();
        toast(T('已创建并加入歌曲', 'Created and added'));
      });
    });
  }

  /* ---------- 初始化 ---------- */
  function init(){
    bindHotkeys();
    document.addEventListener('error', function(e){ var t=e.target; if(t&&t.tagName==='IMG'&&t.classList&&t.classList.contains('song-cover')&&String(t.src||'').indexOf('logo-64')<0){ t.src='assets/logo/logo-64.png'; } }, true);
    applyTheme();
    paintLangButton();
    applyStaticI18n();
    applyVolume();
    audio.muted = false;
    $('#pbVol').value = Math.round(PREF.volume * 100);
    bindMediaSession();
    renderSleepBtn();
    /* 跟随系统主题：只在“跟随系统”模式下响应系统深浅色变化 */
    try {
      const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
      if (mq){
        const onChange = function(){ if (PREF.theme === 'auto') applyTheme(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }
    } catch(e){}
    /* Service Worker 仅用于网页版 / PWA；Electron 的 file:// 环境跳过 */
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
      window.addEventListener('load', function(){
        navigator.serviceWorker.register('sw.js').catch(function(){});
      });
    }
    /* 语言 / 主题初始同步；把空 hash / 未知 hash 归一成可回退的路由 */
    try {
      if (!/^#\/(?:home|library|playlists|mine)$/.test(location.hash || '')){
        history.replaceState(null, '', '#/' + readRoute());
      }
    } catch(e){}
    go(readRoute(), true);
  }

  document.addEventListener('DOMContentLoaded', init);

  window.addEventListener('beforeunload', function(){
    localUrlsCleanup();
  });
})();


