// node test/patterns.test.js
'use strict';
var assert = require('assert');
var P = require('../js/patterns.js');

var failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

var FRAME = 1 / 30;
function base(extra) {
  var o = {
    bpm: 127, downbeat: 0, frameDur: FRAME,
    clipStart: 0, clipEnd: 20, clipIn: 5,
    timeSlot: 'bypass', gateSlot: 'open', timeMix: 1, gateMix: 1,
    attackFrames: 1, releaseFrames: 2, applyGateToVideo: true
  };
  for (var k in extra) o[k] = extra[k];
  return o;
}

// Jedes Zeit-Muster muss einen Takt lückenlos füllen (0..16 Steps)
P.TIME_SLOTS.forEach(function (slot) {
  test('Muster füllt Takt lückenlos: ' + slot.name, function () {
    [0, 1, 7].forEach(function (bar) {
      var segs = slot.bar(bar).slice().sort(function (a, b) { return a.s - b.s; });
      var t = 0;
      segs.forEach(function (s) {
        assert.ok(Math.abs(s.s - t) < 1e-9, 'Lücke/Überlappung bei Step ' + t + ' (Segment ab ' + s.s + ')');
        assert.ok(s.l > 0, 'Länge > 0');
        assert.ok(s.sp !== 0, 'Speed != 0');
        t = s.s + s.l;
      });
      assert.ok(Math.abs(t - 16) < 1e-9, 'endet bei ' + t);
    });
  });
});

P.GATE_SLOTS.forEach(function (g) {
  test('Gate-Slot gültig: ' + g.name, function () {
    if (g.ramp) assert.strictEqual(g.ramp.length, 2);
    else assert.strictEqual(g.steps.length, 16);
  });
});

P.TIME_SLOTS.forEach(function (slot) {
  P.GATE_SLOTS.filter(function (g) { return !g.user; }).forEach(function (gate) {
    test('compute: ' + slot.id + ' × ' + gate.id, function () {
      var o = base({ timeSlot: slot.id, gateSlot: gate.id, clipStart: 1.3, clipEnd: 15.7, clipIn: 2, downbeat: 0.25 });
      var r = P.compute(o);
      var ps = r.pieces;
      assert.ok(ps.length > 0, 'keine Stücke');
      // lückenlos von Clip-Start bis Clip-Ende (auf Frames gerundet)
      assert.ok(Math.abs(ps[0].start - Math.round(o.clipStart / FRAME) * FRAME) < 1e-4, 'Start ' + ps[0].start);
      assert.ok(Math.abs(ps[ps.length - 1].end - Math.round(o.clipEnd / FRAME) * FRAME) < 1e-4, 'Ende');
      var srcMin = o.clipIn, srcMax = o.clipIn + (o.clipEnd - o.clipStart);
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (i) assert.ok(Math.abs(p.start - ps[i - 1].end) < 1e-4, 'Lücke bei ' + p.start);
        assert.ok(p.end > p.start, 'Länge > 0');
        // auf Frames
        assert.ok(Math.abs(p.start / FRAME - Math.round(p.start / FRAME)) < 1e-3, 'nicht auf Frame: ' + p.start);
        // Quelle im Clip
        assert.ok(p.srcIn >= srcMin - 1e-4 && p.srcOut <= srcMax + 1e-4, 'Quelle außerhalb: ' + p.srcIn + '..' + p.srcOut);
        assert.ok(p.srcOut - p.srcIn >= FRAME - 1e-6, 'mind. 1 Quellframe');
        p.keys.forEach(function (k) { assert.ok(k.v >= 0 && k.v <= 1, 'Key-Wert'); });
      }
    });
  });
});

test('Bypass + Open ergibt genau ein Stück (identisch zum Original)', function () {
  var r = P.compute(base({}));
  assert.strictEqual(r.pieces.length, 1);
  assert.strictEqual(r.pieces[0].srcIn, 5);
  assert.strictEqual(r.pieces[0].srcOut, 25);
});

