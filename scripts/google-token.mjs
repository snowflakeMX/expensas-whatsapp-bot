// Genera un GOOGLE_REFRESH_TOKEN con los permisos que usa el bot
// (leer Gmail y editar Google Sheets). Uso: node scripts/google-token.mjs
//
// Pide el client ID y el client secret de tu cliente OAuth de Google Cloud,
// abre el navegador para autorizar y muestra el refresh token para pegarlo en
// Vercel. No guarda nada en disco.
//
// El cliente OAuth tiene que ser de tipo "App de escritorio", o de tipo "Web"
// con http://127.0.0.1:53682 en "URIs de redireccionamiento autorizados".
import http from "node:http";
import { exec } from "node:child_process";
import readline from "node:readline/promises";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];
const PUERTO = 53682;
const REDIRECT = `http://127.0.0.1:${PUERTO}`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const clientId = (await rl.question("GOOGLE_CLIENT_ID: ")).trim();
const clientSecret = (await rl.question("GOOGLE_CLIENT_SECRET: ")).trim();
rl.close();

const oauth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
const url = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

const codigo = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const params = new URL(req.url ?? "/", REDIRECT).searchParams;
    res.end(params.get("code") ? "Listo, ya podés cerrar esta pestaña y volver a la terminal." : "No llegó el código.");
    server.close();
    params.get("code") ? resolve(params.get("code")) : reject(new Error(params.get("error") ?? "sin código"));
  });
  server.listen(PUERTO, "127.0.0.1", () => {
    console.log("\nAbrí este link si no se abre solo:\n" + url + "\n");
    exec(`open "${url}"`);
  });
});

const { tokens } = await oauth.getToken(codigo);
if (!tokens.refresh_token) {
  console.error("Google no devolvió refresh token. Revocá el acceso de la app en myaccount.google.com/permissions y volvé a correr el script.");
  process.exit(1);
}
console.log("\nGOOGLE_REFRESH_TOKEN (pegalo en Vercel, en Production):\n\n" + tokens.refresh_token + "\n");
