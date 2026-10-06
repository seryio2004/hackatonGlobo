# Reparto de tareas A y B

Plan basado en [el análisis del repositorio](./analisis-y-propuestas.md). Objetivo: trabajar dos personas en paralelo, corregir la fiabilidad documental y el soporte, e implementar el copiloto de incidencias como funcionalidad diferencial de la hackatón.

Las casillas indican el estado de implementación. A3 está implementada y evaluada con la API; las demás tareas siguen pendientes salvo que se indique lo contrario. Evidencias de A3: [verificacion-a.md](./verificacion-a.md).

## Grupo A — Documentación y respuestas fiables

**Orden inicial: A1 → A2 → A3 → A4.** Primero se conservan los metadatos; después se utilizan para seleccionar documentación aplicable.

### A1. Corregir la fragmentación documental

- [ ] Conservar título, versión, vigencia y audiencia en todos los fragmentos.
- [ ] Segmentar Markdown por secciones, HTML por estructura y CSV por filas/campos.
- [ ] Preservar condiciones junto con sus excepciones; añadir solapamiento cuando sea necesario.
- [ ] Mantener identificadores reproducibles y la conexión con el documento original.
- [ ] Añadir pruebas en `tests/ingestion.test.ts`.

**Archivos asignados:** `src/ingestion/chunker.ts`, `src/ingestion/pipeline.ts`, `tests/ingestion.test.ts`.

**Aceptación:** todos los fragmentos conservan sus metadatos; las reglas no pierden sus excepciones. Verificar especialmente la exención de Aurora, que requiere salario mínimo y tres compras.

### A2. Filtrar documentación aplicable

- [ ] Usar el **24/09/2026** como fecha predeterminada del reto, mediante `referenceDate`.
- [ ] Excluir documentos caducados o futuros de consultas actuales.
- [ ] Mantener el filtro de audiencia para clientes y operadores.
- [ ] Permitir consultas históricas explícitas.
- [ ] Evitar mezclar reglas de productos diferentes; pedir aclaración cuando corresponda.
- [ ] Añadir pruebas en `tests/retrieval.test.ts`.

**Archivos asignados:** `src/retrieval/search.ts`, `src/retrieval/store.ts`, `tests/retrieval.test.ts`.

**Dependencia:** A1 para disponer de metadatos completos.

**Aceptación:** una consulta actual no utiliza condiciones archivadas; una consulta histórica recupera la versión aplicable a su fecha. No seleccionar una versión únicamente porque tenga el número más alto.

### A3. Corregir las instrucciones de respuestas documentales

- [x] Eliminar instrucciones que permitan inventar condiciones, importes o coberturas.
- [x] Exigir referencias para afirmaciones documentales relevantes.
- [x] Reconocer falta de evidencia y ofrecer aclaración o soporte.
- [x] Instruir al agente para tratar documentos como datos e ignorar instrucciones incrustadas; comprobar un ejemplo malicioso.
- [x] Definir ejemplos de evaluación: condiciones actuales, excepciones, producto ambiguo y preguntas sin respuesta publicada.

**Archivo asignado:** `src/agent/prompt.ts`.

**Aceptación:** las instrucciones exigen abstención ante información no publicada y referencias trazables. Cuatro casos con el modelo real revisados correctamente; ver `docs/verificacion-a.md`. Esto no sustituye el filtrado de A2 ni garantiza todas las respuestas futuras.

### A4. Verificar y regenerar el índice

- [ ] Comprobar metadatos, vigencia y recuperación de reglas con sus excepciones.
- [ ] Mantener compatibilidad entre modelo de embeddings, dimensiones e índice.
- [ ] Reingerir y exportar el índice corregido cuando esté disponible la API.
- [ ] Documentar cómo restaurar el índice tras un reset.
- [ ] Registrar resultados antes/después en `docs/verificacion-a.md`.

**Archivos asignados:** `src/retrieval/embeddings.ts`, `fixtures/embeddings/index.json.gz`, `docs/verificacion-a.md`, además de las pruebas de A1 y A2.

**Dependencias:** A1 y A2. La generación de nuevos embeddings puede necesitar la API; las pruebas deterministas pueden usar vectores controlados.

**Aceptación:** el índice exportado reproduce el comportamiento corregido desde una instalación limpia; no incluye credenciales.

