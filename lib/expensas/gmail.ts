import type { gmail_v1 } from "googleapis";
import { gmail } from "@/lib/google/cliente";
import { env } from "@/lib/env";

export type MailExpensas = { nombrePdf: string; pdf: Buffer };

// El mail de la administración (Simple Solutions) no adjunta el PDF: trae un
// link a su bucket de S3. Solo se descargan links de ese lugar.
const LINK_PDF = /https:\/\/simplesolutionscloud\.s3\.sa-east-1\.amazonaws\.com\/elnaudir\/[\w.-]+\.pdf/;
const MAX_PDF = 10 * 1024 * 1024;

// Recorre las partes del mail (adjuntos y cuerpos anidados).
function* partes(parte: gmail_v1.Schema$MessagePart | undefined): Generator<gmail_v1.Schema$MessagePart> {
  if (!parte) return;
  yield parte;
  for (const hija of parte.parts ?? []) yield* partes(hija);
}

const decodificar = (data?: string | null) => Buffer.from(data ?? "", "base64url").toString("utf8");

async function descargarLink(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`No pude bajar el PDF del link (${res.status}).`);
  const pdf = Buffer.from(await res.arrayBuffer());
  if (pdf.length > MAX_PDF || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("El link no devolvió un PDF.");
  return pdf;
}

// PDF del mail: el adjunto si lo hay, si no el link de la administración en el cuerpo.
async function pdfDelMail(api: gmail_v1.Gmail, id: string, mensaje: gmail_v1.Schema$Message): Promise<MailExpensas | null> {
  const todas = [...partes(mensaje.payload)];

  const adjunto = todas.find(
    (p) => (p.mimeType === "application/pdf" || p.filename?.toLowerCase().endsWith(".pdf")) && p.body?.attachmentId,
  );
  if (adjunto?.body?.attachmentId) {
    const { data } = await api.users.messages.attachments.get({ userId: "me", messageId: id, id: adjunto.body.attachmentId });
    return { nombrePdf: adjunto.filename || "expensas.pdf", pdf: Buffer.from(data.data ?? "", "base64url") };
  }

  for (const p of todas.filter((p) => p.mimeType === "text/html" || p.mimeType === "text/plain")) {
    const cuerpo = decodificar(p.body?.data);
    const url = LINK_PDF.exec(cuerpo)?.[0];
    if (!url) continue;
    // El texto del link es el nombre "lindo" del archivo, ej. 202609-555.pdf.
    const nombre = new RegExp(`${url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[^>]*>\\s*([\\w.-]+\\.pdf)\\s*<`).exec(cuerpo)?.[1];
    return { nombrePdf: nombre ?? url.split("/").at(-1)!, pdf: await descargarLink(url) };
  }
  return null;
}

// PDFs de los últimos mails que matchean EXPENSAS_GMAIL_QUERY (el más nuevo
// primero). Se devuelven varios porque los mails reenviados pueden no llegar
// en orden: el flujo elige el de período más reciente.
export async function buscarMailsExpensas(cantidad = 10): Promise<MailExpensas[]> {
  const api = gmail();
  const { data } = await api.users.messages.list({ userId: "me", q: env("EXPENSAS_GMAIL_QUERY"), maxResults: cantidad });

  const mails: MailExpensas[] = [];
  for (const { id } of data.messages ?? []) {
    if (!id) continue;
    const { data: mensaje } = await api.users.messages.get({ userId: "me", id, format: "full" });
    try {
      const mail = await pdfDelMail(api, id, mensaje);
      if (mail) mails.push(mail);
    } catch (err) {
      console.error(`No pude obtener el PDF del mail ${id}`, err);
    }
  }
  return mails;
}
