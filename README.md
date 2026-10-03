# expensas-whatsapp-bot

Bot de WhatsApp que, al recibir "verificar expensas":

1. Busca en Gmail el mail de las expensas y descarga el PDF.
2. Separa gastos ordinarios (inquilino) de extraordinarios (propietario) con Claude.
3. Escribe el detalle en un documento de Google Drive.
4. Responde por WhatsApp con el PDF original y un archivo con lo que paga cada uno.

## Stack

Next.js (App Router) en Vercel, WhatsApp Cloud API (Meta), Claude API, Gmail y Drive vía OAuth.

## Desarrollo

```bash
cp .env.example .env.local   # completar valores, nunca commitearlos
npm install
npm run dev
```

Webhook: `GET/POST /api/whatsapp/webhook` (verificación de Meta + firma HMAC `x-hub-signature-256`).
