/*
 * Skipper – ExtendScript für Premiere Pro (ES3!)
 *
 * Wird vom Panel per evalScript aufgerufen:
 *   skipperInfo()            -> JSON mit Auswahl, Framerate, Playhead
 *   skipperBuild(payload)    -> baut die berechneten Stücke in die Timeline
 *   skipperReset()           -> entfernt Skipper-Stücke, aktiviert das Original wieder
 *
 * Arbeitsweise (nicht destruktiv): Das Original bleibt liegen und wird deaktiviert.
 * Die Stücke landen auf einer freien Videospur darüber und heißen "[skipper] …".
 */

var SKIPPER_MARK = '[skipper] ';
var TICKS_PER_SECOND = 254016000000;

// Keyframe-Zeiten von Clip-Effekten zählen in Premiere in Quell-/Medienzeit
// (inPoint + Versatz). Bei geänderter Geschwindigkeit wird der Versatz mit der
// Speed skaliert. Falls Keyframes in deiner Version verschoben sitzen: auf false setzen.
var SKIPPER_KEYS_SPEED_SCALED = true;

var skipperSpeedUnit = null; // 1 = Faktor (0.5), 100 = Prozent (50) – wird automatisch erkannt

// ------------------------------------------------------------------ JSON (ES3)
function skJson(v) {
    var t = typeof v, i, out;
    if (v === null || t === 'undefined') return 'null';
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') {
        return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
    }
    if (v instanceof Array) {
        out = [];
        for (i = 0; i < v.length; i++) out.push(skJson(v[i]));
        return '[' + out.join(',') + ']';
    }
    out = [];
    for (i in v) if (v.hasOwnProperty(i)) out.push(skJson(String(i)) + ':' + skJson(v[i]));
    return '{' + out.join(',') + '}';
}

function skOk(data) { data.ok = true; return skJson(data); }
function skErr(msg) { return skJson({ ok: false, error: String(msg) }); }

// ------------------------------------------------------------------ Helpers
function skTime(seconds) {
    var t = new Time();
    t.seconds = seconds;
    return t;
}

function skFrameDur(seq) {
    try {
        var tb = parseFloat(seq.timebase);
        if (tb > 0) return tb / TICKS_PER_SECOND;
    } catch (e) {}
    try { return seq.getSettings().videoFrameRate.seconds; } catch (e2) {}
    return 1 / 25;
}

function skIsGenerated(clip) {
    return clip && clip.name && clip.name.indexOf(SKIPPER_MARK) === 0;
}

function skTrackIndexOf(tracks, clip) {
    for (var i = 0; i < tracks.numTracks; i++) {
        var cs = tracks[i].clips;
        for (var j = 0; j < cs.numItems; j++) if (cs[j].nodeId === clip.nodeId) return i;
    }
    return -1;
}

function skRangeEmpty(track, t0, t1, ignoreGenerated) {
    var cs = track.clips;
    for (var j = 0; j < cs.numItems; j++) {
        var c = cs[j];
        if (ignoreGenerated && skIsGenerated(c)) continue;
        if (c.start.seconds < t1 - 1e-4 && c.end.seconds > t0 + 1e-4) return false;
    }
    return true;
}

/** Original (deaktivierter Clip unter einem Skipper-Stück) suchen. */
function skFindOriginal(seq, genClip, genTrackIdx) {
    var t = genClip.start.seconds + 1e-3;
    for (var i = genTrackIdx - 1; i >= 0; i--) {
        var cs = seq.videoTracks[i].clips;
        for (var j = 0; j < cs.numItems; j++) {
            var c = cs[j];
            if (!skIsGenerated(c) && c.start.seconds <= t && c.end.seconds > t) return { clip: c, track: i };
        }
    }
    return null;
}

/** Videoclip der Auswahl (bzw. dessen Original) + ausgewählte Audioclips. */
function skSelection(seq) {
    var sel = seq.getSelection();
    var video = null, audio = [];
    for (var i = 0; i < sel.length; i++) {
        var c = sel[i];
        if (c.mediaType === 'Video' || skTrackIndexOf(seq.videoTracks, c) >= 0) {
            if (!video) video = c;
        } else {
            audio.push(c);
        }
    }
    var res = { video: null, track: -1, audio: audio };
    if (video) {
        var ti = skTrackIndexOf(seq.videoTracks, video);
        if (skIsGenerated(video)) {
            var orig = skFindOriginal(seq, video, ti);
            if (!orig) throw new Error('Original zum Skipper-Stück nicht gefunden.');
            res.video = orig.clip; res.track = orig.track;
        } else {
            res.video = video; res.track = ti;
        }
    }
    return res;
}

