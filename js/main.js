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

  function userSteps(id) {
    var s = state.userGates[id];
    if (!s || s.length !== 16) s = state.userGates[id] = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    return s;
  }

  function renderGrid() {
    var g = P.findGateSlot(state.gateSlot);
    var show = !!(g && g.user);
    $('userGrid').hidden = !show;
    if (!show) return;
    var steps = userSteps(g.id), cells = $('cells');
    cells.innerHTML = '';
    steps.forEach(function (v, i) {
      var c = document.createElement('div');
      c.className = 'cell' + (v ? ' on' : '');
      c.title = 'Step ' + (i + 1);
      c.addEventListener('click', function () {
        steps[i] = steps[i] ? 0 : 1;
        save(); renderGrid(); drawPreview();
      });
      cells.appendChild(c);
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
    renderGrid();
    drawPreview();
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

  // ------------------------------------------------------------ Vorschau
  function drawPreview() {
    var cv = $('preview'), ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height, gateH = 40, padT = 10, plotH = H - gateH - padT - 14;
    ctx.clearRect(0, 0, W, H);
    var slot = P.findTimeSlot(state.timeSlot);
    var segs = slot.bar(0);

    var lo = 0, hi = 16;
    segs.forEach(function (s) {
      var a = s.src, b = s.src + s.l * s.sp;
      lo = Math.min(lo, a, b); hi = Math.max(hi, a, b);
    });
    function X(step) { return 4 + step / 16 * (W - 8); }
    function Y(src) { return padT + plotH - (src - lo) / (hi - lo) * plotH; }

    // Raster
    for (var i = 0; i <= 16; i++) {
      ctx.strokeStyle = i % 4 === 0 ? '#444' : '#2c2c2c';
      ctx.beginPath(); ctx.moveTo(X(i) + 0.5, padT); ctx.lineTo(X(i) + 0.5, H - 2); ctx.stroke();
    }
    // Original (Diagonale)
    ctx.strokeStyle = '#3c3c3c'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(16), Y(16)); ctx.stroke();
    ctx.setLineDash([]);
    // Quellposition
    ctx.strokeStyle = '#4f9cff'; ctx.lineWidth = 2;
    segs.forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(X(s.s), Y(s.src));
      ctx.lineTo(X(s.s + s.l), Y(s.src + s.l * s.sp));
      ctx.stroke();
    });
    ctx.lineWidth = 1;
    ctx.fillStyle = '#8a8a8a'; ctx.font = '10px sans-serif';
    ['1', '2', '3', '4'].forEach(function (b, k) { ctx.fillText(b, X(k * 4) + 3, H - gateH - 3); });

    // Gate
    var frame = 1 / 100, barLen = 240 / (state.bpm || 120);
    var keys = P.gateKeys({
      bpm: state.bpm || 120, downbeat: 0, frameDur: frame, gateSlot: state.gateSlot,
      gateMix: state.gateMix / 100, attackFrames: 0, releaseFrames: 0, userGates: state.userGates
    }, 0, barLen);
    var gy = H - 2, gh = gateH - 6;
    ctx.fillStyle = 'rgba(227,179,65,.85)';
    ctx.beginPath(); ctx.moveTo(X(0), gy);
    keys.forEach(function (k) { ctx.lineTo(X(k.t / barLen * 16), gy - k.v * gh); });
    ctx.lineTo(X(16), gy); ctx.closePath(); ctx.fill();
  }

  // ------------------------------------------------------------ Aktionen
  function setStatus(msg, cls) {
    var el = $('status');
    el.textContent = msg;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }
  function busy(on) { $('btnApply').disabled = on; $('btnReset').disabled = on; }

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

  // ------------------------------------------------------------ Start
  fillSelect($('timeSlot'), P.TIME_SLOTS);
  fillSelect($('gateSlot'), P.GATE_SLOTS);
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
  syncFromState();
})();
