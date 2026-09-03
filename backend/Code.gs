/**
 * Kickoff IA — Backend (Google Apps Script Web App)
 * ------------------------------------------------------------------
 * Small REST-ish API over a Google Sheet. The frontend NEVER talks to
 * the sheet directly: every read/write goes through this Web App so the
 * business rules (one active meeting, one vote per idea, frozen summary,
 * admin PIN) are enforced server-side.
 *
 * DEPLOY
 *   1. Create a Google Sheet. Extensions > Apps Script.
 *   2. Paste this file as `Code.gs`, paste `appsscript.json` too.
 *   3. Project Settings > Script Properties:
 *        ADMIN_PIN   = <4-6 digit pin>            (required)
 *        ADMIN_NAME  = Erendira Alejandra Hernández Loza   (optional; this is the default)
 *   4. Deploy > New deployment > Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *   5. Copy the /exec URL into frontend/js/config.js -> API_URL
 *
 * The sheets (Reuniones, Participantes, Ideas, Votos) are created
 * automatically on first request.
 */

var HEADERS = {
  Reuniones:     ['id_reunion', 'nombre', 'fecha_inicio', 'fecha_fin', 'estado', 'resumen_generado', 'resumen_json'],
  Participantes: ['id_participante', 'id_reunion', 'nombre', 'equipo', 'fecha_registro'],
  Ideas:         ['id_idea', 'id_reunion', 'id_participante', 'equipo', 'texto', 'fecha'],
  Votos:         ['id_voto', 'id_reunion', 'id_idea', 'id_participante_que_vota', 'fecha']
};

var TEAMS = ['Macarita', 'PastelIA'];
var LOCK_MS = 20000;

/* ============================ ROUTER ============================ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  return route(p.action || '', p);
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
  return route(body.action || '', body);
}

function route(action, params) {
  try {
    var data;
    switch (action) {
      case 'getState':        data = getState(params); break;
      case 'join':            data = join(params); break;
      case 'submitIdeas':     data = submitIdeas(params); break;
      case 'getBoard':        data = getBoard(params); break;
      case 'toggleVote':      data = toggleVote(params); break;

      case 'adminLogin':      data = adminLogin(params); break;
      case 'startMeeting':    data = withAdmin(params, startMeeting); break;
      case 'endMeeting':      data = withAdmin(params, endMeeting); break;
      case 'generateSummary': data = withAdmin(params, generateSummary); break;
      case 'history':         data = withAdmin(params, history); break;
      case 'meetingDetail':   data = withAdmin(params, meetingDetail); break;
      case 'exportMeeting':   data = withAdmin(params, exportMeeting); break;

      default: throw new Error('Acción desconocida: "' + action + '"');
    }
    return json({ ok: true, data: data });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ======================= SHEET HELPERS ========================= */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var headers = HEADERS[name];
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  if (first.join('') === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i].join('') === '') continue;
    var row = {};
    for (var c = 0; c < headers.length; c++) row[headers[c]] = values[i][c];
    row._row = i + 1;
    out.push(row);
  }
  return out;
}

function append_(name, obj) {
  var sh = sheet_(name);
  var rec = HEADERS[name].map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sh.appendRow(rec);
}

function setCell_(name, rowNumber, header, value) {
  var col = HEADERS[name].indexOf(header) + 1;
  sheet_(name).getRange(rowNumber, col).setValue(value);
}

function deleteRow_(name, rowNumber) {
  sheet_(name).deleteRow(rowNumber);
}

