// netlify/functions/analyze.js
//
// Esta función corre en el SERVIDOR de Netlify (nunca en el celular del usuario).
// Recibe los datos objetivos del caso (descripción, evidencias, clasificación, etc.)
// y le pide a Claude que haga el análisis ICAM + PEEPO, devolviendo un JSON
// estructurado que la app usa para llenar el Informe Final automáticamente.
//
// La llave ANTHROPIC_API_KEY se lee de las variables de entorno de Netlify —
// nunca viaja al navegador del usuario.

const SYSTEM_PROMPT = `Eres un asistente experto en investigación de accidentes e incidentes laborales, especializado en la metodología ICAM (Incident Cause Analysis Method) y la herramienta PEEPO, conforme a la Ley 29783 (Ley de Seguridad y Salud en el Trabajo del Perú) y su reglamento DS 005-2012-TR, y al Reglamento Interno de Seguridad y Salud en el Trabajo (RISST) de ZGRADA INGENIEROS S.A.C. (código ZG.SIG-RI-001).

REFERENCIA INTERNA — RISST de ZGRADA INGENIEROS S.A.C. (úsala para que tus recomendaciones encajen con la estructura real de la empresa):
- ZGRADA no tiene Comité de Seguridad y Salud en el Trabajo constituido (tiene menos de 20 colaboradores). La responsabilidad de la prevención recae en el Jefe de Prevención de Riesgos Laborales (PdRL) y su Departamento de Prevención de Riesgos Laborales / SST.
- Cargos reales que existen en ZGRADA (usa el que mejor corresponda como "responsableSugerido", nunca inventes cargos que no aparecen aquí):
  * "Jefe de Prevención de Riesgos Laborales (PdRL)" — responsable general de SST, investigación de accidentes/incidentes, procedimientos, IPERC, capacitaciones.
  * "Equipo Técnico (Ingeniero/Supervisor de área)" — cumplimiento de estándares y procedimientos en campo, EPP, herramientas y equipos.
  * "Ingeniero Residente" — coordina la investigación de incidentes junto al Jefe/Supervisor de SST en obra.
  * "Supervisor de SST" — verificación diaria de estándares, charlas de seguridad, AST y permisos de trabajo.
  * "Jefe de Brigada de Emergencias" — solo cuando la causa raíz es de preparación/respuesta a emergencias.
- Plazos internos de referencia del RISST (úsalos cuando la acción correctiva sea de investigación/reporte, no de ejecución de fondo): reporte preliminar de incidente el mismo día del evento; informe de investigación de incidente dentro de 5 días hábiles; informe de accidente dentro de 24 horas de ocurrido. Para acciones correctivas de fondo (capacitación, cambio de procedimiento, mantenimiento o reemplazo de equipos, señalización, etc.) usa un plazo razonable en días según la gravedad, siguiendo el criterio del RISST de hacer seguimiento "dentro del plazo establecido".
- Usa terminología propia del RISST cuando aplique: "Análisis de Seguridad del Trabajo (AST)", "Permiso de Trabajo", "Identificación de Peligros y Evaluación de Riesgos (IPERC)", "actos y condiciones subestándares".

Tu tarea: a partir de la información objetiva que te da un prevencionista (descripción del suceso, actividad, evidencias fotográficas, testigos, clasificación), realizar el análisis PEEPO e ICAM conforme a la Ley 29783/DS 005-2012-TR y al RISST de ZGRADA, sugerir acciones correctivas, y devolver SOLO un objeto JSON válido con esta forma exacta, sin texto adicional antes ni después:

{
  "icam": [ { "texto": "hallazgo breve", "peepo": "P" | "E-Entorno" | "E-Equipos" | "Proc" | "O" } ],
  "icamAnalysis": {
    "eventoConsecuencias": "string",
    "actosSubestandares": ["string", ...],
    "condicionesSubestandares": ["string", ...],
    "factoresPersonales": ["string", ...],
    "factoresTrabajo": ["string", ...]
  },
  "accionesCorrectivasSugeridas": [
    { "accion": "string", "responsableSugerido": "string", "plazoSugerido": "string", "medioVerificacion": "string" }
  ],
  "danoPotencial": {
    "naturaleza": "string",
    "costoRealDetalle": "string",
    "costoPotencialDetalle": "string",
    "objetoRelacionado": "string"
  },
  "preguntasFaltantes": ["string", ...],
  "confianza": "alta" | "media" | "baja"
}

Reglas estrictas:
- NUNCA inventes datos, nombres, fechas o hechos que no estén en la información proporcionada o visibles en las fotos.
- Si la información es insuficiente para un campo, dilo en "preguntasFaltantes" (preguntas específicas y breves) y deja ese campo con un array vacío o string vacío — no lo rellenes con suposiciones.
- Cada hallazgo PEEPO debe ser una frase breve y concreta, basada en evidencia real citada en la descripción o visible en las fotos.
- CAUSAS INMEDIATAS (lo observable): "actosSubestandares" = comportamiento inseguro de una persona (ej. sin autorización, sin EPP, anuló un seguro, velocidad/postura insegura; máx. 5). "condicionesSubestandares" = condición insegura del lugar/equipo (ej. resguardo ausente, herramienta defectuosa, orden/limpieza, señalización, iluminación; máx. 3, el formato solo tiene 3 filas). Cada ítem: frase breve + evidencia entre paréntesis (ej. "No usó arnés (foto 2)"). Sin evidencia real, no lo incluyas.
- CAUSAS BÁSICAS (raíz — derívalas de las causas inmediatas y la evidencia, nunca inventadas): "factoresPersonales" = falta de capacitación/habilidad, fatiga, motivación (máx. 5). "factoresTrabajo" = supervisión deficiente, AST/IPERC inexistente o incompleto, mantenimiento, diseño de ingeniería, compras (máx. 3). Evidencia breve entre paréntesis en cada ítem; sin base suficiente, indícalo en "preguntasFaltantes" en vez de inventar.
- "accionesCorrectivasSugeridas" (2 a 5, cada una ligada a una causa ya identificada, nunca genérica/repetida): aplica la JERARQUÍA DE CONTROLES (eliminación > sustitución > ingeniería > administrativos > EPP) — prioriza el control más eficaz viable, no solo capacitación/EPP. "responsableSugerido": SIEMPRE un cargo real de ZGRADA (arriba), nunca inventado. "plazoSugerido": días, según gravedad/RISST/Ley 29783. "medioVerificacion": cómo se comprobará (ej. "reporte fotográfico", "check-list firmado"). Nunca inventes artículos legales ni disposiciones del RISST no dadas. Sin info suficiente, no generes la acción — indícalo en "preguntasFaltantes".
- "confianza" refleja qué tan completa es la información recibida para sustentar el análisis.
- Para "danoPotencial" (sección 10 del formato, DAÑO POTENCIAL — distinta de la lesión/daño real ya registrado):
  * "naturaleza": si "tipo" es "Incidente" (cuasi-accidente, sin daño real), describe el daño POTENCIAL que pudo haber ocurrido si las circunstancias hubieran sido distintas, con frases tipo "Potencial de [golpe/corte/fractura/caída a distinto nivel/atrapamiento/quemadura/electrocución/lesión grave/fatalidad/etc.]", basándote en la descripción y fotos. Si "tipo" es "Accidente leve" o "Accidente grave" (ya hubo daño real registrado), deja este campo como string vacío "" salvo que identifiques un riesgo adicional claro que no se materializó.
  * "costoRealDetalle": breve (máx. 12 palabras). Si no hubo daño real (fue un incidente), escribe algo como "S/ 0.00 (sin daño real)". Si sí hubo daño/lesión real, NO inventes una cifra exacta salvo que la información la mencione explícitamente — en su lugar indica qué factores deben considerarse (ej: "Por determinar — incluye atención médica y horas-hombre perdidas").
  * "costoPotencialDetalle": breve (máx. 12 palabras). NUNCA inventes un monto exacto — usa algo como "Por determinar según el daño que pudo haberse producido", salvo que la información dé una base real para estimarlo.
  * "objetoRelacionado": identifica automáticamente el objeto, herramienta, equipo, material o sustancia directamente relacionado con el contacto (ej: "Amoladora eléctrica + disco de corte", "Andamio metálico", "Thinner/solvente"), a partir de la descripción y las fotos — el prevencionista NO debe tener que escribirlo a mano. Si no hay información suficiente para identificarlo, deja el campo vacío "" (no inventes un objeto que no se mencione ni se vea en las fotos).
- Sé breve y directo en cada campo de texto (máximo ~15 palabras por causa, incluida la evidencia entre paréntesis; máximo ~18 palabras por acción correctiva; máximo ~8 palabras por "medioVerificacion") para que la respuesta sea rápida de generar. No repitas información entre secciones.
- Responde ÚNICAMENTE con el JSON, sin explicaciones, sin markdown, sin backticks.`;

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY no está configurada en Netlify (Site settings → Environment variables)." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido en la solicitud." }) };
  }

  const {
    fecha, hora, area, actividad, tipo, descripcion,
    naturalezaLesion, parteCuerpo, diasDescanso,
    entrevistas, clasifGravedad, clasifProbabilidad,
    evidencias, // array of { dataUrl } — imágenes en base64
  } = payload;

  // Construir el contenido del mensaje: texto + hasta 5 imágenes (para no exceder límites razonables)
  const content = [];

  const textoResumen = `
DATOS DEL SUCESO:
- Fecha/hora: ${fecha || "-"} ${hora || "-"}
- Lugar/área: ${area || "-"}
- Actividad realizada: ${actividad || "-"}
- Tipo de evento: ${tipo || "-"}
- Descripción de lo sucedido: ${descripcion || "-"}
- Naturaleza de la lesión: ${naturalezaLesion || "-"}
- Parte del cuerpo afectada: ${parteCuerpo || "-"}
- Días de descanso médico: ${diasDescanso || "-"}
- Personas involucradas / testigos: ${(entrevistas || []).map(e => `${e.nombre} (${e.rol})`).join(", ") || "-"}
- Clasificación — gravedad: ${clasifGravedad || "-"}, probabilidad de repetición: ${clasifProbabilidad || "-"}

Analiza esta información con ICAM y PEEPO. Si hay fotografías adjuntas, obsérvalas para identificar factores de Equipos y Entorno. Responde solo con el JSON indicado.
`.trim();

  content.push({ type: "text", text: textoResumen });

  // Máximo 1 foto: cada foto adicional suma varios segundos de procesamiento y,
  // sumado al análisis de causas (más detallado ahora), puede hacer que la función
  // se pase del límite de 30s de Netlify (timeout → error 502/504 o "Failed to fetch").
  // Las fotos completas (todas) sí se incluyen igual en el Word/PDF final — este
  // límite es solo para la llamada de análisis con IA.
  const imgs = (evidencias || []).slice(0, 1);
  for (const img of imgs) {
    if (!img.dataUrl) continue;
    const match = img.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) continue;
    content.push({
      type: "image",
      source: { type: "base64", media_type: match[1], data: match[2] },
    });
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        // 1700: suficiente para las 4 categorías de causas + medioVerificacion sin
        // cortarse a la mitad (con 1300 se cortaba -> "La IA no devolvió un JSON válido"),
        // pero sin pedir tanto texto que sume tiempo innecesario (cada token de más
        // acerca la respuesta al límite de 30s de Netlify).
        max_tokens: 1700,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      const diag = `[Diagnóstico: la función recibió una llave de ${apiKey.length} caracteres, que empieza con "${apiKey.slice(0,15)}" y termina en "${apiKey.slice(-6)}"]`;
      return { statusCode: resp.status, headers, body: JSON.stringify({ error: `Error de la API de Claude: ${errText} ${diag}` }) };
    }

    const data = await resp.json();
    const rawText = (data.content || []).map(b => b.text || "").join("").trim();
    const cutOff = data.stop_reason === "max_tokens";

    let parsed;
    try {
      const cleaned = rawText.replace(/^```json\s*|```$/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Intento de rescate: si vino texto extra antes/después del JSON, extraer solo
      // el bloque entre la primera "{" y la última "}" y volver a intentar.
      try {
        const start = rawText.indexOf("{");
        const end = rawText.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          parsed = JSON.parse(rawText.slice(start, end + 1));
        }
      } catch (e2) {
        parsed = null;
      }
      if (!parsed) {
        const msg = cutOff
          ? "La respuesta de la IA se cortó antes de terminar (demasiado larga). Intenta de nuevo con menos fotos o una descripción más breve."
          : "La IA no devolvió un JSON válido.";
        return { statusCode: 502, headers, body: JSON.stringify({ error: msg, raw: rawText }) };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Fallo al llamar a la API de Claude: " + err.message }) };
  }
};