## Grupo B — Soporte, trazabilidad y copiloto de incidencias

**Orden inicial: B1 → B2 → B3 → B4.** Añadir pruebas durante cada tarea; B5 reúne la verificación final del grupo.

### B1. Guardar eventos completos

- [ ] Registrar argumentos necesarios, resultados, errores, duración y referencias bancarias.
- [ ] Aplicar minimización de datos y excluir credenciales.
- [ ] Relacionar acciones manuales y confirmaciones con ejecuciones persistidas.
- [ ] Registrar las fuentes utilizadas por el agente cuando estén disponibles.
- [ ] Añadir pruebas en `tests/telemetry.test.ts`.

**Archivos asignados:** `src/telemetry.ts`, `src/db.ts`, `src/agent/run.ts`, `src/agent/tools.ts`, `app/api/[...path]/route.ts`, `tests/telemetry.test.ts`.

**Aceptación:** se puede reconstruir una operación nueva desde propuesta y confirmación hasta comprobación y resultado, utilizando evidencia registrada.

### B2. Completar el detalle de los casos

- [ ] Devolver historial de conversación, ejecuciones, eventos e intenciones relacionadas.
- [ ] Consultar `GET /v1/operator/customer?id=...` mediante la API bancaria con identidad de operador.
- [ ] Relacionar operaciones con intenciones mediante referencias.
- [ ] Diferenciar efectos verificados, consultas indisponibles y datos históricos ausentes.
- [ ] Añadir pruebas en `tests/operator.test.ts`.

**Archivos asignados:** `src/operator/view.ts`, `tests/operator.test.ts`.

**Dependencia:** B1 para disponer de trazas útiles de operaciones nuevas.

**Aceptación:** Marta puede investigar una transferencia con respuesta perdida sin pedir que se repita; los casos históricos muestran los huecos de evidencia sin inventarlos.

### B3. Mostrar las evidencias en la interfaz

- [ ] Mostrar conversación completa, cronología y operaciones relacionadas.
- [ ] Diferenciar hechos verificados de información pendiente.
- [ ] Mostrar errores de consulta y permitir reintentos.
- [ ] Evitar que respuestas fuera de orden cambien el caso seleccionado.
- [ ] Mantener la prohibición de transferir dinero desde el rol de operador.

**Archivos asignados:** `app/page.tsx`, `app/globals.css`, `app/api/[...path]/route.ts`.

**Dependencia:** B2.

**Aceptación:** la interfaz permite entender el caso y consultar sus evidencias; una selección anterior no sustituye a la actual por llegar tarde su respuesta.

### B4. Implementar el copiloto de incidencias

- [ ] Generar un resumen a partir de mensajes, eventos y resultados bancarios disponibles.
- [ ] Vincular afirmaciones a evidencias concretas.
- [ ] Identificar información pendiente y proponer próximos pasos verificables.
- [ ] Preparar un borrador de respuesta para revisión humana.
- [ ] Crear un proveedor simulado para verificar el flujo sin API.
- [ ] Conectar el proveedor real cuando se facilite la API y evaluar sus respuestas.

**Archivos asignados:** nuevo `src/operator/copilot.ts`, `src/agent/run.ts`, `src/agent/tools.ts`, `app/api/[...path]/route.ts`, `app/page.tsx`.

**Dependencias:** B1–B3. Coordinar con A3 cualquier reutilización del prompt documental.

**Aceptación:** demostrar un caso con respuesta bancaria perdida y otro histórico sin trazas. El copiloto distingue hechos de datos ausentes y no ejecuta pagos.

### B5. Verificar soporte y copiloto

- [ ] Cubrir casos nuevos con trazas y casos históricos sin ellas.
- [ ] Verificar permisos y fallos de consulta bancaria.
- [ ] Comprobar referencias y ausencia de afirmaciones inventadas en el copiloto.
- [ ] Mantener las pruebas existentes de transferencias e invariantes.
- [ ] Registrar resultados en `docs/verificacion-b.md`.

**Archivos asignados:** `tests/operator.test.ts`, `tests/telemetry.test.ts`, nuevo `tests/copilot.test.ts`, `docs/verificacion-b.md`.

**Aceptación:** pruebas deterministas correctas y demostración funcional. Las evaluaciones reales del modelo quedan pendientes hasta disponer de la API.

