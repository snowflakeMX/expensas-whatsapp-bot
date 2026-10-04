import type { sheets_v4 } from "googleapis";
import { sheets } from "@/lib/google/cliente";
import { env } from "@/lib/env";
import {
  ALTO_BLOQUE_NUEVO, agregarDevolucion, armarBloque, buscarBloques, lugarNuevoBloque, ref, vistaBloque,
  type Bloque, type Celda, type Formato, type FilaVista, type Grilla,
} from "./bloque";
import type { Liquidacion } from "./liquidacion";

// Lectura y escritura de la planilla "Expensas 555" con la API de Sheets.

const pestania = () => process.env.EXPENSAS_SHEET_TAB?.trim() || "Hoja 1";
const rango = (a1: string) => `'${pestania().replace(/'/g, "''")}'!${a1}`;

const AZUL = { red: 0.812, green: 0.886, blue: 0.953 };
const VERDE = { red: 0.576, green: 0.769, blue: 0.49 };
const VERDE_CLARO = { red: 0.851, green: 0.918, blue: 0.827 };
const MONEDA = { type: "CURRENCY", pattern: '"$"#,##0.00' };
const LINEA = { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } };

type Api = sheets_v4.Sheets;

async function leer(api: Api, render: "FORMULA" | "UNFORMATTED_VALUE"): Promise<Grilla> {
  const { data } = await api.spreadsheets.values.get({
    spreadsheetId: env("EXPENSAS_SHEET_ID"),
    range: rango("A1:Z1000"),
    valueRenderOption: render,
  });
  return (data.values ?? []) as Grilla;
}

async function idPestania(api: Api): Promise<number> {
  const { data } = await api.spreadsheets.get({ spreadsheetId: env("EXPENSAS_SHEET_ID"), fields: "sheets.properties" });
  const hoja = data.sheets?.find((s) => s.properties?.title === pestania());
  if (hoja?.properties?.sheetId == null) throw new Error(`No existe la pestaña "${pestania()}" en la planilla.`);
  return hoja.properties.sheetId;
}

async function escribirCeldas(api: Api, celdas: Celda[]): Promise<void> {
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: env("EXPENSAS_SHEET_ID"),
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: celdas.map((c) => ({ range: rango(ref(c.fila, c.col)), values: [[c.valor]] })),
    },
  });
}

function pedidosFormato(sheetId: number, formatos: Formato[]): sheets_v4.Schema$Request[] {
  const pedidos: sheets_v4.Schema$Request[] = [];
  const rangoGrilla = (fila: number, col: number, ancho = 1) => ({
    sheetId, startRowIndex: fila, endRowIndex: fila + 1, startColumnIndex: col, endColumnIndex: col + ancho,
  });
  const formato = (fila: number, col: number, ancho: number, f: sheets_v4.Schema$CellFormat) =>
    pedidos.push({ repeatCell: { range: rangoGrilla(fila, col, ancho), cell: { userEnteredFormat: f }, fields: "userEnteredFormat" } });
  const caja = (fila: number, col: number, ancho: number) =>
    pedidos.push({ updateBorders: { range: rangoGrilla(fila, col, ancho), top: LINEA, bottom: LINEA, left: LINEA, right: LINEA, innerVertical: ancho > 1 ? LINEA : undefined } });

  for (const { fila, col, ancho, estilo } of formatos) {
    const v = col + 1;
    switch (estilo) {
      case "titulo":
        pedidos.push({ mergeCells: { range: rangoGrilla(fila, col, 2), mergeType: "MERGE_ALL" } });
        formato(fila, col, 2, { horizontalAlignment: "CENTER", textFormat: { bold: true } });
        break;
      case "encabezado":
        pedidos.push({ mergeCells: { range: rangoGrilla(fila, col, 2), mergeType: "MERGE_ALL" } });
        formato(fila, col, 2, { horizontalAlignment: "CENTER", backgroundColor: AZUL });
        caja(fila, col, 2);
        break;
      case "linea":
        formato(fila, v, 1, { numberFormat: MONEDA });
        pedidos.push({ updateBorders: { range: rangoGrilla(fila, col, 2), left: LINEA, right: LINEA } });
        break;
      case "total":
        formato(fila, col, 1, { horizontalAlignment: "RIGHT" });
        formato(fila, v, 1, { numberFormat: MONEDA });
        pedidos.push({ updateBorders: { range: rangoGrilla(fila, col, 2), top: LINEA, left: LINEA, right: LINEA } });
        break;
      case "bonif":
        formato(fila, col, 1, { horizontalAlignment: "RIGHT" });
        formato(fila, v, 1, { numberFormat: MONEDA });
        caja(fila, col, 2);
        break;
      case "devolucionTitulo":
        formato(fila, col, 1, { horizontalAlignment: "CENTER", textFormat: { bold: true } });
        break;
      case "devolucion":
        formato(fila, col, 1, { backgroundColor: VERDE_CLARO });
        formato(fila, v, 1, { backgroundColor: VERDE_CLARO, numberFormat: MONEDA });
        break;
      case "persona":
        formato(fila, col, 1, { textFormat: { bold: true } });
        formato(fila, v, 1, { textFormat: { bold: true }, numberFormat: MONEDA });
        caja(fila, col, 2);
        break;
      case "totalFinal":
        formato(fila, col, 1, { backgroundColor: VERDE });
        formato(fila, v, 1, { backgroundColor: VERDE, numberFormat: MONEDA });
        caja(fila, col, 2);
        break;
    }
  }
  return pedidos;
}

