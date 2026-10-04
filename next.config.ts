import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // resvg trae un binario nativo y unpdf su propio pdf.js: se cargan desde node_modules.
  serverExternalPackages: ["@resvg/resvg-js", "unpdf"],
  // Fuentes para dibujar la imagen del bloque (se leen con fs en runtime).
  outputFileTracingIncludes: { "/api/whatsapp/webhook": ["./assets/fonts/**"] },
};

export default nextConfig;
