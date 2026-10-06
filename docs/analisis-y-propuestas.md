# Análisis del repositorio y propuestas de implementación

Fecha: 6 de octubre de 2026. Fecha de referencia documental del reto: **24 de septiembre de 2026**, aunque la aplicación se ejecute otro día.

## Resultado y alcance

La aplicación funciona como base de la hackatón, pero todavía tiene problemas de fiabilidad documental y de atención al operador. **La IA ya está integrada**: `src/agent/run.ts` utiliza Responses, herramientas y recuperación de documentos; `src/retrieval/embeddings.ts` utiliza embeddings. No hace falta construir otro chatbot desde cero.

Se revisaron los requisitos, contratos, documentación, aplicación Next.js, API, agente, integración bancaria, ingesta, recuperación, almacenamiento, scripts, pruebas y simulador. Se inspeccionaron el manifiesto, el índice y las conversaciones iniciales, junto con documentos representativos. El simulador se analizó como dependencia externa; sus escenarios de error no son defectos que debamos eliminar.

Esta entrega es un **análisis y una propuesta de trabajo**, no una implementación de las correcciones ni de la nueva funcionalidad. No se configuraron credenciales ni se realizaron llamadas reales a un proveedor de IA. No se realizó una revisión visual interactiva del navegador ni una auditoría exhaustiva de dependencias.

## Requisitos que guían las decisiones

Fuentes: `docs/challenge.md` y `docs/contracts.md`.

- Parte 1: identificar, reproducir y corregir problemas; demostrar los resultados sin romper las funciones existentes. Peso: **40 %**.
- Parte 2: implementar una funcionalidad creativa y útil dentro del agente o de su flujo de trabajo. Peso: **40 %**.
- Método, verificación y entrega reproducible: **20 %**.
- Solo el titular puede ordenar transferencias; los operadores no pueden mover dinero de clientes.
- Cada transferencia necesita revisión explícita de sus detalles. Una consulta informativa no autoriza un pago.
- Los reintentos de una misma intención no pueden duplicar efectos. Dos intenciones legítimas idénticas deben seguir siendo posibles.
- Un timeout no demuestra que el banco haya rechazado una operación.
- Las respuestas deben basarse en documentación aplicable y permitir rastrear la evidencia. Si faltan datos, hay que reconocerlo.
- El operador necesita conversación, pasos relevantes y efectos; la evidencia histórica inexistente no se puede inventar.
- La aplicación debe funcionar con otro banco que implemente el contrato; no debe consultar directamente su SQLite ni usar sus endpoints administrativos para atender clientes.
- La entrega final debe incluir código, sesiones originales completas de IA y vídeo o documento alternativo dentro de un único ZIP.

## Verificación realizada

| Comprobación | Resultado | Alcance |
| --- | --- | --- |
| `npm test` | **26/26 pruebas pasan** | Invariantes y transferencias; sin API de IA. |
| `npm run typecheck` | **Correcto** | Generación de tipos Next.js y TypeScript. |
| `npm run build` | **Correcto** | Build de producción con webpack. |
| Índice documental | 80 documentos, 356 fragmentos | 276 fragmentos tienen versión nula; el chunker también elimina título y vigencia después del primer fragmento. |
| Recuperación de contenido archivado | Fallo reproducido | Buscar el texto cacheado de `archive-family-5` devuelve ese documento primero, pese a haber caducado el 31/08/2026. |
| Detalle de soporte | Fallo reproducido | Un caso con 3 mensajes almacenados devuelve `history: []`, `events: []` y `bank: null`. |
| Registro de actividad | Fallo reproducido | Un evento con argumentos, resultado y duración termina almacenando únicamente `tool` y `status`. |

Las comprobaciones documentales y de soporte utilizaron una base temporal, eliminada después. La consulta documental reutilizó embeddings del índice suministrado; no llamó a la API. No demuestra la calidad de respuestas de un modelo real.

El entorno disponible utiliza Node **22.22.1**, mientras el proyecto exige **24 o superior**. Aunque las comprobaciones anteriores pasaron, hay que repetirlas en la versión exigida antes de entregar. Las restricciones de ejecución bloquearon inicialmente el servidor de pruebas y un subproceso del build; ambas comprobaciones pasaron al ejecutarlas con permisos locales adecuados. Esos bloqueos no se contabilizan como fallos del repositorio.

## Lista 1: propuestas para solventar fallos y carencias

