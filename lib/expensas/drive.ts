import { Readable } from "node:stream";
import { drive } from "@/lib/google/cliente";
import { env } from "@/lib/env";
import type { Analisis } from "./analisis";
import type { MailExpensas } from "./gmail";

export const pesos = (monto: number) =>
  monto.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

const escapar = (texto: string) =>
  texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function tabla(analisis: Analisis, paga: "inquilino" | "propietario"): string {
  const filas = analisis.conceptos
    .filter((c) => c.paga === paga)
    .map((c) => `<tr><td>${escapar(c.descripcion)}</td><td>${c.tipo}</td><td style="text-align:right">${pesos(c.monto)}</td><td>${escapar(c.motivo)}</td></tr>`)
    .join("");
  return `<table border="1" cellpadding="4" style="border-collapse:collapse">
<tr><th>Concepto</th><th>Tipo</th><th>Monto</th><th>Motivo</th></tr>
${filas || `<tr><td colspan="4">Sin conceptos</td></tr>`}
</table>`;
}

function html(analisis: Analisis, mail: MailExpensas): string {
  return `<html><body>
<h1>Expensas ${escapar(analisis.periodo)}</h1>
<p><b>Unidad:</b> ${escapar(analisis.unidad ?? "sin identificar")}<br>
<b>Vencimiento:</b> ${escapar(analisis.vencimiento ?? "no indicado")}<br>
<b>Mail:</b> ${escapar(mail.asunto)} (${escapar(mail.fecha)})</p>
<h2>Resumen</h2>
<p><b>Paga el inquilino (ordinarias):</b> ${pesos(analisis.totalInquilino)}<br>
<b>Paga el propietario (extraordinarias):</b> ${pesos(analisis.totalPropietario)}<br>
<b>Total:</b> ${pesos(analisis.totalInquilino + analisis.totalPropietario)}${
    analisis.total_liquidacion_unidad != null ? ` (total según la liquidación: ${pesos(analisis.total_liquidacion_unidad)})` : ""
  }</p>
<h2>Inquilino</h2>
${tabla(analisis, "inquilino")}
<h2>Propietario</h2>
${tabla(analisis, "propietario")}
${analisis.observaciones ? `<h2>Observaciones</h2><p>${escapar(analisis.observaciones)}</p>` : ""}
</body></html>`;
}

export type DocumentoExpensas = { url: string; pdfDetalle: Buffer; nombre: string };

// Crea un Google Doc con el detalle en la carpeta de Drive y lo exporta a PDF
// para mandarlo por WhatsApp.
export async function crearDocumentoExpensas(analisis: Analisis, mail: MailExpensas): Promise<DocumentoExpensas> {
  const api = drive();
  const nombre = `Expensas ${analisis.periodo} - detalle inquilino y propietario`;

  const crear = (parents?: string[]) =>
    api.files.create({
      requestBody: { name: nombre, mimeType: "application/vnd.google-apps.document", parents },
      media: { mimeType: "text/html", body: Readable.from(html(analisis, mail)) },
      fields: "id, webViewLink",
    });

  // Con el scope drive.file la app solo ve carpetas que creó ella: si no tiene
  // acceso a GOOGLE_DRIVE_FOLDER_ID, el doc queda en la raíz de Drive.
  let doc;
  try {
    ({ data: doc } = await crear([env("GOOGLE_DRIVE_FOLDER_ID")]));
  } catch (err) {
    console.error("No se pudo crear el doc en GOOGLE_DRIVE_FOLDER_ID, se crea en la raíz", err);
    ({ data: doc } = await crear());
  }
  if (!doc.id) throw new Error("Drive no devolvió el id del documento.");

  const { data: pdf } = await api.files.export(
    { fileId: doc.id, mimeType: "application/pdf" },
    { responseType: "arraybuffer" },
  );

  return {
    url: doc.webViewLink ?? `https://docs.google.com/document/d/${doc.id}`,
    pdfDetalle: Buffer.from(pdf as ArrayBuffer),
    nombre: `${nombre}.pdf`,
  };
}
