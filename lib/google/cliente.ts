import { google } from "googleapis";
import { env } from "@/lib/env";

// Cliente OAuth con refresh token del usuario (scopes: gmail.readonly + spreadsheets).
// Para generar el token: node scripts/google-token.mjs
export function googleAuth() {
  const auth = new google.auth.OAuth2(env("GOOGLE_CLIENT_ID"), env("GOOGLE_CLIENT_SECRET"));
  auth.setCredentials({ refresh_token: env("GOOGLE_REFRESH_TOKEN") });
  return auth;
}

export const gmail = () => google.gmail({ version: "v1", auth: googleAuth() });
export const sheets = () => google.sheets({ version: "v4", auth: googleAuth() });
