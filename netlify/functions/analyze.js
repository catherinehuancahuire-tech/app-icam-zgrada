// netlify/functions/analyze.js
//
// Esta función corre en el SERVIDOR de Netlify (nunca en el celular del usuario).
// Recibe los datos objetivos del caso (descripción, evidencias, clasificación, etc.)
// y le pide a Claude que haga el análisis ICAM + PEEPO, devolviendo un JSON
// estructurado que la app usa para llenar el Informe Final automáticamente.
//
// La llave ANTHROPIC_API_KEY se lee de las variables de entorno de Netlify —
// nunca viaja al navegador del usuario.

const SYSTEM_PROMPT = `Eres un asistente experto en investigación de accidentes e incidentes laborales, especializado en la metodología ICAM (Incident Cause Analysis Method) y la herramienta PEEPO, conforme a la Ley 29783 (Ley de Seguridad y Salud en el Trabajo del Perú) y su reglamento DS 005-2012-TR.

Tu tarea: a partir de la información objetiva que te da un prevencionista (descripción del suceso, actividad, evidencias fotográficas, testigos, clasificación), realizar el análisis PEEPO e ICAM y devolver SOLO un objeto JSON válido con esta forma exacta, sin texto adicional antes ni después:

{
  "icam": [ { "texto": "hallazgo breve", "peepo": "P" | "E-Entorno" | "E-Equipos" | "Proc" | "O" } ],
  "icamAnalysis": {
    "eventoConsecuencias": "string",
    "barreras": ["string", ...],
    "accionesInmediatas": ["string", ...],
    "factoresContribuyentes": ["string", ...],
    "factoresOrganizacionales": ["string", ...],
    "causasSubyacentes": "string"
  },
  "preguntasFaltantes": ["string", ...],
  "confianza": "alta" | "media" | "baja"
}

Reglas estrictas:
- NUNCA inventes datos, nombres, fechas o hechos que no estén en la información proporcionada o visibles en las fotos.
- Si la información es insuficiente para un campo, dilo en "preguntasFaltantes" (preguntas específicas y breves) y deja ese campo con un array vacío o string vacío — no lo rellenes con suposiciones.
- Usa terminología de la Ley 29783: causas inmediatas = actos y condiciones subestándares; causas básicas = factores personales y factores del trabajo.
- Cada hallazgo PEEPO debe ser una frase breve y concreta, basada en evidencia real citada en la descripción o visible en las fotos.
- "confianza" refleja qué tan completa es la información recibida para sustentar el análisis.
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

  const imgs = (evidencias || []).slice(0, 5);
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
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: resp.status, headers, body: JSON.stringify({ error: `Error de la API de Claude: ${errText}` }) };
    }

    const data = await resp.json();
    const rawText = (data.content || []).map(b => b.text || "").join("").trim();

    let parsed;
    try {
      const cleaned = rawText.replace(/^```json\s*|```$/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "La IA no devolvió un JSON válido.", raw: rawText }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Fallo al llamar a la API de Claude: " + err.message }) };
  }
};
