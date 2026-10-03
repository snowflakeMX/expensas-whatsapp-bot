import { Readable } from "node:stream";
import { drive } from "@/lib/google/cliente";
import { env } from "@/lib/env";
import type { ClasificacionExpensas } from "@/lib/claude/clasificar";

const ARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

function textoDocumento(c: ClasificacionExpensas): string {
  const lineas = (items: { concepto: string; monto: number }[]) =>
    items.map((i) => `  - ${i.concepto}: ${ARS.format(i.monto)}`).join("\n");

  return [
    `Expensas — ${c.periodo}`,
    "",
    "Paga el inquilino (ordinarios):",
    lineas(c.ordinarios),
    `Subtotal ordinarios: ${ARS.format(c.totalOrdinarios)}`,
    "",
    "Pagás vos, propietario (extraordinarios):",
    lineas(c.extraordinarios),
    `Subtotal extraordinarios: ${ARS.format(c.totalExtraordinarios)}`,
    "",
    `Total general: ${ARS.format(c.totalGeneral)}`,
    c.notas ? `\nNotas: ${c.notas}` : "",
  ].join("\n");
}

// Crea un Google Doc nativo en la carpeta de Drive con el detalle de la
// liquidación (subiendo texto plano, que Drive convierte al formato Doc).
export async function guardarEnDrive(c: ClasificacionExpensas): Promise<string> {
  const api = drive();
  const res = await api.files.create({
    requestBody: {
      name: `Expensas ${c.periodo}`,
      mimeType: "application/vnd.google-apps.document",
      parents: [env("GOOGLE_DRIVE_FOLDER_ID")],
    },
    media: {
      mimeType: "text/plain",
      body: Readable.from(textoDocumento(c)),
    },
    fields: "webViewLink",
  });
  return res.data.webViewLink ?? "";
}
