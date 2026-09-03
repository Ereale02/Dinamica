# Kickoff IA — App de dinámica

App web ligera para una dinámica de lluvia de ideas sobre casos de uso de IA.
Dos equipos (**Macarita** y **PastelIA**) aportan ideas, las votan dentro de su
equipo, y una **administradora** controla el ciclo de vida de la reunión
(iniciar, resumir, terminar, exportar, historial).

Implementa la especificación `spec-app-kickoff-ia.md` con la **Opción A**:
código en GitHub, frontend estático en GitHub Pages, y **Google Apps Script +
Google Sheet** como backend y almacenamiento.

```
Frontend (GitHub Pages)  ──fetch()──►  Apps Script Web App  ──►  Google Sheet
   frontend/                              backend/Code.gs         Reuniones
                                                                 Participantes
                                                                 Ideas
                                                                 Votos
```

---

## Estructura

```
/frontend
  index.html
  /css/styles.css
  /js/config.js      ← pega aquí la URL del Web App
  /js/api.js         ← cliente HTTP (evita preflight CORS)
  /js/app.js         ← flujo de participante
  /js/admin.js       ← panel de administración
/backend
  Code.gs            ← toda la API + reglas de negocio
  appsscript.json
.github/workflows/pages.yml   ← publica /frontend en GitHub Pages
.env.example         ← documenta ADMIN_PIN / ADMIN_NAME (van como Script Properties)
```

---

## Puesta en marcha

### 1. Backend — Google Apps Script

1. Crea un **Google Sheet** nuevo (será la base de datos). No hace falta crear
   las hojas a mano: se crean solas en la primera petición.
