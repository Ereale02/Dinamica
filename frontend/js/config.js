/**
 * Configuración del frontend.
 * ---------------------------------------------------------------
 * API_URL   → URL /exec del Web App de Google Apps Script (backend/Code.gs).
 *             Se obtiene al hacer "Deploy > New deployment > Web app".
 * POLL_MS   → cada cuánto refresca el tablero (ms).
 * ADMIN_NAME→ solo se usa en el cliente para saber cuándo mostrar el
 *             campo de PIN. La validación real ocurre en el backend.
 */
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwgwPchMQU3IQUKIy_XRD0WfI5acOOI2wkdARVzbFFW0lw6iKwadiurrYdnj634hYx8/exec',
  POLL_MS: 6000,
  ADMIN_NAME: 'Erendira Alejandra Hernández Loza'
};