function skRemoveGenerated(seq, t0, t1, aboveTrack) {
    var removed = 0;
    for (var i = aboveTrack + 1; i < seq.videoTracks.numTracks; i++) {
        var cs = seq.videoTracks[i].clips;
        for (var j = cs.numItems - 1; j >= 0; j--) {
            var c = cs[j];
            if (skIsGenerated(c) && c.start.seconds < t1 - 1e-4 && c.end.seconds > t0 + 1e-4) {
                c.remove(false, false);
                removed++;
            }
        }
    }
    return removed;
}

function skFindClipAt(track, t, frame) {
    var cs = track.clips;
    for (var j = 0; j < cs.numItems; j++) {
        if (Math.abs(cs[j].start.seconds - t) < frame / 2) return cs[j];
    }
    return null;
}

// ------------------------------------------------------------------ QE (inoffizielle API)
function skQeSeq() {
    app.enableQE();
    return qe.project.getActiveSequence();
}

function skQeSecs(qt) {
    try { if (qt.secs !== undefined) return parseFloat(qt.secs); } catch (e) {}
    try { return parseFloat(qt.ticks) / TICKS_PER_SECOND; } catch (e2) {}
    return -1;
}

function skQeItemAt(qeTrack, t, frame) {
    for (var i = 0; i < qeTrack.numItems; i++) {
        var it = qeTrack.getItemAt(i);
        if (!it || it.type === 'Empty') continue;
        if (Math.abs(skQeSecs(it.start) - t) < frame / 2) return it;
    }
    return null;
}

function skSetSpeed(qeItem, clipGetter, speed, reverse) {
    var units = skipperSpeedUnit ? [skipperSpeedUnit] : [1, 100];
    for (var u = 0; u < units.length; u++) {
        try {
            qeItem.setSpeed(speed * units[u], '', reverse, false, false);
        } catch (e) { continue; }
        var clip = clipGetter();
        var got = 1;
        try { got = clip.getSpeed(); } catch (e2) { skipperSpeedUnit = units[u]; return clip; }
        if (Math.abs(Math.abs(got) - speed) < speed * 0.02 + 1e-4) {
            skipperSpeedUnit = units[u];
            return clip;
        }
    }
    return clipGetter();
}

function skTimecodeFrames(frames) {
    var f = String(Math.max(1, Math.round(frames)));
    if (f.length < 2) f = '0' + f;
    return '00;00;00;' + f;
}

// ------------------------------------------------------------------ Effekte
function skFindComponent(clip, matchNames, displayNames) {
    var comps = clip.components;
    for (var i = 0; i < comps.numItems; i++) {
        var c = comps[i], j;
        for (j = 0; j < matchNames.length; j++) if (c.matchName === matchNames[j]) return c;
        for (j = 0; j < displayNames.length; j++) if (c.displayName === displayNames[j]) return c;
    }
    return null;
}

function skAddKey(prop, t, value) {
    try { prop.addKey(t); } catch (e) { prop.addKey(skTime(t)); }
    try { prop.setValueAtKey(t, value, true); } catch (e2) { prop.setValueAtKey(skTime(t), value, true); }
}

function skKeyTime(clip, offset) {
    var speed = 1;
    if (SKIPPER_KEYS_SPEED_SCALED) {
        try { speed = Math.abs(clip.getSpeed()) || 1; } catch (e) {}
    }
    return clip.inPoint.seconds + offset * speed;
}

/** keys = [{t: Versatz ab Clip-Start in s, v: 0..1}] */
function skApplyOpacity(clip, keys) {
    if (!keys || !keys.length) return;
    var comp = skFindComponent(clip, ['AE.ADBE Opacity'], ['Opacity', 'Deckkraft']);
    if (!comp) return;
    var prop = comp.properties[0];
    var constant = true, i;
    for (i = 1; i < keys.length; i++) if (Math.abs(keys[i].v - keys[0].v) > 1e-4) constant = false;
    if (constant) {
        if (keys[0].v < 0.9999) prop.setValue(keys[0].v * 100, true);
        return;
    }
    prop.setTimeVarying(true);
    for (i = 0; i < keys.length; i++) skAddKey(prop, skKeyTime(clip, keys[i].t), keys[i].v * 100);
}

