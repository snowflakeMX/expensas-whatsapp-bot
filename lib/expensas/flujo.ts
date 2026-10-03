import { enviarTexto } from "@/lib/whatsapp/enviar";

// Orquesta "verificar expensas". Cada paso se implementa en los próximos PRs:
// 1. Buscar el último mail de expensas en Gmail y bajar el PDF.
// 2. Extraer y clasificar gastos ordinarios vs. extraordinarios con Claude.
// 3. Escribir el detalle en un documento de Drive.
// 4. Responder por WhatsApp con el PDF y el detalle inquilino / propietario.
// phoneNumberId: el número del bot que recibió el mensaje, para responder desde ese mismo.
export async function verificarExpensas(waId: string, phoneNumberId?: string): Promise<void> {
  await enviarTexto(waId, "Recibido, estoy buscando el mail de expensas. Todavía estoy en construcción.", phoneNumberId);
}