Prioridades: **P0**, confianza y cumplimiento del contrato; **P1**, funcionamiento y demostración; **P2**, robustez adicional. El esfuerzo es relativo al resto de propuestas, no una estimación contractual.

### 1. P0 — Respuestas documentales sin invenciones

**Evidencia:** `src/agent/prompt.ts` pide completar información ausente con prácticas bancarias comunes y estimaciones, y dice que las referencias no siempre son necesarias. Contradice los requisitos y documentos como `context-guide-1.md`, que expresamente prohíben inventar recompensas, hipotecas o seguros no publicados.

**Implementación propuesta:** eliminar esas instrucciones; exigir evidencia para condiciones, importes y excepciones; devolver identificadores de fuentes verificables junto con la respuesta. Si no hay evidencia suficiente, preguntar por producto/fecha o ofrecer soporte. Validar que las citas pertenecen a fuentes realmente recuperadas. Añadir defensas y evaluaciones ante instrucciones maliciosas en documentos y conceptos de transferencias.

**Aceptación:** una pregunta sobre recompensas por recomendación o seguros no documentados no obtiene importes ni coberturas inventadas; una respuesta de tarifas incluye fuente y versión. Esfuerzo: medio.

### 2. P0 — Filtrar documentos por vigencia y ámbito

**Evidencia:** `src/retrieval/search.ts` filtra audiencia, pero no fecha, versión ni producto. Hay 12 documentos archivados caducados en el manifiesto. Se reprodujo la devolución de un archivo histórico como primer resultado en una búsqueda actual.

**Implementación propuesta:** resolver metadatos fiables por documento, aplicar `validFrom`/`validTo` respecto a `referenceDate`, conservar búsquedas históricas explícitas y seleccionar el producto correcto. Pedir aclaración si el producto o la fecha no están determinados. No elegir simplemente la versión numérica mayor sin comprobar su vigencia.

**Aceptación:** consultas actuales e históricas recuperan las políticas correspondientes; no se mezclan tarifas de Aurora y Cloud; una versión futura no aplica hoy. Esfuerzo: medio.

### 3. P0 — Conservar contexto y metadatos en la ingesta

**Evidencia:** `src/ingestion/chunker.ts` corta cada 650 caracteres sin solapamiento y solo guarda título, versión y fechas en el primer fragmento. Se verificó que 276/356 fragmentos carecen de versión.

**Implementación propuesta:** heredar metadatos en todos los fragmentos, incluir familia/producto y referencias a secciones; segmentar Markdown por encabezados, HTML por estructura y CSV por filas/campos; preservar reglas con sus excepciones y añadir solapamiento donde sea necesario. Reingerir y exportar el índice reproducible.

**Aceptación:** todos los fragmentos conservan procedencia y vigencia; una condición y su excepción se recuperan juntas. Comprobar, por ejemplo, que la exención de Aurora exige salario mínimo **y** tres compras, no solo uno de los requisitos. Esfuerzo: medio.

### 4. P0 — Dar al operador evidencia real del caso

**Evidencia:** `src/operator/view.ts` devuelve únicamente incidente, cliente y último mensaje; fija los demás campos a listas vacías o `null`. La UI ya contiene secciones para historial, actividad y operaciones, pero no recibe sus datos.

**Implementación propuesta:** cargar conversación, ejecuciones, eventos e intenciones relacionadas; consultar `GET /v1/operator/customer?id=...` con la identidad del operador y relacionar operaciones por referencias. Mostrar disponibilidad del banco y huecos históricos por separado. El banco sigue siendo la autoridad para efectos monetarios.

**Aceptación:** Marta puede entender un pago con respuesta perdida sin pedir al cliente que lo repita. Los casos históricos sin trazas muestran esa carencia y no pasos inventados. Esfuerzo: medio.

### 5. P0 — Registrar trazas suficientes para investigar

**Evidencia:** `src/telemetry.ts` recibe argumentos, resultados, errores y duración, pero persiste solo `{tool, status}`. `src/agent/run.ts` tampoco conserva las fuentes documentales utilizadas en la respuesta.

**Implementación propuesta:** eventos estructurados con argumentos necesarios, resultado, error, duración, referencias bancarias e identificadores de fuentes; registrar modelo y consumo cuando estén disponibles. Aplicar minimización de datos y nunca guardar claves. Relacionar acciones manuales y confirmaciones con registros de ejecución persistidos: actualmente pueden usar `runId` sin una fila correspondiente en `runs`.

