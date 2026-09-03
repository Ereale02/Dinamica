# Especificación funcional y técnica
## App de dinámica de kickoff — Proyecto IA en Paulette

**Documento para:** equipo de desarrollo (Codex / ChatGPT u otra IA generativa)
**Preparado como:** especificación de requisitos para construcción de software
**Repositorio destino:** GitHub

---

## 1. Objetivo

Construir una aplicación web ligera para ejecutar una dinámica grupal de lluvia de ideas sobre casos de uso de IA dentro de la empresa. Los participantes se organizan en dos equipos (**Macarita** y **PastelIA**), aportan ideas, las votan dentro de su equipo, y una persona con rol de **Administrador** controla el ciclo de vida de la reunión (inicio, cierre, generación de resumen, exportación e historial).

A diferencia de un prototipo de una sola sesión, esta versión debe:
- Persistir la información en un almacenamiento real (no solo en memoria del navegador).
- Soportar múltiples reuniones a lo largo del tiempo (historial).
- Tener un rol de administración separado del rol de participante.

---

## 2. Actores y roles

| Rol | Descripción | Permisos |
|---|---|---|
| **Participante** | Cualquier persona que entra al enlace/QR de una reunión activa | Registrarse en un equipo, enviar sus 3 ideas, votar ideas de su equipo, ver el tablero y resultados |
| **Administrador** | Erendira Alejandra Hernández Loza (rol único en esta versión) | Todo lo del participante, más: iniciar/terminar reuniones, definir cuándo se genera el resumen, exportar la reunión, ver historial de reuniones pasadas |

### 2.1 Control de acceso al rol de Administrador — decisión pendiente

El requerimiento original es: *"al poner el nombre de Erendira Alejandra Hernández Loza entra a la ventana de administración."* Documento las dos variantes para que el equipo de desarrollo implemente la que se decida:

**Variante A — Literal (nombre como llave)**
- Si el texto del campo "nombre" coincide (normalizado: sin acentos, minúsculas, espacios recortados) con `"erendira alejandra hernandez loza"`, la app redirige a la vista de administrador en lugar de la vista de participante.
- Riesgo: cualquier persona que escriba ese nombre exacto obtiene acceso admin. No hay revocación sin cambiar código. No es un mecanismo de autenticación real.

**Variante B — Recomendada (nombre + PIN)**
- Mismo disparador por nombre, pero al detectarlo la app pide un PIN de 4-6 dígitos (guardado como variable de entorno, no en el código fuente ni en el repo público) antes de conceder el acceso.
- Costo de implementación: mínimo (un campo más, una comparación en backend).
- Beneficio: evita que cualquiera con ese nombre —o alguien que lo copie del código fuente público del repo— entre como admin.

> **Recomendación del analista:** implementar Variante B. Si el repositorio es público en GitHub, el nombre completo quedaría visible en el código fuente de la Variante A, lo cual anula cualquier intento de restricción.

---

## 3. Requisitos funcionales

| ID | Requisito |
|---|---|
| RF-01 | El participante se registra con nombre y equipo (Macarita / PastelIA) |
| RF-02 | El sistema detecta si el nombre ingresado corresponde a la administradora y habilita su panel |
| RF-03 | El administrador puede **crear e iniciar** una reunión nueva (queda "activa") |
| RF-04 | Mientras no haya una reunión activa, los participantes no pueden registrar ideas (pantalla de espera) |
| RF-05 | El participante envía hasta 3 ideas de texto libre |
| RF-06 | El participante vota ideas de su propio equipo (una idea, un voto por persona, con opción de quitar el voto) |
| RF-07 | Todos los participantes ven el tablero de su equipo actualizado en vivo (polling o realtime) |
| RF-08 | Se calcula automáticamente un ranking de ideas por número de votos, por equipo |
| RF-09 | El administrador puede **terminar** la reunión activa |
| RF-10 | Al terminar (o bajo demanda del administrador, ver RF-11) se genera un **resumen**: top 5 ideas por equipo, total de participantes, total de ideas enviadas |
| RF-11 | El administrador decide el momento de generar el resumen: automático al terminar la reunión, o manual mientras la reunión sigue activa (botón "Generar resumen ahora") |
| RF-12 | El administrador puede **exportar** una reunión (formato sugerido: PDF y/o CSV) con ideas, votos y resumen |
| RF-13 | El administrador puede **ver el historial** de reuniones anteriores (lista con fecha, nombre de la reunión, número de participantes, acceso al detalle y export de cada una) |
| RF-14 | La app genera un enlace y código QR para unirse a la reunión activa |

