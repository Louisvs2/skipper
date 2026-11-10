// Läuft host.jsx gegen ein vereinfachtes Premiere-Modell (prüft den Ablauf, nicht Premiere selbst).
// node test/host.mock.test.js
'use strict';
var fs = require('fs'), vm = require('vm'), assert = require('assert');
var P = require('../js/patterns.js');

function T(s) { return { seconds: s }; }
function Coll(arr) { arr.numItems = arr.length; return arr; }
var nid = 0;
function makeClip(track, name, start, end, inP, mediaType) {
  var c = { nodeId: 'n' + (++nid), name: name, mediaType: mediaType || 'Video', disabled: false, speed: 1, reversed: false,
    start: T(start), end: T(end), inPoint: T(inP), outPoint: T(inP + end - start), projectItem: item,
    getSpeed: function () { return this.speed; },
    getLinkedItems: function () { return Coll([]); },
    remove: function () { var a = track._clips; a.splice(a.indexOf(this), 1); },
    components: Coll([{ matchName: 'AE.ADBE Opacity', displayName: 'Opacity', properties: Coll([mkProp()]) }]) };
  Object.defineProperty(c, 'end', { get: function () { return this._end; }, set: function (t) { this._end = T(t.seconds); }, configurable: true });
  c._end = T(end);
  return c;
}
function mkProp() {
  return { keys: [], value: 100, tv: false,
    setValue: function (v) { this.value = v; }, setTimeVarying: function (b) { this.tv = b; if (!b) this.keys = []; },
    isTimeVarying: function () { return this.tv; }, getValue: function () { return this.value; },
    addKey: function (t) { this.keys.push({ t: t }); },
    setValueAtKey: function (t, v) { this.keys[this.keys.length - 1].v = v; } };
}
function makeTrack() {
  var tr = { _clips: [], locked: false,
    isLocked: function () { return this.locked; }, setLocked: function (b) { this.locked = b; },
    overwriteClip: function (it, t) {
      var s = t.seconds, len = it._out - it._in;
      var c = makeClip(tr, it.name, s, s + len, it._in);
      tr._clips.push(c); tr._clips.sort(function (a, b) { return a.start.seconds - b.start.seconds; });
    } };
  Object.defineProperty(tr, 'clips', { get: function () { return Coll(tr._clips.slice()); } });
  return tr;
}
var item = { name: 'clip.mp4', _in: 0, _out: 60,
  setInPoint: function (s) { this._in = s; }, setOutPoint: function (s) { this._out = s; },
  getInPoint: function () { return T(0); }, getOutPoint: function () { return T(60); } };

var v1 = makeTrack(), v2 = makeTrack(), a1 = makeTrack();
var orig = makeClip(v1, 'clip.mp4', 2, 12, 3); v1._clips.push(orig);
var vt = [v1, v2]; vt.numTracks = 2; var at = [a1]; at.numTracks = 1;
var selection = [orig];
var seq = { timebase: String(254016000000 / 25), videoTracks: vt, audioTracks: at,
  getSelection: function () { return selection; }, getPlayerPosition: function () { return T(1.5); } };

var qeTracks = [v1, v2].map(function (tr) {
  return { get numItems() { return tr._clips.length; },
    getItemAt: function (i) { var c = tr._clips[i]; return { type: 'Clip', start: { secs: c.start.seconds },
      setSpeed: function (sp, x, rev) { // Faktor-Einheit; Länge passt sich an
        var len = (c.outPoint.seconds - c.inPoint.seconds); c.speed = sp; c.reversed = rev; c.end = T(c.start.seconds + len / sp); },
      addTransition: function () {}, setTimeInterpolationType: function () {} }; } };
});
var ctx = { Time: function () { this.seconds = 0; }, app: { project: { activeSequence: seq }, enableQE: function () {} },
  qe: { project: { getActiveSequence: function () { return { getVideoTrackAt: function (i) { return qeTracks[i]; }, addTracks: function () {} }; },
    getVideoTransitionByName: function () { return {}; } } } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../jsx/host.jsx', 'utf8'), ctx);

var info = JSON.parse(ctx.skipperInfo());
assert.ok(info.ok, info.error);
assert.strictEqual(info.video.start, 2); assert.strictEqual(info.frameDur, 0.04);

var r = P.compute({ bpm: 127, downbeat: 0, frameDur: info.frameDur, clipStart: 2, clipEnd: 12, clipIn: 3,
  timeSlot: 'baby_scratch_2_4', gateSlot: 'eighth_chop', timeMix: 1, gateMix: 1, attackFrames: 1, releaseFrames: 2, applyGateToVideo: true });
var res = JSON.parse(ctx.skipperBuild(JSON.parse(JSON.stringify({ pieces: r.pieces, audioKeys: [], gateVideo: true, frameMode: 'sampling', jumpFrames: 2 }))));
assert.ok(res.ok, res.error);
assert.strictEqual(res.built, r.pieces.length, 'alle Stücke gebaut');
assert.strictEqual(v2._clips.length, r.pieces.length);
assert.ok(orig.disabled, 'Original deaktiviert');
assert.ok(!a1.locked, 'Audiospur wieder entsperrt');
v2._clips.forEach(function (c, i) {
  assert.ok(Math.abs(c.start.seconds - r.pieces[i].start) < 1e-6);
  assert.ok(Math.abs(c.end.seconds - r.pieces[i].end) < 0.021, 'Länge Stück ' + i);
  assert.strictEqual(c.reversed, !!r.pieces[i].reverse);
});
assert.ok(v2._clips.some(function (c) { return c.components[0].properties[0].keys.length; }), 'Opacity-Keys gesetzt');

// erneutes Apply über ein Skipper-Stück ersetzt die alten Stücke
selection = [v2._clips[3]];
res = JSON.parse(ctx.skipperBuild(JSON.parse(JSON.stringify({ pieces: r.pieces.slice(0, 5), audioKeys: [], gateVideo: false, frameMode: 'sampling', jumpFrames: 0 }))));
assert.ok(res.ok, res.error);
assert.strictEqual(v2._clips.length, 5, 'alte Stücke ersetzt');

selection = [v2._clips[1]]; // ein aktuelles Skipper-Stück auswählen
res = JSON.parse(ctx.skipperReset());
assert.ok(res.ok && res.removed === 5 && !orig.disabled && v2._clips.length === 0);
// Song für die BPM-Erkennung: Audioclip mit größter Überlappung, ohne den eigenen Ton des Videos
var ownAudio = makeClip(a1, 'clip.mp4', 2, 12, 3, 'Audio');
var a2 = makeTrack(); at.push(a2); at.numTracks = 2;
var songItem = { getMediaPath: function () { return '/Musik/song.wav'; } };
var songClip = makeClip(a2, 'song.wav', 0, 30, 4, 'Audio'); songClip.projectItem = songItem;
a1._clips.push(ownAudio); a2._clips.push(songClip);
orig.getLinkedItems = function () { return Coll([orig, ownAudio]); };
selection = [orig];
var song = JSON.parse(ctx.skipperSongInfo());
assert.ok(song.ok, song.error);
assert.strictEqual(song.path, '/Musik/song.wav');
assert.strictEqual(song.inPoint, 4);
selection = [orig, songClip]; // explizit markierter Song gewinnt
assert.strictEqual(JSON.parse(ctx.skipperSongInfo()).name, 'song.wav');
selection = [];
assert.ok(!JSON.parse(ctx.skipperSongInfo()).ok, 'ohne Auswahl -> Fehler');

console.log('host.jsx Mock-Test bestanden (' + r.pieces.length + ' Stücke)');
