import { enviarDocumento, enviarTexto, subirMedia } from "@/lib/whatsapp/enviar";
import { analizarExpensas } from "./analisis";
import { crearDocumentoExpensas, pesos } from "./drive";
import { buscarUltimoMailExpensas } from "./gmail";

// Orquesta "verificar expensas":
// 1. Busca el último mail de expensas en Gmail y baja el PDF.
// 2. Clasifica gastos ordinarios (inquilino) vs. extraordinarios (propietario) con Claude.
// 3. Escribe el detalle en un documento de Drive.
// 4. Responde por WhatsApp con el PDF original y el detalle.
// phoneNumberId: el número del bot que recibió el mensaje, para responder desde ese mismo.
export async function verificarExpensas(waId: string, phoneNumberId?: string): Promise<void> {
  const texto = (mensaje: string) => enviarTexto(waId, mensaje, phoneNumberId);

  try {
    await texto("Recibido, estoy buscando el mail de expensas...");

    const mail = await buscarUltimoMailExpensas();
    if (!mail) {
      await texto("No encontré ningún mail de expensas con un PDF adjunto.");
      return;
    }

    const analisis = await analizarExpensas(mail.pdf);
    const documento = await crearDocumentoExpensas(analisis, mail);

    await texto(
      [
        `*Expensas ${analisis.periodo}*${analisis.vencimiento ? ` (vence ${analisis.vencimiento})` : ""}`,
        `Inquilino (ordinarias): ${pesos(analisis.totalInquilino)}`,
        `Propietario (extraordinarias): ${pesos(analisis.totalPropietario)}`,
        `Total: ${pesos(analisis.totalInquilino + analisis.totalPropietario)}`,
        analisis.observaciones ? `\nObservaciones: ${analisis.observaciones}` : "",
        `\nDocumento en Drive: ${documento.url}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    const idOriginal = await subirMedia(mail.pdf, mail.nombrePdf, "application/pdf", phoneNumberId);
    await enviarDocumento(waId, idOriginal, mail.nombrePdf, "Liquidación original", phoneNumberId);

    const idDetalle = await subirMedia(documento.pdfDetalle, documento.nombre, "application/pdf", phoneNumberId);
    await enviarDocumento(waId, idDetalle, documento.nombre, "Detalle inquilino / propietario", phoneNumberId);
  } catch (err) {
    console.error("Error en verificar expensas", err);
    await texto("Hubo un error procesando las expensas. Revisá los logs de Vercel.").catch(() => {});
  }
}
