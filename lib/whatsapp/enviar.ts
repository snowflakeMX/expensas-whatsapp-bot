import { env } from "@/lib/env";
import { telefonoParaEnvio } from "./telefono";

function graphUrl(path: string): string {
  const version = process.env.WHATSAPP_GRAPH_VERSION ?? "v25.0";
  return `https://graph.facebook.com/${version}/${path}`;
}

// Número desde el que se responde: el que recibió el mensaje (viene en el
// webhook); si no se pasa, el configurado en WHATSAPP_PHONE_NUMBER_ID.
function numeroEmisor(phoneNumberId?: string): string {
  return phoneNumberId || env("WHATSAPP_PHONE_NUMBER_ID");
}

async function enviarMensaje(payload: Record<string, unknown>, phoneNumberId?: string): Promise<void> {
  const res = await fetch(graphUrl(`${numeroEmisor(phoneNumberId)}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) throw new Error(`WhatsApp respondió ${res.status}: ${await res.text()}`);
}

export async function enviarTexto(waId: string, texto: string, phoneNumberId?: string): Promise<void> {
  await enviarMensaje({ to: telefonoParaEnvio(waId), type: "text", text: { body: texto } }, phoneNumberId);
}

// Sube un archivo a WhatsApp y devuelve el media id para mandarlo como documento.
export async function subirMedia(
  archivo: Buffer,
  nombre: string,
  mimeType: string,
  phoneNumberId?: string,
): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([new Uint8Array(archivo)], { type: mimeType }), nombre);
  const res = await fetch(graphUrl(`${numeroEmisor(phoneNumberId)}/media`), {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Subida de media falló ${res.status}: ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

export async function enviarDocumento(
  waId: string,
  mediaId: string,
  nombre: string,
  caption?: string,
  phoneNumberId?: string,
): Promise<void> {
  await enviarMensaje(
    {
      to: telefonoParaEnvio(waId),
      type: "document",
      document: { id: mediaId, filename: nombre, caption },
    },
    phoneNumberId,
  );
}
