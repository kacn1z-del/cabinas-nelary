// Calendario iCal de cada cabaña para Airbnb y Booking.
// Uso: https://cabinas-nelary.vercel.app/api/calendario?cabana=grande
//      https://cabinas-nelary.vercel.app/api/calendario?cabana=pequena

const PROYECTO = "cabinas-nelary";

const CABANAS = {
  grande: "Cabaña Grande",
  pequena: "Cabina Pequeña"
};

// Lee las noches de una cabaña desde Firestore (la colección bloqueos es de lectura pública)
async function leerBloqueos(nombreCabana) {
  const url = "https://firestore.googleapis.com/v1/projects/" + PROYECTO +
    "/databases/(default)/documents:runQuery";

  const respuesta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "bloqueos" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "cabana" },
            op: "EQUAL",
            value: { stringValue: nombreCabana }
          }
        }
      }
    })
  });

  if (!respuesta.ok) throw new Error("Firestore respondió " + respuesta.status);
  const resultados = await respuesta.json();

  const ahora = Date.now();
  const fechas = [];

  resultados.forEach(function (item) {
    if (!item.document) return;
    const campos = item.document.fields || {};
    const estado = campos.estado && campos.estado.stringValue;
    const fecha = campos.fecha && campos.fecha.stringValue;
    const expiraEn = campos.expiraEn && campos.expiraEn.timestampValue;

    // Los pendientes vencidos ya no bloquean la fecha
    if (estado === "pendiente" && expiraEn && new Date(expiraEn).getTime() < ahora) return;
    if (fecha) fechas.push(fecha);
  });

  return fechas;
}

// Suma un día a una fecha "AAAA-MM-DD"
function diaSiguiente(texto) {
  const d = new Date(texto + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Agrupa noches consecutivas en un solo evento
function agrupar(fechas) {
  const ordenadas = Array.from(new Set(fechas)).sort();
  const bloques = [];

  ordenadas.forEach(function (f) {
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && diaSiguiente(ultimo.fin) === f) {
      ultimo.fin = f;
    } else {
      bloques.push({ inicio: f, fin: f });
    }
  });

  return bloques;
}

function sinGuiones(fecha) {
  return fecha.replace(/-/g, "");
}

function sello() {
  return new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

function construirIcs(nombreCabana, bloques) {
  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Refugio NELARY//Disponibilidad//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + nombreCabana + " - Refugio NELARY"
  ];

  bloques.forEach(function (b, i) {
    lineas.push(
      "BEGIN:VEVENT",
      "UID:nelary-" + sinGuiones(b.inicio) + "-" + i + "@cabinas-nelary.vercel.app",
      "DTSTAMP:" + sello(),
      "DTSTART;VALUE=DATE:" + sinGuiones(b.inicio),
      "DTEND;VALUE=DATE:" + sinGuiones(diaSiguiente(b.fin)),
      "SUMMARY:Reservado",
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  });

  lineas.push("END:VCALENDAR");
  return lineas.join("\r\n");
}

// Nombre de una cabaña: primero las dos originales y después la colección "cabanas" (lectura pública)
async function nombreDeCabana(clave) {
  if (!/^[a-z0-9-]{1,60}$/.test(clave)) return null;

  const url = "https://firestore.googleapis.com/v1/projects/" + PROYECTO +
    "/databases/(default)/documents/cabanas/" + clave;

  const respuesta = await fetch(url);
  if (respuesta.status === 404) return CABANAS[clave] || null;
  if (!respuesta.ok) throw new Error("Firestore respondió " + respuesta.status);

  const documento = await respuesta.json();
  const campos = documento.fields || {};
  if (campos.activa && campos.activa.booleanValue === false) return null;
  return (campos.nombre && campos.nombre.stringValue) || CABANAS[clave] || null;
}

export default async function handler(req, res) {
  const clave = req.query && req.query.cabana;
  let nombreCabana = null;

  try {
    nombreCabana = clave ? await nombreDeCabana(String(clave)) : null;
  } catch (error) {
    console.error("No se pudo leer la cabaña:", error);
    res.status(500).send("No se pudo generar el calendario en este momento.");
    return;
  }

  if (!nombreCabana) {
    res.status(400).send("Cabaña no válida. Use el identificador de una cabaña activa, por ejemplo ?cabana=grande");
    return;
  }

  try {
    const fechas = await leerBloqueos(nombreCabana);
    const bloques = agrupar(fechas);

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.status(200).send(construirIcs(nombreCabana, bloques));
  } catch (error) {
    console.error("No se pudo generar el calendario:", error);
    res.status(500).send("No se pudo generar el calendario en este momento.");
  }
}
