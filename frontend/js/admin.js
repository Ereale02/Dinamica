/**
 * Kickoff IA — panel de administración.
 * Requiere window.UI (definido en app.js) y window.API.
 * Las credenciales (nombre + PIN) se guardan solo en sessionStorage:
 * se pierden al cerrar la pestaña y nunca viajan en la URL.
 */
(function () {
  'use strict';

  var CREDS_KEY = 'kickoff_admin';
  var UI = null;
  var creds = restore();
  var cache = { history: [], active: null, counts: null };

  function restore() {
    try { return JSON.parse(sessionStorage.getItem(CREDS_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function persist() {
    try { sessionStorage.setItem(CREDS_KEY, JSON.stringify(creds)); } catch (e) {}
  }
  function withCreds(obj) {
    return Object.assign({ name: creds ? creds.name : '', pin: creds ? creds.pin : '' }, obj || {});
  }

  /* ------------------------------ API ----------------------------- */
  function setCreds(name, pin) { creds = { name: name, pin: pin }; persist(); }
  function hasCreds() { return !!(creds && creds.pin); }

  function enter() {
    if (!hasCreds()) return;
    UI.showScreen('screen-admin');
    UI.$all('nav.bottom button').forEach(function (x) { x.classList.remove('active'); });
    var b = document.querySelector('nav.bottom button[data-nav="admin"]');
    if (b) b.classList.add('active');
    refresh();
  }

  function refresh() {
    if (!hasCreds()) return;
    return Promise.all([
      window.API.get('getState', {}),
      window.API.post('history', withCreds())
    ]).then(function (res) {
      cache.active = res[0].activeMeeting;
      cache.counts = res[0].counts;
      cache.history = res[1] || [];
      renderActive();
      renderHistory();
    }).catch(function (e) {
      UI.toast(e.message, true);
      if (/PIN|administrador/i.test(e.message || '')) {
        creds = null;
        try { sessionStorage.removeItem(CREDS_KEY); } catch (x) {}
        location.reload();
      }
    });
  }

  /* --------------------------- RENDER ----------------------------- */
  function renderActive() {
    var el = UI.$('#adminActive');
    var esc = UI.esc;

    if (!cache.active) {
      el.innerHTML =
        '<h2 class="section-title">Sin reunión activa</h2>' +
        '<p class="muted">Inicia una para que los participantes puedan registrarse y enviar ideas.</p>' +
        '<div class="field"><label for="newMeetingName">Nombre de la reunión</label>' +
        '<input type="text" id="newMeetingName" placeholder="Ej. Kickoff IA · ' +
        new Date().toLocaleDateString('es-MX') + '"></div>' +
        '<button class="primary" id="startMeetingBtn">Iniciar nueva reunión</button>';
      UI.$('#startMeetingBtn').addEventListener('click', startMeeting);
      return;
    }

    var m = cache.active;
    var c = cache.counts || { participantes: 0, ideas: 0 };
    el.innerHTML =
      '<h2 class="section-title">' + esc(m.nombre) + ' <span class="badge activa">activa</span></h2>' +
      '<p class="muted">Inició ' + UI.fmtDate(m.fecha_inicio) +
      (m.resumen_generado ? ' · resumen generado' : '') + '</p>' +
      '<div class="stat-row">' +
      '<div class="stat"><div class="v">' + c.participantes + '</div><div class="k">Participantes</div></div>' +
      '<div class="stat"><div class="v">' + c.ideas + '</div><div class="k">Ideas</div></div>' +
      '</div>' +
      '<button class="primary" id="genSummaryBtn">Generar resumen ahora</button>' +
      '<button class="ghost" id="viewActiveBtn">Ver detalle / exportar</button>' +
      '<div class="divider"></div>' +
      '<button class="danger" id="endMeetingBtn">Terminar reunión</button>';

    UI.$('#genSummaryBtn').addEventListener('click', function () {
      window.API.post('generateSummary', withCreds())
        .then(function () { UI.toast('Resumen generado.'); refresh(); })
        .catch(function (e) { UI.toast(e.message, true); });
    });
    UI.$('#viewActiveBtn').addEventListener('click', function () { openDetail(m.id); });
    UI.$('#endMeetingBtn').addEventListener('click', function () {
      if (!confirm('¿Terminar la reunión? No se aceptarán más ideas ni votos.')) return;
      window.API.post('endMeeting', withCreds())
        .then(function () { UI.toast('Reunión cerrada.'); refresh(); })
        .catch(function (e) { UI.toast(e.message, true); });
    });
  }

  function startMeeting() {
    var name = (UI.$('#newMeetingName').value || '').trim();
    var btn = UI.$('#startMeetingBtn');
    btn.disabled = true;
    window.API.post('startMeeting', withCreds({ nombre: name }))
      .then(function () { UI.toast('Reunión iniciada.'); refresh(); })
      .catch(function (e) { UI.toast(e.message, true); btn.disabled = false; });
  }

  function renderHistory() {
    var el = UI.$('#adminHistory');
    var esc = UI.esc;
    if (!cache.history.length) {
      el.innerHTML = '<div class="empty">Aún no hay reuniones registradas.</div>';
      return;
    }
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.gap = '10px';
    el.innerHTML = cache.history.map(function (h) {
      return '<div class="hist-item" data-id="' + esc(h.id) + '">' +
        '<div class="name">' + esc(h.nombre) +
        ' <span class="badge ' + esc(h.estado) + '">' + esc(h.estado) + '</span></div>' +
        '<div class="muted">' + UI.fmtDate(h.fecha_inicio) +
        ' · ' + h.participantes + ' participantes · ' + h.ideas + ' ideas</div>' +
        '</div>';
    }).join('');
    UI.$all('.hist-item', el).forEach(function (it) {
      it.addEventListener('click', function () { openDetail(it.dataset.id); });
    });
  }

  /* --------------------------- DETAIL ----------------------------- */
  function openDetail(meetingId) {
    window.API.post('meetingDetail', withCreds({ meetingId: meetingId }))
      .then(function (d) { renderDetail(d); UI.showScreen('screen-detail'); })
      .catch(function (e) { UI.toast(e.message, true); });
  }

  function renderDetail(d) {
    var esc = UI.esc;
    var m = d.meeting;
    var s = d.summary;
    var teams = ['Macarita', 'PastelIA'];
    var colors = { Macarita: 'var(--macarita)', PastelIA: 'var(--pastelia)' };

    var top = teams.map(function (team) {
      var rows = s && s.equipos && s.equipos[team] && s.equipos[team].length
        ? s.equipos[team].map(function (e, i) {
            return '<div class="idea-card rank"><div class="n" style="color:' + colors[team] + '">' +
              (i + 1) + '</div><div style="flex:1;"><div class="who">' + esc(e.autor) +
              ' · ' + e.votos + ' voto' + (e.votos === 1 ? '' : 's') + '</div><div class="text">' +
              esc(e.texto) + '</div></div></div>';
          }).join('')
        : '<div class="empty">Sin datos.</div>';
      return '<h3 class="section-title" style="color:' + colors[team] + '">Equipo ' + team + ' · top 5</h3>' + rows;
    }).join('');

    UI.$('#detailBody').innerHTML =
      '<h2 class="section-title">' + esc(m.nombre) +
      ' <span class="badge ' + esc(m.estado) + '">' + esc(m.estado) + '</span></h2>' +
      '<p class="muted">' + UI.fmtDate(m.fecha_inicio) + ' → ' + UI.fmtDate(m.fecha_fin) + '</p>' +
      (s ? '<div class="stat-row">' +
        '<div class="stat"><div class="v">' + s.total_participantes + '</div><div class="k">Participantes</div></div>' +
        '<div class="stat"><div class="v">' + s.total_ideas + '</div><div class="k">Ideas</div></div>' +
        '<div class="stat"><div class="v">' + s.total_votos + '</div><div class="k">Votos</div></div>' +
        '</div>' : '<p class="muted">Resumen no generado todavía.</p>') +
      top +
      '<div class="divider"></div>' +
      '<button class="primary" id="exportCsvBtn" data-id="' + esc(m.id) + '">Descargar CSV</button>' +
      '<button class="ghost" id="printBtn">Imprimir / Guardar como PDF</button>';

    UI.$('#exportCsvBtn').addEventListener('click', function () { exportCsv(m.id); });
    UI.$('#printBtn').addEventListener('click', function () { window.print(); });
  }

  function exportCsv(meetingId) {
    window.API.post('exportMeeting', withCreds({ meetingId: meetingId }))
      .then(function (r) {
        var blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = r.filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      })
      .catch(function (e) { UI.toast(e.message, true); });
  }

  /* ---------------------------- INIT ------------------------------ */
  function init() {
    UI = window.UI;
    var back = UI.$('#detailBack');
    if (back) back.addEventListener('click', function () { enter(); });
  }

  window.Admin = {
    init: init, enter: enter, refresh: refresh,
    setCreds: setCreds, hasCreds: hasCreds
  };
})();
