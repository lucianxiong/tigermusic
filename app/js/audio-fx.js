/* 蓝虎听歌 · 专业音效链（Web Audio API）
 *
 * 说明：Dolby Atmos / Dolby Digital 是授权专有技术，Web 端无合法实现，本应用不提供。
 * 本文件实现的是 Web Audio 原生专业音效：10 段图形均衡 + 低音/高音增益 + 动态压缩，
 * 功能等效于主流播放器的音效系统。
 *
 * 信号链：
 *   <audio> → MediaElementSource
 *          → preGain
 *          → eq0..eq9（peaking，31Hz~16kHz）
 *          → bassShelf（lowshelf 200Hz）
 *          → trebleShelf（highshelf 4kHz）
 *          → compressor（DynamicsCompressor）
 *          → masterGain
 *          → destination
 */
(function(global){
  'use strict';

  var EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  /* 常用均衡预设：10 段 EQ 增益（dB）+ 低音 / 高音架增益（dB）。
   * 所有值限制在 ±12dB，与 normalizeEq 的钳位范围一致。 */
  var PRESETS = {
    pop:       { eq: [4, 2, -1, 2, 3, 1, -1, 1, 2, 4],    bass: 3, treble: 2 },
    rock:      { eq: [5, 3, -2, 1, 2, 4, 2, -1, 1, 4],    bass: 5, treble: 1 },
    classical: { eq: [4, 2, 0, -1, 1, 2, 3, 3, 3, 2],     bass: 0, treble: 0 },
    jazz:      { eq: [3, 1, -1, 1, 2, 1, -1, 1, 2, 3],    bass: 2, treble: 0 },
    vocal:     { eq: [-2, -2, 0, 2, 3, 3, 2, 0, -1, -2],  bass: -1, treble: 2 }
  };

  function clampDb(v){
    v = Number(v) || 0;
    return v > 12 ? 12 : (v < -12 ? -12 : v);
  }

  /* 归一化音效偏好：{ on, preset, bass, treble, bands[] }。
   * preset 取值：off / 预设名（PRESETS 键）/ custom（自定义保留 bands）。 */
  function normalizeEq(eq){
    eq = eq && typeof eq === 'object' ? eq : {};
    var allowed = ['off', 'custom'].concat(Object.keys(PRESETS));
    var preset = allowed.indexOf(eq.preset) >= 0 ? eq.preset : 'off';
    var bands = Array.isArray(eq.bands) ? eq.bands.slice(0, EQ_FREQS.length) : [];
    var i;
    for (i = 0; i < EQ_FREQS.length; i++) bands[i] = clampDb(bands[i]);
    return {
      on: !!eq.on,
      preset: preset,
      bass: clampDb(eq.bass),
      treble: clampDb(eq.treble),
      bands: bands
    };
  }

  /* 直通（关闭音效）参数：全 0dB，压缩器不生效 */
  function neutralParams(){
    return { eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0, treble: 0 };
  }

  function AudioFX(){
    this.ctx = null;
    this.nodes = null;
    this.sourceEl = null;
  }

  AudioFX.prototype.attach = function(audioEl){
    if (this.ctx) return true;
    if (!audioEl) return false;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.sourceEl = audioEl;
      var src = this.ctx.createMediaElementSource(audioEl);
      this.nodes = this._buildChain();
      src.connect(this.nodes.preGain);
      return true;
    } catch(e){
      try { if (this.ctx) this.ctx.close(); } catch(_e){}
      this.ctx = null;
      this.nodes = null;
      this.sourceEl = null;
      return false;
    }
  };

  AudioFX.prototype._buildChain = function(){
    var ctx = this.ctx;
    var preGain = ctx.createGain();
    preGain.gain.value = 1;

    var eq = [];
    for (var i = 0; i < EQ_FREQS.length; i++){
      var f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = EQ_FREQS[i];
      f.Q.value = 1;
      f.gain.value = 0;
      eq.push(f);
    }

    var bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 200;
    bass.gain.value = 0;

    var treble = ctx.createBiquadFilter();
    treble.type = 'highshelf';
    treble.frequency.value = 4000;
    treble.gain.value = 0;

    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = 0;
    comp.knee.value = 40;
    comp.ratio.value = 1;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;

    var master = ctx.createGain();
    master.gain.value = 1;

    var chain = [preGain].concat(eq).concat([bass, treble, comp, master]);
    for (var j = 0; j < chain.length - 1; j++){
      chain[j].connect(chain[j + 1]);
    }
    master.connect(ctx.destination);

    return { preGain: preGain, eq: eq, bass: bass, treble: treble, comp: comp, master: master };
  };

  AudioFX.prototype.resume = function(){
    if (!this.ctx) return Promise.resolve();
    if (this.ctx.state === 'suspended'){
      try { return this.ctx.resume(); } catch(e){ return Promise.resolve(); }
    }
    return Promise.resolve();
  };

  AudioFX.prototype.setVolume = function(v){
    if (!this.nodes || !this.ctx) return;
    var t = this.ctx.currentTime;
    try { this.nodes.master.gain.setTargetAtTime(Number(v) || 0, t, 0.02); } catch(e){}
  };

  AudioFX.prototype.applyPreset = function(p, volumeBase){
    if (!this.nodes || !this.ctx) return;
    p = p || {};
    var t = this.ctx.currentTime;
    var eq = Array.isArray(p.eq) ? p.eq : [];
    for (var i = 0; i < this.nodes.eq.length; i++){
      var g = Number(eq[i]) || 0;
      try { this.nodes.eq[i].gain.setTargetAtTime(g, t, 0.05); } catch(e){}
    }
    try { this.nodes.bass.gain.setTargetAtTime(Number(p.bass) || 0, t, 0.05); } catch(e){}
    try { this.nodes.treble.gain.setTargetAtTime(Number(p.treble) || 0, t, 0.05); } catch(e){}
    var c = p.comp || { threshold: 0, ratio: 1 };
    try { this.nodes.comp.threshold.setTargetAtTime(Number(c.threshold) || 0, t, 0.05); } catch(e){}
    try { this.nodes.comp.ratio.setTargetAtTime(Number(c.ratio) || 1, t, 0.05); } catch(e){}
    var vs = p.volumeScale == null ? 1 : Number(p.volumeScale);
    var base = volumeBase == null ? 1 : Number(volumeBase);
    try { this.nodes.master.gain.setTargetAtTime(base * vs, t, 0.05); } catch(e){}
  };

  AudioFX.prototype.setEqBand = function(idx, gainDb){
    if (!this.nodes || !this.ctx || !this.nodes.eq[idx]) return;
    try { this.nodes.eq[idx].gain.setTargetAtTime(Number(gainDb) || 0, this.ctx.currentTime, 0.05); } catch(e){}
  };

  AudioFX.prototype.setBass = function(db){
    if (!this.nodes || !this.ctx) return;
    try { this.nodes.bass.gain.setTargetAtTime(Number(db) || 0, this.ctx.currentTime, 0.05); } catch(e){}
  };

  AudioFX.prototype.setTreble = function(db){
    if (!this.nodes || !this.ctx) return;
    try { this.nodes.treble.gain.setTargetAtTime(Number(db) || 0, this.ctx.currentTime, 0.05); } catch(e){}
  };

  AudioFX.prototype.isReady = function(){ return !!(this.ctx && this.nodes); };

  AudioFX.prototype.dispose = function(){
    if (this.ctx){ try { this.ctx.close(); } catch(e){} }
    this.ctx = null;
    this.nodes = null;
    this.sourceEl = null;
  };

  AudioFX.EQ_FREQS = EQ_FREQS;
  AudioFX.PRESETS = PRESETS;
  AudioFX.normalizeEq = normalizeEq;
  AudioFX.neutralParams = neutralParams;

  if (global){
    global.AudioFX = AudioFX;
    global.TigerAudioFX = new AudioFX();
  }
  if (typeof module !== 'undefined' && module.exports){
    module.exports = { AudioFX: AudioFX, EQ_FREQS: EQ_FREQS, PRESETS: PRESETS, normalizeEq: normalizeEq, neutralParams: neutralParams };
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));