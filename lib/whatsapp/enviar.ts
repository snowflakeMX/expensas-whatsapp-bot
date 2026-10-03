import { env } from "@/lib/env";
import { telefonoParaEnvio } from "./telefono";

function graphUrl(path: string): string {
  const version = process.env.WHATSAPP_GRAPH_VERSION ?? "v25.0";
  return `https://graph.facebook.com/${version}/${path}`;
}

async function enviarMensaje(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(graphUrl(`${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) throw new Error(`WhatsApp respondió ${res.status}: ${await res.text()}`);
}

export async function enviarTexto(waId: string, texto: string): Promise<void> {
  await enviarMensaje({ to: telefonoParaEnvio(waId), type: "text", text: { body: texto } });
}

// Sube un archivo a WhatsApp y devuelve el media id para mandarlo como documento.
export async function subirMedia(archivo: Buffer, nombre: string, mimeType: string): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([new Uint8Array(archivo)], { type: mimeType }), nombre);
  const res = await fetch(graphUrl(`${env("WHATSAPP_PHONE_NUMBER_ID")}/media`), {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Subida de media falló ${res.status}: ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

export async function enviarDocumento(waId: string, mediaId: string, nombre: string, caption?: string): Promise<void> {
  await enviarMensaje({
    to: telefonoParaEnvio(waId),
    type: "document",
    document: { id: mediaId, filename: nombre, caption },
  });
}
