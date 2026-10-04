import { MESES, type Liquidacion } from "./liquidacion";

// Lógica pura sobre la grilla de la planilla "Expensas 555" (sin llamadas a la API).
//
// Cada mes es un bloque de 2 columnas (etiqueta | importe). Los bloques van en
// franjas horizontales de hasta 5 (columnas B, E, H, K, N) separadas por filas vacías:
//   septiembre 2026
//   Estado de cuenta
//   Gs. Mantenimiento | ... (líneas)
//   Total | =SUMA(...)          Bonif Antes | importe del PDF
//   Devolución / <conceptos>     (opcional, lo que Santi le devuelve a Agus)
//   Paga C/U
//   Agus | =Bonif-Santi    Santi | =líneas de Santi + devoluciones    Total

export type Grilla = (string | number | boolean | null | undefined)[][];

export const COLUMNAS_BLOQUE = [1, 4, 7, 10, 13]; // B, E, H, K, N

// Etiquetas del bloque que van a cargo del inquilino; todas las demás líneas son del propietario.
const DEL_INQUILINO = [/^gs\.? mantenimiento/i, /^g\.? particular/i];
const ORDEN = ["Gs. Mantenimiento", "Arba", "Municipal", "C. Extra", "Gas", "G. Particular", "Cons Rest"];

export type Bloque = {
  mes: number;
  anio: number;
  fila: number; // fila del título (0-based)
  col: number; // columna de las etiquetas (0-based); los importes van en col + 1
  lineas: number[]; // filas de las líneas del estado de cuenta
  total: number;
  bonif: number;
  devolucionTitulo: number | null;
  devoluciones: number[];
  paga: number;
  agus: number;
  santi: number;
  totalFinal: number;
};

const celda = (g: Grilla, f: number, c: number) => String(g[f]?.[c] ?? "").trim();
const vacia = (g: Grilla, f: number, c: number) => celda(g, f, c) === "";

export const letra = (col: number) => String.fromCharCode(65 + col);
export const ref = (fila: number, col: number) => `${letra(col)}${fila + 1}`;

export const tituloMes = (mes: number, anio: number) => `${MESES[mes - 1]} ${anio}`;

function parsearTitulo(texto: string): { mes: number; anio: number } | null {
  const m = /^([a-záéíóú]+)\s+(\d{4})$/i.exec(texto);
  const mes = m ? MESES.indexOf(m[1].toLowerCase()) + 1 : 0;
  return m && mes ? { mes, anio: Number(m[2]) } : null;
}

// Lee la estructura de un bloque recorriendo sus etiquetas hacia abajo.
function leerBloque(g: Grilla, fila: number, col: number, mes: number, anio: number): Bloque | null {
  const etiqueta = (f: number) => celda(g, f, col).toLowerCase();
  if (!etiqueta(fila + 1).startsWith("estado de cuenta")) return null;

  let f = fila + 2;
  const lineas: number[] = [];
  for (; f < fila + 30 && etiqueta(f) !== "total"; f++) if (etiqueta(f)) lineas.push(f);
  const total = f;
  const bonif = total + 1;
  if (etiqueta(total) !== "total" || !etiqueta(bonif).startsWith("bonif")) return null;

  let devolucionTitulo: number | null = null;
  const devoluciones: number[] = [];
  for (f = bonif + 1; f < bonif + 30 && !/^(paga c\/u|corresponde)/.test(etiqueta(f)); f++) {
    if (etiqueta(f).startsWith("devoluci")) devolucionTitulo = f;
    else if (devolucionTitulo !== null && etiqueta(f)) devoluciones.push(f);
  }
  const paga = f;
  const agus = paga + 1;
  const santi = paga + 2;
  const totalFinal = paga + 3;
  if (etiqueta(agus) !== "agus" || etiqueta(santi) !== "santi") return null;

  return { mes, anio, fila, col, lineas, total, bonif, devolucionTitulo, devoluciones, paga, agus, santi, totalFinal };
}

export function buscarBloques(g: Grilla): Bloque[] {
  const bloques: Bloque[] = [];
  g.forEach((_, fila) =>
    COLUMNAS_BLOQUE.forEach((col) => {
      const titulo = parsearTitulo(celda(g, fila, col));
      const bloque = titulo && leerBloque(g, fila, col, titulo.mes, titulo.anio);
      if (bloque) bloques.push(bloque);
    }),
  );
  return bloques.sort((a, b) => a.anio * 12 + a.mes - (b.anio * 12 + b.mes));
}

const ultimaFilaUsada = (g: Grilla) => {
  for (let f = g.length - 1; f >= 0; f--) if (g[f]?.some((v) => String(v ?? "").trim() !== "")) return f;
  return -1;
};