/** Volume-Gate auf einen Audioclip; keys = [{t: Sequenzzeit, v: 0..1}] */
function skApplyVolume(clip, keys) {
    var comp = skFindComponent(clip, ['audiovolume', 'ADBE Volume'], ['Volume', 'Lautstärke']);
    if (!comp) return false;
    var prop = null, i;
    for (i = 0; i < comp.properties.numItems; i++) {
        var dn = comp.properties[i].displayName;
        if (dn === 'Level' || dn === 'Pegel') prop = comp.properties[i];
    }
    if (!prop) prop = comp.properties[comp.properties.numItems > 1 ? 1 : 0];
    var base = 0.1778; // 0 dB
    try {
        if (!prop.isTimeVarying()) base = prop.getValue();
        else base = prop.getValueAtTime(clip.inPoint.seconds);
    } catch (e) {}
    prop.setTimeVarying(false); // alte Keyframes entfernen
    prop.setValue(base, true);
    prop.setTimeVarying(true);
    var s0 = clip.start.seconds, s1 = clip.end.seconds, inP = clip.inPoint.seconds;
    for (i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.t < s0 - 1e-4 || k.t > s1 + 1e-4) continue;
        skAddKey(prop, inP + (k.t - s0), base * k.v);
    }
    return true;
}

// ------------------------------------------------------------------ Öffentliche Funktionen
function skipperInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return skErr('Keine aktive Sequenz.');
        var s = skSelection(seq);
        var info = {
            frameDur: skFrameDur(seq),
            playhead: seq.getPlayerPosition().seconds,
            video: null,
            audio: []
        };
        if (s.video) {
            var v = s.video, speed = 1;
            try { speed = v.getSpeed(); } catch (e) {}
            info.video = {
                name: v.name, track: s.track,
                start: v.start.seconds, end: v.end.seconds,
                inPoint: v.inPoint.seconds, outPoint: v.outPoint.seconds,
                speed: speed
            };
        }
        for (var i = 0; i < s.audio.length; i++) {
            info.audio.push({ name: s.audio[i].name, start: s.audio[i].start.seconds, end: s.audio[i].end.seconds });
        }
        return skOk(info);
    } catch (e) {
        return skErr(e.message || e);
    }
}

/**
 * payload = {
 *   pieces: [{start, end, srcIn, srcOut, reverse, keys, jump}],
 *   audioKeys: [[{t, v}], …]  (je ausgewähltem Audioclip, gleiche Reihenfolge wie skipperInfo)
 *   gateVideo: bool, frameMode: 'sampling'|'blending'|'optical', jumpFrames: n
 * }
 */