**Aceptación:** un caso nuevo permite reconstruir propuesta, confirmación, petición, comprobación y resultado. Distinguir lo observado de la explicación generada por IA. Esfuerzo: medio.

### 6. P1 — Evitar que embeddings sea un requisito para cualquier turno

**Evidencia:** `sendMessage` ejecuta `searchDocuments(content)` antes de llamar al modelo, incluso para consultar cuentas, saludar o solicitar soporte. Una caída o incompatibilidad del índice impide todo el turno.

**Implementación propuesta:** recuperar documentación cuando la intención lo requiera; permitir consultas de cuentas y ayuda operativa sin embeddings. Añadir acceso directo a soporte cuando el proveedor de IA no esté disponible. Mantener un error explícito para consultas que realmente requieren documentación.

**Aceptación:** con embeddings indisponible y el modelo de chat disponible se pueden consultar cuentas; con toda la IA indisponible siguen disponibles operaciones manuales y acceso a soporte. Esfuerzo: medio.

### 7. P1 — Recuperar contexto operativo entre turnos

**Evidencia:** el agente carga los últimos 24 mensajes de texto, pero no propuestas, intenciones ni resultados de herramientas de turnos anteriores. Los identificadores de intención del agente dependen de `runId` y `call_id`.

**Riesgo:** ante «¿qué pasó con el pago?» o «reinténtalo», el modelo tiene instrucciones de seguridad, pero carece de un contexto estructurado duradero para identificarlo. La confirmación del servidor protege la ejecución; esta carencia afecta a la interpretación y experiencia del agente.

**Implementación propuesta:** ofrecer una herramienta de consulta de intenciones propias y cargar propuestas pendientes, referencias y estados verificados de la conversación. Resolver reintentos contra la intención original y distinguir nuevas órdenes explícitas.

**Aceptación:** un seguimiento encuentra la operación original; no crea otra propuesta para recuperarla. Dos pagos nuevos y expresamente solicitados pueden conservar detalles idénticos. Esfuerzo: medio.

### 8. P1 — Gestionar límite, errores y duración del agente

**Evidencia:** el bucle se limita a siete rondas; si se agota, guarda el mensaje genérico y marca la ejecución como `completed`. La API no devuelve los pasos de progreso. No hay presupuesto global de tiempo/tokens ni idempotencia de envío de mensajes; el bloqueo por conversación es un `Set` en memoria.

**Implementación propuesta:** estados `completed`, `failed` y `incomplete`; límite total de tiempo y herramientas; progreso visible; identificador de envío para evitar repetir turnos tras errores de red. Para despliegues con varios procesos, bloqueo duradero con caducidad. Situar las escrituras iniciales dentro de una gestión de errores que libere siempre el bloqueo.

**Aceptación:** agotar rondas no se informa como éxito; reintentar una petición de chat no duplica mensajes ni propuestas. Esfuerzo: medio/alto.

### 9. P1 — Mejorar la selección y suficiencia de evidencia

**Evidencia:** `searchDocuments` devuelve siempre los cinco fragmentos de mayor similitud disponibles, sin evaluación de pertinencia, agrupación por documento ni recuperación de secciones relacionadas. El texto repetido del corpus puede competir con reglas específicas.

**Implementación propuesta:** combinar búsqueda léxica y semántica, priorizar términos de producto, agrupar/diversificar resultados y recuperar contexto vecino. Calibrar pertinencia con consultas de evaluación; no tratar la similitud como una probabilidad de certeza.

**Aceptación:** medir recuperación de la regla aplicable para preguntas conocidas y abstención en preguntas sin respuesta, comparando índice inicial y corregido. Esfuerzo: medio/alto.

### 10. P1 — Añadir pruebas de documentación, agente y soporte

**Evidencia:** las pruebas existentes verifican invariantes y transferencias, pero no vigencia, citas, abstención, excepciones documentales, soporte completo ni conducta del modelo.

**Implementación propuesta:** pruebas deterministas de ingesta, filtros, permisos y detalle de casos; proveedor simulado para probar el flujo de herramientas; evaluaciones reales separadas para calidad del modelo cuando llegue la API. Incluir preguntas ambiguas, instrucciones maliciosas y consultas informativas que no deben preparar pagos.

**Aceptación:** los fallos documentales y de soporte reproducidos dejan de pasar inadvertidos; la suite bancaria actual continúa pasando. Esfuerzo: medio.

### 11. P2 — Validar respuestas bancarias y entrada de importes

