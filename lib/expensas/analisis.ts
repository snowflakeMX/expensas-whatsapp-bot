import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { env } from "@/lib/env";

const Concepto = z.object({
  descripcion: z.string(),
  monto: z.number(),
  tipo: z.enum(["ordinaria", "extraordinaria"]),
  paga: z.enum(["inquilino", "propietario"]),
  motivo: z.string(),
});

const AnalisisExpensas = z.object({
  periodo: z.string(),
  unidad: z.string().nullable(),
  vencimiento: z.string().nullable(),
  total_liquidacion_unidad: z.number().nullable(),
  conceptos: z.array(Concepto),
  observaciones: z.string(),
});

export type Analisis = z.infer<typeof AnalisisExpensas> & {
  totalInquilino: number;
  totalPropietario: number;
};

const SISTEMA = `Analizás liquidaciones de expensas de consorcios en Argentina para un propietario que alquila su unidad.

Tu tarea: extraer lo que corresponde pagar a ESA unidad y separar cada concepto entre inquilino y propietario.

Criterio (art. 1209 y 1210 del Código Civil y Comercial y uso habitual en contratos de locación):
- Expensas ordinarias (gastos habituales de mantenimiento y funcionamiento: sueldos y cargas del encargado, limpieza, luz y agua comunes, abonos de ascensor, seguros, honorarios de administración, pequeñas reparaciones) → paga el inquilino.
- Expensas extraordinarias (obras, mejoras, reparaciones estructurales, juicios, indemnizaciones, aportes al fondo de reserva, cuotas especiales aprobadas en asamblea) → paga el propietario.
- Intereses o recargos por mora: indicá a quién corresponde según qué concepto estaba impago y explicalo en "motivo"; si no se puede saber, asignalo al propietario y aclaralo en observaciones.

Reglas:
- Los montos de "conceptos" son los que le corresponden a la unidad (ya prorrateados), en pesos, como número sin separadores de miles.
- Si la liquidación ya trae para la unidad el importe de "expensas ordinarias" y "extraordinarias" (columnas A/B o similar), usá esos importes como conceptos en lugar del detalle de gastos generales del edificio.
- No inventes conceptos ni montos. Si algo es ambiguo o el PDF no permite determinarlo, decilo en "observaciones".
- "motivo": una frase corta que justifique la clasificación.`;

// Clasifica el PDF de expensas con Claude. Los totales se calculan acá a partir
// de los conceptos para que siempre sumen.
export async function analizarExpensas(pdf: Buffer): Promise<Analisis> {
  const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  const unidad = process.env.EXPENSAS_UNIDAD?.trim();

  const respuesta = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(AnalisisExpensas) },
    system: SISTEMA,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          {
            type: "text",
            text: unidad
              ? `Analizá esta liquidación de expensas. La unidad es: ${unidad}.`
              : "Analizá esta liquidación de expensas. Si incluye varias unidades y no queda claro cuál es la mía, decilo en observaciones.",
          },
        ],
      },
    ],
  });

  if (respuesta.stop_reason === "refusal") throw new Error("Claude no pudo analizar el PDF (refusal).");
  if (respuesta.stop_reason === "max_tokens") throw new Error("El análisis del PDF quedó cortado (max_tokens).");
  const analisis = respuesta.parsed_output;
  if (!analisis) throw new Error("Claude no devolvió un análisis válido.");

  const total = (paga: "inquilino" | "propietario") =>
    analisis.conceptos.filter((c) => c.paga === paga).reduce((suma, c) => suma + c.monto, 0);
  return { ...analisis, totalInquilino: total("inquilino"), totalPropietario: total("propietario") };
}
