/**
 * Cliente HTTP hacia el Web App de Apps Script.
 *
 * Truco CORS: Apps Script no responde preflight (OPTIONS). Para evitarlo:
 *  - GET: parámetros en la query string.
 *  - POST: body = JSON string, Content-Type "text/plain" (petición "simple",
 *    sin preflight). El backend hace JSON.parse(e.postData.contents).
 */
(function (global) {
  'use strict';

  function base() {
    var url = (global.APP_CONFIG && global.APP_CONFIG.API_URL) || '';
    if (!url || url.indexOf('PEGA_AQUI') === 0) {
      throw new Error('Falta configurar API_URL en js/config.js');
    }
    return url;
  }

  function unwrap(res) {
    return res.json().then(function (payload) {
      if (!payload || payload.ok !== true) {
        throw new Error((payload && payload.error) || 'Error del servidor');
      }
      return payload.data;
    });
  }

  function apiGet(action, params) {
    return Promise.resolve().then(function () {
      var q = Object.assign({ action: action }, params || {});
      var qs = Object.keys(q)
        .filter(function (k) { return q[k] !== undefined && q[k] !== null && q[k] !== ''; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); })
        .join('&');
      return fetch(base() + '?' + qs, { method: 'GET' }).then(unwrap);
    });
  }

  function apiPost(action, body) {
    return Promise.resolve().then(function () {
      return fetch(base(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action }, body || {}))
      }).then(unwrap);
    });
  }

  global.API = { get: apiGet, post: apiPost };
})(window);