**Evidencia:** `bankRequest<T>` comprueba HTTP y JSON, pero convierte el resultado a `T` sin validar su estructura ni la correspondencia de la operación. La UI convierte importes con `Number` y `Math.round`, pudiendo redondear entradas con más de dos decimales.

**Clasificación:** endurecimiento de la frontera de integración; no se observó un banco conforme al contrato devolviendo operaciones incoherentes.

**Implementación propuesta:** esquemas para cuentas/operaciones y comprobación de referencia, actor y payload antes de persistir éxito. Tratar respuestas inválidas como resultado no verificado. Analizar importes decimales de forma exacta y rechazar precisión excesiva en el formulario.

**Aceptación:** un HTTP 200 con JSON válido pero incorrecto no marca un pago como completado; `10,005` no se transforma silenciosamente en otro importe. Esfuerzo: bajo/medio.

### 12. P2 — Afinar API, interfaz y recuperación de errores

**Evidencia:** varias ramas del handler comparten GET/POST sin comprobar el método específico; rutas adicionales pueden acabar devolviendo recursos de una ruta más corta. `runTool` convierte excepciones de validación/autorización en resultados `failed`, normalmente con HTTP 200 en `/actions`. Las cargas de documentos/casos solo comprueban cambio de usuario y pueden mostrar una selección anterior si las respuestas llegan fuera de orden. Si falla la primera carga del dashboard, la UI mantiene la pantalla de carga y el selector deshabilitado.

**Implementación propuesta:** verificar método y ruta exactos; conservar los estados HTTP apropiados en la API y adaptar errores para el modelo; controlar selección activa o cancelar peticiones obsoletas; añadir reintento de carga; sustituir `AnyRecord` por contratos tipados progresivamente. Mejorar revisión de propuestas con nombres/IBAN y vencimiento visible.

**Aceptación:** respuestas fuera de orden no cambian la selección; un fallo inicial permite recuperarse; método incorrecto devuelve 405. Esfuerzo: medio.

### Consideración separada: autenticación y despliegue

El selector permite asumir cualquier persona y los secretos predeterminados son conocidos. **Es una decisión explícita del entorno local del reto**, no un fallo que justifique sustituir ahora el simulador por una plataforma de identidad. Si se decide publicar una aplicación real, habría que separar el modo demo, implantar autenticación/roles, sesiones con caducidad y secretos propios. Esta ampliación tiene menor prioridad para la hackatón que corregir documentación y soporte.

## Lista 2: posibles mejoras funcionales basadas en los requisitos

Estas son funcionalidades propuestas, todavía no implementadas. La Parte 2 requiere elegir y demostrar al menos una.

| Mejora | Valor y relación con requisitos | MVP y demostración | Límites |
| --- | --- | --- | --- |
| **1. Copiloto de resolución de incidencias — recomendado** | Ayuda al operador a entender conversación, pasos y efectos; combina evidencia verificable con una síntesis útil del agente. | Cronología del caso, operación contrastada con el banco, resumen con citas, datos faltantes y borrador de respuesta para revisión humana. Demo: respuesta perdida y ausencia de trazas históricas. | El operador no ejecuta pagos; la IA no inventa comprobaciones. Depende de correcciones 4 y 5. |
| **2. Explicador de comisiones y requisitos** | Convierte políticas complejas en una decisión comprensible y rastreable para el cliente. | Para Aurora, explicar tarifa base y los dos requisitos de exención; permitir una simulación con datos declarados por el cliente y citar reglas aplicables. | El contrato de cuentas no aporta un campo estructurado de producto ni certificación de compras liquidadas/nómina; no prometer verificación automática a partir de descripciones. |
| **3. Asistente para recuperar pagos inciertos** | Da continuidad al flujo del agente ante timeouts y protege de duplicados. | «¿Qué ocurrió con mi pago?» encuentra la intención, comprueba la referencia y explica el estado; ofrece continuar con el pago original desde la UI. | No repetir pagos basándose solo en una frase ni crear nuevas referencias para recuperar uno anterior. |
| **4. Planificador de transferencias en modo simulación** | Ayuda a preparar decisiones sin confundir asesoramiento con autorización. | «Si envío 200 €, ¿cuánto me quedaría?» consulta saldo y calcula el escenario; solo crea propuesta cuando se solicita pagar. | Cálculos deterministas y confirmación explícita; no ejecutar desde la simulación. |
| **5. Respuestas con tarjeta de evidencia** | Permite comprobar fuentes, versión y vigencia desde el chat. | Cada afirmación documental relevante abre el documento y sección aplicables; estados «verificado», «faltan datos» y «requiere soporte» respaldados por comprobaciones concretas. | Las etiquetas no son porcentajes de confianza generados por el modelo. Se integra en el flujo del agente, no solo en la biblioteca. |
| **6. Comparador explicativo de políticas históricas** | Hace útil el corpus archivado sin mezclarlo con condiciones actuales. | Preguntar qué cambió entre agosto y septiembre para un producto; mostrar reglas anteriores/actuales y fuentes de ambas fechas. | No modificar retroactivamente saldos ni asegurar devoluciones sin documentación. |
| **7. Asistente multilingüe con continuidad humana** | Reduce fricción y evita que el cliente tenga que repetir su problema al pasar a soporte. | Responder en español o en el idioma del cliente; preparar un resumen para el operador enlazado a mensajes y evidencias. | El resumen no sustituye al historial original; conservar importes, condiciones y conceptos exactos. |