function id_(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function now_() { return new Date().toISOString(); }

function norm_(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function lock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/* ========================= ADMIN AUTH ========================== */

function props_() { return PropertiesService.getScriptProperties(); }
function adminPin_() { return String(props_().getProperty('ADMIN_PIN') || ''); }
function adminName_() {
  return props_().getProperty('ADMIN_NAME') || 'Erendira Alejandra Hernández Loza';
}

function adminLogin(params) {
  var pin = adminPin_();
  if (!pin) throw new Error('El PIN de administrador no está configurado en el servidor.');
  if (norm_(params.name) !== norm_(adminName_())) throw new Error('Ese nombre no tiene acceso de administrador.');
  if (String(params.pin || '') !== pin) throw new Error('PIN incorrecto.');
  return { name: adminName_() };
}

/** Wrap an admin-only handler: validates name + pin, then runs it. */
function withAdmin(params, fn) {
  adminLogin(params); // throws on failure
  return fn(params);
}

/* ==================== MEETING LIFECYCLE ======================== */

function activeMeeting_() {
  var rows = readAll_('Reuniones');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].estado) === 'activa') return rows[i];
  }
  return null;
}

function meetingById_(mid) {
  var rows = readAll_('Reuniones');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id_reunion) === String(mid)) return rows[i];
  }
  return null;
}

function publicMeeting_(m) {
  if (!m) return null;
  return {
    id: m.id_reunion,
    nombre: m.nombre,
    estado: m.estado,
    fecha_inicio: m.fecha_inicio,
    fecha_fin: m.fecha_fin,
    resumen_generado: String(m.resumen_generado) === 'sí'
  };
}

function startMeeting(params) {
  return lock_(function () {
    if (activeMeeting_()) throw new Error('Ya hay una reunión activa. Termínala antes de iniciar otra.');
    var name = String(params.nombre || '').trim() || ('Reunión ' + new Date().toLocaleDateString('es-MX'));
    var mid = id_('m');
    append_('Reuniones', {
      id_reunion: mid,
      nombre: name,
      fecha_inicio: now_(),
      fecha_fin: '',
      estado: 'activa',
      resumen_generado: 'no',
      resumen_json: ''
    });
    return publicMeeting_(meetingById_(mid));
  });
}

function endMeeting(params) {
  return lock_(function () {
    var m = params.meetingId ? meetingById_(params.meetingId) : activeMeeting_();
    if (!m) throw new Error('No hay reunión que terminar.');
    if (String(m.estado) === 'cerrada' && !params.force) {
      return { meeting: publicMeeting_(m), summary: parseSummary_(m) };
    }
    setCell_('Reuniones', m._row, 'estado', 'cerrada');
    setCell_('Reuniones', m._row, 'fecha_fin', now_());
    var summary = parseSummary_(m);
    if (String(m.resumen_generado) !== 'sí') {
      summary = computeSummary_(m.id_reunion);
      setCell_('Reuniones', m._row, 'resumen_json', JSON.stringify(summary));
      setCell_('Reuniones', m._row, 'resumen_generado', 'sí');
    }
    return { meeting: publicMeeting_(meetingById_(m.id_reunion)), summary: summary };
  });
}

function generateSummary(params) {
  return lock_(function () {
    var m = params.meetingId ? meetingById_(params.meetingId) : activeMeeting_();
    if (!m) throw new Error('No hay reunión activa para resumir.');
    var summary = computeSummary_(m.id_reunion);
    setCell_('Reuniones', m._row, 'resumen_json', JSON.stringify(summary));
    setCell_('Reuniones', m._row, 'resumen_generado', 'sí');
    return { meeting: publicMeeting_(meetingById_(m.id_reunion)), summary: summary };
  });
}

function parseSummary_(m) {
  if (!m || !m.resumen_json) return null;
  try { return JSON.parse(m.resumen_json); } catch (e) { return null; }
}

