// Entrega un comprobante o una cédula privada de Cloudinary solo a administradores.
// Uso: GET /api/documento?publicId=nelary/documentos/xxx&tipo=image&formato=jpg
// Header obligatorio: Authorization: Bearer <token de sesión de Firebase>
// Responde con un enlace firmado que vence en 5 minutos.
// Las claves de Cloudinary están en Vercel (CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET).

import { createHash, createVerify } from "crypto";

const PROYECTO = "cabinas-nelary";
const CLOUD_NAME = "kyhdlu4q";
const CARPETA = "nelary/documentos/";
const CERTIFICADOS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

// Mismos administradores que las reglas de Firestore
const ADMIN_UIDS = [
  "YuGaXZVr1bSBYvPqJLOL3c23aS62",
  "v2tphhfJLAdd5muupr8eDdJVuZJ3",
  "jaTW5LoCJQfySBfGtSLwvSpUMgB2"
];

const TIPOS_VALIDOS = ["image", "raw", "video"];

let certificadosCache = null;
let certificadosVencen = 0;

async function obtenerCertificados() {
  if (certificadosCache && Date.now() < certificadosVencen) return certificadosCache;
  const respuesta = await fetch(CERTIFICADOS_URL);
  if (!respuesta.ok) throw new Error("No se pudieron leer los certificados de Google.");
  certificadosCache = await respuesta.json();
  certificadosVencen = Date.now() + 60 * 60 * 1000;
  return certificadosCache;
}

// Verifica la firma y los datos del token de Firebase Auth sin usar claves secretas
async function verificarToken(token) {
  const partes = token.split(".");
  if (partes.length !== 3) throw new Error("Token con formato inválido.");

  const cabecera = JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8"));
  const carga = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));

  if (cabecera.alg !== "RS256" || !cabecera.kid) throw new Error("Algoritmo de token no válido.");

  const certificados = await obtenerCertificados();
  const certificado = certificados[cabecera.kid];
  if (!certificado) throw new Error("Certificado de token desconocido.");

  const verificador = createVerify("RSA-SHA256");
  verificador.update(partes[0] + "." + partes[1]);
  if (!verificador.verify(certificado, Buffer.from(partes[2], "base64url"))) {
    throw new Error("Firma de token no válida.");
  }

  const ahora = Math.floor(Date.now() / 1000);
  if (carga.aud !== PROYECTO) throw new Error("Token de otro proyecto.");
  if (carga.iss !== "https://securetoken.google.com/" + PROYECTO) throw new Error("Emisor no válido.");
  if (!carga.exp || carga.exp < ahora) throw new Error("Token vencido.");
  if (!carga.iat || carga.iat > ahora + 300) throw new Error("Token con fecha futura.");
  if (!carga.sub || carga.sub !== carga.user_id) throw new Error("Usuario no válido.");

  return carga.sub;
}

// Firma de la API de Cloudinary: parámetros ordenados alfabéticamente + secreto, en SHA-1
function firmar(parametros, secreto) {
  const aFirmar = Object.keys(parametros)
    .sort()
    .map(function (clave) { return clave + "=" + parametros[clave]; })
    .join("&");
  return createHash("sha1").update(aFirmar + secreto).digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) {
    res.status(500).json({ error: "Falta configurar Cloudinary en Vercel." });
    return;
  }

  const cabecera = req.headers.authorization || "";
  const token = cabecera.indexOf("Bearer ") === 0 ? cabecera.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Falta la sesión de administrador." });
    return;
  }

  let uid;
  try {
    uid = await verificarToken(token);
  } catch (error) {
    res.status(401).json({ error: "La sesión no es válida. Vuelva a entrar al panel." });
    return;
  }

  if (ADMIN_UIDS.indexOf(uid) === -1) {
    res.status(403).json({ error: "Esta cuenta no es administradora." });
    return;
  }

  const publicId = req.query && req.query.publicId;
  const tipo = req.query && req.query.tipo;
  const formato = (req.query && req.query.formato) || "";

  if (typeof publicId !== "string" || publicId.indexOf(CARPETA) !== 0 || !/^[A-Za-z0-9_\/\-]+$/.test(publicId)) {
    res.status(400).json({ error: "Documento no válido." });
    return;
  }
  if (TIPOS_VALIDOS.indexOf(tipo) === -1) {
    res.status(400).json({ error: "Tipo de archivo no válido." });
    return;
  }
  if (formato && !/^[a-z0-9]{2,5}$/i.test(formato)) {
    res.status(400).json({ error: "Formato no válido." });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const parametros = {
    expires_at: timestamp + 300,
    public_id: publicId,
    timestamp: timestamp,
    type: "authenticated"
  };
  if (formato) parametros.format = formato;

  const firma = firmar(parametros, apiSecret);

  const consulta = new URLSearchParams();
  Object.keys(parametros).forEach(function (clave) { consulta.append(clave, String(parametros[clave])); });
  consulta.append("api_key", apiKey);
  consulta.append("signature", firma);

  const url = "https://api.cloudinary.com/v1_1/" + CLOUD_NAME + "/" + tipo + "/download?" + consulta.toString();
  res.status(200).json({ url: url });
}
