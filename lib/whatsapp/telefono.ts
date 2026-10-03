import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";

// Meta entrega el wa_id de los celulares argentinos como 549 + área + número,
// pero para enviar no acepta ese formato: hay que sacar el 9 e insertar "15"
// después del código de área (mismo ajuste que en futbol-semanal-app,
// confirmado contra la API real):
//   5491137022655 -> 54111537022655   (54, 11, 15, 37022655)
// El código de área (2 a 4 dígitos) se toma del formato nacional de
// libphonenumber-js ("011 15-3702-2655" -> "11").
export function telefonoParaEnvio(waId: string): string {
  if (!waId.startsWith("549")) return waId;

  const phone = parsePhoneNumberFromString(`+${waId}`);
  const nacional = phone?.nationalNumber ?? "";
  const area = phone ? /^0(\d{2,4}) 15-/.exec(phone.formatNational())?.[1] : undefined;
  const local = area ? nacional.slice(1 + area.length) : "";
  if (!area || !local || `9${area}${local}` !== nacional) {
    throw new Error(`No se pudo armar el número de envío para ${waId}`);
  }
  return `54${area}15${local}`;
}
