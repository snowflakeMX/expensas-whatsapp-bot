import { enviarDocumento, enviarImagen, enviarTexto, subirMedia } from "@/lib/whatsapp/enviar";
import type { FilaVista } from "./bloque";
import { buscarMailsExpensas, type MailExpensas } from "./gmail";
import { formatoPesos, imagenBloque } from "./imagen";
import { MESES, parsearLiquidacion, repartir, textoDelPdf, type Liquidacion } from "./liquidacion";
import { cargarDevolucion, cargarMes, type ResultadoPlanilla } from "./planilla";

// Orquesta "verificar expensas":
// 1. Busca el último mail de expensas en Gmail y baja el PDF.
// 2. Lee el estado de cuenta y reparte entre Agus (inquilino) y Santi (propietario).
// 3. Carga el mes en la planilla "Expensas 555".
// 4. Responde por WhatsApp con el resumen, el PDF original y la imagen del bloque.
// phoneNumberId: el número del bot que recibió el mensaje, para responder desde ese mismo.

const valor = (filas: FilaVista[], etiqueta: string) => filas.find((f) => f.etiqueta === etiqueta)?.valor ?? 0;

async function enviarBloque(waId: string, r: ResultadoPlanilla, phoneNumberId?: string): Promise<void> {
  const png = imagenBloque(r.filas);
  const nombre = `expensas-${MESES[r.bloque.mes - 1]}-${r.bloque.anio}.png`;
  const id = await subirMedia(png, nombre, "image/png", phoneNumberId);
  await enviarImagen(waId, id, phoneNumberId);
}

export async function verificarExpensas(waId: string, phoneNumberId?: string): Promise<void> {
  const texto = (mensaje: string) => enviarTexto(waId, mensaje, phoneNumberId);

  try {
    await texto("Recibido, estoy buscando el mail de expensas...");

    // De los últimos mails, el de período más reciente.
    let elegido: { mail: MailExpensas; liq: Liquidacion } | null = null;
    for (const mail of await buscarMailsExpensas()) {
      let liq: Liquidacion;
      try {
        liq = parsearLiquidacion(await textoDelPdf(mail.pdf));
      } catch (err) {
        console.error(`No pude leer ${mail.nombrePdf}`, err);
        continue;
      }
      if (!elegido || liq.anio * 12 + liq.mes > elegido.liq.anio * 12 + elegido.liq.mes) elegido = { mail, liq };
    }
    if (!elegido) {
      await texto("No encontré ningún mail de expensas con un PDF que pueda leer.");
      return;
    }
    const { mail, liq } = elegido;
    const { avisos } = repartir(liq);
    const r = await cargarMes(liq);

    await texto(
      [
        `*Expensas ${MESES[liq.mes - 1]} ${liq.anio}*${liq.vencimiento ? ` (vence ${liq.vencimiento})` : ""}`,
        `Agus: ${formatoPesos(valor(r.filas, "Agus"))}`,
        `Santi: ${formatoPesos(valor(r.filas, "Santi"))}`,
        `Total con bonificación: ${formatoPesos(liq.bonif)}`,
        r.yaEstaba ? "\nEse mes ya estaba cargado en la planilla, no lo modifiqué." : "\nLo cargué en la planilla.",
        ...avisos.map((a) => `⚠️ ${a}`),
      ].join("\n"),
    );

    const idPdf = await subirMedia(mail.pdf, mail.nombrePdf, "application/pdf", phoneNumberId);
    await enviarDocumento(waId, idPdf, mail.nombrePdf, "Liquidación original", phoneNumberId);
    await enviarBloque(waId, r, phoneNumberId);
  } catch (err) {
    console.error("Error en verificar expensas", err);
    await texto(`Hubo un error procesando las expensas: ${err instanceof Error ? err.message : err}`).catch(() => {});
  }
}

// "devolución bomba 200000": gasto que pagó Agus y Santi le devuelve en el último mes cargado.
export async function registrarDevolucion(
  waId: string,
  concepto: string,
  monto: number,
  phoneNumberId?: string,
): Promise<void> {
  const texto = (mensaje: string) => enviarTexto(waId, mensaje, phoneNumberId);
  try {
    const r = await cargarDevolucion(concepto, monto);
    await texto(
      [
        `Agregué la devolución "${concepto}" por ${formatoPesos(monto)} en ${MESES[r.bloque.mes - 1]} ${r.bloque.anio}.`,
        `Agus: ${formatoPesos(valor(r.filas, "Agus"))}`,
        `Santi: ${formatoPesos(valor(r.filas, "Santi"))}`,
      ].join("\n"),
    );
    await enviarBloque(waId, r, phoneNumberId);
  } catch (err) {
    console.error("Error registrando devolución", err);
    await texto(`No pude agregar la devolución: ${err instanceof Error ? err.message : err}`).catch(() => {});
  }
}

// Monto escrito a mano: "200000", "200.000", "200,000", "$200.000,50".
export function parsearMontoLibre(texto: string): number | null {
  let t = texto.replace(/[$\s]/g, "");
  const ultimoPunto = t.lastIndexOf(".");
  const ultimaComa = t.lastIndexOf(",");
  const decimal = Math.max(ultimoPunto, ultimaComa);
  // Es decimal si el último separador tiene 1 o 2 dígitos después.
  if (decimal >= 0 && t.length - decimal - 1 <= 2) {
    t = t.slice(0, decimal).replace(/[.,]/g, "") + "." + t.slice(decimal + 1);
  } else {
    t = t.replace(/[.,]/g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}
