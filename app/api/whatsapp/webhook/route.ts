import { after, NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { firmaValida } from "@/lib/whatsapp/firma";
import { verificarExpensas } from "@/lib/expensas/flujo";

// Verificación del webhook que hace Meta al configurarlo.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === env("WHATSAPP_VERIFY_TOKEN")) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

type MensajeEntrante = { from: string; type: string; text?: { body: string } };

// Reenvía el payload tal cual al workflow de n8n del bot de fútbol, que sigue
// siendo dueño de ese número para todo lo que no sea "verificar expensas".
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

  // Sin mensajes (ej. actualizaciones de estado) o nada que matchee "verificar
  // expensas": es tráfico del bot de fútbol, se reenvía sin tocar.
  let paraExpensas = false;
  for (const msg of mensajes) {
    const texto = msg.text?.body?.trim().toLowerCase() ?? "";
    const esPermitido = !permitidos.length || permitidos.includes(msg.from);
    if (esPermitido && texto.includes("verificar expensas")) {
      paraExpensas = true;
      // Meta exige responder rápido; el trabajo pesado corre después de la respuesta.
      after(() => verificarExpensas(msg.from, phoneNumberId));
    }
  }

  if (!paraExpensas) {
    after(() => reenviarAFutbol(cuerpo, firma));
  }

  return NextResponse.json({ ok: true });
}
