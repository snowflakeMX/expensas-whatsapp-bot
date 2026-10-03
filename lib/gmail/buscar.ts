import { gmail } from "@/lib/google/cliente";
import { env } from "@/lib/env";

export type MailExpensas = {
  id: string;
  asunto: string;
  remitente: string;
  fecha: string;
  pdf: Buffer;
  nombreArchivo: string;
};

// Busca el mail de expensas más reciente que matchee EXPENSAS_GMAIL_QUERY y
// devuelve su primer adjunto PDF. null si no encuentra nada.
export async function buscarUltimoMailDeExpensas(): Promise<MailExpensas | null> {
  const api = gmail();
  const query = env("EXPENSAS_GMAIL_QUERY");

  const lista = await api.users.messages.list({ userId: "me", q: query, maxResults: 1 });
  const id = lista.data.messages?.[0]?.id;
  if (!id) return null;

  const mensaje = await api.users.messages.get({ userId: "me", id, format: "full" });
  const headers = mensaje.data.payload?.headers ?? [];
  const asunto = headers.find((h) => h.name === "Subject")?.value ?? "(sin asunto)";
  const remitente = headers.find((h) => h.name === "From")?.value ?? "(desconocido)";
  const fecha = headers.find((h) => h.name === "Date")?.value ?? "";

  const parte = buscarPartePdf(mensaje.data.payload);
  if (!parte?.body?.attachmentId) return null;

  const adjunto = await api.users.messages.attachments.get({
    userId: "me",
    messageId: id,
    id: parte.body.attachmentId,
  });
  if (!adjunto.data.data) return null;

  // Gmail devuelve el adjunto en base64url.
  const pdf = Buffer.from(adjunto.data.data, "base64url");

  return { id, asunto, remitente, fecha, pdf, nombreArchivo: parte.filename || "expensas.pdf" };
}

type Parte = {
  mimeType?: string | null;
  filename?: string | null;
  body?: { attachmentId?: string | null } | null;
  parts?: Parte[] | null;
};

// El PDF puede venir en cualquier nivel de anidamiento (multipart/mixed con
// multipart/alternative adentro, etc.), así que se busca recursivamente.
function buscarPartePdf(payload: Parte | undefined): Parte | undefined {
  if (!payload) return undefined;
  if (payload.mimeType === "application/pdf" && payload.body?.attachmentId) return payload;
  for (const sub of payload.parts ?? []) {
    const encontrada = buscarPartePdf(sub);
    if (encontrada) return encontrada;
  }
  return undefined;
}