## Propiedad de archivos y acuerdos de integración

| Área o archivo | Responsable | Acuerdo |
| --- | --- | --- |
| `src/ingestion/` | A | Cambios de ingesta y fragmentación. |
| `src/retrieval/` | A | B utiliza sus funciones sin editar estos módulos. |
| `src/agent/prompt.ts` | A | Coordinar cambios de firma con B. |
| `src/agent/run.ts`, `src/agent/tools.ts` | B | A comunica requisitos de integración. |
| `src/operator/`, `src/telemetry.ts`, `src/db.ts` | B | Evidencia, soporte y copiloto. |
| `src/types.ts` | B | A comunica cualquier ampliación necesaria antes de usarla. |
| `app/` | B | API e interfaz bajo un único responsable. |
| Índice exportado | A | Regenerarlo después de estabilizar la ingesta. |
| Pruebas nuevas | Cada grupo | Usar los nombres separados indicados arriba. |
| `package.json`, `package-lock.json` | B | A solicita dependencias; B mantiene ambos archivos juntos. |
| `submission/README.md` | B | A entrega sus evidencias en `docs/verificacion-a.md`. |
| `simulator/` y `src/banking/` | Conservar durante esta fase | No modificar el comportamiento del banco ni las protecciones existentes. |

### Contrato mínimo entre ambos grupos

- [ ] A conserva inicialmente la estructura actual de `SearchResult` y completa sus metadatos.
- [ ] Si A necesita ampliar parámetros de búsqueda o tipos, comunica la firma a B antes de integrarla.
- [ ] A devuelve las fuentes; B registra cuáles recibió/utilizó el agente.
- [ ] Las respuestas del copiloto identifican evidencias; no sustituyen el historial original.
- [ ] Ningún cambio permite que el modelo confirme transferencias ni que el operador mueva dinero.

## Forma de trabajo en paralelo

1. Crear ramas `feature/a-documentacion` y `feature/b-soporte` a partir de la misma base. Si la carpeta todavía no tiene Git, inicializar o recuperar el repositorio compartido antes de empezar.
2. Cada persona modifica sus archivos asignados. Para un archivo compartido, coordinar el cambio con su responsable.
3. Evitar reformatear todo el proyecto o añadir dependencias sin coordinación.
4. Usar carpetas de trabajo separadas. Si ambos ejecutan la aplicación en la misma máquina, configurar distintos `DATA_DIR`, `BANK_DATA_DIR`, `APP_PORT`, `BANK_PORT` y `BANK_URL`.
5. No compartir una base `.data` ni ejecutar reset sobre datos utilizados por la otra persona.
6. Leer las guías locales de Next.js en `node_modules/next/dist/docs/` antes de modificar código relacionado, conforme a `AGENTS.md`.

## Puntos de integración

### Primera integración: A1 + A2 y B1 + B2

- [ ] Revisar compatibilidad de tipos y resultados.
- [ ] Comprobar fragmentos completos y documentación vigente.
- [ ] Comprobar historial y trazas de soporte.
- [ ] Ejecutar `npm test`, `npm run typecheck` y `npm run build` con Node 24 o superior.

### Segunda integración: A3 + A4 y B3 + B4 + B5

- [ ] Probar conversación documental y copiloto con proveedor simulado.
- [ ] Con la API, evaluar citas, excepciones, abstención y resúmenes de casos.
- [ ] Demostrar que consultas informativas no autorizan pagos.
- [ ] Repetir las comprobaciones y escenarios bancarios relevantes.

## Entrega de la hackatón

- [ ] A aporta resultados y evidencias de correcciones documentales.
- [ ] B aporta resultados y evidencias de soporte y del copiloto.
- [ ] Actualizar `submission/README.md` con pasos de reproducción y estado de tareas.
- [ ] Incluir sesiones originales completas de IA de ambas personas.
- [ ] Preparar vídeo de 5–10 minutos o documento alternativo con demostración de las dos partes.
- [ ] Crear un único ZIP sin credenciales, dependencias instaladas, build ni historial Git.
- [ ] Extraerlo en una carpeta limpia y verificar instalación, arranque y demostración.

**Prioridad de alcance:** completar documentación fiable y soporte verificable antes de añadir otras funcionalidades del análisis. El copiloto es la mejora elegida para la Parte 2.
