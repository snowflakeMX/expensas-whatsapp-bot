// Política de privacidad: Google la exige para publicar la app de OAuth
// (sin esto los refresh tokens vencen a los 7 días en modo "Prueba").
export const metadata = { title: "Expensas Bot - Privacidad" };

export default function Privacidad() {
  return (
    <main style={{ maxWidth: 640, margin: "40px auto", padding: "0 16px", fontFamily: "sans-serif", lineHeight: 1.5 }}>
      <h1>Política de privacidad de Expensas Bot</h1>
      <p>
        Expensas Bot es una herramienta de uso personal de su dueño para procesar las expensas de su unidad y
        repartirlas entre propietario e inquilino.
      </p>
      <h2>Qué datos usa</h2>
      <ul>
        <li>Gmail (solo lectura): busca el mail mensual de la administración del barrio y descarga la liquidación en PDF.</li>
        <li>Google Sheets: escribe el detalle del mes en la planilla de expensas del dueño.</li>
        <li>WhatsApp: recibe los comandos del dueño y le responde con el resumen.</li>
      </ul>
      <h2>Qué no hace</h2>
      <p>
        No guarda copias de los mails, no lee otros mensajes que no sean los de expensas y no comparte ningún dato
        con terceros. Los datos se usan únicamente para la función descrita arriba.
      </p>
      <h2>Contacto</h2>
      <p>espiritudadirri@gmail.com</p>
    </main>
  );
}
