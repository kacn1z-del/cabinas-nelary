// Lee un calendario iCal de Airbnb o Booking para el panel de administración.
// Uso: /api/importar?url=ENLACE_ICAL
// Solo acepta enlaces https de Airbnb y Booking.

const HOSTS_PERMITIDOS = [
  "airbnb.com",
  "www.airbnb.com",
  "booking.com",
  "www.booking.com",
  "admin.booking.com"
];

export default async function handler(req, res) {
  const enlace = req.query && req.query.url;

  let destino;
  try {
    destino = new URL(enlace);
  } catch (error) {
    res.status(400).send("El enlace no es válido.");
    return;
  }

  if (destino.protocol !== "https:" || HOSTS_PERMITIDOS.indexOf(destino.hostname) === -1) {
    res.status(400).send("Solo se aceptan enlaces de Airbnb o Booking.");
    return;
  }

  try {
    const respuesta = await fetch(destino.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RefugioNELARY/1.0)" }
    });

    if (!respuesta.ok) {
      res.status(502).send("La plataforma respondió con error " + respuesta.status + ".");
      return;
    }

    const texto = await respuesta.text();
    if (texto.indexOf("BEGIN:VCALENDAR") === -1) {
      res.status(502).send("El enlace no devolvió un calendario válido.");
      return;
    }

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(texto);
  } catch (error) {
    console.error("No se pudo leer el calendario:", error);
    res.status(502).send("No se pudo leer el calendario en este momento.");
  }
}