2. En ese Sheet: **Extensiones → Apps Script**.
3. Borra el contenido de `Código.gs` y pega `backend/Code.gs`. Añade también el
   archivo de manifiesto `appsscript.json` (Proyecto → ⚙ → "Mostrar
   `appsscript.json`").
4. **Configura los secretos** en Apps Script → ⚙ **Configuración del proyecto →
   Propiedades del script**:
   | Propiedad     | Valor                                   | Obligatoria |
   |---------------|-----------------------------------------|-------------|
   | `ADMIN_PIN`   | PIN de 4–6 dígitos que elijas           | Sí          |
   | `ADMIN_NAME`  | `Erendira Alejandra Hernández Loza`      | No (default)|
5. **Implementar → Nueva implementación → Aplicación web**
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario**
6. Copia la **URL `/exec`**.

> Cada vez que cambies `Code.gs` tienes que **Implementar → Administrar
> implementaciones → editar → Nueva versión** para que la URL sirva el código
> nuevo.

### 2. Frontend

1. Abre `frontend/js/config.js` y pega la URL en `API_URL`:
   ```js
   window.APP_CONFIG = {
     API_URL: 'https://script.google.com/macros/s/AKf.../exec',
     POLL_MS: 6000,
     ADMIN_NAME: 'Erendira Alejandra Hernández Loza'
   };
   ```
2. **Local:** cualquier servidor estático sirve. Ejemplos:
   ```bash
   npx serve frontend
   ```
3. **GitHub Pages:** al hacer push a `main`, el workflow
   `.github/workflows/pages.yml` publica la carpeta `frontend/`.
   Actívalo una vez en **Settings → Pages → Source: GitHub Actions**.

---

## Roles y acceso

| Rol            | Cómo entra                                                                 |
|----------------|---------------------------------------------------------------------------|
| Participante   | Abre el enlace/QR, escribe su nombre y elige equipo.                     |
| Administradora | Escribe exactamente `Erendira Alejandra Hernández Loza` → aparece el campo de **PIN**. El PIN se valida en el backend contra `ADMIN_PIN`. |

**Decisión implementada:** *Variante B* del spec (nombre + PIN). El nombre por sí
solo no da acceso; el PIN nunca está en el código ni en el repo (vive en Script
Properties). La sesión de admin se guarda solo en `sessionStorage` (se pierde al
cerrar la pestaña) y las credenciales viajan en el *body* del POST, nunca en la
URL.

---

## Modelo de datos (hojas del Sheet)

| Hoja | Columnas |
|---|---|
| `Reuniones` | `id_reunion, nombre, fecha_inicio, fecha_fin, estado, resumen_generado, resumen_json` |
| `Participantes` | `id_participante, id_reunion, nombre, equipo, fecha_registro` |
| `Ideas` | `id_idea, id_reunion, id_participante, equipo, texto, fecha` |
| `Votos` | `id_voto, id_reunion, id_idea, id_participante_que_vota, fecha` |

`resumen_json` es una columna extra (no estaba en el spec) donde se congela el
resumen generado, para cumplir la regla "el resumen, una vez generado, queda
fijo". Cada voto es **una fila nueva** (no un contador), lo que evita condiciones
de carrera; además toda escritura pasa por `LockService`.

---

## API (Apps Script Web App)

`GET` con `?action=...` para lecturas, `POST` con body JSON (`Content-Type:
text/plain` para evitar preflight) para escrituras.

| action | método | rol | descripción |
|---|---|---|---|
| `getState` | GET | público | reunión activa, conteos, y estado del participante si se pasa `participantId` |
| `join` | POST | público | registra participante (`name`, `team`) → `participantId` |
| `submitIdeas` | POST | participante | guarda/reemplaza hasta 3 ideas (`participantId`, `ideas[]`) |
| `getBoard` | GET | público | ideas + votos (`participantId` para saber qué votó, `team`/`meetingId` opcionales) |
| `toggleVote` | POST | participante | vota / quita voto (`participantId`, `ideaId`) |
| `adminLogin` | POST | — | valida `name` + `pin` |
| `startMeeting` | POST | admin | crea e inicia reunión (`nombre`) |
| `generateSummary` | POST | admin | genera/recalcula el resumen de la reunión activa |
| `endMeeting` | POST | admin | cierra la reunión activa (genera resumen si no existía) |
| `history` | POST | admin | lista de reuniones |
| `meetingDetail` | POST | admin | detalle + resumen de una reunión (`meetingId`) |
| `exportMeeting` | POST | admin | CSV completo (`meetingId`) → `{ filename, csv }` |

Todas las respuestas: `{ ok: true, data }` o `{ ok: false, error }`.

---

## Reglas de negocio (implementadas)

- Solo **una reunión activa** a la vez.
- Un participante solo envía ideas mientras su reunión siga activa.
- Un voto por participante por idea; se puede quitar.
- Solo se votan ideas del **equipo propio**.
- El resumen, una vez generado, queda fijo salvo que la admin lo regenere.
- Cerrar una reunión no borra datos: cambia `estado` a `cerrada`.

## Decisiones sobre las preguntas abiertas del spec (§12)

| Pregunta | Decisión en esta versión |
|---|---|
| ¿Más de una administradora? | No. Un solo `ADMIN_NAME` / `ADMIN_PIN`. Ampliable a una lista más adelante. |
| ¿Variante A o B para el acceso admin? | **Variante B** (nombre + PIN en Script Properties). |
| ¿Formato de exportación? | **CSV** desde el backend (datos completos + resumen) y **Imprimir / Guardar como PDF** desde el detalle. |
| ¿Historial visible para todos? | **Solo la administradora.** |

---

## Exportar a PDF

El botón **"Imprimir / Guardar como PDF"** en el detalle de una reunión abre el
diálogo de impresión del navegador (`Ctrl/Cmd + P` → "Guardar como PDF"). El CSV
es la exportación de datos completa.

---

## Pruebas manuales (criterios de aceptación del spec §9)

1. Sin reunión activa → el participante ve el aviso y el botón "Continuar"
   deshabilitado.
2. Nombre de la administradora → pide PIN; con PIN correcto entra al panel admin.
3. Dos votos simultáneos a la misma idea → dos filas en `Votos`, ninguno se
   pierde (LockService).
4. "Generar resumen ahora" → top 5 por equipo sin cerrar la reunión.
5. "Terminar reunión" → no acepta más ideas/votos y deja el resumen fijo.
6. "Descargar CSV" → archivo con ideas, votos y resumen de esa reunión.
7. El historial muestra todas las reuniones.
8. El QR apunta a la URL del frontend.

---

## Escalamiento (Opción B del spec)

Si crece el uso (más reuniones, realtime real, integraciones), migrar el backend
a **Supabase (Postgres) + Vercel/Netlify** manteniendo el mismo contrato de
`api.js`. El frontend casi no cambia.