function computeSummary_(mid) {
  var parts = readAll_('Participantes').filter(function (p) { return String(p.id_reunion) === String(mid); });
  var ideas = readAll_('Ideas').filter(function (i) { return String(i.id_reunion) === String(mid); });
  var votes = readAll_('Votos').filter(function (v) { return String(v.id_reunion) === String(mid); });

  var pmap = {};
  parts.forEach(function (p) { pmap[p.id_participante] = p.nombre; });

  var tally = {};
  votes.forEach(function (v) { tally[v.id_idea] = (tally[v.id_idea] || 0) + 1; });

  var equipos = {};
  TEAMS.forEach(function (team) {
    equipos[team] = ideas
      .filter(function (i) { return String(i.equipo) === team; })
      .map(function (i) {
        return { id: i.id_idea, texto: i.texto, autor: pmap[i.id_participante] || '—', votos: tally[i.id_idea] || 0 };
      })
      .sort(function (a, b) { return b.votos - a.votos; })
      .slice(0, 5);
  });

  return {
    generado_en: now_(),
    total_participantes: parts.length,
    total_ideas: ideas.length,
    total_votos: votes.length,
    equipos: equipos
  };
}

/* ==================== PARTICIPANT FLOWS ======================== */

function getState(params) {
  var m = activeMeeting_();
  var out = { activeMeeting: publicMeeting_(m), isAdminName: norm_(params.name) === norm_(adminName_()) };

  if (m) {
    var parts = readAll_('Participantes').filter(function (p) { return String(p.id_reunion) === String(m.id_reunion); });
    var ideas = readAll_('Ideas').filter(function (i) { return String(i.id_reunion) === String(m.id_reunion); });
    out.counts = { participantes: parts.length, ideas: ideas.length };
  } else {
    out.counts = { participantes: 0, ideas: 0 };
  }

  if (params.participantId) {
    var me = findParticipant_(params.participantId);
    if (me) {
      out.participant = { id: me.id_participante, nombre: me.nombre, equipo: me.equipo, id_reunion: me.id_reunion };
      out.hasSubmittedIdeas = readAll_('Ideas').some(function (i) {
        return String(i.id_participante) === String(me.id_participante);
      });
      out.inActiveMeeting = !!(m && String(me.id_reunion) === String(m.id_reunion));
    }
  }
  return out;
}

function findParticipant_(pid) {
  var rows = readAll_('Participantes');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id_participante) === String(pid)) return rows[i];
  }
  return null;
}

function join(params) {
  return lock_(function () {
    var m = activeMeeting_();
    if (!m) throw new Error('Aún no hay una reunión activa.');
    var name = String(params.name || '').trim();
    var team = String(params.team || '').trim();
    if (!name) throw new Error('Escribe tu nombre.');
    if (TEAMS.indexOf(team) === -1) throw new Error('Elige un equipo válido.');

    var pid = id_('p');
    append_('Participantes', {
      id_participante: pid,
      id_reunion: m.id_reunion,
      nombre: name,
      equipo: team,
      fecha_registro: now_()
    });
    return { participantId: pid, meeting: publicMeeting_(m), team: team, name: name };
  });
}

function submitIdeas(params) {
  return lock_(function () {
    var m = activeMeeting_();
    if (!m) throw new Error('La reunión no está activa.');
    var me = findParticipant_(params.participantId);
    if (!me) throw new Error('No encontramos tu registro. Vuelve a unirte.');
    if (String(me.id_reunion) !== String(m.id_reunion)) throw new Error('Tu registro es de otra reunión.');

    var ideas = (params.ideas || [])
      .map(function (t) { return String(t || '').trim(); })
      .filter(Boolean)
      .slice(0, 3);
    if (!ideas.length) throw new Error('Escribe al menos una idea.');

    // Replace this participant's previous ideas (allows editing before close).
    readAll_('Ideas')
      .filter(function (i) { return String(i.id_participante) === String(me.id_participante); })
      .sort(function (a, b) { return b._row - a._row; })
      .forEach(function (i) { deleteRow_('Ideas', i._row); });

    ideas.forEach(function (text) {
      append_('Ideas', {
        id_idea: id_('i'),
        id_reunion: m.id_reunion,
        id_participante: me.id_participante,
        equipo: me.equipo,
        texto: text,
        fecha: now_()
      });
    });
    return { count: ideas.length };
  });
}

