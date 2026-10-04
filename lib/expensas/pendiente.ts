import { sheets } from "@/lib/google/cliente";
import { env } from "@/lib/env";
import type { Liquidacion } from "./liquidacion";

// Mes encontrado que espera la respuesta de devoluciones ("jardinero $15000" o "no").
// Se guarda como metadata invisible de la planilla: el webhook no tiene estado
// entre un mensaje y otro.

const CLAVE = "expensas_pendiente";
const VENCE_MS = 6 * 60 * 60 * 1000; // la pregunta queda abierta 6 horas

export type Pendiente = { waId: string; liq: Liquidacion; creado: number };

const filtro = { developerMetadataLookup: { metadataKey: CLAVE } };

export async function leerPendiente(waId: string): Promise<Pendiente | null> {
  const { data } = await sheets().spreadsheets.developerMetadata.search({
    spreadsheetId: env("EXPENSAS_SHEET_ID"),
    requestBody: { dataFilters: [filtro] },
  });
  const valor = data.matchedDeveloperMetadata?.[0]?.developerMetadata?.metadataValue;
  if (!valor) return null;
  const pendiente = JSON.parse(valor) as Pendiente;
  if (pendiente.waId !== waId || Date.now() - pendiente.creado > VENCE_MS) return null;
  return pendiente;
}

export async function borrarPendiente(): Promise<void> {
  const api = sheets();
  const { data } = await api.spreadsheets.developerMetadata.search({
    spreadsheetId: env("EXPENSAS_SHEET_ID"),
    requestBody: { dataFilters: [filtro] },
  });
  if (!data.matchedDeveloperMetadata?.length) return;
  await api.spreadsheets.batchUpdate({
    spreadsheetId: env("EXPENSAS_SHEET_ID"),
    requestBody: { requests: [{ deleteDeveloperMetadata: { dataFilter: filtro } }] },
  });
}

export async function guardarPendiente(waId: string, liq: Liquidacion): Promise<void> {
  await borrarPendiente();
  const pendiente: Pendiente = { waId, liq, creado: Date.now() };
  await sheets().spreadsheets.batchUpdate({
    spreadsheetId: env("EXPENSAS_SHEET_ID"),
    requestBody: {
      requests: [{
        createDeveloperMetadata: {
          developerMetadata: {
            metadataKey: CLAVE,
            metadataValue: JSON.stringify(pendiente),
            location: { spreadsheet: true },
            visibility: "DOCUMENT",
          },
        },
      }],
    },
  });
}
