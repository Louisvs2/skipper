// node test/bpm.test.js
'use strict';
var assert = require('assert');
var B = require('../js/bpm.js');

/** Synthetischer Song: Kick (Akzent auf der 1), Snare auf 2+4, Hi-Hats auf Achteln, Rauschen */
function synth(bpm, firstDownbeat, seconds, sr, seed) {
  var x = new Float32Array(Math.floor(seconds * sr));
  var s = seed || 1;
  function rnd() { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; }
  var P = 60 / bpm;
  function add(t0, fn, len) {
    var a = Math.floor(t0 * sr), n = Math.floor(len * sr);
    for (var i = 0; i < n && a + i < x.length; i++) if (a + i >= 0) x[a + i] += fn(i / sr);
  }
  for (var k = -4; firstDownbeat + k * P < seconds; k++) {
    var t = firstDownbeat + k * P, beat = ((k % 4) + 4) % 4;
    var amp = beat === 0 ? 1 : 0.55;
    add(t, function (u) { return amp * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-u / 0.03)) * u) * Math.exp(-u / 0.12); }, 0.4);
    if (beat === 1 || beat === 3) add(t, function (u) { return 0.35 * rnd() * Math.exp(-u / 0.08); }, 0.25);
    add(t + P / 2, function (u) { return 0.12 * rnd() * Math.exp(-u / 0.015); }, 0.05);
    add(t, function (u) { return 0.08 * rnd() * Math.exp(-u / 0.015); }, 0.05);
  }
  for (var i = 0; i < x.length; i++) x[i] += 0.01 * rnd();
  return x;
}

var failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

[[127, 0.37], [93, 1.1], [140, 0.05], [120, 0.8], [174, 0.4], [100.5, 0.6]].forEach(function (c) {
  test('erkennt ' + c[0] + ' BPM, Downbeat ' + c[1] + ' s', function () {
    var sr = 22050;
    var r = B.detect(synth(c[0], c[1], 40, sr, 7), sr);
    assert.ok(Math.abs(r.bpm - c[0]) <= 0.2, 'BPM ' + r.bpm);
    var bar = 240 / c[0];
    var d = ((r.downbeat - c[1]) % bar + bar) % bar;
    d = Math.min(d, bar - d);
    assert.ok(d <= 0.025, 'Downbeat ' + r.downbeat + ' (Abweichung ' + d.toFixed(3) + ' s)');
    assert.ok(r.confidence > 0.3, 'Sicherheit ' + r.confidence);
  });
});

test('funktioniert bei 44,1 kHz und 90 s Länge (schnell genug)', function () {
  var sr = 44100, t0 = Date.now();
  var r = B.detect(synth(128, 2.2, 90, sr, 11), sr);
  var ms = Date.now() - t0;
  assert.ok(Math.abs(r.bpm - 128) <= 0.2, 'BPM ' + r.bpm);
  var bar = 240 / 128, d = ((r.downbeat - 2.2) % bar + bar) % bar;
  assert.ok(Math.min(d, bar - d) <= 0.025, 'Downbeat ' + r.downbeat);
  assert.ok(ms < 5000, 'dauerte ' + ms + ' ms');
});

test('Rauschen ohne Beat hat geringe Sicherheit', function () {
  var sr = 22050, x = new Float32Array(sr * 20), s = 3;
  for (var i = 0; i < x.length; i++) { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; x[i] = (s / 0x7fffffff - 0.5) * 0.3; }
  var r = B.detect(x, sr);
  assert.ok(r.confidence < 0.3, 'Sicherheit ' + r.confidence);
});

test('zu kurzes Audio wirft verständlichen Fehler', function () {
  assert.throws(function () { B.detect(new Float32Array(500), 22050); }, /zu kurz/);
});

console.log(failures ? '\n' + failures + ' Test(s) fehlgeschlagen' : '\nAlle BPM-Tests bestanden');
process.exit(failures ? 1 : 0);
