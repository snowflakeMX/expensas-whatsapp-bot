import { createHmac, timingSafeEqual } from "node:crypto";

// Verifica el header x-hub-signature-256 que manda Meta en cada webhook.
export function firmaValida(cuerpo: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const esperado = createHmac("sha256", appSecret).update(cuerpo).digest("hex");
  const recibido = header.slice("sha256=".length);
  if (recibido.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(recibido, "hex"), Buffer.from(esperado, "hex"));
}