function getBoard(params) {
  var m = params.meetingId ? meetingById_(params.meetingId) : activeMeeting_();
  if (!m) return { meeting: null, ideas: [], myVotes: [] };
  var mid = m.id_reunion || m.id;

  var parts = readAll_('Participantes').filter(function (p) { return String(p.id_reunion) === String(mid); });
  var ideas = readAll_('Ideas').filter(function (i) { return String(i.id_reunion) === String(mid); });
  var votes = readAll_('Votos').filter(function (v) { return String(v.id_reunion) === String(mid); });

  var pmap = {};
  parts.forEach(function (p) { pmap[p.id_participante] = p.nombre; });

  var tally = {};
  votes.forEach(function (v) { tally[v.id_idea] = (tally[v.id_idea] || 0) + 1; });

  var myVotes = votes
    .filter(function (v) { return String(v.id_participante_que_vota) === String(params.participantId || ''); })
    .map(function (v) { return v.id_idea; });

  var list = ideas.map(function (i) {
    return {
      id: i.id_idea,
      equipo: i.equipo,
      texto: i.texto,
      autor: pmap[i.id_participante] || '—',
      votos: tally[i.id_idea] || 0
    };
  });

  if (params.team) list = list.filter(function (i) { return String(i.equipo) === String(params.team); });

  return { meeting: publicMeeting_(meetingById_(mid)), ideas: list, myVotes: myVotes };
}

function toggleVote(params) {
  return lock_(function () {
    var m = activeMeeting_();
    if (!m) throw new Error('La reunión no está activa.');
    var me = findParticipant_(params.participantId);
    if (!me) throw new Error('No encontramos tu registro.');
    if (String(me.id_reunion) !== String(m.id_reunion)) throw new Error('Tu registro es de otra reunión.');

    var idea = null;
    var ideas = readAll_('Ideas');
    for (var i = 0; i < ideas.length; i++) {
      if (String(ideas[i].id_idea) === String(params.ideaId)) { idea = ideas[i]; break; }
    }
    if (!idea) throw new Error('Esa idea ya no existe.');
    if (String(idea.equipo) !== String(me.equipo)) throw new Error('Solo puedes votar ideas de tu equipo.');

    var existing = readAll_('Votos').filter(function (v) {
      return String(v.id_idea) === String(params.ideaId) &&
             String(v.id_participante_que_vota) === String(me.id_participante);
    });

    var voted;
    if (existing.length) {
      existing.sort(function (a, b) { return b._row - a._row; })
        .forEach(function (v) { deleteRow_('Votos', v._row); });
      voted = false;
    } else {
      append_('Votos', {
        id_voto: id_('v'),
        id_reunion: m.id_reunion,
        id_idea: params.ideaId,
        id_participante_que_vota: me.id_participante,
        fecha: now_()
      });
      voted = true;
    }

    var count = readAll_('Votos').filter(function (v) {
      return String(v.id_idea) === String(params.ideaId);
    }).length;

    return { voted: voted, votos: count, ideaId: params.ideaId };
  });
}

/* ========================= ADMIN VIEWS ========================= */

function history(params) {
  var meetings = readAll_('Reuniones');
  var parts = readAll_('Participantes');
  var ideas = readAll_('Ideas');
  return meetings.map(function (m) {
    return {
      id: m.id_reunion,
      nombre: m.nombre,
      fecha_inicio: m.fecha_inicio,
      fecha_fin: m.fecha_fin,
      estado: m.estado,
      resumen_generado: String(m.resumen_generado) === 'sí',
      participantes: parts.filter(function (p) { return String(p.id_reunion) === String(m.id_reunion); }).length,
      ideas: ideas.filter(function (i) { return String(i.id_reunion) === String(m.id_reunion); }).length
    };
  }).sort(function (a, b) { return String(b.fecha_inicio).localeCompare(String(a.fecha_inicio)); });
}

