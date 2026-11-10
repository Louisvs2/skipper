/*
 * Skipper – BPM- und Downbeat-Erkennung
 *
 * Reines JavaScript (ES5). Läuft im Panel und unter Node (Tests).
 *   SkipperBPM.detect(samples, sampleRate) -> { bpm, downbeat, confidence }
 *   samples: Float32Array (mono), downbeat: Sekunden ab Beginn von samples.
 */
(function (root) {
  'use strict';

  var FRAME = 1024, HOP = 256;

  /** Onset-Hüllkurven (gesamt + Tiefband) */
  function envelopes(x, sr) {
    var n = Math.floor((x.length - FRAME) / HOP);
    if (n < 10) return null;
    var a = 1 - Math.exp(-2 * Math.PI * 150 / sr);
    var lp = new Float32Array(x.length), y = 0, i;
    for (i = 0; i < x.length; i++) { y += a * (x[i] - y); lp[i] = y; }

    var full = new Float32Array(n), low = new Float32Array(n), lowE = new Float32Array(n);
    var prevE = 0, prevL = 0;
    for (var f = 0; f < n; f++) {
      var e = 0, l = 0, o = f * HOP;
      for (i = 0; i < FRAME; i++) { var v = x[o + i], w = lp[o + i]; e += v * v; l += w * w; }
      lowE[f] = l;
      var le = Math.log(1e-9 + e), ll = Math.log(1e-9 + l);
      if (f > 0) { full[f] = Math.max(0, le - prevE); low[f] = Math.max(0, ll - prevL); }
      prevE = le; prevL = ll;
    }
    var fr = sr / HOP;
    return { full: peaky(full, fr), low: peaky(low, fr), lowE: lowE, fr: fr };
  }

  /** gleitenden Mittelwert (~0.25 s) abziehen, negativ -> 0 */
  function peaky(env, fr) {
    var w = Math.max(1, Math.round(fr * 0.125)), out = new Float32Array(env.length), sum = 0, i;
    var pre = new Float64Array(env.length + 1);
    for (i = 0; i < env.length; i++) { sum += env[i]; pre[i + 1] = sum; }
    for (i = 0; i < env.length; i++) {
      var a = Math.max(0, i - w), b = Math.min(env.length, i + w + 1);
      var m = (pre[b] - pre[a]) / (b - a);
      out[i] = Math.max(0, env[i] - m);
    }
    return out;
  }

  function autocorr(env, lag) {
    var s = 0, n = env.length - lag;
    if (n <= 0) return 0;
    for (var i = 0; i < n; i++) s += env[i] * env[i + lag];
    return s / n;
  }

  /** Grobes Tempo über Autokorrelation mit Kammfilter */
  function coarseTempo(env, fr) {
    var best = -1, bestBpm = 120;
    var minLag = Math.floor(60 * fr / 200), maxLag = Math.ceil(60 * fr / 60);
    var cache = {};
    function ac(l) { return cache[l] !== undefined ? cache[l] : (cache[l] = autocorr(env, l)); }
    for (var lag = minLag; lag <= maxLag; lag++) {
      var bpm = 60 * fr / lag;
      var score = ac(lag) + 0.5 * ac(2 * lag) + 0.25 * ac(4 * lag);
      var oct = Math.log(bpm / 120) / Math.LN2;
      score *= Math.exp(-0.5 * (oct / 1.0) * (oct / 1.0));
      if (score > best) { best = score; bestBpm = bpm; }
    }
    while (bestBpm < 70) bestBpm *= 2;
    while (bestBpm > 180) bestBpm /= 2;
    return bestBpm;
  }

  /** Hüllkurve modulo Periode falten -> Histogramm */
  function fold(env, fr, bpm, bins) {
    var P = 60 / bpm, h = new Float64Array(bins);
    for (var i = 0; i < env.length; i++) {
      if (!env[i]) continue;
      var ph = ((i / fr) % P) / P * bins;
      var b0 = Math.floor(ph), k = ph - b0;
      h[b0 % bins] += env[i] * (1 - k);
      h[(b0 + 1) % bins] += env[i] * k;
    }
    return h;
  }

  function peakOf(h) {
    var n = h.length, best = -1, bi = 0, mean = 0, i;
    for (i = 0; i < n; i++) mean += h[i];
    mean /= n;
    for (i = 0; i < n; i++) {
      var v = h[(i - 1 + n) % n] * 0.5 + h[i] + h[(i + 1) % n] * 0.5;
      if (v > best) { best = v; bi = i; }
    }
    // parabolische Verfeinerung
    var l = h[(bi - 1 + n) % n], c = h[bi], r = h[(bi + 1) % n], d = l - 2 * c + r;
    var off = d !== 0 ? 0.5 * (l - r) / d : 0;
    if (off > 0.5 || off < -0.5) off = 0;
    return { index: (bi + off + n) % n, sharp: mean > 0 ? best / (2 * mean) : 0 };
  }

  function detect(samples, sr) {
    var env = envelopes(samples, sr);
    if (!env) throw new Error('Audio zu kurz für die BPM-Erkennung.');
    var comb = new Float32Array(env.full.length);
    for (var i = 0; i < comb.length; i++) comb[i] = env.full[i] + env.low[i];

    var bpm0 = coarseTempo(comb, env.fr);

    // Feinabstimmung: schärfstes Phasen-Histogramm
    var best = null;
    for (var b = bpm0 - 2; b <= bpm0 + 2; b += 0.02) {
      var pk = peakOf(fold(comb, env.fr, b, 48));
      if (!best || pk.sharp > best.sharp) best = { bpm: b, sharp: pk.sharp };
    }
    var bpm = best.bpm;
    if (Math.abs(bpm - Math.round(bpm)) <= 0.15) bpm = Math.round(bpm);
    else bpm = Math.round(bpm * 100) / 100;

    // Beat-Phase
    var BINS = 200, P = 60 / bpm;
    var pk2 = peakOf(fold(comb, env.fr, bpm, BINS));
    // Ein Einsatz zeigt sich in der Hüllkurve, sobald er ins Analysefenster rutscht:
    // die Frame-Zeit liegt daher etwa (FRAME - HOP/2) Samples vor dem echten Einsatz.
    var latency = (FRAME - HOP / 2) / sr;
    var phase = pk2.index / BINS * P + latency;
    phase = ((phase % P) + P) % P;

    // Downbeat: Beat mit der lautesten Tiefband-Energie direkt nach dem Schlag (Kick auf der 1)
    var sums = [0, 0, 0, 0], dur = samples.length / sr, j;
    var win = Math.max(1, Math.round(0.08 * env.fr));
    for (var k = 0; phase + k * P < dur; k++) {
      var c = Math.round((phase + k * P) * sr / HOP), m = 0;
      for (j = c; j < c + win; j++) if (j >= 0 && j < env.lowE.length) m += env.lowE[j];
      sums[k % 4] += Math.sqrt(m);
    }
    var bestJ = 0;
    for (j = 1; j < 4; j++) if (sums[j] > sums[bestJ]) bestJ = j;

    // Sicherheit: normierte Autokorrelation der Hüllkurve beim Beat-Abstand
    var mean = 0;
    for (i = 0; i < comb.length; i++) mean += comb[i];
    mean /= comb.length;
    var z = new Float32Array(comb.length);
    for (i = 0; i < comb.length; i++) z[i] = comb[i] - mean;
    var lag0 = Math.round(60 * env.fr / bpm), r = 0, ac0 = autocorr(z, 0) || 1;
    for (var lg = lag0 - 1; lg <= lag0 + 1; lg++) r = Math.max(r, autocorr(z, lg) / ac0);
    var confidence = Math.max(0, Math.min(1, (r - 0.05) / 0.3));
    return { bpm: bpm, downbeat: Math.round((phase + bestJ * P) * 1000) / 1000, confidence: confidence };
  }

  /** Base64-String -> ArrayBuffer (für cep.fs.readFile) */
  function base64ToArrayBuffer(b64) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  /** AudioBuffer -> Mono-Ausschnitt [from, from+maxSec] */
  function monoSlice(audioBuffer, from, maxSec) {
    var sr = audioBuffer.sampleRate;
    var a = Math.max(0, Math.floor(from * sr));
    var b = Math.min(audioBuffer.length, a + Math.floor(maxSec * sr));
    var out = new Float32Array(Math.max(0, b - a));
    var ch = audioBuffer.numberOfChannels;
    for (var c = 0; c < ch; c++) {
      var d = audioBuffer.getChannelData(c);
      for (var i = a; i < b; i++) out[i - a] += d[i] / ch;
    }
    return out;
  }

  var api = { detect: detect, base64ToArrayBuffer: base64ToArrayBuffer, monoSlice: monoSlice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SkipperBPM = api;
})(typeof window !== 'undefined' ? window : this);
