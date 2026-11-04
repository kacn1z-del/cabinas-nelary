// Firma las subidas a Cloudinary para documentos privados (comprobantes y cédulas).
// Las claves están en Vercel: CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET.
// El secreto nunca sale al navegador; solo se envía la firma.

import { createHash } from "crypto";

const CLOUD_NAME = "kyhdlu4q";
const CARPETA = "nelary/documentos";
const TIPO = "authenticated";

export default function handler(req, res) {
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!apiKey || !apiSecret) {
    res.status(500).json({ error: "Falta configurar Cloudinary en Vercel." });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Los parámetros van ordenados alfabéticamente, como lo exige Cloudinary
  const aFirmar = "folder=" + CARPETA + "&timestamp=" + timestamp + "&type=" + TIPO;
  const signature = createHash("sha1").update(aFirmar + apiSecret).digest("hex");

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    apiKey: apiKey,
    cloudName: CLOUD_NAME,
    folder: CARPETA,
    type: TIPO,
    timestamp: timestamp,
    signature: signature
  });
}
