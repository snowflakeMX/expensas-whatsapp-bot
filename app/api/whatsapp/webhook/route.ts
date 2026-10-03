import { after, NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { firmaValida } from "@/lib/whatsapp/firma";
import { enviarTexto } from "@/lib/whatsapp/enviar";
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

export async function POST(req: NextRequest) {
  const cuerpo = await req.text();
  if (!firmaValida(cuerpo, req.headers.get("x-hub-signature-256"), env("META_APP_SECRET"))) {
    return new NextResponse("Firma inválida", { status: 401 });
  }

  const data = JSON.parse(cuerpo);
  const mensajes: MensajeEntrante[] = data?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];
  const permitidos = (process.env.WHATSAPP_ALLOWED_NUMBERS ?? "").split(",").map((n) => n.trim()).filter(Boolean);

  for (const msg of mensajes) {
    if (permitidos.length && !permitidos.includes(msg.from)) continue;
    const texto = msg.text?.body?.trim().toLowerCase() ?? "";
    // Meta exige responder rápido; el trabajo pesado corre después de la respuesta.
    if (texto.includes("verificar expensas")) {
      after(() => verificarExpensas(msg.from));
    } else {
      after(() => enviarTexto(msg.from, 'Escribí "verificar expensas" para revisar las expensas del mes.'));
    }
  }

  return NextResponse.json({ ok: true });
}
