import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { FilaVista } from "./bloque";

// Dibuja el bloque del mes con el mismo aspecto que en la planilla y lo devuelve como PNG.

const ANCHO_ETIQUETA = 200;
const ANCHO_VALOR = 150;
const ALTO_FILA = 28;
const MARGEN = 16;

const FUENTES = ["Arimo-400.ttf", "Arimo-700.ttf"].map((f) => path.join(process.cwd(), "assets", "fonts", f));

export const formatoPesos = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FONDO: Partial<Record<FilaVista["estilo"], string>> = {
  encabezado: "#cfe2f3",
  devolucion: "#d9ead3",
  totalFinal: "#93c47d",
};

export function imagenBloque(filas: FilaVista[]): Buffer {
  const ancho = ANCHO_ETIQUETA + ANCHO_VALOR;
  const alto = filas.length * ALTO_FILA;
  const x0 = MARGEN;
  const xValor = x0 + ANCHO_ETIQUETA;
  const partes: string[] = [];

  filas.forEach((f, i) => {
    const y = MARGEN + i * ALTO_FILA;
    const yTexto = y + ALTO_FILA / 2 + 5;
    const negrita = ["titulo", "devolucionTitulo", "persona"].includes(f.estilo) ? ' font-weight="700"' : "";
    const fondo = FONDO[f.estilo];
    if (fondo) partes.push(`<rect x="${x0}" y="${y}" width="${ancho}" height="${ALTO_FILA}" fill="${fondo}"/>`);

    // Bordes: todo menos el título y el subtítulo de devoluciones van dentro de la grilla.
    if (f.estilo !== "titulo" && f.estilo !== "devolucionTitulo") {
      partes.push(`<rect x="${x0}" y="${y}" width="${ancho}" height="${ALTO_FILA}" fill="none" stroke="#000" stroke-width="1"/>`);
      if (f.estilo !== "encabezado") partes.push(`<line x1="${xValor}" y1="${y}" x2="${xValor}" y2="${y + ALTO_FILA}" stroke="#bbb"/>`);
    }

    const centrado = ["titulo", "encabezado", "devolucionTitulo"].includes(f.estilo);
    const derecha = f.estilo === "total" || f.estilo === "bonif";
    const etiqueta = escapar(f.etiqueta);
    if (centrado) {
      partes.push(`<text x="${x0 + ancho / 2}" y="${yTexto}" text-anchor="middle"${negrita}>${etiqueta}</text>`);
    } else {
      const xEtiqueta = derecha ? xValor - 8 : x0 + 8;
      partes.push(`<text x="${xEtiqueta}" y="${yTexto}" text-anchor="${derecha ? "end" : "start"}"${negrita}>${etiqueta}</text>`);
    }
    if (f.valor !== null && !Number.isNaN(f.valor)) {
      partes.push(`<text x="${xValor + ANCHO_VALOR - 8}" y="${yTexto}" text-anchor="end"${negrita}>${formatoPesos(f.valor)}</text>`);
    }
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho + 2 * MARGEN}" height="${alto + 2 * MARGEN}" font-family="Arimo" font-size="14">
<rect width="100%" height="100%" fill="#fff"/>
${partes.join("\n")}
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: 2 },
    font: { fontFiles: FUENTES, loadSystemFonts: false, defaultFontFamily: "Arimo" },
  });
  return Buffer.from(resvg.render().asPng());
}