function meetingDetail(params) {
  var m = meetingById_(params.meetingId);
  if (!m) throw new Error('Reunión no encontrada.');
  var board = getBoard({ meetingId: m.id_reunion });
  return {
    meeting: publicMeeting_(m),
    participantes: readAll_('Participantes')
      .filter(function (p) { return String(p.id_reunion) === String(m.id_reunion); })
      .map(function (p) { return { nombre: p.nombre, equipo: p.equipo, fecha: p.fecha_registro }; }),
    ideas: board.ideas,
    summary: parseSummary_(m)
  };
}

function exportMeeting(params) {
  var m = meetingById_(params.meetingId);
  if (!m) throw new Error('Reunión no encontrada.');
  var mid = m.id_reunion;

  var parts = readAll_('Participantes').filter(function (p) { return String(p.id_reunion) === String(mid); });
  var ideas = readAll_('Ideas').filter(function (i) { return String(i.id_reunion) === String(mid); });
  var votes = readAll_('Votos').filter(function (v) { return String(v.id_reunion) === String(mid); });
  var pmap = {}; parts.forEach(function (p) { pmap[p.id_participante] = p.nombre; });
  var tally = {}; votes.forEach(function (v) { tally[v.id_idea] = (tally[v.id_idea] || 0) + 1; });
  var summary = parseSummary_(m) || computeSummary_(mid);

  var L = [];
  L.push('REUNIÓN');
  L.push(csvRow_(['id', 'nombre', 'estado', 'fecha_inicio', 'fecha_fin']));
  L.push(csvRow_([m.id_reunion, m.nombre, m.estado, m.fecha_inicio, m.fecha_fin]));
  L.push('');
  L.push('PARTICIPANTES (' + parts.length + ')');
  L.push(csvRow_(['nombre', 'equipo', 'fecha_registro']));
  parts.forEach(function (p) { L.push(csvRow_([p.nombre, p.equipo, p.fecha_registro])); });
  L.push('');
  L.push('IDEAS (' + ideas.length + ')');
  L.push(csvRow_(['equipo', 'autor', 'idea', 'votos']));
  ideas.sort(function (a, b) { return (tally[b.id_idea] || 0) - (tally[a.id_idea] || 0); })
    .forEach(function (i) {
      L.push(csvRow_([i.equipo, pmap[i.id_participante] || '—', i.texto, tally[i.id_idea] || 0]));
    });
  L.push('');
  L.push('VOTOS (' + votes.length + ')');
  L.push(csvRow_(['idea', 'equipo', 'votante', 'fecha']));
  var imap = {}; ideas.forEach(function (i) { imap[i.id_idea] = i; });
  votes.forEach(function (v) {
    var i = imap[v.id_idea] || {};
    L.push(csvRow_([i.texto || '(idea eliminada)', i.equipo || '', pmap[v.id_participante_que_vota] || '—', v.fecha]));
  });
  L.push('');
  L.push('RESUMEN');
  L.push(csvRow_(['total_participantes', summary.total_participantes]));
  L.push(csvRow_(['total_ideas', summary.total_ideas]));
  L.push(csvRow_(['total_votos', summary.total_votos]));
  TEAMS.forEach(function (team) {
    L.push('');
    L.push('TOP 5 · ' + team);
    L.push(csvRow_(['#', 'autor', 'idea', 'votos']));
    (summary.equipos[team] || []).forEach(function (e, idx) {
      L.push(csvRow_([idx + 1, e.autor, e.texto, e.votos]));
    });
  });

  var safe = String(m.nombre || 'reunion').replace(/[^a-z0-9\-_]+/gi, '_').slice(0, 40);
  return { filename: 'kickoff-ia_' + safe + '.csv', csv: '﻿' + L.join('\r\n') };
}

function csvRow_(arr) {
  return arr.map(function (cell) {
    var s = String(cell === null || cell === undefined ? '' : cell);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }).join(',');
}
