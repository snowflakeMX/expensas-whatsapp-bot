// pdf-parse (vía su entrypoint normal) intenta leer un PDF de prueba al
// importarse si NODE_ENV no es "production" durante el build; se carga el
// archivo interno directamente para evitar ese efecto secundario.
declare const require: (id: string) => { (buffer: Buffer): Promise<{ text: string }> };
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

export async function extraerTextoPdf(pdf: Buffer): Promise<string> {
  const resultado = await pdfParse(pdf);
  return resultado.text as string;
}
