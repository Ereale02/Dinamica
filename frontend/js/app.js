/**
 * Kickoff IA — controlador principal (participante).
 * El panel de administración vive en admin.js y reusa window.UI.
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var SESSION_KEY = 'kickoff_session';

  var state = {
    session: load(),          // { participantId, name, team, meetingId } | null
    meeting: null,            // reunión activa pública | null
    view: 'team',             // pestaña del tablero
    board: { ideas: [], myVotes: [], maxVotes: 2 },
    poll: null,
    votePending: 0           // votos en vuelo: pausa el polling para no pisar el estado optimista
  };

  /* ----------------------------- utils ----------------------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function load() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(state.session)); } catch (e) {}
  }
  function clearSession() {
    state.session = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }
  function norm(s) {
    return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  function showScreen(id) {
    $all('.screen').forEach(function (s) { s.classList.remove('active'); });
    var el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  // compartido con admin.js
  window.UI = { showScreen: showScreen, toast: toast, esc: esc, fmtDate: fmtDate, $: $, $all: $all };

  /* --------------------------- polling ---------------------------- */
  function startPoll() {
    stopPoll();
    state.poll = setInterval(tick, CFG.POLL_MS);
  }
  function stopPoll() {
    if (state.poll) { clearInterval(state.poll); state.poll = null; }
  }
  function tick() {
    var active = document.querySelector('.screen.active');
    var id = active && active.id;
    if (id === 'screen-board') { refreshBoard(); refreshMeeting(); }
    else if (id === 'screen-join') { bootRoute(); }
    else if (id === 'screen-admin' && window.Admin) { window.Admin.refresh(); }
  }

  /* ------------------------- data helpers ------------------------- */
  function refreshMeeting() {
    return API.get('getState', {}).then(function (s) {
      state.meeting = s.activeMeeting;
      $('#shareFab').style.display = s.activeMeeting ? 'block' : 'none';
    }).catch(function () {});
  }

  function refreshBoard() {
    if (!state.session) return Promise.resolve();
    if (state.votePending > 0) return Promise.resolve(); // hay un voto en vuelo: no pises el estado optimista
    return API.get('getBoard', { participantId: state.session.participantId })
      .then(function (b) {
        if (state.votePending > 0) return; // llegó tarde
        state.board = b;
        renderTeamView();
        renderResultsView();
      })
      .catch(function (e) { console.warn(e); });
  }

  /* ----------------------------- JOIN ----------------------------- */
  var joinTeam = '';

  function initJoin() {
    var nameInput = $('#nameInput');
    var pinInput = $('#pinInput');

    $all('.team-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $all('.team-btn').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        joinTeam = btn.dataset.team;
        checkReady();
      });
    });

    nameInput.addEventListener('input', function () {
      var isAdmin = norm(nameInput.value) === norm(CFG.ADMIN_NAME);
      $('#pinField').style.display = isAdmin ? 'flex' : 'none';
      $('#teamField').style.display = isAdmin ? 'none' : 'flex';
      $('#joinBtn').textContent = isAdmin ? 'Entrar como administradora' : 'Continuar';
      checkReady();
    });
    pinInput.addEventListener('input', checkReady);

    $('#joinBtn').addEventListener('click', doJoin);
  }

  function checkReady() {
    var name = $('#nameInput').value.trim();
    var isAdmin = norm(name) === norm(CFG.ADMIN_NAME);
    var ok = isAdmin
      ? (name && $('#pinInput').value.trim().length >= 4)
      : (name && joinTeam && state.meeting);
    $('#joinBtn').disabled = !ok;
  }

  function doJoin() {
    var name = $('#nameInput').value.trim();
    var btn = $('#joinBtn');
    btn.disabled = true;

    if (norm(name) === norm(CFG.ADMIN_NAME)) {
      var pin = $('#pinInput').value.trim();
      API.post('adminLogin', { name: name, pin: pin })
        .then(function () {
          window.Admin.setCreds(name, pin);
          $('#navAdmin').style.display = 'block';
          $('#bottomNav').style.display = 'flex';
          window.Admin.enter();
        })
        .catch(function (e) { toast(e.message, true); btn.disabled = false; });
      return;
    }

    API.post('join', { name: name, team: joinTeam })
      .then(function (r) {
        state.session = {
          participantId: r.participantId,
          name: r.name,
          team: r.team,
          meetingId: r.meeting.id
        };
        save();
        $('#headerTitle').textContent = 'Equipo ' + r.team;
        $('#bottomNav').style.display = 'flex';
        goToIdeas();
      })
      .catch(function (e) { toast(e.message, true); btn.disabled = false; });
  }

  /* ----------------------------- IDEAS ---------------------------- */
  function initIdeas() {
    $('#submitIdeasBtn').addEventListener('click', function () {
      if (!state.session) { toast('Primero únete a un equipo.', true); return; }
      var ideas = $all('.ideaInput').map(function (i) { return i.value.trim(); }).filter(Boolean);
      if (!ideas.length) { toast('Escribe al menos una idea.', true); return; }
      var btn = $('#submitIdeasBtn');
      btn.disabled = true; btn.textContent = 'Guardando…';
      API.post('submitIdeas', {
        participantId: state.session.participantId,
        ideas: ideas
      })
        .then(function () {
          btn.disabled = false; btn.textContent = 'Actualizar mis ideas';
          $('#ideasHint').textContent = 'Guardado. Puedes editarlas mientras la reunión siga activa.';
          goToBoard();
        })
        .catch(function (e) {
          btn.disabled = false; btn.textContent = 'Compartir con mi equipo';
          toast(e.message, true);
        });
    });
  }

  /* --------------------------- NAV / TABS ------------------------- */
  function initNav() {
    $all('nav.bottom button').forEach(function (b) {
      b.addEventListener('click', function () {
        var nav = b.dataset.nav;
        if (nav === 'ideas') goToIdeas();
        else if (nav === 'board') goToBoard();
        else if (nav === 'admin' && window.Admin) window.Admin.enter();
        setNav(nav);
      });
    });

    $all('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        $all('.tab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        state.view = t.dataset.view;
        $('#boardTeamView').style.display = state.view === 'team' ? 'flex' : 'none';
        $('#boardResultsView').style.display = state.view === 'results' ? 'block' : 'none';
      });
    });
    $('#boardTeamView').style.display = 'flex';
    $('#boardTeamView').style.flexDirection = 'column';
    $('#boardTeamView').style.gap = '10px';
    $('#boardResultsView').style.gap = '4px';
  }

  function setNav(nav) {
    $all('nav.bottom button').forEach(function (x) { x.classList.remove('active'); });
    var b = document.querySelector('nav.bottom button[data-nav="' + nav + '"]');
    if (b) b.classList.add('active');
  }

  function goToIdeas() { showScreen('screen-ideas'); setNav('ideas'); }
  function goToBoard() {
    showScreen('screen-board'); setNav('board');
    refreshBoard(); refreshMeeting();
  }

  /* --------------------------- RENDERERS -------------------------- */
  function renderTeamView() {
    var el = $('#boardTeamView');
    var team = state.session && state.session.team;
    var mineTeam = (state.board.ideas || []).filter(function (i) { return i.equipo === team; });
    if (!mineTeam.length) {
      el.innerHTML = '<div class="empty">Aún no hay ideas de tu equipo. Sé la primera en compartir.</div>';
      return;
    }
    var voteSet = {};
    (state.board.myVotes || []).forEach(function (k) { voteSet[k] = true; });
    var closed = state.board.meeting && state.board.meeting.estado !== 'activa';
    var maxVotes = state.board.maxVotes || 2;
    var used = (state.board.myVotes || []).length;
    var left = Math.max(0, maxVotes - used);

    var header = closed
      ? '<div class="muted" style="padding:2px 2px 6px;">Votación cerrada.</div>'
      : '<div class="muted" style="padding:2px 2px 6px;">Te quedan <b>' + left + '</b> de ' + maxVotes +
        ' votos · no puedes votar tus propias ideas.</div>';

    el.innerHTML = header + mineTeam.map(function (e) {
      var voted = !!voteSet[e.id];
      var atLimit = !voted && used >= maxVotes;
      var control = e.mine
        ? '<span class="muted" style="font-size:12px;font-weight:600;">Tu idea</span>'
        : '<button class="vote-btn ' + (voted ? 'voted' : '') + '" data-key="' + esc(e.id) + '"' +
          ((closed || atLimit) ? ' disabled' : '') + '>&#9829; ' + e.votos + '</button>';
      return '<div class="idea-card">' +
        '<div class="who">' + esc(e.autor) + '</div>' +
        '<div class="text">' + esc(e.texto) + '</div>' +
        '<div class="row"><span></span>' + control + '</div></div>';
    }).join('');

    $all('.vote-btn', el).forEach(function (btn) {
      if (btn.disabled) return;
      btn.addEventListener('click', function () { toggleVote(btn.dataset.key); });
    });
  }

  function toggleVote(ideaId) {
    if (!state.session) return;
    var ideas = state.board.ideas || [];
    var idea = null;
    for (var i = 0; i < ideas.length; i++) { if (ideas[i].id === ideaId) { idea = ideas[i]; break; } }
    if (!idea) return;
    if (idea.mine) { toast('No puedes votar tus propias ideas.', true); return; }

    var myVotes = (state.board.myVotes || []).slice();
    var maxVotes = state.board.maxVotes || 2;
    var have = myVotes.indexOf(ideaId) !== -1;
    if (!have && myVotes.length >= maxVotes) {
      toast('Solo puedes votar ' + maxVotes + ' ideas. Quita un voto para cambiar.', true);
      return;
    }

    // --- actualización optimista: el corazón cambia al instante ---
    var prevVotes = myVotes.slice();
    var prevCount = idea.votos;
    if (have) {
      state.board.myVotes = myVotes.filter(function (k) { return k !== ideaId; });
      idea.votos = Math.max(0, idea.votos - 1);
    } else {
      state.board.myVotes = myVotes.concat([ideaId]);
      idea.votos = idea.votos + 1;
    }
    renderTeamView();
    renderResultsView();

    state.votePending++;
    API.post('toggleVote', { participantId: state.session.participantId, ideaId: ideaId })
      .then(function (r) {
        if (typeof r.votos === 'number') idea.votos = r.votos;
        var set = (state.board.myVotes || []).filter(function (k) { return k !== ideaId; });
        if (r.voted) set.push(ideaId);
        state.board.myVotes = set;
      })
      .catch(function (e) {
        state.board.myVotes = prevVotes;   // revertir
        idea.votos = prevCount;
        toast(e.message, true);
      })
      .then(function () {
        state.votePending = Math.max(0, state.votePending - 1);
        renderTeamView();
        renderResultsView();
      });
  }

  function topByTeam(team) {
    return (state.board.ideas || [])
      .filter(function (i) { return i.equipo === team; })
      .slice()
      .sort(function (a, b) { return b.votos - a.votos; })
      .slice(0, 5);
  }

  function rankRows(entries, color) {
    if (!entries.length) return '<div class="empty">Sin ideas todavía.</div>';
    return entries.map(function (e, i) {
      return '<div class="idea-card rank">' +
        '<div class="n" style="color:' + color + '">' + (i + 1) + '</div>' +
        '<div style="flex:1;">' +
        '<div class="who">' + esc(e.autor) + ' · ' + e.votos + ' voto' + (e.votos === 1 ? '' : 's') + '</div>' +
        '<div class="text">' + esc(e.texto) + '</div>' +
        '</div></div>';
    }).join('');
  }

  function renderResultsView() {
    var el = $('#boardResultsView');
    el.innerHTML =
      '<h3 class="section-title" style="color:var(--macarita)">Equipo Macarita · top 5</h3>' +
      rankRows(topByTeam('Macarita'), 'var(--macarita)') +
      '<h3 class="section-title" style="color:var(--pastelia)">Equipo PastelIA · top 5</h3>' +
      rankRows(topByTeam('PastelIA'), 'var(--pastelia)');
  }

  /* ---------------------------- SHARE ----------------------------- */
  function initShare() {
    $('#shareFab').addEventListener('click', function () {
      $('#sheetBackdrop').classList.add('active');
      var link = window.location.href.split('#')[0];
      $('#linkBox').textContent = link;
      var qrEl = $('#qrcode');
      qrEl.innerHTML = '';
      if (window.QRCode) {
        new QRCode(qrEl, { text: link, width: 180, height: 180, colorDark: '#2E2118', colorLight: '#ffffff' });
      }
    });
    $('#closeSheet').addEventListener('click', function () {
      $('#sheetBackdrop').classList.remove('active');
    });
    $('#sheetBackdrop').addEventListener('click', function (e) {
      if (e.target.id === 'sheetBackdrop') $('#sheetBackdrop').classList.remove('active');
    });
  }

  /* --------------------------- ROUTING ---------------------------- */
  function bootRoute() {
    var q = state.session ? { participantId: state.session.participantId } : {};
    return API.get('getState', q).then(function (s) {
      state.meeting = s.activeMeeting;
      $('#shareFab').style.display = s.activeMeeting ? 'block' : 'none';

      // sesión de admin activa en este navegador
      var adminHere = window.Admin && window.Admin.hasCreds();
      if (adminHere) {
        $('#navAdmin').style.display = 'block';
        $('#bottomNav').style.display = 'flex';
      }

      // sesión guardada pero el servidor ya no conoce a este participante
      if (state.session && !s.participant) clearSession();

      if (adminHere && !(state.session && s.participant)) {
        window.Admin.enter();
        return;
      }

      if (state.session && s.participant) {
        // participante ya registrado
        $('#headerTitle').textContent = 'Equipo ' + state.session.team;
        $('#bottomNav').style.display = 'flex';

        if (!s.inActiveMeeting) {
          // su reunión terminó (o hay otra distinta)
          showScreen('screen-board');
          setNav('board');
          refreshBoard();
          return;
        }
        if (s.hasSubmittedIdeas) {
          $('#ideasHint').textContent = 'Ya enviaste tus ideas. Puedes editarlas mientras la reunión siga activa.';
          $('#submitIdeasBtn').textContent = 'Actualizar mis ideas';
          goToBoard();
        } else {
          goToIdeas();
        }
        return;
      }

      // sin registro: pantalla de unirse / espera
      if (!s.activeMeeting) {
        $('#joinWaiting').style.display = 'block';
        $('#joinBtn').disabled = true;
      } else {
        $('#joinWaiting').style.display = 'none';
      }
      showScreen('screen-join');
      checkReady();
    }).catch(function (e) {
      toast('No se pudo conectar con el servidor. Revisa API_URL.', true);
      console.error(e);
    });
  }

  /* ----------------------------- INIT ---------------------------- */
  function init() {
    try {
      if (!CFG || !CFG.API_URL || CFG.API_URL.indexOf('PEGA_AQUI') === 0) {
        toast('Configura API_URL en js/config.js', true);
      }
    } catch (e) {}

    initJoin();
    initIdeas();
    initNav();
    initShare();
    if (window.Admin) window.Admin.init();

    bootRoute();
    startPoll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
