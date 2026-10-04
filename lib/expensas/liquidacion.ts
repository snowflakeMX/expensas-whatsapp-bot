import { extractText } from "unpdf";

// Liquidación mensual de la administración del barrio El Naudir (unidad 555).
// El PDF siempre trae el "ESTADO DE CUENTA" como pares "ETIQUETA : 1.234,56".

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export type Paga = "inquilino" | "propietario";

export type Linea = {
  etiquetaPdf: string;
  // Etiqueta tal como se usa en la planilla "Expensas 555".
  etiqueta: string;
  monto: number;
  paga: Paga;
  // Línea que no está en las reglas: se asigna al propietario y se avisa.
  desconocida?: boolean;
};

export type Liquidacion = {
  mes: number; // 1-12
  anio: number;
  vencimiento: string | null;
  lineas: Linea[];
  total: number;
  bonif: number;
};

// Reglas verificadas contra la planilla (ago 2025 - sep 2026, 14/14 al centavo):
// el inquilino paga los gastos de mantenimiento (con la bonificación del 10%
// por pago anticipado) y los gastos particulares (colonia); el resto, el propietario.
const REGLAS: { patron: RegExp; etiqueta: string; paga: Paga }[] = [
  { patron: /^GS\.? MANTENI/, etiqueta: "Gs. Mantenimiento", paga: "inquilino" },
  { patron: /^G\.? PART/, etiqueta: "G. Particular", paga: "inquilino" },
  { patron: /^ARBA/, etiqueta: "Arba", paga: "propietario" },
  { patron: /^MUNICIPAL/, etiqueta: "Municipal", paga: "propietario" },
  { patron: /^C\.? EXTRA/, etiqueta: "C. Extra", paga: "propietario" },
  { patron: /^CONSUMO REST/, etiqueta: "Cons Rest", paga: "propietario" },
  { patron: /^GAS/, etiqueta: "Gas", paga: "propietario" },
];

// Líneas del estado de cuenta que no son gastos del mes.
const IGNORADAS = /^(ABONADO AL CIERRE|AJUSTE|TOTAL|BONIF)/;

export const BONIFICACION = 0.1;

export function parsearMonto(texto: string): number {
  return Number(texto.replace(/\./g, "").replace(",", "."));
}

export async function textoDelPdf(pdf: Buffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  return text.replace(/\s+/g, " ");
}

export function parsearLiquidacion(texto: string): Liquidacion {
  const periodo = /per[ií]odo:\s*([A-ZÁÉÍÓÚ]+)\s+(\d{4})/i.exec(texto);
  const mes = periodo ? MESES.indexOf(periodo[1].toLowerCase()) + 1 : 0;
  if (!periodo || mes === 0) throw new Error("No encontré el período en el PDF.");

  const inicio = texto.search(/ESTADO DE CUENTA/);
  if (inicio < 0) throw new Error("No encontré el estado de cuenta en el PDF.");
  const estado = texto.slice(inicio).replace(/^.*?VTO\.:\s*[\d-]+\s*\)/, "");

  const lineas: Linea[] = [];
  let total: number | null = null;
  let bonif: number | null = null;

  for (const m of estado.matchAll(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9./ ]*?)\s*:\s*(\(([^)]*)\)|-?[\d.]+,\d{2})/g)) {
    const etiquetaPdf = m[1].trim();
    // "DESC. : (Colonia)" describe la línea anterior.
    if (m[3] !== undefined) {
      const anterior = lineas.at(-1);
      if (anterior && /^DESC/.test(etiquetaPdf)) anterior.etiqueta += ` (${m[3].trim().toLowerCase()})`;
      continue;
    }
    const monto = parsearMonto(m[2]);
    if (/^TOTAL$/.test(etiquetaPdf)) total = monto;
    else if (/^BONIF/.test(etiquetaPdf)) bonif = monto;
    if (IGNORADAS.test(etiquetaPdf)) continue;

    const regla = REGLAS.find((r) => r.patron.test(etiquetaPdf));
    lineas.push(
      regla
        ? { etiquetaPdf, etiqueta: regla.etiqueta, monto, paga: regla.paga }
        : { etiquetaPdf, etiqueta: etiquetaPdf, monto, paga: "propietario", desconocida: true },
    );
  }
  if (total === null || bonif === null) throw new Error("No encontré el TOTAL o la BONIF en el PDF.");

  const venc = /vencimiento el:\s*(\d{2}-\d{2}-\d{4})/.exec(texto);
  return { mes, anio: Number(periodo[2]), vencimiento: venc?.[1] ?? null, lineas, total, bonif };
}

export const redondear = (n: number) => Math.round(n * 100) / 100;

export type Reparto = { agus: number; santi: number; devoluciones: number; avisos: string[] };

// Mismo cálculo que la planilla: Santi = sus líneas + devoluciones; Agus = Bonif - Santi.
export function repartir(liq: Liquidacion, devoluciones = 0): Reparto {
  const avisos: string[] = [];
  const suma = (paga: Paga) => liq.lineas.filter((l) => l.paga === paga).reduce((s, l) => s + l.monto, 0);
  const santi = redondear(suma("propietario") + devoluciones);
  const agus = redondear(liq.bonif - santi);

  const sumaLineas = redondear(suma("inquilino") + suma("propietario"));
  if (Math.abs(sumaLineas - liq.total) > 0.01) {
    avisos.push(`Las líneas suman ${sumaLineas} pero el TOTAL del PDF es ${liq.total}.`);
  }
  const mantenimiento = liq.lineas.find((l) => l.etiqueta === "Gs. Mantenimiento")?.monto ?? 0;
  const bonifEsperada = redondear(liq.total - mantenimiento * BONIFICACION);
  // La administración redondea por su lado: se toleran un par de centavos.
  if (Math.abs(bonifEsperada - liq.bonif) > 0.02) {
    avisos.push(`La bonificación del PDF (${liq.bonif}) no es el 10% de Gs. Mantenimiento (esperaba ${bonifEsperada}).`);
  }
  for (const l of liq.lineas.filter((l) => l.desconocida)) {
    avisos.push(`Apareció una línea nueva: "${l.etiquetaPdf}" (${l.monto}). La puse a cargo del propietario; si es del inquilino avisame.`);
  }
  return { agus, santi, devoluciones, avisos };
}
