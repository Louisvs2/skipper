/* Skipper – Panel-Logik (läuft im CEP-Panel von Premiere Pro) */
(function () {
  'use strict';

  var P = window.SkipperPatterns;
  var STORE_KEY = 'skipper.settings.v1';
  var $ = function (id) { return document.getElementById(id); };

  var defaults = {
    bpm: 127, downbeat: 0, timeSlot: 'bypass', gateSlot: 'open', linkSlots: false,
    timeMix: 100, gateMix: 100, gateTarget: 'video', attack: 1, release: 2,
    frameMode: 'sampling', jump: 0, userGates: {}
  };
  var state = load();

  // ------------------------------------------------------------ Speicher
  function load() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { s = {}; }
    var out = {};
    for (var k in defaults) out[k] = s[k] !== undefined ? s[k] : defaults[k];
    return out;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* egal */ }
  }

  // ------------------------------------------------------------ Host-Aufruf
  function callHost(script) {
    return new Promise(function (resolve, reject) {
      var cep = window.__adobe_cep__;
      if (!cep) { reject(new Error('Nicht in Premiere geöffnet – nur Vorschau verfügbar.')); return; }
      cep.evalScript(script, function (res) {
        if (res === 'EvalScript error.' || res === undefined) { reject(new Error('ExtendScript-Fehler (host.jsx nicht geladen?)')); return; }
        var data;
        try { data = JSON.parse(res); } catch (e) { reject(new Error('Unerwartete Antwort: ' + res)); return; }
        if (!data.ok) reject(new Error(data.error || 'Unbekannter Fehler'));
        else resolve(data);
      });
    });
  }

  // ------------------------------------------------------------ UI aufbauen
  function fillSelect(sel, list) {
    sel.innerHTML = '';
    list.forEach(function (it) {
      var o = document.createElement('option');
      o.value = it.id; o.textContent = it.name;
      sel.appendChild(o);
    });
  }

  function setVal(id, v) {
    var el = $(id);
    if (document.activeElement === el && el.type === 'number') return; // Tippen nicht stören
    el.value = v;
  }

  function syncFromState() {
    setVal('bpm', state.bpm);
    setVal('downbeat', state.downbeat);
    $('timeSlot').value = state.timeSlot;
    if (state.linkSlots) state.gateSlot = P.linkedGate(state.timeSlot);
    $('gateSlot').value = state.gateSlot;
    $('gateSlot').disabled = state.linkSlots;
    $('linkSlots').checked = state.linkSlots;
    setVal('timeMix', state.timeMix);
    setVal('gateMix', state.gateMix);
    $('gateTarget').value = state.gateTarget;
    setVal('attack', state.attack);
    setVal('release', state.release);
    $('frameMode').value = state.frameMode;
    setVal('jump', state.jump);
    document.querySelector('output[for=timeMix]').textContent = state.timeMix + ' %';
    document.querySelector('output[for=gateMix]').textContent = state.gateMix + ' %';
  }

  function bind(id, key, parse) {
    var el = $(id);
    var ev = (el.type === 'range' || el.type === 'number') ? 'input' : 'change';
    el.addEventListener(ev, function () {
      var v = el.type === 'checkbox' ? el.checked : el.value;
      if (parse) { v = parse(v); if (v === null) return; }
      state[key] = v;
      save(); syncFromState();
    });
  }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }

  // ------------------------------------------------------------ Aktionen
  function setStatus(msg, cls) {
    var el = $('status');
    el.textContent = msg;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }
  function busy(on) { $('btnApply').disabled = on; $('btnReset').disabled = on; $('btnDetect').disabled = on; }

  function apply() {
    busy(true);
    setStatus('Lese Auswahl …');
    callHost('skipperInfo()').then(function (info) {
      if (!info.video && !info.audio.length) throw new Error('Bitte einen Clip in der Timeline auswählen.');
      var gateVideo = state.gateTarget !== 'audio';
      var gateAudio = state.gateTarget !== 'video';
      var opts = {
        bpm: state.bpm, downbeat: state.downbeat, frameDur: info.frameDur,
        timeSlot: state.timeSlot, gateSlot: state.gateSlot,
        timeMix: state.timeMix / 100, gateMix: state.gateMix / 100,
        attackFrames: state.attack, releaseFrames: state.release,
        applyGateToVideo: gateVideo, userGates: state.userGates
      };
      var payload = { pieces: [], audioKeys: [], gateVideo: gateVideo, frameMode: state.frameMode, jumpFrames: state.jump };
      var notes = [];
      if (info.video) {
        if (Math.abs(Math.abs(info.video.speed) - 1) > 0.001) notes.push('Hinweis: Clip hat schon eine Geschwindigkeit ≠ 100 %, Ergebnis kann abweichen.');
        opts.clipStart = info.video.start; opts.clipEnd = info.video.end; opts.clipIn = info.video.inPoint;
        var r = P.compute(opts);
        payload.pieces = r.pieces;
        notes = notes.concat(r.warnings);
      }
      if (gateAudio) {
        payload.audioKeys = info.audio.map(function (a) { return P.gateKeys(opts, a.start, a.end); });
      }
      setStatus('Baue ' + payload.pieces.length + ' Stücke …');
      return callHost('skipperBuild(' + JSON.stringify(payload) + ')').then(function (res) {
        var msg = 'Fertig: ' + res.built + ' Stücke' + (res.audio ? ', ' + res.audio + ' Audioclip(s) gegatet' : '') + '.';
        var all = notes.concat(res.warnings || []);
        setStatus(msg + (all.length ? '\n' + all.join('\n') : ''), 'ok');
      });
    }).catch(function (e) {
      setStatus(e.message, 'err');
    }).then(function () { busy(false); });
  }

  function reset() {
    busy(true);
    callHost('skipperReset()').then(function (res) {
      setStatus('Zurückgesetzt (' + res.removed + ' Stücke entfernt).', 'ok');
    }).catch(function (e) { setStatus(e.message, 'err'); })
      .then(function () { busy(false); });
  }

  function playheadAsDownbeat() {
    callHost('skipperInfo()').then(function (info) {
      state.downbeat = Math.round(info.playhead * 1000) / 1000;
      save(); syncFromState();
      setStatus('Downbeat = ' + state.downbeat + ' s');
    }).catch(function (e) { setStatus(e.message, 'err'); });
  }

  // ------------------------------------------------------------ BPM-Erkennung
  function readFileBase64(path) {
    var cep = window.cep;
    if (!cep || !cep.fs) throw new Error('Dateizugriff nicht verfügbar (nur in Premiere).');
    var r = cep.fs.readFile(path, cep.encoding.Base64);
    if (r.err !== 0) throw new Error('Song-Datei konnte nicht gelesen werden (Fehler ' + r.err + '): ' + path);
    return r.data;
  }

  function decodeAudio(arrayBuffer) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    return new Promise(function (resolve, reject) {
      var done = function (buf) { try { ctx.close(); } catch (e) {} resolve(buf); };
      var fail = function () { try { ctx.close(); } catch (e) {} reject(new Error('Audioformat wird nicht unterstützt. Bitte den Song als WAV oder MP3 verwenden.')); };
      var p = ctx.decodeAudioData(arrayBuffer, done, fail);
      if (p && p.catch) p.catch(fail);
    });
  }

  function detectBpm() {
    var B = window.SkipperBPM, song;
    busy(true);
    setStatus('Suche Song …');
    callHost('skipperSongInfo()').then(function (info) {
      song = info;
      setStatus('Lese „' + song.name + '“ …');
      return decodeAudio(B.base64ToArrayBuffer(readFileBase64(song.path)));
    }).then(function (buf) {
      setStatus('Analysiere …');
      var len = Math.min(90, song.end - song.start);
      var r = B.detect(B.monoSlice(buf, song.inPoint, len), buf.sampleRate);
      state.bpm = r.bpm;
      // Dateizeit -> Sequenzzeit
      state.downbeat = Math.round((song.start + r.downbeat) * 1000) / 1000;
      save(); syncFromState();
      var msg = r.bpm + ' BPM erkannt (Song: ' + song.name + ').';
      if (r.confidence < 0.4) setStatus(msg + '\nUnsicher – bitte prüfen und ggf. von Hand korrigieren.', 'err');
      else setStatus(msg + ' Downbeat: ' + state.downbeat + ' s', 'ok');
    }).catch(function (e) {
      setStatus(e.message, 'err');
    }).then(function () { busy(false); });
  }

  // ------------------------------------------------------------ Start
  fillSelect($('timeSlot'), P.TIME_SLOTS);
  fillSelect($('gateSlot'), P.GATE_SLOTS.filter(function (g) { return !g.user; }));
  if (!P.findGateSlot(state.gateSlot) || P.findGateSlot(state.gateSlot).user) state.gateSlot = 'open';
  bind('bpm', 'bpm', function (v) { v = num(v); return v && v > 0 ? v : null; });
  bind('downbeat', 'downbeat', num);
  bind('timeSlot', 'timeSlot');
  bind('gateSlot', 'gateSlot');
  bind('linkSlots', 'linkSlots');
  bind('timeMix', 'timeMix', num);
  bind('gateMix', 'gateMix', num);
  bind('gateTarget', 'gateTarget');
  bind('attack', 'attack', num);
  bind('release', 'release', num);
  bind('frameMode', 'frameMode');
  bind('jump', 'jump', num);
  $('btnApply').addEventListener('click', apply);
  $('btnReset').addEventListener('click', reset);
  $('btnPlayhead').addEventListener('click', playheadAsDownbeat);
  $('btnDetect').addEventListener('click', detectBpm);
  syncFromState();
})();