## Cómo integrar la API cuando se facilite

1. **Identificar el proveedor y capacidades.** El código está preparado para OpenAI. Si la API que se facilita es de otro proveedor, comprobar soporte de llamadas a herramientas, parámetros de razonamiento y embeddings; crear un adaptador cuando sea necesario.
2. **Configurar solo en el servidor.** Para el proveedor actual, utilizar `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL` y `OPENAI_EMBEDDING_MODEL` en `.env.local` o variables del entorno. La clave no debe aparecer en código, navegador, trazas ni ZIP.
3. **Separar chat de embeddings.** Poder simular ambos en pruebas y distinguir sus errores; evitar que una caída de búsqueda bloquee operaciones sin necesidad documental.
4. **Revisar compatibilidad del índice.** El índice incluido utiliza `text-embedding-3-small`, dimensión 1536. El código fija esa dimensión; cambiar proveedor/modelo puede requerir adaptar dimensión y regenerar todo el índice. Vectores de modelos distintos no son intercambiables aunque tengan el mismo tamaño.
5. **Probar conexión y comportamiento.** `npm run doctor` hará llamadas reales y consumirá cuota. Después ejecutar evaluaciones de citas, ausencia de evidencia, excepciones, herramientas, soporte y pagos inciertos. Confirmar que los modelos configurados están disponibles en el proyecto recibido.

Antes de recibir la API se pueden implementar y probar filtros, chunking, trazas, soporte, validación, interfaz y el flujo del agente con un proveedor simulado. La validación de calidad real del modelo queda pendiente.

## Orden de implementación recomendado

1. **Base verificable:** repetir comprobaciones en Node 24+ y guardar evidencias de los fallos y sesiones completas.
2. **Parte 1:** resolver conjuntamente propuestas 1–3; añadir pruebas de vigencia, citas y abstención. Completar 4–5 para reconstruir casos con hechos reales.
3. **Parte 2:** implementar el **copiloto de resolución de incidencias**, reutilizando la cronología y evidencias. Mostrar dos casos: operación con respuesta perdida y caso histórico con datos ausentes.
4. **Con la API:** ejecutar evaluaciones reales y comprobar conversación, propuestas y continuidad. Mantener la suite de transferencias y el simulador sin cambios de comportamiento.
5. **Entrega:** actualizar `submission/README.md`, incluir exportaciones originales completas de las sesiones, vídeo de 5–10 minutos o alternativa, y verificar el ZIP desde una carpeta limpia sin credenciales, dependencias ni artefactos de build.

No conviene dispersar el tiempo implementando todas las funcionalidades propuestas. El reto valora profundidad, demostración y una capacidad diferencial útil; documentación fiable más un copiloto de soporte forman un alcance coherente para las dos partes.

## Lo que ya está resuelto y conviene conservar

`docs/critical-fixes.md` y las pruebas confirman una base sólida: propuesta previa a ejecución, confirmación del titular vinculada al payload, expiración, referencia bancaria persistente por intención, protección de concurrencia e idempotencia, y recuperación de respuestas perdidas o consultas indisponibles mediante el pago original. No se presentan estos comportamientos como fallos pendientes.

La deuda histórica también importa: `src/seed.ts` incluye una intención antigua marcada `failed` por ausencia de respuesta. No debe asumirse que esa etiqueta prueba rechazo bancario ni inventarse una confirmación histórica para reejecutarla. El operador debe contrastar los efectos disponibles y explicar qué evidencia falta.