---

## 4. Requisitos no funcionales

- **Peso/rendimiento:** app ligera, uso principal desde celular durante una sesión presencial; carga en menos de 2 segundos en red 4G.
- **Concurrencia:** debe soportar al menos 20-30 usuarios simultáneos enviando ideas y votando sin conflictos de escritura (evitar condiciones de carrera al sumar votos).
- **Persistencia:** los datos deben sobrevivir a que el navegador se cierre o se recargue la página; no se puede depender solo de `localStorage`/memoria del cliente.
- **Multi-reunión:** el modelo de datos debe distinguir reuniones distintas (no mezclar ideas de sesiones diferentes).
- **Disponibilidad:** la app debe estar accesible durante toda la sesión en vivo (evitar dependencias que dupliquen puntos de falla).
- **Seguridad mínima:** ninguna credencial (PIN, tokens de API) debe quedar hardcodeada en el código fuente si el repositorio es público; usar variables de entorno.

---

## 5. Arquitectura propuesta

GitHub Pages por sí solo **solo sirve archivos estáticos** — no puede almacenar datos ni tener lógica de servidor. Por eso "correr en GitHub como repositorio" se resuelve así: **el código vive y se versiona en GitHub**, pero el *hosting* de la app y el almacenamiento de datos necesitan un servicio adicional. Se presentan dos rutas viables:

| Opción | Cómo cumple "almacenar en un documento" | Complejidad | Costo | Tiempo real (votos en vivo) |
|---|---|---|---|---|
| **A — Google Sheets como base de datos** (vía Google Apps Script como API intermedia) | Literal: los datos quedan en una hoja de cálculo (documento) que además es legible/editable a mano si hace falta | Baja | Gratis | Limitado (funciona por *polling*, no push en tiempo real; hay cuotas de Google) |
| **B — Supabase (Postgres) + Vercel/Netlify** | La "documentación" de los datos es una base de datos relacional real, con tablas versionables y exportables a CSV/PDF | Media | Gratis en capa básica | Sí, soporta realtime nativo |

**Recomendación del analista:** para un grupo de ~15-30 personas en una sola sesión presencial, la Opción A (Google Sheets) es suficiente, más simple de dar a Codex para construir en poco tiempo, y coincide con el pedido literal de "almacenar en algún documento". La Opción B conviene si se planea escalar a más reuniones, más gente simultánea, o integrarlo después a otras herramientas internas.

Este documento asume **Opción A** como base, con la Opción B anotada como ruta de escalamiento.

### 5.1 Componentes

```
[Frontend: HTML/JS o React, en GitHub, desplegado en GitHub Pages o Vercel]
        |
        | fetch() a una URL de Web App
        v
[Google Apps Script Web App]  <-- actúa como API REST simple (GET/POST)
        |
        v
[Google Sheet]  <-- documento con las hojas: Reuniones, Participantes, Ideas, Votos
```

- El **frontend** no debe hablar directamente con la hoja de cálculo; siempre pasa por el Web App de Apps Script, que valida datos y aplica la lógica de negocio (ej. no permitir votos duplicados).
- El **PIN de administrador** (si se implementa Variante B) se valida del lado del Apps Script, nunca solo en el navegador.

---

## 6. Modelo de datos (hojas del documento)

**Hoja `Reuniones`**
| id_reunion | nombre | fecha_inicio | fecha_fin | estado (activa/cerrada) | resumen_generado (sí/no) |

**Hoja `Participantes`**
| id_participante | id_reunion | nombre | equipo | fecha_registro |

**Hoja `Ideas`**
| id_idea | id_reunion | id_participante | equipo | texto | fecha |

**Hoja `Votos`**
| id_voto | id_reunion | id_idea | id_participante_que_vota | fecha |

> Nota de diseño: separar "Votos" de "Ideas" evita condiciones de carrera cuando varias personas votan al mismo tiempo (cada voto es una fila nueva, no una actualización de contador compartido).

---

## 7. Pantallas requeridas

