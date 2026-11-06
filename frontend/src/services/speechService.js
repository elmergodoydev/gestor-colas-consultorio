import api from "./api";

/**
 * Solicita a Django una locución Piper y recibe una URL HTTP temporal.
 * El MP3 se conserva en Redis durante un periodo corto; no se crea archivo.
 */
export async function generarAudioLlamado(texto, monitorToken, signal) {
  const textoLimpio = String(texto || "").trim();

  if (!textoLimpio) {
    throw new Error("No se recibió texto para generar la locución.");
  }

  if (!monitorToken) {
    throw new Error("El monitor no tiene un token de activación válido.");
  }

  const respuesta = await api.post(
    "monitor/voz/",
    { texto: textoLimpio },
    {
      headers: {
        Authorization: `Bearer ${monitorToken}`,
      },
      timeout: 60000,
      signal,
    }
  );

  const audioUrl = respuesta.data?.audio_url;

  if (typeof audioUrl !== "string" || !audioUrl.trim()) {
    throw new Error(
      respuesta.data?.detail ||
      "Django no devolvió la dirección temporal del audio."
    );
  }

  // La URL debe pertenecer al mismo origen de la aplicación para evitar
  // enviar accidentalmente al reproductor una dirección externa inesperada.
  const url = new URL(audioUrl, window.location.origin);
  if (url.origin !== window.location.origin) {
    throw new Error("El servidor devolvió una URL de audio de otro origen.");
  }

  return url.href;
}