test('Glitch shuffle ist deterministisch', function () {
  var a = JSON.stringify(P.compute(base({ timeSlot: 'glitch_shuffle' })));
  var b = JSON.stringify(P.compute(base({ timeSlot: 'glitch_shuffle' })));
  assert.strictEqual(a, b);
});

test('Time mix 0 % entspricht Bypass', function () {
  var r = P.compute(base({ timeSlot: 'bar_remix', timeMix: 0 }));
  assert.strictEqual(r.pieces.length, 1);
});

test('Time mix 50 % bearbeitet jeden zweiten Takt', function () {
  var full = P.compute(base({ timeSlot: 'bar_remix', timeMix: 1 })).pieces.length;
  var half = P.compute(base({ timeSlot: 'bar_remix', timeMix: 0.5 })).pieces.length;
  assert.ok(half < full && half > 1, half + ' vs ' + full);
});

test('Previous bar fällt im ersten Takt auf Original zurück', function () {
  var r = P.compute(base({ timeSlot: 'previous_bar' }));
  assert.strictEqual(r.pieces[0].srcIn, 5);
  assert.ok(r.pieces.some(function (p) { return p.jump; }), 'Sprünge erwartet');
});

test('Ping-pong erzeugt Rückwärts-Stücke', function () {
  var r = P.compute(base({ timeSlot: 'pingpong_eighths' }));
  assert.ok(r.pieces.some(function (p) { return p.reverse; }));
});

test('Sixteenth chop mit Gate mix 100 % hat Werte 0 und 1', function () {
  var r = P.compute(base({ gateSlot: 'sixteenth_chop', attackFrames: 0, releaseFrames: 0 }));
  var vals = {};
  r.pieces.forEach(function (p) { p.keys.forEach(function (k) { vals[Math.round(k.v * 100)] = 1; }); });
  assert.ok(vals[0] && vals[100], JSON.stringify(vals));
});

test('Gate mix 50 % senkt nur auf 0.5', function () {
  var r = P.compute(base({ gateSlot: 'eighth_chop', gateMix: 0.5 }));
  r.pieces.forEach(function (p) { p.keys.forEach(function (k) { assert.ok(k.v >= 0.5 - 1e-9); }); });
});

test('Gate nur fürs Audio: Video bleibt ein Stück', function () {
  var r = P.compute(base({ gateSlot: 'trance_a', applyGateToVideo: false }));
  assert.strictEqual(r.pieces.length, 1);
});

test('gateKeys liefert sortierte Keys im Bereich', function () {
  var keys = P.gateKeys(base({ gateSlot: 'trance_b' }), 2, 6);
  assert.ok(keys.length > 4);
  for (var i = 1; i < keys.length; i++) assert.ok(keys[i].t > keys[i - 1].t);
  assert.ok(keys[0].t >= 2 && keys[keys.length - 1].t <= 6);
});

test('Fade in bar rampt von 0 auf 1', function () {
  var barEnd = Math.round((240 / 127) / FRAME) * FRAME; // aufs Frame gerastetes Taktende
  var keys = P.gateKeys(base({ gateSlot: 'fade_in_bar' }), 0, barEnd);
  assert.ok(Math.abs(keys[0].v) < 1e-9);
  assert.ok(Math.abs(keys[keys.length - 1].v - 1) < 1e-6);
});

test('User-Slot nutzt eigenes Raster', function () {
  var steps = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  var r = P.compute(base({ gateSlot: 'user1', userGates: { user1: steps } }));
  assert.ok(r.pieces.length > 8);
});

test('Link slots liefert passendes Gate', function () {
  assert.strictEqual(P.linkedGate('pingpong_eighths'), 'eighth_chop');
});

console.log(failures ? '\n' + failures + ' Test(s) fehlgeschlagen' : '\nAlle Tests bestanden');
process.exit(failures ? 1 : 0);
