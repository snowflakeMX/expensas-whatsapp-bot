import PDFDocument from "pdfkit";
import type { ClasificacionExpensas } from "@/lib/claude/clasificar";

const ARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

// Arma el PDF con el detalle de qué paga el inquilino y qué pagás vos.
export function generarPdfDetalle(c: ClasificacionExpensas): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(`Expensas — ${c.periodo}`, { align: "center" });
    doc.moveDown(1.5);

    seccion(doc, "Paga el inquilino (ordinarios)", c.ordinarios, c.totalOrdinarios);
    doc.moveDown(1);
    seccion(doc, "Pagás vos (extraordinarios)", c.extraordinarios, c.totalExtraordinarios);

    doc.moveDown(1.5);
    doc.fontSize(13).text(`Total general: ${ARS.format(c.totalGeneral)}`, { align: "right" });

    if (c.notas) {
      doc.moveDown(1);
      doc.fontSize(10).fillColor("gray").text(`Notas: ${c.notas}`);
    }

    doc.end();
  });
}

function seccion(doc: PDFKit.PDFDocument, titulo: string, items: { concepto: string; monto: number }[], total: number): void {
  doc.fontSize(14).fillColor("black").text(titulo);
  doc.moveDown(0.3);
  doc.fontSize(11);
  for (const item of items) {
    doc.text(`${item.concepto}`, { continued: true }).text(ARS.format(item.monto), { align: "right" });
  }
  doc.moveDown(0.3);
  doc.fontSize(12).text(`Subtotal: ${ARS.format(total)}`, { align: "right" });
}
