/* 蓝虎听歌 · 主应用逻辑
 * 本地优先音乐应用：在线搜索试听（iTunes Search 30 秒预览）、公共领域曲库（Internet Archive 全曲）、
 * 本地音乐导入；收藏 / 最近播放 / 自定义歌单全部保存在本机 localStorage，不注册账号、不收集个人信息。
 * 依赖 js/music-utils.js（window.MusicUtils）。
 */
(function(){
  'use strict';

  window.__blueTigerMusic = true;

  const U = window.MusicUtils;
  const APP_VERSION = '1.1.0';
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

  function toast(msg){
    let t = $('.rt-toast');
    if (!t){
      t = document.createElement('div');
      t.className = 'rt-toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._timer);
    t._timer = setTimeout(function(){ t.classList.remove('on'); }, 2400);
  }

  /* ---------- 偏好（主题 / 语言 / 音量 / 循环 / Jamendo） ---------- */
  const PREF = Object.assign({
    lang: 'zh',
    theme: 'auto',
    volume: 0.8,
    repeat: 'all',
    shuffle: false,
    jamendoClientId: ''
  }, store.get('pref', {}));

  function savePref(){
    store.set('pref', { lang: PREF.lang, theme: PREF.theme, volume: PREF.volume, repeat: PREF.repeat, shuffle: PREF.shuffle, jamendoClientId: PREF.jamendoClientId });
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

  let favorites = loadList('favorites', []);
  let recent = loadList('recent', []);
  let playlists = loadList('playlists', []);
  let stats = loadList('stats', {});
  let searchHistory = loadList('searchHistory', []);
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

  function isFav(song){ return favorites.some(function(s){ return s.id === song.id; }); }

  function toggleFav(song){
    if (isFav(song)){
      favorites = favorites.filter(function(s){ return s.id !== song.id; });
      toast(T('已取消收藏', 'Removed from favorites'));
    } else {
      favorites = U.dedupeSongs([song].concat(favorites));
      toast(T('已收藏', 'Added to favorites'));
    }
    persistFavorites();
    refreshFavUI();
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
  const audio = new Audio();
  audio.preload = 'metadata';

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
    $('#pbSeek').value = '0';
    $('#pbCur').textContent = '0:00';
    $('#pbRepeat').setAttribute('aria-pressed', String(PREF.repeat !== 'off'));
    const rt = $('#pbRepeat .pb-repeat-txt');
    if (rt) rt.textContent = PREF.repeat === 'one' ? '1' : (PREF.repeat === 'off' ? '×' : '');
    $('#pbShuffle').setAttribute('aria-pressed', String(!!PREF.shuffle));
    $('#pbShuffle').classList.toggle('on', !!PREF.shuffle);
    $('#pbToggle').classList.toggle('playing', !audio.paused && !audio.ended);
    audio.volume = U.clampNum(PREF.volume, 0, 1);
    $('#pbVol').value = Math.round(audio.volume * 100);
    $('#pbMute').classList.toggle('on', audio.muted || audio.volume === 0);
    renderQueuePanel();
    syncMiniPlayer();
  }

  function playQueue(songs, index){
    if (!songs || !songs.length) return;
    queue = songs.slice();
    qIndex = U.clampNum(index == null ? 0 : index, 0, queue.length - 1);
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

  /* ---------- 歌词（LRCLIB 公共歌词库） ---------- */
  function loadLyrics(song){
    if (!song) return;
    const artist = U.cleanTerm(song.artist);
    const title = U.cleanTerm(song.title);
    if (!artist && !title){ return; }
    song._lrcState = 'loading';
    renderLyricsUI();
    /* duration 统一按秒传入（iTunes 的 song.duration 为毫秒） */
    const durSec = isFinite(Number(song.duration)) && Number(song.duration) > 0
      ? Number(song.duration) / 1000
      : (isFinite(audio.duration) ? audio.duration : 0);
    /* 撇号变体：iTunes 用 ASCII '，LRCLIB 常收录弯引号 ’；两种都试 */
    const variants = [
      { a: artist, t: title },
      { a: artist.replace(/'/g, '’'), t: title.replace(/'/g, '’') },
      { a: artist.replace(/’/g, "'"), t: title.replace(/’/g, "'") }
    ];
    const tried = {};
    const queue2 = variants.filter(function(v){ const k = v.a + '|' + v.t; if (tried[k]) return false; tried[k] = 1; return true; });
    let attempt = 0;
    function nextTry(){
      if (attempt >= queue2.length){
        song._lrc = null;
        song._lrcState = 'none';
        renderLyricsUI();
        return;
      }
      const tr = queue2[attempt++];
      fetch(U.lrcURL(tr.a, tr.t, song.album, durSec))
        .then(function(res){
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(j){
          if (j && (j.syncedLyrics || j.plainLyrics)){
            song._lrc = {
              lines: U.parseLRC(j.syncedLyrics || ''),
              plain: j.plainLyrics || '',
              source: j.source || 'lrclib'
            };
            song._lrcState = 'ok';
            renderLyricsUI();
          } else {
            nextTry();
          }
        })
        .catch(function(){ nextTry(); });
    }
    nextTry();
  }

  function renderLyricsUI(){
    const song = queue[qIndex];
    const box = $('#mpLyrics');
    if (!box) return;
    if (!song){
      box.innerHTML = '<div class="mp-lyr-empty">' + T('播放歌曲后显示歌词', 'Lyrics will show while playing.') + '</div>';
      return;
    }
    if (song._lrcState === 'loading'){
      box.innerHTML = '<div class="mp-lyr-empty">' + T('正在获取歌词…', 'Loading lyrics…') + '</div>';
      return;
    }
    if (!song._lrc || (!song._lrc.lines.length && !song._lrc.plain)){
      box.innerHTML = '<div class="mp-lyr-empty">' + T('暂无歌词', 'No lyrics available.') + '</div>';
      return;
    }
    const lines = song._lrc.lines;
    if (!lines.length){
      box.innerHTML = '<div class="mp-lyr-plain">' + esc(song._lrc.plain).split('\n').join('<br>') + '</div>';
      return;
    }
    box.innerHTML = lines.map(function(ln, i){
      return '<div class="mp-lyr-line" data-li="' + i + '">' + (ln.line ? esc(ln.line) : '&nbsp;') + '</div>';
    }).join('');
    const idx = U.lrcIndexAt(lines, audio.currentTime);
    highlightLyric(idx);
  }

  function highlightLyric(idx){
    const box = $('#mpLyrics');
    if (!box) return;
    $$('.mp-lyr-line', box).forEach(function(l, i){
      l.classList.toggle('on', i === idx);
    });
    const cur = $('.mp-lyr-line.on', box);
    if (cur && cur.scrollIntoView){ cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  function startCurrent(){
    const song = queue[qIndex];
    if (!song) return;
    pushRecent(song);
    /* 播放统计：每次开始播放记一次 */
    stats = U.bumpStats(stats, song.id, 1, 0);
    persistStats();
    /* 媒体会话（锁屏 / 系统媒体控制） */
    updateMediaSession(song);
    const src = songSrc(song);
    if (!src){
      toast(T('该歌曲无可用音频来源', 'No playable source for this song'));
      next(true);
      return;
    }
    audio.src = src;
    audio.play().catch(function(){
      toast(T('播放失败，请检查网络后重试', 'Playback failed, check network and retry'));
      renderPlayerBar();
    });
    renderPlayerBar();
    /* 异步拉取歌词（LRCLIB 公共歌词库） */
    loadLyrics(song);
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

  function setVolume(v){
    PREF.volume = U.clampNum(v, 0, 1);
    audio.volume = PREF.volume;
    audio.muted = false;
    savePref();
    renderPlayerBar();
  }

  function toggleMute(){
    audio.muted = !audio.muted;
    if (!audio.muted) audio.volume = U.clampNum(PREF.volume, 0, 1);
    renderPlayerBar();
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
    audio.pause();
    audio.removeAttribute('src');
    try { audio.load(); } catch(e){}
    localUrlsCleanup();
    renderPlayerBar();
  }

  function localUrlsCleanup(){
    Object.keys(localUrls).forEach(function(k){
      try { URL.revokeObjectURL(localUrls[k]); } catch(e){}
    });
    for (const k in localUrls) delete localUrls[k];
  }

  audio.addEventListener('timeupdate', function(){
    if (qIndex < 0) return;
    if (isFinite(audio.duration)){
      $('#pbCur').textContent = U.fmtTime(audio.currentTime);
      $('#pbSeek').value = Math.round((audio.currentTime / audio.duration) * 1000);
    }
    const mp = $('#mpCur');
    if (mp && isFinite(audio.duration)) mp.textContent = U.fmtTime(audio.currentTime);
    const song = queue[qIndex];
    if (song && song._lrc && song._lrc.lines && song._lrc.lines.length){
      highlightLyric(U.lrcIndexAt(song._lrc.lines, audio.currentTime));
    }
  });

  audio.addEventListener('loadedmetadata', function(){
    if (isFinite(audio.duration) && queue[qIndex] && !queue[qIndex].duration){
      $('#pbDur').textContent = U.fmtTime(audio.duration);
    }
    const mp = $('#mpDur');
    if (mp && isFinite(audio.duration)) mp.textContent = U.fmtTime(audio.duration);
    const mpSeek = $('#mpSeek');
    if (mpSeek && isFinite(audio.duration)) mpSeek.max = '1000';
  });

  audio.addEventListener('ended', function(){
    /* 播放统计：歌曲播完累计收听时长 */
    const song = queue[qIndex];
    if (song && isFinite(audio.duration)){
      stats = U.bumpStats(stats, song.id, 0, Math.round(audio.duration * 1000));
      persistStats();
    }
    next(true);
  });

  audio.addEventListener('error', function(){
    if (qIndex >= 0){
      toast(T('当前歌曲播放出错，已自动跳到下一首', 'Playback error, skipping to next'));
      next(true);
    }
  });

  audio.addEventListener('play', function(){
    $('#pbToggle').classList.add('playing');
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; } catch(e){}
  });
  audio.addEventListener('pause', function(){
    $('#pbToggle').classList.remove('playing');
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; } catch(e){}
  });

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
      '<span class="song-src-tag">' + (song.source === 'itunes' ? T('试听', 'Preview') : song.source === 'ia' ? T('全曲', 'Full') : T('本地', 'Local')) + '</span>' +
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
  function bindSongList(host, songs){
    const handler = function(e){
      const row = e.target.closest('.song-row');
      if (!row) return;
      const idx = Number(row.dataset.idx);
      const song = songs[idx];
      if (!song) return;
      const actBtn = e.target.closest('[data-act]');
      if (actBtn){
        const act = actBtn.dataset.act;
        if (act === 'fav'){ toggleFav(song); return; }
        if (act === 'add'){ openPlaylistPicker(song); return; }
        if (act === 'remove'){
          if (onRowRemove) onRowRemove(song, idx);
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
  let onRowRemove = null;

  /* ---------- 渲染：首页 ---------- */
  const HOT_TERMS = ['周杰伦', '邓紫棋', 'Taylor Swift', '钢琴', '轻音乐', '古典'];

  /* Internet Archive 条目解析并播放（公共曲库 / 精选推荐 / 随机一听共用） */
  function loadIAItem(it){
    return fetch(U.iaMetaURL(it.identifier))
      .then(function(res){
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(meta){
        const file = U.pickAudioFile(meta.files);
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

  /* 精选推荐：预设公共领域主题词，随机取一类从 IA 拉取 */
  const CURATED_QUERIES = ['Beethoven', 'Mozart classical', 'Chopin piano', 'Bach organ', 'Jazz standards', 'Folk guitar'];

  function fetchRecommendations(){
    const q = CURATED_QUERIES[Math.floor(Math.random() * CURATED_QUERIES.length)];
    return fetch(U.iaSearchURL(q, 8))
      .then(function(res){
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(j){
        return (j.response && j.response.docs) || [];
      });
  }

  function randomDiscover(){
    fetchRecommendations()
      .then(function(docs){
        if (!docs.length){ toast(T('暂无可随机推荐的歌曲', 'No tracks to shuffle right now')); return; }
        const d = docs[Math.floor(Math.random() * docs.length)];
        toast(T('随机一听：' + (d.title || d.identifier), 'Shuffle: ' + (d.title || d.identifier)));
        loadIAItem({ identifier: d.identifier, title: d.title || d.identifier, creator: d.creator || '' })
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
          '<div class="hero-badge">' + T('本地优先 · 在线试听 · 三端通用', 'Local-first · Online preview · Windows / Android / Web') + '</div>' +
          '<h1 class="hero-title">' + T('听喜欢的歌，<br>也发现新的旋律', 'Play what you love,<br>discover what is new.') + '</h1>' +
          '<div class="hero-sub">' + T('在线搜索试听、公共领域全曲、本地音乐导入，收藏与歌单都保存在本机。', 'Search & preview online, play public-domain tracks in full, import local music. Favorites and playlists stay on your device.') + '</div>' +
          '<form class="search-box" id="homeSearch">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
            '<input class="search-input" id="homeSearchInput" type="search" placeholder="' + T('搜索歌曲、歌手（在线试听）', 'Search songs or artists (online preview)') + '" autocomplete="off">' +
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
    function paintRec(){
      recBox.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><div class="spinner-txt">' + T('正在加载推荐…', 'Loading picks…') + '</div></div>';
      fetchRecommendations()
        .then(function(docs){
          if (!docs.length){
            recBox.innerHTML = '<div class="list-empty">' + T('暂未加载到推荐曲目', 'No picks loaded right now.') + '</div>';
            return;
          }
          const items = docs.map(function(d, i){
            return { identifier: d.identifier, title: d.title || d.identifier, creator: d.creator || '', idx: i };
          });
          recBox.innerHTML = items.map(function(it){
            return '<div class="ia-row" data-idx="' + it.idx + '">' +
              '<img class="song-cover" src="assets/logo/logo-64.png" alt="">' +
              '<div class="song-meta"><div class="song-title">' + esc(it.title) + '</div>' +
              '<div class="song-artist">' + esc(it.creator || it.identifier) + '</div></div>' +
              '<span class="song-src-tag">' + T('全曲', 'Full') + '</span>' +
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
            if (actBtn && actBtn.dataset.act === 'play'){
              it.loading = true;
              const btn = $('[data-act="play"]', row);
              if (btn){ btn.disabled = true; btn.textContent = T('加载中…', 'Loading…'); }
              loadIAItem(it)
                .catch(function(){ toast(T('该条目暂无可播放的音频文件', 'No playable audio found for this item')); })
                .finally(function(){
                  it.loading = false;
                  if (btn){ btn.disabled = false; btn.textContent = T('播放', 'Play'); }
                });
            }
          };
          recBox.addEventListener('click', recBox._recHandler);
        })
        .catch(function(){
          recBox.innerHTML = '<div class="err-banner">' + T('无法连接 Internet Archive，当前网络可能无法访问该服务。', 'Cannot reach Internet Archive — it may be blocked by your network.') + '</div>';
        });
    }
    paintRec();
    $('#recRefresh', host).addEventListener('click', paintRec);
  }

  /* ---------- 渲染：曲库 ---------- */
  function renderLibraryPage(host, initialTab, initialTerm){
    const tabs = [
      { k: 'online', t: T('在线搜索', 'Online search') },
      { k: 'ia', t: T('公共曲库', 'Public domain') },
      { k: 'jamendo', t: T('自由音乐', 'Free music') },
      { k: 'local', t: T('本地文件', 'Local files') }
    ];
    let tab = initialTab || 'online';
    let term = initialTerm || '';

    host.innerHTML =
      '<section class="page">' +
        '<div class="page-head"><div class="page-title">' + T('曲库', 'Library') + '</div>' +
        '<div class="ph-right">' + T('试听为 30 秒片段 · 公共曲库全曲', 'Previews 30s · Public domain in full') + '</div></div>' +
        '<div class="tabbar" id="libTabs">' +
          tabs.map(function(tb){ return '<button class="tab" type="button" data-tab="' + tb.k + '">' + tb.t + '</button>'; }).join('') +
        '</div>' +
        '<div id="libBody"></div>' +
      '</section>';
    const body = $('#libBody', host);
    const tabbar = $('#libTabs', host);
    tabbar.addEventListener('click', function(e){
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      tab = b.dataset.tab;
      renderTab();
    });
    function paintTabs(){
      $$('.tab', tabbar).forEach(function(t){ t.classList.toggle('on', t.dataset.tab === tab); });
    }
    function renderTab(){
      paintTabs();
      if (tab === 'online') renderOnline(body, term);
      else if (tab === 'ia') renderIA(body, term);
      else if (tab === 'jamendo') renderJamendo(body, term);
      else renderLocal(body);
    }
    renderTab();
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
    if (clear) clear.addEventListener('click', function(){ clearSearchHistory(); el.remove(); });
  }

  function searchBoxHTML(ph, id, btn){
    return '<form class="search-box" id="' + id + '">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
      '<input class="search-input" type="search" placeholder="' + esc(ph) + '" autocomplete="off">' +
      '<button class="btn primary" type="submit">' + btn + '</button>' +
      '</form>';
  }

  let lastItunesTerm = '';

  function renderOnline(body, initialTerm){
    lastItunesTerm = '';
    const box = el(searchBoxHTML(T('搜索 iTunes 曲库（中文 / 英文均可）', 'Search the iTunes catalog (CN / EN)'), 'onlineSearch', T('搜索', 'Search')));
    const hist = el('<div id="onlineHist"></div>');
    hist.innerHTML = searchHistHTML(body);
    const list = el('<div class="song-list" id="onlineList"></div>');
    const note = el('<div class="hint-note">' + T('结果来自 Apple iTunes Search（30 秒试听预览），仅供试听参考。', 'Results from Apple iTunes Search (30s previews), for preview only.') + '</div>');
    body.innerHTML = '';
    body.appendChild(box);
    body.appendChild(hist);
    body.appendChild(note);
    body.appendChild(list);
    bindSearchHist(hist, function(t){ doSearch(t); });

    box.addEventListener('submit', function(e){
      e.preventDefault();
      const t = U.cleanTerm($('.search-input', box).value);
      if (t){ pushSearchHistory(t); doSearch(t); }
    });

    function doSearch(t){
      lastItunesTerm = t;
      list.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><div class="spinner-txt">' + T('正在搜索…', 'Searching…') + '</div></div>';
      fetch(U.itunesSearchURL(t, 25))
        .then(function(res){
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(j){
          const songs = (j.results || []).map(function(r){
            return {
              id: 'it-' + r.trackId,
              title: r.trackName || '',
              artist: r.artistName || '',
              album: r.collectionName || '',
              cover: r.artworkUrl100 ? r.artworkUrl100.replace('100x100', '300x300') : '',
              src: r.previewUrl || '',
              duration: r.trackTimeMillis || 0,
              source: 'itunes'
            };
          }).filter(function(s){ return s.src; });
          if (!songs.length){
            list.innerHTML = '<div class="list-empty">' + T('没有找到相关结果，换个关键词试试', 'No results. Try another keyword.') + '</div>';
            return;
          }
          /* 歌手维度：提取唯一歌手 chips，点击按歌手重搜 */
          const artistSet = {};
          songs.forEach(function(s){ if (s.artist) artistSet[s.artist] = 1; });
          const artists = Object.keys(artistSet).slice(0, 6);
          let head = '';
          if (artists.length > 1){
            head = '<div class="artist-chips"><span class="sh-label">' + T('歌手', 'Artists') + '</span>' +
              artists.map(function(a){ return '<button class="chip" type="button" data-artist="' + esc(a) + '">' + esc(a) + '</button>'; }).join('') +
              '</div>';
          }
          list.innerHTML = head + songs.map(function(s, i){
            return songRowHTML(s).replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"');
          }).join('');
          bindSongList(list, songs);
          $$('.artist-chips .chip', list).forEach(function(c){
            c.addEventListener('click', function(){
              const a = c.dataset.artist;
              if (a){ pushSearchHistory(a); doSearch(a); }
            });
          });
          /* 行内歌手可点击重搜（捕获阶段拦截，避免与行播放冲突） */
          if (list._artistHandler) list.removeEventListener('click', list._artistHandler, true);
          list._artistHandler = function(e){
            const artEl = e.target.closest('.song-artist');
            if (!artEl) return;
            e.stopImmediatePropagation();
            const row = artEl.closest('.song-row');
            if (!row) return;
            const song = songs[Number(row.dataset.idx)];
            if (song && song.artist){ pushSearchHistory(song.artist); doSearch(song.artist); }
          };
          list.addEventListener('click', list._artistHandler, true);
        })
        .catch(function(){
          list.innerHTML = '<div class="err-banner">' + T('在线搜索失败：无法连接 iTunes 服务，请检查网络后重试。', 'Search failed: cannot reach the iTunes service. Check your network and retry.') +
            '<button class="btn small ghost" type="button" id="retryOnline">' + T('重试', 'Retry') + '</button></div>';
          const rb = $('#retryOnline', list);
          if (rb) rb.addEventListener('click', function(){ doSearch(lastItunesTerm); });
        });
    }

    if (initialTerm) doSearch(initialTerm);
    else list.innerHTML = '<div class="list-empty">' + T('输入关键词，搜索并试听在线歌曲', 'Type a keyword to search & preview songs online.') + '</div>';
  }

  function renderIA(body, initialTerm){
    const box = el(searchBoxHTML(T('搜索公共领域曲库（Internet Archive）', 'Search public-domain audio (Internet Archive)'), 'iaSearch', T('搜索', 'Search')));
    const hist = el('<div id="iaHist"></div>');
    hist.innerHTML = searchHistHTML(body);
    const list = el('<div class="song-list" id="iaList"></div>');
    const note = el('<div class="hint-note">' + T('全曲来自 Internet Archive 公共领域 / 开放授权音频；如当前网络无法访问 archive.org，会提示错误。', 'Full tracks from Internet Archive public-domain / open audio. If archive.org is unreachable, an error will show.') + '</div>');
    body.innerHTML = '';
    body.appendChild(box);
    body.appendChild(hist);
    body.appendChild(note);
    body.appendChild(list);
    bindSearchHist(hist, function(t){ doSearch(t); });

    let lastTerm = '';

    box.addEventListener('submit', function(e){
      e.preventDefault();
      const t = U.cleanTerm($('.search-input', box).value);
      if (t){ pushSearchHistory(t); doSearch(t); }
    });

    function doSearch(t){
      lastTerm = t;
      list.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><div class="spinner-txt">' + T('正在搜索…', 'Searching…') + '</div></div>';
      fetch(U.iaSearchURL(t, 16))
        .then(function(res){
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(j){
          const docs = (j.response && j.response.docs) || [];
          if (!docs.length){
            list.innerHTML = '<div class="list-empty">' + T('没有找到相关结果', 'No results found.') + '</div>';
            return;
          }
          const items = docs.map(function(d, i){
            return { id: 'ia-' + d.identifier, identifier: d.identifier, title: d.title || d.identifier, creator: d.creator || '', downloads: d.downloads || 0, year: d.year || '', source: 'ia', idx: i };
          });
          list.innerHTML = items.map(function(it){
            return '<div class="ia-row" data-idx="' + it.idx + '">' +
              '<img class="song-cover" src="assets/logo/logo-64.png" alt="">' +
              '<div class="song-meta"><div class="song-title">' + esc(it.title) + '</div>' +
              '<div class="song-artist">' + esc(it.creator || it.identifier) + (it.year ? ' · ' + esc(it.year) : '') + '</div></div>' +
              '<span class="song-src-tag">' + T('全曲', 'Full') + '</span>' +
              '<span class="song-dur">' + (it.downloads ? T('下载 ' + it.downloads, it.downloads + ' downloads') : '') + '</span>' +
              '<div class="row-actions"><span class="ia-loading" hidden></span>' +
              '<button class="btn small primary" type="button" data-act="play">' + T('播放', 'Play') + '</button></div>' +
            '</div>';
          }).join('');
          if (list._iaHandler) list.removeEventListener('click', list._iaHandler);
          list._iaHandler = function(e){
            const row = e.target.closest('.ia-row');
            if (!row) return;
            const it = items[Number(row.dataset.idx)];
            if (!it || it.loading) return;
            const actBtn = e.target.closest('[data-act]');
            if (actBtn && actBtn.dataset.act === 'play'){
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
          list.addEventListener('click', list._iaHandler);
        })
        .catch(function(){
          list.innerHTML = '<div class="err-banner">' + T('无法连接 Internet Archive（archive.org），当前网络可能无法访问该服务。', 'Cannot reach Internet Archive (archive.org) — it may be blocked by your network.') +
            '<button class="btn small ghost" type="button" id="retryIA">' + T('重试', 'Retry') + '</button></div>';
          const rb = $('#retryIA', list);
          if (rb) rb.addEventListener('click', function(){ doSearch(lastTerm); });
        });
    }

    if (initialTerm) doSearch(initialTerm);
    else list.innerHTML = '<div class="list-empty">' + T('输入关键词，搜索公共领域全曲', 'Type a keyword to search public-domain tracks.') + '</div>';
  }

  /* ---------- 渲染：Jamendo 自由音乐（需 client_id） ---------- */
  function renderJamendo(body, initialTerm){
    if (!PREF.jamendoClientId){
      body.innerHTML =
        '<div class="card">' +
          '<div class="card-h"><div class="card-t">' + T('自由音乐（Jamendo）', 'Free music (Jamendo)') + '</div></div>' +
          '<div class="hint-note">' + T('Jamendo 提供按创作共用许可发布的免费音乐全曲播放。需要免费注册获取 Client ID 后启用。', 'Jamendo offers full tracks under Creative Commons licenses. Register for a free Client ID to enable it.') + '</div>' +
          '<div class="set-row"><span>' + T('Jamendo Client ID', 'Jamendo Client ID') + '</span>' +
            '<input class="search-input jam-id-input" type="text" id="jmId" value="' + esc(PREF.jamendoClientId) + '" maxlength="64" placeholder="client_id">' +
            '<button class="btn small primary" type="button" id="jmSave">' + T('保存并启用', 'Save & enable') + '</button></div>' +
          '<div class="hint-note">' + T('获取方式：', 'How to get: ') +
            '<a href="https://devs.jamendo.com/" target="_blank" rel="noopener noreferrer">devs.jamendo.com</a> ' +
            T('注册开发者账号 → Create an application → 复制 Client ID 粘贴到上方。', 'sign up → Create an application → copy the Client ID above.') + '</div>' +
        '</div>';
      $('#jmSave', body).addEventListener('click', function(){
        const v = U.cleanTerm($('#jmId', body).value);
        if (!v){ toast(T('请输入 Client ID', 'Enter a Client ID')); return; }
        PREF.jamendoClientId = v;
        savePref();
        toast(T('已启用 Jamendo 自由音乐', 'Jamendo enabled'));
        renderJamendo(body, initialTerm);
      });
      return;
    }
    const box = el(searchBoxHTML(T('搜索 Jamendo 自由音乐（英文关键词更佳）', 'Search Jamendo free music (English works best)'), 'jamendoSearch', T('搜索', 'Search')));
    const list = el('<div class="song-list" id="jamendoList"></div>');
    const note = el('<div class="hint-note">' + T('全曲来自 Jamendo 创作共用授权音乐。', 'Full tracks from Jamendo Creative Commons music.') +
      ' <button class="link-btn" type="button" id="jmReset">' + T('更换 Client ID', 'Change Client ID') + '</button></div>');
    body.innerHTML = '';
    body.appendChild(box);
    body.appendChild(note);
    body.appendChild(list);
    $('#jmReset', body).addEventListener('click', function(){
      PREF.jamendoClientId = '';
      savePref();
      renderJamendo(body, initialTerm);
    });

    box.addEventListener('submit', function(e){
      e.preventDefault();
      const t = U.cleanTerm($('.search-input', box).value);
      if (t){ pushSearchHistory(t); doSearch(t); }
    });

    function doSearch(t){
      list.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><div class="spinner-txt">' + T('正在搜索…', 'Searching…') + '</div></div>';
      fetch(U.jamendoSearchURL(t, 16, PREF.jamendoClientId))
        .then(function(res){
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(j){
          const results = (j.results && j.results) || [];
          if (!results.length){
            list.innerHTML = '<div class="list-empty">' + T('没有找到相关结果', 'No results found.') + '</div>';
            return;
          }
          const songs = results.map(function(r){
            return {
              id: 'jm-' + r.id,
              title: r.name || '',
              artist: r.artist_name || '',
              album: r.album_name || '',
              cover: r.album_image || '',
              src: r.audio || '',
              duration: Number(r.duration) || 0,
              license: r.license_short || '',
              source: 'jamendo'
            };
          }).filter(function(s){ return s.src; });
          if (!songs.length){
            list.innerHTML = '<div class="list-empty">' + T('没有可播放的音频', 'No playable audio.') + '</div>';
            return;
          }
          list.innerHTML = songs.map(function(s, i){
            return songRowHTML(s).replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"');
          }).join('');
          bindSongList(list, songs);
        })
        .catch(function(){
          list.innerHTML = '<div class="err-banner">' + T('无法连接 Jamendo，请检查 Client ID 与网络后重试。', 'Cannot reach Jamendo. Check the Client ID and network, then retry.') +
            '<button class="btn small ghost" type="button" id="retryJamendo">' + T('重试', 'Retry') + '</button></div>';
          const rb = $('#retryJamendo', list);
          if (rb) rb.addEventListener('click', function(){ doSearch(U.cleanTerm($('.search-input', box).value) || ''); });
        });
    }

    if (initialTerm) doSearch(initialTerm);
    else list.innerHTML = '<div class="list-empty">' + T('输入关键词，搜索 Jamendo 自由音乐全曲', 'Type a keyword to search Jamendo free tracks.') + '</div>';
  }

  function renderLocal(body){
    body.innerHTML = '';
    const card = el(
      '<section class="card">' +
        '<div class="card-h"><div class="card-t">' + T('导入本地音乐', 'Import local music') + '</div></div>' +
        '<div class="local-actions">' +
          '<button class="btn primary" id="localPick" type="button">' + T('选择音频文件…', 'Choose audio files…') + '</button>' +
          '<span class="hint-note">' + T('支持 mp3 / m4a / ogg / wav / flac 等格式；导入的歌曲仅在本次使用内可播放。', 'Supports mp3 / m4a / ogg / wav / flac; imported songs are playable for this session only.') + '</span>' +
        '</div>' +
        '<input type="file" id="localInput" accept="audio/*" multiple hidden>' +
        '<div class="song-list" id="localList"></div>' +
      '</section>');
    body.appendChild(card);
    const input = $('#localInput', card);
    const list = $('#localList', card);
    function paintLocal(){
      if (!localSongs.length){
        list.innerHTML = '<div class="list-empty">' + T('还没有导入本地音乐', 'No local music imported yet.') + '</div>';
        return;
      }
      list.innerHTML = localSongs.map(function(s, i){
        return songRowHTML(s, { canRemove: true }).replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"');
      }).join('');
      bindSongList(list, localSongs);
    }
    onRowRemove = function(song, idx){
      localSongs = localSongs.filter(function(s){ return s.id !== song.id; });
      if (localUrls[song.id]){ try { URL.revokeObjectURL(localUrls[song.id]); } catch(e){} delete localUrls[song.id]; }
      paintLocal();
    };
    $('#localPick', card).addEventListener('click', function(){ input.click(); });
    input.addEventListener('change', function(){
      const files = Array.prototype.slice.call(input.files || []);
      if (!files.length) return;
      files.forEach(function(f){
        const meta = U.parseLocalName(f.name);
        const id = 'local-' + U.stableId(f.name + ':' + f.size + ':' + f.lastModified);
        localSongs.push({
          id: id,
          title: meta.title,
          artist: meta.artist,
          album: T('本地导入', 'Local import'),
          cover: '',
          src: '',
          duration: 0,
          source: 'local',
          file: f
        });
      });
      input.value = '';
      toast(T('已导入 ' + files.length + ' 首', files.length + ' imported'));
      paintLocal();
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
      if (sec === 'fav'){
        body.innerHTML = '<div class="card"><div class="card-h"><div class="card-t">' + T('我的收藏', 'Favorites') + '</div>' +
          (favorites.length ? '<button class="link-btn" type="button" data-pl-play-all="fav">' + T('播放全部', 'Play all') + '</button>' : '') + '</div>' +
          (favorites.length ? '<div class="song-list"></div>' : '<div class="list-empty">' + T('还没有收藏的歌曲', 'No favorites yet.') + '</div>') + '</div>';
        if (favorites.length){
          const list = $('.song-list', body);
          list.innerHTML = favorites.map(function(s, i){ return songRowHTML(s, { canRemove: true }).replace('data-id="' + esc(s.id) + '"', 'data-id="' + esc(s.id) + '" data-idx="' + i + '"'); }).join('');
          bindSongList(list, favorites);
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
          bindSongList(list, p.songs);
        }
      }
      onRowRemove = function(song, idx){
        p.songs = p.songs.filter(function(s){ return s.id !== song.id; });
        savePlaylist(p);
        renderPlaylistDetail(p);
      };
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
    const data = {
      app: 'tiger-music',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      pref: { lang: PREF.lang, theme: PREF.theme, volume: PREF.volume, repeat: PREF.repeat, shuffle: PREF.shuffle, jamendoClientId: PREF.jamendoClientId },
      favorites: favorites,
      recent: recent,
      playlists: playlists,
      stats: stats
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
        favorites = data.favorites;
        recent = data.recent;
        playlists = data.playlists;
        if (data.stats && typeof data.stats === 'object') stats = data.stats;
        if (data.pref && typeof data.pref === 'object') Object.assign(PREF, data.pref);
        persistFavorites(); persistRecent(); persistPlaylists(); persistStats(); savePref();
        applyTheme();
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
            '<div class="card-h"><div class="card-t">' + T('自由音乐（Jamendo）', 'Free music (Jamendo)') + '</div></div>' +
            '<div class="hint-note">' + T('可选：填入 Jamendo Client ID 后可在曲库「自由音乐」中搜索全曲。', 'Optional: add a Jamendo Client ID to search full tracks in Library → Free music.') + '</div>' +
            '<div class="set-row"><input class="search-input jam-id-input" type="text" id="setJamId" value="' + esc(PREF.jamendoClientId) + '" maxlength="64" placeholder="client_id">' +
              '<button class="btn small primary" type="button" id="setJamSave">' + T('保存', 'Save') + '</button></div>' +
          '</section>' +
        '</div>' +
        '<section class="card about-card">' +
          '<div class="card-h"><div class="card-t">' + T('关于', 'About') + '</div></div>' +
          '<div class="about-line">蓝虎听歌 v' + APP_VERSION + '</div>' +
          '<div class="about-line">' + T('本地优先 · 在线试听 · Windows / Android / 浏览器三端同源', 'Local-first · Online preview · Windows / Android / Web') + '</div>' +
          '<div class="about-line">' + T('在线数据来源：', 'Online sources: ') + '</div>' +
          '<ul class="about-list">' +
            '<li>' + T('在线试听：Apple iTunes Search 接口，仅提供每曲 30 秒预览，用于试听参考。', 'Online preview: Apple iTunes Search API, 30-second previews for reference only.') + '</li>' +
            '<li>' + T('公共曲库：Internet Archive 公共领域 / 开放授权音频，可全曲播放。', 'Public domain: Internet Archive public-domain / openly licensed audio, full playback.') + '</li>' +
            '<li>' + T('自由音乐：Jamendo 创作共用授权音频（需 Client ID），可全曲播放。', 'Free music: Jamendo Creative Commons audio (requires Client ID), full playback.') + '</li>' +
            '<li>' + T('歌词：LRCLIB 公共歌词库，自动显示同步歌词（如可获取）。', 'Lyrics: LRCLIB public lyrics database, synced lyrics when available.') + '</li>' +
            '<li>' + T('本地导入：仅在你的设备上读取所选音频文件，不上传任何内容。', 'Local import: audio files are read on your device only; nothing is uploaded.') + '</li>' +
          '</ul>' +
          '<div class="about-line">' + T('所有收藏、歌单与偏好仅保存在本机浏览器 / 应用存储中。', 'Favorites, playlists and preferences are stored only on this device.') + '</div>' +
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
    $('#exportData', host).addEventListener('click', exportBackup);
    $('#importData', host).addEventListener('click', function(){ $('#importInput', host).click(); });
    $('#importInput', host).addEventListener('change', function(){
      const f = $('#importInput', host).files && $('#importInput', host).files[0];
      if (f) importBackup(f);
      $('#importInput', host).value = '';
    });
    const setJamId = $('#setJamId', host);
    $('#setJamSave', host).addEventListener('click', function(){
      const v = U.cleanTerm(setJamId.value);
      PREF.jamendoClientId = v;
      savePref();
      toast(v ? T('已保存 Jamendo Client ID', 'Jamendo Client ID saved') : T('已清除 Jamendo Client ID', 'Jamendo Client ID cleared'));
    });
    $('#clearData', host).addEventListener('click', function(){
      openConfirmModal(T('清空本地数据', 'Clear local data'), T('将删除收藏、最近播放、自定义歌单、听歌统计、搜索历史与偏好设置。', 'This deletes favorites, history, playlists, stats, search history and preferences.'), function(){
        store.del('favorites'); store.del('recent'); store.del('playlists'); store.del('pref'); store.del('stats'); store.del('searchHistory');
        favorites = []; recent = []; playlists = []; stats = {}; searchHistory = [];
        Object.assign(PREF, { lang: 'zh', theme: 'auto', volume: 0.8, repeat: 'all', shuffle: false, jamendoClientId: '' });
        applyTheme();
        toast(T('已清空本地数据', 'Local data cleared'));
        go('mine');
      });
    });
  }

  /* ---------- 路由与导航 ---------- */
  let currentModule = 'home';
  let libraryTab = null;
  let libraryTerm = '';
  let plFocus = null;

  function go(name){
    const host = $('#main');
    host.innerHTML = '';
    currentModule = name;
    $$('.tnav-btn').forEach(function(b){ b.classList.toggle('on', b.dataset.page === name); });
    if (name === 'home') renderHomePage(host);
    else if (name === 'library') renderLibraryPage(host, libraryTab, libraryTerm);
    else if (name === 'playlists'){ renderPlaylistsPage(host, plFocus); plFocus = null; }
    else renderMinePage(host);
    window.scrollTo(0, 0);
  }

  function goLibrarySearch(term){
    libraryTerm = term;
    go('library');
  }

  /* 支持浏览器前进 / 后退与直接修改 hash 导航 */
  window.addEventListener('hashchange', function(){
    const h = (location.hash || '#/home').slice(2) || 'home';
    go(h);
  });

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

  function setLang(v){
    PREF.lang = v === 'en' ? 'en' : 'zh';
    savePref();
    paintLangButton();
    const h = location.hash;
    if (h) go(h.slice(2));
    else go('home');
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
    /* 迷你页打开即同步当前状态 */
    syncMiniPlayer();
    renderLyricsUI();
    $('#mpToggle', miniPlayerMask).addEventListener('click', togglePlay);
    $('#mpPrev', miniPlayerMask).addEventListener('click', prev);
    $('#mpNext', miniPlayerMask).addEventListener('click', function(){ next(false); });
    $('#mpSeek', miniPlayerMask).addEventListener('input', function(){ seekTo(Number($('#mpSeek', miniPlayerMask).value)); });
    $('#mpShuffle', miniPlayerMask).addEventListener('click', toggleShuffle);
    $('#mpRepeat', miniPlayerMask).addEventListener('click', cycleRepeat);
    $('#mpSleep', miniPlayerMask).addEventListener('click', openSleepPicker);
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
  let favRefreshTimer = null;
  function refreshFavUI(){
    clearTimeout(favRefreshTimer);
    favRefreshTimer = setTimeout(function(){
      const h = location.hash;
      if (h && (h.indexOf('playlists') >= 0 || h.indexOf('home') >= 0)) go(h.slice(2));
    }, 120);
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
    applyTheme();
    paintLangButton();
    audio.volume = U.clampNum(PREF.volume, 0, 1);
    audio.muted = false;
    $('#pbVol').value = Math.round(audio.volume * 100);
    bindMediaSession();
    renderSleepBtn();
    /* 语言 / 主题初始同步 */
    const first = (location.hash || '#/home').slice(2) || 'home';
    go(first);
  }

  document.addEventListener('DOMContentLoaded', init);

  window.addEventListener('beforeunload', function(){
    localUrlsCleanup();
  });
})();
