import { after, NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { firmaValida } from "@/lib/whatsapp/firma";
import { parsearMontoLibre, registrarDevolucion, responderDevoluciones, verificarExpensas } from "@/lib/expensas/flujo";
import { futbolNativoActivo, manejarMensajeFutbol } from "@/lib/futbol/bot";
import { enviarTexto } from "@/lib/whatsapp/enviar";

// El flujo de expensas (Gmail + planilla + WhatsApp) corre en after() y puede
// tardar más que la respuesta a Meta.
export const maxDuration = 120;

// Verificación del webhook que hace Meta al configurarlo.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === env("WHATSAPP_VERIFY_TOKEN")) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

type MensajeEntrante = { from: string; type: string; text?: { body: string } };

// Reenvía el payload tal cual al workflow de n8n del bot de fútbol. Solo se usa
// mientras no esté configurado FUTBOL_BOT_SECRET (el bot de fútbol en código).
async function reenviarAFutbol(cuerpo: string, firma: string | null): Promise<void> {
  const url = process.env.N8N_FUTBOL_WEBHOOK_URL;
  if (!url) return; // mientras no esté configurada, no reenvía nada
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (firma) headers["x-hub-signature-256"] = firma;
    const res = await fetch(url, { method: "POST", headers, body: cuerpo });
    if (!res.ok) console.error(`Reenvío a n8n falló: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error("Error reenviando a n8n", err);
  }
}

export async function POST(req: NextRequest) {
  const cuerpo = await req.text();
  const firma = req.headers.get("x-hub-signature-256");
  if (!firmaValida(cuerpo, firma, env("META_APP_SECRET"))) {
    return new NextResponse("Firma inválida", { status: 401 });
  }

  const data = JSON.parse(cuerpo);
  const value = data?.entry?.[0]?.changes?.[0]?.value;
  const mensajes: MensajeEntrante[] = value?.messages ?? [];
  // Número del bot que recibió el mensaje: se responde desde ese mismo.
  const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
  const permitidos = (process.env.WHATSAPP_ALLOWED_NUMBERS ?? "").split(",").map((n) => n.trim()).filter(Boolean);

  // Comandos de expensas (solo números autorizados): "expensas" (o "verificar
  // expensas") y "devolución <concepto> <monto>". Todo lo demás es del bot de
  // fútbol, salvo la respuesta a la pregunta de devoluciones ("jardinero $15000" / "no").
  let paraExpensas = false;
  const paraFutbol: MensajeEntrante[] = [];
  for (const msg of mensajes) {
    const texto = msg.text?.body?.trim().toLowerCase() ?? "";
    const esPermitido = !permitidos.length || permitidos.includes(msg.from);
    // Meta exige responder rápido; el trabajo pesado corre después de la respuesta.
    if (esPermitido && (texto === "expensas" || texto.includes("verificar expensas"))) {
      paraExpensas = true;
      after(() => verificarExpensas(msg.from, phoneNumberId));
    } else if (esPermitido && /^devoluci[oó]n\b/.test(texto)) {
      paraExpensas = true;
      // "devolución bomba 200000": el concepto es todo menos la última palabra (el monto).
      const original = msg.text?.body?.trim() ?? "";
      const m = /^devoluci[oó]n\s+(.+?)\s+(\$?\s*[\d.,]+)$/i.exec(original);
      const monto = m ? parsearMontoLibre(m[2]) : null;
      after(() =>
        m && monto
          ? registrarDevolucion(msg.from, m[1].trim(), monto, phoneNumberId)
          : enviarTexto(msg.from, "Formato: devolución <concepto> <monto>. Ej: devolución bomba 200000", phoneNumberId),
      );
    } else {
      paraFutbol.push(msg);
    }
  }

  const esRespuestaDevoluciones = async (msg: MensajeEntrante) =>
    (!permitidos.length || permitidos.includes(msg.from)) &&
    Boolean(msg.text?.body) &&
    (await responderDevoluciones(msg.from, msg.text?.body ?? "", phoneNumberId));

  if (futbolNativoActivo()) {
    for (const msg of paraFutbol) {
      const texto = msg.text?.body?.trim();
      if (!texto) continue; // estados de entrega, audios, fotos: el bot de fútbol solo entiende texto
      after(async () => {
        if (await esRespuestaDevoluciones(msg)) return;
        await manejarMensajeFutbol(msg.from, texto);
      });
    }
  } else if (!paraExpensas) {
    // Bot de fútbol todavía en n8n: se le reenvía el payload completo.
    after(async () => {
      for (const msg of paraFutbol) if (await esRespuestaDevoluciones(msg)) return;
      await reenviarAFutbol(cuerpo, firma);
    });
  }

  return NextResponse.json({ ok: true });
}
