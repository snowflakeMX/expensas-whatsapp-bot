import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";

const Gasto = z.object({
  concepto: z.string(),
  monto: z.number(),
});

const Clasificacion = z.object({
  periodo: z.string().describe("Mes/año de la liquidación, ej. 'Septiembre 2026'"),
  totalGeneral: z.number(),
  ordinarios: z.array(Gasto),
  extraordinarios: z.array(Gasto),
  totalOrdinarios: z.number(),
  totalExtraordinarios: z.number(),
  notas: z.string().optional().describe("Gastos dudosos o que no se pudieron clasificar con certeza"),
});

export type ClasificacionExpensas = z.infer<typeof Clasificacion>;

const PROMPT_SISTEMA = `Sos un asistente que lee liquidaciones de expensas de consorcios argentinos y separa
cada ítem en dos categorías:

- "ordinarios": gastos de uso habitual del edificio, los paga el INQUILINO. Ejemplos: limpieza,
  portería/encargado, luz y gas de espacios comunes, mantenimiento de ascensor, seguro, administración.
- "extraordinarios": gastos de capital o mejoras, los paga el PROPIETARIO. Ejemplos: reparaciones
  estructurales, pintura, obras, equipamiento nuevo, fondo de reserva, honorarios extraordinarios.

Si un ítem es ambiguo, usalo con tu mejor criterio y mencionalo en "notas". Devolvé únicamente el
JSON pedido, sin texto adicional.`;

export async function clasificarExpensas(textoPdf: string): Promise<ClasificacionExpensas> {
  const anthropic = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });

  const mensaje = await anthropic.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4096,
    system: PROMPT_SISTEMA,
    messages: [{ role: "user", content: `Liquidación de expensas:\n\n${textoPdf}` }],
    tools: [
      {
        name: "clasificacion_expensas",
        description: "Reporta la clasificación de gastos ordinarios y extraordinarios",
        input_schema: {
          type: "object",
          properties: {
            periodo: { type: "string" },
            totalGeneral: { type: "number" },
            ordinarios: {
              type: "array",
              items: { type: "object", properties: { concepto: { type: "string" }, monto: { type: "number" } }, required: ["concepto", "monto"] },
            },
            extraordinarios: {
              type: "array",
              items: { type: "object", properties: { concepto: { type: "string" }, monto: { type: "number" } }, required: ["concepto", "monto"] },
            },
            totalOrdinarios: { type: "number" },
            totalExtraordinarios: { type: "number" },
            notas: { type: "string" },
          },
          required: ["periodo", "totalGeneral", "ordinarios", "extraordinarios", "totalOrdinarios", "totalExtraordinarios"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "clasificacion_expensas" },
  });

  const usoHerramienta = mensaje.content.find((b) => b.type === "tool_use");
  if (!usoHerramienta || usoHerramienta.type !== "tool_use") {
    throw new Error("Claude no devolvió la clasificación esperada");
  }
  return Clasificacion.parse(usoHerramienta.input);
}
