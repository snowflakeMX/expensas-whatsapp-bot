import type { gmail_v1 } from "googleapis";
import { gmail } from "@/lib/google/cliente";
import { env } from "@/lib/env";

export type MailExpensas = { nombrePdf: string; pdf: Buffer };

// Busca recursivamente la primera parte del mail que sea un PDF adjunto.
function buscarPdf(parte: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart | undefined {
  if (!parte) return undefined;
  const esPdf = parte.mimeType === "application/pdf" || parte.filename?.toLowerCase().endsWith(".pdf");
  if (esPdf && parte.body?.attachmentId) return parte;
  for (const hija of parte.parts ?? []) {
    const encontrada = buscarPdf(hija);
    if (encontrada) return encontrada;
  }
  return undefined;
}

// PDFs adjuntos de los últimos mails que matchean EXPENSAS_GMAIL_QUERY (el más
// nuevo primero). Se devuelven varios porque los mails reenviados pueden no
// llegar en orden: el flujo elige el de período más reciente.
export async function buscarMailsExpensas(cantidad = 10): Promise<MailExpensas[]> {
  const api = gmail();
  const { data } = await api.users.messages.list({ userId: "me", q: env("EXPENSAS_GMAIL_QUERY"), maxResults: cantidad });

  const mails: MailExpensas[] = [];
  for (const { id } of data.messages ?? []) {
    if (!id) continue;
    const { data: mensaje } = await api.users.messages.get({ userId: "me", id, format: "full" });
    const parte = buscarPdf(mensaje.payload);
    if (!parte?.body?.attachmentId) continue;

    const { data: adjunto } = await api.users.messages.attachments.get({
      userId: "me",
      messageId: id,
      id: parte.body.attachmentId,
    });
    mails.push({ nombrePdf: parte.filename || "expensas.pdf", pdf: Buffer.from(adjunto.data ?? "", "base64url") });
  }
  return mails;
}
