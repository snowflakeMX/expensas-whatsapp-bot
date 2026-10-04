import { enviarDocumento, enviarImagen, enviarTexto, subirMedia } from "@/lib/whatsapp/enviar";
import type { FilaVista } from "./bloque";
import { buscarMailsExpensas, type MailExpensas } from "./gmail";
import { formatoPesos, imagenBloque } from "./imagen";
import { MESES, parsearLiquidacion, repartir, textoDelPdf, type Liquidacion } from "./liquidacion";
import { borrarPendiente, guardarPendiente, leerPendiente } from "./pendiente";
import { cargarDevolucion, cargarMes, leerMes, type ResultadoPlanilla } from "./planilla";

// Flujo de "expensas" por WhatsApp:
// 1. "expensas": busca en Gmail el último mail de la administración y lee el PDF.
//    Si el mes ya está en la planilla, lo dice y manda la imagen del bloque.
//    Si es nuevo, manda el PDF y pregunta si hay devoluciones para cargar.
// 2. La respuesta ("jardinero $15000", varias líneas, o "no") carga el mes en la
//    planilla con las devoluciones y responde con el resumen y la imagen del bloque.
// phoneNumberId: el número del bot que recibió el mensaje, para responder desde ese mismo.

const valor = (filas: FilaVista[], etiqueta: string) => filas.find((f) => f.etiqueta === etiqueta)?.valor ?? 0;
const nombreMes = (mes: number, anio: number) => `${MESES[mes - 1]} ${anio}`;

async function enviarBloque(waId: string, r: ResultadoPlanilla, phoneNumberId?: string): Promise<void> {
  const png = imagenBloque(r.filas);
  const nombre = `expensas-${MESES[r.bloque.mes - 1]}-${r.bloque.anio}.png`;
  const id = await subirMedia(png, nombre, "image/png", phoneNumberId);
  await enviarImagen(waId, id, phoneNumberId);
}

const resumen = (r: ResultadoPlanilla) =>
  [`Agus: ${formatoPesos(valor(r.filas, "Agus"))}`, `Santi: ${formatoPesos(valor(r.filas, "Santi"))}`];

// De los últimos mails, el de período más reciente.
async function ultimaLiquidacion(): Promise<{ mail: MailExpensas; liq: Liquidacion } | null> {
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
  return elegido;
}

export async function verificarExpensas(waId: string, phoneNumberId?: string): Promise<void> {
  const texto = (mensaje: string) => enviarTexto(waId, mensaje, phoneNumberId);

  try {
    await texto("Buscando el mail de expensas...");
    const elegido = await ultimaLiquidacion();
    if (!elegido) {
      await texto("No encontré ningún mail de expensas con un PDF que pueda leer.");
      return;
    }
    const { mail, liq } = elegido;
    const mes = nombreMes(liq.mes, liq.anio);

    const cargado = await leerMes(liq.mes, liq.anio);
    if (cargado) {
      await texto(
        [
          `No hay mail nuevo: el último es el de *${mes}* y ya está cargado en la planilla.`,
          ...resumen(cargado),
          `\nSi querés sumar una devolución a ${mes}: devolución <concepto> <monto>`,
        ].join("\n"),
      );
      await enviarBloque(waId, cargado, phoneNumberId);
      return;
    }

    await guardarPendiente(waId, liq);
    const idPdf = await subirMedia(mail.pdf, mail.nombrePdf, "application/pdf", phoneNumberId);
    await enviarDocumento(waId, idPdf, mail.nombrePdf, `Liquidación ${mes}`, phoneNumberId);
    await texto(
      [
        `Llegó el mail nuevo de expensas: *${mes}*${liq.vencimiento ? ` (vence ${liq.vencimiento})` : ""}.`,
        `Total con bonificación: ${formatoPesos(liq.bonif)}`,
        "",
        "¿Hay algo para cargar como devolución? Mandame concepto y monto, uno por línea. Ej:",
        "jardinero $15000",
        "pileta $43000",
        "",
        "Si no hay, respondé *no*.",
      ].join("\n"),
    );
  } catch (err) {
    console.error("Error en verificar expensas", err);
    await texto(`Hubo un error procesando las expensas: ${err instanceof Error ? err.message : err}`).catch(() => {});
  }
}

export type Devolucion = { concepto: string; monto: number };

// Respuesta a la pregunta de devoluciones: "no", o pares concepto/monto
// ("jardinero $15000", uno por línea o separados por coma). null si no se entiende.
export function parsearRespuestaDevoluciones(texto: string): "no" | Devolucion[] | null {
  const t = texto.trim();
  if (/^(no|nop|nada|ninguna|no hay(\s+nada)?)[.!]*$/i.test(t)) return "no";
  const devoluciones: Devolucion[] = [];
  for (const m of t.matchAll(/([a-záéíóúñü][^$\d\n]*?)\s*\$?\s*(\d[\d.,]*)/gi)) {
    const concepto = m[1].replace(/^[\s,;]+/, "").replace(/^y\s+/i, "").replace(/[\s,;:-]+$/, "").trim();
    const monto = parsearMontoLibre(m[2].replace(/[.,]+$/, ""));
    // Montos chicos ("somos 10") no son devoluciones: evita confundir otros mensajes.
    if (concepto && monto !== null && monto >= 100) devoluciones.push({ concepto, monto });
  }
  return devoluciones.length ? devoluciones : null;
}

// Si hay una pregunta de devoluciones abierta para este número, procesa la
// respuesta y devuelve true. Si no, devuelve false (el mensaje sigue su camino).
export async function responderDevoluciones(waId: string, mensaje: string, phoneNumberId?: string): Promise<boolean> {
  const respuesta = parsearRespuestaDevoluciones(mensaje);
  if (!respuesta) return false;
  const pendiente = await leerPendiente(waId);
  if (!pendiente) return false;

  const texto = (m: string) => enviarTexto(waId, m, phoneNumberId);
  const { liq } = pendiente;
  try {
    await borrarPendiente();
    const { avisos } = repartir(liq);
    let r = await cargarMes(liq);
    const devoluciones = respuesta === "no" ? [] : respuesta;
    for (const d of devoluciones) r = await cargarDevolucion(d.concepto, d.monto);

    await texto(
      [
        `*Expensas ${nombreMes(liq.mes, liq.anio)}* cargadas en la planilla.`,
        ...devoluciones.map((d) => `Devolución ${d.concepto}: ${formatoPesos(d.monto)}`),
        ...resumen(r),
        `Total con bonificación: ${formatoPesos(liq.bonif)}`,
        ...avisos.map((a) => `⚠️ ${a}`),
      ].join("\n"),
    );
    await enviarBloque(waId, r, phoneNumberId);
  } catch (err) {
    console.error("Error cargando expensas con devoluciones", err);
    await texto(`Hubo un error cargando las expensas: ${err instanceof Error ? err.message : err}`).catch(() => {});
  }
  return true;
}

// "devolución bomba 200000": suma una devolución al último mes ya cargado.
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
        `Agregué la devolución "${concepto}" por ${formatoPesos(monto)} en ${nombreMes(r.bloque.mes, r.bloque.anio)}.`,
        ...resumen(r),
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