1. **Registro** — nombre + selección de equipo (Macarita / PastelIA). Si el nombre coincide con la administradora → ir a Panel de administración (con o sin PIN, según variante elegida).
2. **Espera** — se muestra si no hay reunión activa ("Aún no inicia la sesión").
3. **Ideas** — formulario de 3 ideas.
4. **Tablero de equipo** — ideas del equipo propio con botón de voto.
5. **Resultados** — top 5 por equipo, visible para todos.
6. **Compartir** — enlace + QR de la reunión activa.
7. **Panel de administración**
   - Botón "Iniciar nueva reunión" (pide nombre de la reunión)
   - Botón "Generar resumen ahora" (disponible con reunión activa)
   - Botón "Terminar reunión" (cierra la reunión, genera resumen automáticamente si no se generó antes)
   - Botón "Exportar" (descarga PDF/CSV de la reunión seleccionada)
   - Listado "Historial de reuniones" con acceso al detalle de cada una

---

## 8. Reglas de negocio clave

- Solo puede haber **una reunión activa a la vez**.
- Un participante solo puede enviar ideas mientras la reunión con la que se registró siga activa.
- Un voto por participante por idea; puede quitarlo y volver a votar otra.
- El resumen, una vez generado, queda fijo (no se recalcula si siguen entrando votos después, salvo que el administrador vuelva a generarlo explícitamente).
- Cerrar una reunión no borra sus datos; solo cambia su estado a "cerrada" y deja de aceptar ideas/votos nuevos.

---

## 9. Criterios de aceptación (para pruebas)

- [ ] Con la reunión cerrada, un participante nuevo ve la pantalla de espera y no puede enviar ideas.
- [ ] Al escribir el nombre de la administradora, se accede al panel admin (con PIN si se implementa Variante B) y no a la vista de participante.
- [ ] Dos personas votando la misma idea al mismo tiempo generan dos votos, no una condición de carrera que pierda uno.
- [ ] "Generar resumen ahora" produce el top 5 por equipo sin cerrar la reunión.
- [ ] "Terminar reunión" impide nuevas ideas/votos y genera el resumen si no existía.
- [ ] "Exportar" produce un archivo descargable (PDF o CSV) con ideas, votos y resumen de esa reunión específica.
- [ ] El historial muestra todas las reuniones anteriores, no solo la más reciente.
- [ ] El QR generado apunta al enlace correcto de la reunión activa.

---

## 10. Prompt sugerido para pegar en Codex / ChatGPT

```
Actúa como desarrollador full-stack. Construye una aplicación web para una
dinámica grupal de brainstorming de ideas de IA, con estos componentes:

FRONTEND: HTML/CSS/JS (sin framework pesado), mobile-first, alojado en un
repositorio de GitHub y desplegado en GitHub Pages o Vercel.

BACKEND/DATOS: usa Google Apps Script como Web App (endpoints GET/POST) que
lea y escriba en un Google Sheet con estas hojas: Reuniones, Participantes,
Ideas, Votos (esquema de columnas adjunto en la sección 6 del documento
"Especificación funcional y técnica - App de dinámica de kickoff").

ROLES: Participante (registro con nombre + equipo, envío de 3 ideas, voto de
ideas de su equipo, ver tablero y resultados) y Administrador (nombre
disparador: "Erendira Alejandra Hernández Loza", confirmado con un PIN
guardado en variable de entorno — nunca en el código fuente). El
administrador puede iniciar reunión, generar resumen bajo demanda, terminar
reunión, exportar a PDF/CSV y ver historial de reuniones pasadas.

Sigue las reglas de negocio y criterios de aceptación de las secciones 8 y 9
del documento adjunto. Entrega el código organizado en un repositorio con
carpetas /frontend y /backend (script de Apps Script), un README con pasos
de despliegue, y variables de entorno documentadas en un .env.example
(nunca con valores reales).
```

---

## 11. Estructura de repositorio sugerida

```
/kickoff-ia-app
  /frontend
    index.html
    /js
    /css
  /backend
    Code.gs                 (Apps Script — API)
    appsscript.json
  .env.example
  README.md
```

---

## 12. Preguntas abiertas antes de construir

1. ¿La app debe soportar más de un administrador en el futuro, o solo esta persona?
2. ¿El PIN de administrador (Variante B) lo defines tú, o prefieres seguir con la Variante A pese al riesgo señalado?
3. ¿Formato de exportación preferido: PDF, CSV, o ambos?
4. ¿Se necesita que el historial sea visible solo para el administrador, o también para cualquier participante (modo consulta)?
