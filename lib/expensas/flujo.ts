import { enviarTexto, enviarDocumento, subirMedia } from "@/lib/whatsapp/enviar";
import { buscarUltimoMailDeExpensas } from "@/lib/gmail/buscar";
import { extraerTextoPdf } from "@/lib/pdf/extraer";
import { clasificarExpensas } from "@/lib/claude/clasificar";
import { generarPdfDetalle } from "@/lib/pdf/generar";
import { guardarEnDrive } from "@/lib/google/drive";

// Orquesta "verificar expensas": busca el mail, baja el PDF, lo clasifica con
// Claude, lo guarda en Drive y responde por WhatsApp con los dos archivos.
// phoneNumberId: el número del bot que recibió el mensaje, para responder desde ese mismo.
export async function verificarExpensas(phoneNumberId: string, waId: string): Promise<void> {
  try {
    await enviarTexto(waId, "Recibido, estoy buscando el mail de expensas…", phoneNumberId);

    const mail = await buscarUltimoMailDeExpensas();
    if (!mail) {
      await enviarTexto(waId, "No encontré ningún mail de expensas. Revisá que EXPENSAS_GMAIL_QUERY esté bien configurado.", phoneNumberId);
      return;
    }

    const texto = await extraerTextoPdf(mail.pdf);
    const clasificacion = await clasificarExpensas(texto);

    const [driveLink] = await Promise.all([
      guardarEnDrive(clasificacion),
      (async () => {
        const mediaIdOriginal = await subirMedia(mail.pdf, mail.nombreArchivo, "application/pdf", phoneNumberId);
        await enviarDocumento(waId, mediaIdOriginal, mail.nombreArchivo, "Expensas original", phoneNumberId);

        const pdfDetalle = await generarPdfDetalle(clasificacion);
        const mediaIdDetalle = await subirMedia(pdfDetalle, `Detalle ${clasificacion.periodo}.pdf`, "application/pdf", phoneNumberId);
        await enviarDocumento(waId, mediaIdDetalle, `Detalle-${clasificacion.periodo}.pdf`, "Quién paga qué", phoneNumberId);
      })(),
    ]);

    await enviarTexto(waId, `Listo. Guardado en Drive: ${driveLink || "(no se pudo generar el link)"}`, phoneNumberId);
  } catch (err) {
    console.error("Error en verificarExpensas", err);
    await enviarTexto(waId, "Tuve un error procesando las expensas. Lo reviso y te aviso.", phoneNumberId);
  }
}
