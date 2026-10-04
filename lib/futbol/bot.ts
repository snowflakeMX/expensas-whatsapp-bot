// Bot de fútbol: el mismo flujo que tenía el workflow de n8n "Bot Futbol Semanal -
// Principal", ahora en código. Toda la lógica vive en futbol-semanal-app
// (rutas /api/bot/*); acá solo se encadenan las llamadas:
//   allowlist -> interpretar -> acción (tabla, partidos, confirmar, resultado,
//   convocatoria, alta) -> enviar el texto que devolvió la acción.
// Las rutas se autentican con "Authorization: Bearer <WEBHOOK_SHARED_SECRET>"
// de futbol-semanal-app, que acá se configura como FUTBOL_BOT_SECRET.

const TIMEOUT_MS = 30_000;

const baseUrl = () => (process.env.FUTBOL_API_URL?.trim() || "https://futbol-semanal-app.vercel.app").replace(/\/$/, "");

export const futbolNativoActivo = () => Boolean(process.env.FUTBOL_BOT_SECRET?.trim());

type Respuesta = Record<string, unknown>;

async function llamar(ruta: string, body: Record<string, unknown>): Promise<Respuesta> {
  const res = await fetch(`${baseUrl()}/api/bot/${ruta}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.FUTBOL_BOT_SECRET?.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as Respuesta;
  // Las rutas de acción responden { texto } también en los errores: se manda igual.
  if (!res.ok && typeof json.texto !== "string") {
    throw new Error(`/api/bot/${ruta} respondió ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

// Qué ruta llamar para cada acción de /api/bot/interpretar y con qué datos.
function accionARuta(accion: unknown, i: Respuesta, telefono: string, mensaje: string): [string, Respuesta] | null {
  switch (accion) {
    case "ver_tabla":
      return ["tabla", {}];
    case "ver_partidos":
      return ["partidos", {}];
    case "confirmar_jugador":
      return ["confirmar", { jugador: i.jugador, respuesta: i.respuesta, fecha: i.fecha ?? null }];
    case "cargar_resultado":
      return ["resultado", { resultado: i.resultado ?? null, fecha: i.fecha ?? null }];
    case "crear_convocatoria":
      return ["convocatoria", { fecha: i.fecha ?? null, hora: i.hora ?? null, cupo: i.cupo ?? null }];
    case "alta_jugador":
      return ["alta", { telefono, mensaje }];
    default:
      // "menu" u otras: el workflow de n8n tampoco respondía.
      return null;
  }
}

// telefono: el wa_id de Meta (sin "+"). mensaje: el texto recibido.
export async function manejarMensajeFutbol(telefono: string, mensaje: string): Promise<void> {
  try {
    const permiso = await llamar("allowlist", { telefono });
    if (permiso.autorizado !== true) return;

    const interpretacion = await llamar("interpretar", { telefono, mensaje });
    const ruta = accionARuta(interpretacion.accion, interpretacion, telefono, mensaje);
    if (!ruta) return;

    const { texto } = await llamar(...ruta);
    if (typeof texto === "string" && texto.trim()) {
      await llamar("enviar", { telefono: `+${telefono}`, mensaje: texto });
    }
  } catch (err) {
    console.error("Bot de fútbol: error procesando el mensaje", err);
  }
}