async function aplicarFormatos(api: Api, formatos: Formato[]): Promise<void> {
  if (!formatos.length) return;
  const sheetId = await idPestania(api);
  await api.spreadsheets.batchUpdate({
    spreadsheetId: env("EXPENSAS_SHEET_ID"),
    requestBody: { requests: pedidosFormato(sheetId, formatos) },
  });
}

async function vista(api: Api, bloque: Bloque): Promise<FilaVista[]> {
  return vistaBloque(await leer(api, "UNFORMATTED_VALUE"), bloque);
}

export type ResultadoPlanilla = { bloque: Bloque; filas: FilaVista[]; yaEstaba: boolean };

// Carga el mes en la planilla (si ya estaba, no lo toca) y devuelve el bloque como quedó.
export async function cargarMes(liq: Liquidacion): Promise<ResultadoPlanilla> {
  const api = sheets();
  const grilla = await leer(api, "FORMULA");
  const existente = buscarBloques(grilla).find((b) => b.mes === liq.mes && b.anio === liq.anio);
  if (existente) return { bloque: existente, filas: await vista(api, existente), yaEstaba: true };

  const { fila, col } = lugarNuevoBloque(grilla, ALTO_BLOQUE_NUEVO(liq));
  const escritura = armarBloque(grilla, liq, fila, col);
  await escribirCeldas(api, escritura.celdas);
  await aplicarFormatos(api, escritura.formatos);
  return { bloque: escritura.bloque, filas: await vista(api, escritura.bloque), yaEstaba: false };
}

// Agrega una devolución al último mes cargado.
export async function cargarDevolucion(concepto: string, monto: number): Promise<ResultadoPlanilla> {
  const api = sheets();
  const grilla = await leer(api, "FORMULA");
  const bloque = buscarBloques(grilla).at(-1);
  if (!bloque) throw new Error("No encontré ningún mes cargado en la planilla.");

  const cambio = agregarDevolucion(grilla, bloque, concepto, monto);
  if (cambio.moverPagaDesde !== undefined) {
    const sheetId = await idPestania(api);
    await api.spreadsheets.batchUpdate({
      spreadsheetId: env("EXPENSAS_SHEET_ID"),
      requestBody: {
        requests: [{
          cutPaste: {
            source: {
              sheetId, startRowIndex: bloque.paga, endRowIndex: bloque.totalFinal + 1,
              startColumnIndex: bloque.col, endColumnIndex: bloque.col + 2,
            },
            destination: { sheetId, rowIndex: bloque.paga + 1, columnIndex: bloque.col },
            pasteType: "PASTE_NORMAL",
          },
        }],
      },
    });
  }
  await escribirCeldas(api, cambio.celdas);
  await aplicarFormatos(api, cambio.formatos);
  return { bloque: cambio.bloque, filas: await vista(api, cambio.bloque), yaEstaba: true };
}