// Dónde va el bloque de un mes nuevo: a la derecha del último, o en una franja
// nueva debajo de todo (dejando 2 filas vacías, como en la planilla).
export function lugarNuevoBloque(g: Grilla, alto: number): { fila: number; col: number } {
  const ultimo = buscarBloques(g).at(-1);
  if (ultimo) {
    const col = ultimo.col + 3;
    const libre = (c: number) => Array.from({ length: alto }, (_, i) => ultimo.fila + i).every((f) => vacia(g, f, c));
    if (COLUMNAS_BLOQUE.includes(col) && libre(col) && libre(col + 1)) return { fila: ultimo.fila, col };
  }
  return { fila: ultimaFilaUsada(g) + 3, col: COLUMNAS_BLOQUE[0] };
}

export type Celda = { fila: number; col: number; valor: string | number };
export type Estilo =
  | "titulo" | "encabezado" | "linea" | "total" | "bonif"
  | "devolucionTitulo" | "devolucion" | "persona" | "totalFinal";
export type Formato = { fila: number; col: number; ancho: 1 | 2; estilo: Estilo };

export type Escritura = { celdas: Celda[]; formatos: Formato[]; bloque: Bloque };

// Fórmula de Santi: sus líneas (todo lo que no es del inquilino) más las devoluciones.
function formulaSanti(g: Grilla, b: Bloque): string {
  const v = b.col + 1;
  const propias = b.lineas.filter((f) => !DEL_INQUILINO.some((r) => r.test(celda(g, f, b.col))));
  const partes = propias.map((f) => ref(f, v));
  if (b.devoluciones.length) partes.push(`SUM(${ref(b.devoluciones[0], v)}:${ref(b.devoluciones.at(-1)!, v)})`);
  return partes.length ? `=${partes.join("+")}` : "=0";
}

function formulasReparto(g: Grilla, b: Bloque): Celda[] {
  const v = b.col + 1;
  return [
    { fila: b.santi, col: v, valor: formulaSanti(g, b) },
    { fila: b.agus, col: v, valor: `=${ref(b.bonif, v)}-${ref(b.santi, v)}` },
    { fila: b.totalFinal, col: v, valor: `=${ref(b.agus, v)}+${ref(b.santi, v)}` },
  ];
}

// Arma el bloque de un mes nuevo en la posición indicada.
export function armarBloque(g: Grilla, liq: Liquidacion, fila: number, col: number): Escritura {
  const v = col + 1;
  const lineas = [...liq.lineas];
  if (!lineas.some((l) => l.etiqueta.startsWith("G. Particular"))) {
    lineas.push({ etiquetaPdf: "", etiqueta: "G. Particular", monto: Number.NaN, paga: "inquilino" });
  }
  const pos = (e: string) => {
    const i = ORDEN.findIndex((o) => e.startsWith(o));
    return i < 0 ? ORDEN.length : i;
  };
  lineas.sort((a, b) => pos(a.etiqueta) - pos(b.etiqueta));

  const celdas: Celda[] = [];
  const formatos: Formato[] = [];
  const poner = (f: number, c: number, valor: string | number) => celdas.push({ fila: f, col: c, valor });

  poner(fila, col, tituloMes(liq.mes, liq.anio));
  formatos.push({ fila, col, ancho: 2, estilo: "titulo" });
  poner(fila + 1, col, "Estado de cuenta");
  formatos.push({ fila: fila + 1, col, ancho: 2, estilo: "encabezado" });

  const filasLineas = lineas.map((l, i) => {
    const f = fila + 2 + i;
    poner(f, col, l.etiqueta);
    if (!Number.isNaN(l.monto)) poner(f, v, l.monto);
    formatos.push({ fila: f, col, ancho: 2, estilo: "linea" });
    return f;
  });
  const total = fila + 2 + lineas.length;
  const bonif = total + 1;
  poner(total, col, "Total");
  poner(total, v, `=SUM(${ref(filasLineas[0], v)}:${ref(filasLineas.at(-1)!, v)})`);
  formatos.push({ fila: total, col, ancho: 2, estilo: "total" });
  poner(bonif, col, "Bonif Antes");
  poner(bonif, v, liq.bonif);
  formatos.push({ fila: bonif, col, ancho: 2, estilo: "bonif" });

  // Dos filas libres para las devoluciones, como en la planilla.
  const paga = bonif + 3;
  poner(paga, col, "Paga C/U");
  formatos.push({ fila: paga, col, ancho: 2, estilo: "encabezado" });
  poner(paga + 1, col, "Agus");
  poner(paga + 2, col, "Santi");
  formatos.push({ fila: paga + 1, col, ancho: 2, estilo: "persona" }, { fila: paga + 2, col, ancho: 2, estilo: "persona" });
  poner(paga + 3, col, "Total");
  formatos.push({ fila: paga + 3, col, ancho: 2, estilo: "totalFinal" });

  const bloque: Bloque = {
    mes: liq.mes, anio: liq.anio, fila, col, lineas: filasLineas, total, bonif,
    devolucionTitulo: null, devoluciones: [], paga, agus: paga + 1, santi: paga + 2, totalFinal: paga + 3,
  };
  // La grilla todavía no tiene las etiquetas nuevas: se arman con las de la liquidación.
  const conEtiquetas: Grilla = g.map((r) => [...(r ?? [])]);
  for (const c of celdas) (conEtiquetas[c.fila] ??= [])[c.col] = c.valor as string;
  celdas.push(...formulasReparto(conEtiquetas, bloque));
  return { celdas, formatos, bloque };
}