function skipperBuild(payload) {
    var seq = app.project.activeSequence;
    if (!seq) return skErr('Keine aktive Sequenz.');
    var lockedAudio = [];
    var restoreIn = null, restoreOut = null, item = null;
    try {
        var s = skSelection(seq);
        var frame = skFrameDur(seq), i;
        var built = 0, warnings = [];

        if (s.video && payload.pieces && payload.pieces.length) {
            var orig = s.video;
            var t0 = orig.start.seconds, t1 = orig.end.seconds;
            item = orig.projectItem;
            if (!item) throw new Error('Clip hat kein Projekt-Element (verschachtelte Sequenz?).');

            skRemoveGenerated(seq, t0, t1, s.track);

            // freie Videospur über dem Original suchen, sonst eine anlegen
            var target = -1;
            for (i = s.track + 1; i < seq.videoTracks.numTracks; i++) {
                if (skRangeEmpty(seq.videoTracks[i], t0, t1, false)) { target = i; break; }
            }
            if (target < 0) {
                try { skQeSeq().addTracks(1, seq.videoTracks.numTracks, 0); } catch (eAdd) {}
                if (skRangeEmpty(seq.videoTracks[seq.videoTracks.numTracks - 1], t0, t1, false) &&
                    seq.videoTracks.numTracks - 1 > s.track) {
                    target = seq.videoTracks.numTracks - 1;
                }
            }
            if (target < 0) throw new Error('Keine freie Videospur über dem Clip. Bitte eine leere Videospur darüber anlegen.');
            var track = seq.videoTracks[target];

            // Audiospuren sperren, damit kein Ton überschrieben wird
            for (i = 0; i < seq.audioTracks.numTracks; i++) {
                var at = seq.audioTracks[i];
                try { if (!at.isLocked()) { at.setLocked(true); lockedAudio.push(at); } } catch (eL) {}
            }

            try { restoreIn = item.getInPoint(); restoreOut = item.getOutPoint(); } catch (eIO) {}

            var qeSeq = skQeSeq();
            var qeTrack = qeSeq.getVideoTrackAt(target);
            var transition = null;
            if (payload.jumpFrames > 0) {
                var names = ['Cross Dissolve', 'Weiche Blende', 'Überblendung'];
                for (i = 0; i < names.length && !transition; i++) {
                    try { transition = qe.project.getVideoTransitionByName(names[i]); } catch (eT) {}
                }
                if (!transition) warnings.push('Überblendung "Cross Dissolve" nicht gefunden, Jump dissolve übersprungen.');
            }

            for (i = 0; i < payload.pieces.length; i++) {
                var p = payload.pieces[i];
                var dur = p.end - p.start;
                var span = p.srcOut - p.srcIn;
                var speed = span / dur;

                item.setInPoint(p.srcIn, 4);
                item.setOutPoint(p.srcOut, 4);
                track.overwriteClip(item, skTime(p.start));

                var clip = skFindClipAt(track, p.start, frame);
                if (!clip) { warnings.push('Stück bei ' + p.start.toFixed(2) + ' s fehlt.'); continue; }

                // eventuell mitgekommenen Ton entfernen
                try {
                    var linked = clip.getLinkedItems();
                    for (var li = linked.numItems - 1; li >= 0; li--) {
                        if (linked[li].mediaType === 'Audio') linked[li].remove(false, false);
                    }
                } catch (eLk) {}

                var needSpeed = p.reverse || Math.abs(speed - 1) > 0.001;
                var qeItem = (needSpeed || payload.frameMode !== 'sampling' || (p.jump && transition))
                    ? skQeItemAt(qeTrack, p.start, frame) : null;

                if (needSpeed && qeItem) {
                    clip = skSetSpeed(qeItem, function () { return skFindClipAt(track, p.start, frame); }, speed, p.reverse);
                    if (!clip) { warnings.push('Speed bei ' + p.start.toFixed(2) + ' s fehlgeschlagen.'); continue; }
                }
                // exakte Länge sicherstellen
                if (Math.abs(clip.end.seconds - p.end) > frame / 2) {
                    try { clip.end = skTime(p.end); } catch (eEnd) {}
                }

                if (qeItem && payload.frameMode && payload.frameMode !== 'sampling') {
                    var mode = payload.frameMode === 'optical' ? 2 : 1;
                    try { qeItem.setTimeInterpolationType(mode); }
                    catch (eFm) { try { qeItem.setFrameBlend(true); } catch (eFb) {} }
                }

                clip.name = SKIPPER_MARK + orig.name;
                if (payload.gateVideo) skApplyOpacity(clip, p.keys);

                if (p.jump && transition && qeItem) {
                    try { qeItem.addTransition(transition, true, skTimecodeFrames(payload.jumpFrames)); } catch (eTr) {}
                }
                built++;
            }
            orig.disabled = true;
        }
        skUnlock(lockedAudio);

        // Volume-Gate auf ausgewählte Audioclips
        var audioDone = 0;
        if (payload.audioKeys) {
            for (i = 0; i < s.audio.length && i < payload.audioKeys.length; i++) {
                if (payload.audioKeys[i] && skApplyVolume(s.audio[i], payload.audioKeys[i])) audioDone++;
            }
        }
        return skOk({ built: built, audio: audioDone, warnings: warnings });
    } catch (e) {
        return skErr(e.message || e);
    } finally {
        if (item) {
            try {
                if (restoreIn) item.setInPoint(restoreIn.seconds, 4);
                if (restoreOut) item.setOutPoint(restoreOut.seconds, 4);
            } catch (eR) {}
        }
        skUnlock(lockedAudio);
    }
}

function skUnlock(list) {
    while (list.length) {
        try { list.pop().setLocked(false); } catch (eU) {}
    }
}

function skipperReset() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return skErr('Keine aktive Sequenz.');
        var s = skSelection(seq);
        if (!s.video) return skErr('Bitte den Clip (oder ein Skipper-Stück) auswählen.');
        var n = skRemoveGenerated(seq, s.video.start.seconds, s.video.end.seconds, s.track);
        s.video.disabled = false;
        return skOk({ removed: n });
    } catch (e) {
        return skErr(e.message || e);
    }
}
