/*
 * Skipper – Muster-Engine
 *
 * Reines JavaScript (ES5), läuft im CEP-Panel (Browser) und unter Node (Tests).
 * Berechnet aus BPM, Downbeat und Clip-Daten die Liste der Clip-Stücke, die
 * host.jsx anschließend in die Premiere-Timeline baut.
 *
 * Einheiten in den Musterdefinitionen: 1 Step = 1/16-Note, 1 Takt = 16 Steps (4/4).
 * Ein Zeit-Segment ist { s: Start-Step, l: Länge in Steps, src: Quell-Step
 * relativ zum Taktbeginn, sp: Geschwindigkeit (negativ = rückwärts) }.
 */
(function (root) {
  'use strict';

  var STEPS = 16;
  var HOLD = 0.02; // "Standbild": fast stehendes Bild

  function seg(s, l, src, sp) {
    return { s: s, l: l, src: src, sp: sp === undefined ? 1 : sp };
  }

  function identity(from, to) {
    return seg(from, to - from, from, 1);
  }

  // Deterministischer Zufall (mulberry32), damit "Glitch shuffle" reproduzierbar ist.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- Time slots
  var TIME_SLOTS = [
    { id: 'bypass', name: 'Bypass', gate: 'open',
      bar: function () { return [identity(0, 16)]; } },

    { id: 'stutter16_b4', name: '1/16 stutter, beat 4', gate: 'open',
      bar: function () {
        return [identity(0, 12), seg(12, 1, 12), seg(13, 1, 12), seg(14, 1, 12), seg(15, 1, 12)];
      } },

    { id: 'halfspeed_b4', name: 'Half-speed beat 4', gate: 'open',
      bar: function () { return [identity(0, 12), seg(12, 4, 12, 0.5)]; } },

    { id: 'previous_bar', name: 'Previous bar', gate: 'beats_1_3',
      bar: function () { return [seg(0, 16, -16, 1)]; } },

    { id: 'downbeat_cascade', name: 'Downbeat cascade', gate: 'open',
      bar: function () {
        return [seg(0, 4, 0), seg(4, 4, 0), seg(8, 2, 0), seg(10, 2, 0),
                seg(12, 1, 0), seg(13, 1, 0), seg(14, 1, 0), seg(15, 1, 0)];
      } },

    { id: 'glitch_shuffle', name: 'Glitch shuffle', gate: 'trance_a',
      bar: function (barIndex) {
        var r = rng(barIndex * 9973 + 17);
        var out = [seg(0, 2, 0)];
        for (var i = 1; i < 8; i++) {
          var from = Math.floor(r() * 8) * 2;
          if (r() < 0.3) { // 1/16-Wiederholung
            out.push(seg(i * 2, 1, from));
            out.push(seg(i * 2 + 1, 1, from));
          } else {
            out.push(seg(i * 2, 2, from));
          }
        }
        return out;
      } },

    { id: 'pingpong_eighths', name: 'Ping-pong eighths', gate: 'eighth_chop',
      bar: function () {
        var out = [];
        for (var i = 0; i < 8; i++) {
          // gerade Achtel vorwärts, ungerade spielen das vorige Achtel rückwärts
          out.push(i % 2 === 0 ? seg(i * 2, 2, i * 2, 1) : seg(i * 2, 2, i * 2, -1));
        }
        return out;
      } },

    { id: 'triplet_tumble', name: 'Triplet tumble', gate: 'open',
      bar: function () {
        var out = [], t = 4 / 3;
        for (var b = 0; b < 4; b++) {
          var s = b * 4;
          out.push(seg(s, t, s));
          out.push(seg(s + t, t, s + t));
          out.push(seg(s + 2 * t, t, s)); // "kippt" zurück auf den Schlag
        }
        return out;
      } },

    { id: 'baby_scratch_2_4', name: 'Baby scratch 2 and 4', gate: 'offbeats',
      bar: function () {
        function scratch(b) {
          return [seg(b, 1, b, 2), seg(b + 1, 1, b + 2, -2), seg(b + 2, 1, b, 2), seg(b + 3, 1, b + 2, -2)];
        }
        return [identity(0, 4)].concat(scratch(4), [identity(8, 12)], scratch(12));
      } },

    { id: 'stopmotion_build', name: 'Stop-motion build', gate: 'open',
      bar: function () {
        var out = [], i;
        for (i = 0; i < 2; i++) out.push(seg(i * 2, 2, i * 2, HOLD));
        for (i = 0; i < 4; i++) out.push(seg(4 + i, 1, 4 + i, HOLD));
        for (i = 0; i < 8; i++) out.push(seg(8 + i * 0.5, 0.5, 8 + i * 0.5, HOLD));
        out.push(identity(12, 16));
        return out;
      } },

    { id: 'bar_remix', name: 'Bar remix', gate: 'open',
      bar: function () {
        return [seg(0, 4, 0), seg(4, 4, 8), seg(8, 4, 4), seg(12, 2, 12), seg(14, 2, 12)];
      } },

    { id: 'halftime_boomerang', name: 'Half-time boomerang', gate: 'open',
      bar: function () { return [seg(0, 8, 0, 0.5), seg(8, 8, 4, -0.5)]; } },

    { id: 'rewind_spinup', name: 'Rewind and spin-up', gate: 'open',
      bar: function () {
        return [identity(0, 8), seg(8, 4, 8, -2),
                seg(12, 1, 12.25, 0.25), seg(13, 1, 12.5, 0.5), seg(14, 1, 13, 1), seg(15, 1, 14, 2)];
      } },

    { id: 'rubber_band', name: 'Rubber band', gate: 'open',
      bar: function () {
        return [seg(0, 4, 0, 0.5), seg(4, 4, 2, 1.5), seg(8, 4, 8, 0.5), seg(12, 4, 10, 1.5)];
      } }
  ];

  // ---------------------------------------------------------------- Gate slots
  function rep(arr, n) { var o = []; for (var i = 0; i < n; i++) o = o.concat(arr); return o; }

  var GATE_SLOTS = [
    { id: 'open', name: 'Open', steps: rep([1], 16) },
    { id: 'eighth_chop', name: 'Eighth chop', steps: rep([1, 1, 0, 0], 4) },
    { id: 'sixteenth_chop', name: 'Sixteenth chop', steps: rep([1, 0], 8) },
    { id: 'offbeats', name: 'Offbeats', steps: rep([0, 0, 1, 1], 4) },
    { id: 'beats_1_3', name: 'Beats 1 and 3', steps: rep([1, 1, 1, 1, 0, 0, 0, 0], 2) },
    { id: 'trance_a', name: 'Trance A', steps: [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1] },
    { id: 'trance_b', name: 'Trance B', steps: [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1] },
    { id: 'fade_out_bar', name: 'Fade out bar', ramp: [1, 0] },
    { id: 'fade_in_bar', name: 'Fade in bar', ramp: [0, 1] }
  ];
  var USER_SLOT_COUNT = 8;
  for (var u = 1; u <= USER_SLOT_COUNT; u++) {
    GATE_SLOTS.push({ id: 'user' + u, name: 'User ' + u, user: true, steps: rep([1], 16) });
  }

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // ---------------------------------------------------------------- Helpers
  var EPS = 1e-6;

  function snap(t, frame) { return Math.round(t / frame) * frame; }

  /**
   * Gate-Slices über [from, to]: [{t0, t1, a, b, ramp}] mit Pegel a→b (0..1, Mix
   * schon eingerechnet), linear über "ramp" Sekunden ab t0, danach konstant b.
   */
  function gateSlices(o, from, to) {
    var gate = findById(GATE_SLOTS, o.gateSlot) || GATE_SLOTS[0];
    var steps = gate.steps;
    if (gate.user && o.userGates && o.userGates[gate.id]) steps = o.userGates[gate.id];
    var mix = clamp01(o.gateMix);
    function lv(x) { return 1 - mix * (1 - x); }

    var barLen = 240 / o.bpm, stepLen = barLen / STEPS;
    var first = Math.floor((from - o.downbeat) / barLen);
    var last = Math.ceil((to - o.downbeat) / barLen);
    var raw = [];
    for (var b = first; b < last; b++) {
      var barT = o.downbeat + b * barLen, f = o.frameDur;
      if (gate.ramp) {
        raw.push({ t0: snap(barT, f), t1: snap(barT + barLen, f), ramp: true, a: lv(gate.ramp[0]), b: lv(gate.ramp[1]) });
      } else {
        for (var s = 0; s < STEPS; s++) {
          var st0 = snap(barT + s * stepLen, f), st1 = snap(barT + (s + 1) * stepLen, f);
          if (st1 - st0 < EPS) continue;
          raw.push({ t0: st0, t1: st1, level: lv(steps[s] ? 1 : 0) });
        }
      }
    }

    // Gleiche Pegel zusammenfassen, Attack/Release einsetzen
    var out = [], prev = null, i;
    var atk = Math.max(1, o.attackFrames || 0) * o.frameDur;
    var rel = Math.max(1, o.releaseFrames || 0) * o.frameDur;
    for (i = 0; i < raw.length; i++) {
      var r = raw[i];
      if (r.ramp) {
        out.push({ t0: r.t0, t1: r.t1, a: r.a, b: r.b, ramp: r.t1 - r.t0, isRampSlice: true });
        prev = r.b;
        continue;
      }
      var last2 = out[out.length - 1];
      if (last2 && !last2.isRampSlice && last2.b === r.level && last2.t1 >= r.t0 - EPS) {
        last2.t1 = r.t1;
        continue;
      }
      var from2 = prev === null ? r.level : prev;
      var ramp = from2 === r.level ? 0 : (r.level > from2 ? atk : rel);
      out.push({ t0: r.t0, t1: r.t1, a: from2, b: r.level, ramp: Math.min(ramp, r.t1 - r.t0) });
      prev = r.level;
    }
    // auf den Bereich zuschneiden
    var res = [];
    for (i = 0; i < out.length; i++) {
      var g = out[i];
      if (g.t1 <= from + EPS || g.t0 >= to - EPS) continue;
      res.push(g);
    }
    return res;
  }

  function gateValue(g, t) {
    if (g.ramp <= 0) return g.b;
    var k = (t - g.t0) / g.ramp;
    if (k <= 0) return g.a;
    if (k >= 1) return g.b;
    return Math.round((g.a + (g.b - g.a) * k) * 1e4) / 1e4;
  }

  function clamp01(x) { x = Number(x); if (isNaN(x)) return 1; return Math.max(0, Math.min(1, x)); }

  /** Keyframes [{t, v}] (absolute Sequenzzeit, v = 0..1) für einen Bereich, z. B. Audio. */
  function gateKeys(o, from, to) {
    var sl = gateSlices(o, from, to), keys = [];
    for (var i = 0; i < sl.length; i++) {
      var g = sl[i];
      var a = Math.max(g.t0, from), e = Math.min(g.t0 + g.ramp, g.t1, to);
      keys.push({ t: a, v: gateValue(g, a) });
      if (e > a + EPS) keys.push({ t: e, v: gateValue(g, e) });
    }
    if (sl.length) keys.push({ t: to, v: gateValue(sl[sl.length - 1], to) });
    return dedupeKeys(keys);
  }

  function dedupeKeys(keys) {
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], p = out[out.length - 1];
      if (p && Math.abs(p.t - k.t) < 1e-4) { p.v = k.v; continue; }
      out.push(k);
    }
    return out;
  }

  // ---------------------------------------------------------------- Hauptfunktion
  /**
   * o = {
   *   bpm, downbeat (s, Sequenzzeit eines Taktbeginns), frameDur (s),
   *   clipStart, clipEnd (Sequenzzeit), clipIn (Quellzeit am clipStart),
   *   srcMin, srcMax (erlaubter Quellbereich, Standard: Clip-In/Out),
   *   timeSlot, gateSlot, timeMix (0..1), gateMix (0..1),
   *   attackFrames, releaseFrames, applyGateToVideo (bool), userGates
   * }
   * Rückgabe: { pieces: [{start, end, srcIn, srcOut, reverse, keys:[{t,v}], jump}], warnings: [] }
   */
  function compute(o) {
    var warnings = [];
    if (!(o.bpm > 0)) throw new Error('BPM muss größer als 0 sein.');
    if (!(o.frameDur > 0)) throw new Error('Unbekannte Framerate.');
    var slot = findById(TIME_SLOTS, o.timeSlot) || TIME_SLOTS[0];
    var barLen = 240 / o.bpm, stepLen = barLen / STEPS;
    var srcMin = o.srcMin !== undefined ? o.srcMin : o.clipIn;
    var srcMax = o.srcMax !== undefined ? o.srcMax : o.clipIn + (o.clipEnd - o.clipStart);
    var mix = clamp01(o.timeMix === undefined ? 1 : o.timeMix);
    function ident(t) { return o.clipIn + (t - o.clipStart); }

    // 1) Zeit-Segmente in Sequenzzeit: {t0, t1, s0 (Quelle bei t0), sp}
    var segs = [];
    var first = Math.floor((o.clipStart - o.downbeat) / barLen + EPS);
    var last = Math.ceil((o.clipEnd - o.downbeat) / barLen - EPS);
    for (var b = first, k = 0; b < last; b++, k++) {
      var barT = o.downbeat + b * barLen;
      var active = Math.floor((k + 1) * mix + EPS) > Math.floor(k * mix + EPS);
      var list = active ? slot.bar(b) : [identity(0, 16)];
      for (var i = 0; i < list.length; i++) {
        var sg = list[i];
        var t0 = barT + sg.s * stepLen, t1 = t0 + sg.l * stepLen;
        var s0 = ident(barT + sg.src * stepLen);
        var c0 = Math.max(t0, o.clipStart), c1 = Math.min(t1, o.clipEnd);
        if (c1 <= c0 + EPS) continue;
        s0 += (c0 - t0) * sg.sp;
        var lo = Math.min(s0, s0 + (c1 - c0) * sg.sp), hi = Math.max(s0, s0 + (c1 - c0) * sg.sp);
        if (lo < srcMin - EPS || hi > srcMax + EPS) {
          segs.push({ t0: c0, t1: c1, s0: ident(c0), sp: 1, fallback: true });
        } else {
          segs.push({ t0: c0, t1: c1, s0: s0, sp: sg.sp });
        }
      }
    }

    // 2) An Gate-Grenzen teilen
    var gates = o.applyGateToVideo ? gateSlices(o, o.clipStart, o.clipEnd) : [];
    var cuts = [];
    for (i = 0; i < gates.length; i++) cuts.push(gates[i].t0, gates[i].t1);
    var pieces = [];
    for (i = 0; i < segs.length; i++) {
      var s = segs[i], bounds = [s.t0];
      for (var c = 0; c < cuts.length; c++) if (cuts[c] > s.t0 + EPS && cuts[c] < s.t1 - EPS) bounds.push(cuts[c]);
      bounds.push(s.t1);
      bounds.sort(function (x, y) { return x - y; });
      for (var j = 0; j + 1 < bounds.length; j++) {
        if (bounds[j + 1] - bounds[j] < EPS) continue;
        pieces.push({ t0: bounds[j], t1: bounds[j + 1], s0: s.s0 + (bounds[j] - s.t0) * s.sp, sp: s.sp });
      }
    }

    // 3) Auf Frames einrasten
    var snapped = [];
    for (i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      var a = snap(p.t0, o.frameDur), e = snap(p.t1, o.frameDur);
      if (e - a < o.frameDur / 2) continue;
      snapped.push({ t0: a, t1: e, s0: p.s0 + (a - p.t0) * p.sp, sp: p.sp });
    }

    // 4) Opacity-Keys je Stück
    for (i = 0; i < snapped.length; i++) {
      var q = snapped[i];
      q.keys = [];
      if (!gates.length) continue;
      var g = gateAt(gates, q.t0 + EPS);
      if (!g) continue;
      q.keys.push({ t: 0, v: gateValue(g, q.t0) });
      var re = g.t0 + g.ramp;
      if (g.ramp > 0 && re > q.t0 + EPS) {
        var e2 = Math.min(re, q.t1);
        q.keys.push({ t: e2 - q.t0, v: gateValue(g, e2) });
      }
    }

    // 5) Zusammenhängende Stücke zusammenfassen
    var merged = [];
    for (i = 0; i < snapped.length; i++) {
      var cur = snapped[i], prev = merged[merged.length - 1];
      if (prev && prev.sp === cur.sp && Math.abs(prev.t1 - cur.t0) < EPS &&
          Math.abs(prev.s0 + (prev.t1 - prev.t0) * prev.sp - cur.s0) < o.frameDur / 4 &&
          isConstant(prev.keys) && isConstant(cur.keys) && constVal(prev.keys) === constVal(cur.keys)) {
        prev.t1 = cur.t1;
        continue;
      }
      merged.push(cur);
    }

    // 6) Ausgabe
    var out = [], lastSrcEnd = null;
    for (i = 0; i < merged.length; i++) {
      var m = merged[i], dur = m.t1 - m.t0, span = dur * Math.abs(m.sp);
      var rev = m.sp < 0;
      if (span < o.frameDur) span = o.frameDur; // mind. 1 Quellframe (Standbild)
      var inP, outP;
      if (!rev) { inP = m.s0; outP = m.s0 + span; } else { outP = m.s0; inP = m.s0 - span; }
      if (outP > srcMax) { inP -= outP - srcMax; outP = srcMax; }
      if (inP < srcMin) { outP += srcMin - inP; inP = srcMin; }
      var startSrc = rev ? outP : inP;
      var jump = lastSrcEnd !== null && Math.abs(startSrc - lastSrcEnd) > o.frameDur * 1.5;
      lastSrcEnd = rev ? inP : outP;
      out.push({
        start: round6(m.t0), end: round6(m.t1),
        srcIn: round6(inP), srcOut: round6(outP),
        reverse: rev, keys: m.keys, jump: jump
      });
    }
    if (!out.length) warnings.push('Keine Stücke erzeugt – liegt der Clip im Beat-Raster?');
    return { pieces: out, warnings: warnings };
  }

  function gateAt(gates, t) {
    for (var i = 0; i < gates.length; i++) if (t >= gates[i].t0 - EPS && t < gates[i].t1) return gates[i];
    return gates[gates.length - 1] || null;
  }
  function isConstant(keys) {
    if (!keys || keys.length <= 1) return true;
    for (var i = 1; i < keys.length; i++) if (Math.abs(keys[i].v - keys[0].v) > 1e-6) return false;
    return true;
  }
  function constVal(keys) { return keys && keys.length ? Math.round(keys[0].v * 1e6) : 1e6; }
  function round6(x) { return Math.round(x * 1e6) / 1e6; }

  var api = {
    STEPS: STEPS,
    TIME_SLOTS: TIME_SLOTS,
    GATE_SLOTS: GATE_SLOTS,
    findTimeSlot: function (id) { return findById(TIME_SLOTS, id); },
    findGateSlot: function (id) { return findById(GATE_SLOTS, id); },
    linkedGate: function (timeId) { var s = findById(TIME_SLOTS, timeId); return s ? s.gate : 'open'; },
    compute: compute,
    gateSlices: gateSlices,
    gateKeys: gateKeys
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SkipperPatterns = api;
})(this);