export const ALTO_BLOQUE_NUEVO = (liq: Liquidacion) =>
  2 + liq.lineas.length + (liq.lineas.some((l) => l.etiqueta.startsWith("G. Particular")) ? 0 : 1) + 2 + 2 + 4;

export type AgregarDevolucion = Escritura & { moverPagaDesde?: number };

// Agrega una devolución (gasto que pagó Agus y le devuelve Santi) al bloque.
// Si no hay fila libre antes de "Paga C/U", el tramo Paga C/U..Total baja una fila.
export function agregarDevolucion(g: Grilla, b: Bloque, concepto: string, monto: number): AgregarDevolucion {
  const v = b.col + 1;
  const celdas: Celda[] = [];
  const formatos: Formato[] = [];
  const nuevo: Bloque = { ...b, devoluciones: [...b.devoluciones] };
  let moverPagaDesde: number | undefined;

  if (nuevo.devolucionTitulo === null) {
    nuevo.devolucionTitulo = b.bonif + 1;
    celdas.push({ fila: nuevo.devolucionTitulo, col: b.col, valor: "Devolución" });
    formatos.push({ fila: nuevo.devolucionTitulo, col: b.col, ancho: 1, estilo: "devolucionTitulo" });
  }
  const filaNueva = (nuevo.devoluciones.at(-1) ?? nuevo.devolucionTitulo) + 1;

  if (filaNueva >= b.paga) {
    const debajo = b.totalFinal + 1;
    if (!vacia(g, debajo, b.col) || !vacia(g, debajo, v)) {
      throw new Error("No hay lugar debajo del bloque para agregar otra devolución.");
    }
    moverPagaDesde = b.paga;
    nuevo.paga += 1;
    nuevo.agus += 1;
    nuevo.santi += 1;
    nuevo.totalFinal += 1;
  }

  nuevo.devoluciones.push(filaNueva);
  celdas.push({ fila: filaNueva, col: b.col, valor: concepto }, { fila: filaNueva, col: v, valor: monto });
  formatos.push({ fila: filaNueva, col: b.col, ancho: 2, estilo: "devolucion" });
  celdas.push(...formulasReparto(g, nuevo));
  return { celdas, formatos, bloque: nuevo, moverPagaDesde };
}

// Filas del bloque para dibujar la imagen, con los valores ya calculados por la planilla.
export type FilaVista = { etiqueta: string; valor: number | null; estilo: Estilo };

export function vistaBloque(valores: Grilla, b: Bloque): FilaVista[] {
  const etiqueta = (f: number) => celda(valores, f, b.col);
  const valor = (f: number) => {
    const x = valores[f]?.[b.col + 1];
    return typeof x === "number" ? x : x === "" || x == null ? null : Number(x);
  };
  const filas: FilaVista[] = [
    { etiqueta: tituloMes(b.mes, b.anio), valor: null, estilo: "titulo" },
    { etiqueta: "Estado de cuenta", valor: null, estilo: "encabezado" },
    ...b.lineas.map((f) => ({ etiqueta: etiqueta(f), valor: valor(f), estilo: "linea" as const })),
    { etiqueta: "Total", valor: valor(b.total), estilo: "total" },
    { etiqueta: "Bonif Antes", valor: valor(b.bonif), estilo: "bonif" },
  ];
  if (b.devolucionTitulo !== null) {
    filas.push({ etiqueta: "Devolución", valor: null, estilo: "devolucionTitulo" });
    for (const f of b.devoluciones) filas.push({ etiqueta: etiqueta(f), valor: valor(f), estilo: "devolucion" });
  }
  filas.push(
    { etiqueta: "Paga C/U", valor: null, estilo: "encabezado" },
    { etiqueta: "Agus", valor: valor(b.agus), estilo: "persona" },
    { etiqueta: "Santi", valor: valor(b.santi), estilo: "persona" },
    { etiqueta: "Total", valor: valor(b.totalFinal), estilo: "totalFinal" },
  );
  return filas;
}

