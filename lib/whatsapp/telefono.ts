// Meta entrega los números argentinos como 549 + área + número, pero para enviar
// hay que sacar el "9" de celular (mismo ajuste que en futbol-semanal-app).
export function telefonoParaEnvio(waId: string): string {
  if (waId.startsWith("549")) return "54" + waId.slice(3);
  return waId;
}
