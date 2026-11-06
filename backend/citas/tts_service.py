"""Cliente HTTP interno para el servicio Piper TTS.

La síntesis se realiza en el contenedor Piper. Django solo reenvía la
solicitud y devuelve los bytes WAV; no crea archivos ni carga el modelo.
"""

from __future__ import annotations

import json
import logging
import subprocess
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings

logger = logging.getLogger(__name__)


class PiperServiceError(RuntimeError):
    """Error al comunicarse con el servicio HTTP de Piper."""


def generar_audio_wav(texto: str) -> bytes:
    """Solicita a Piper un WAV en memoria y devuelve sus bytes."""
    texto = str(texto or "").strip()
    if not texto:
        raise ValueError("El texto para la locución está vacío.")

    payload = {
        "text": texto,
        "voice": settings.PIPER_TTS_VOICE,
        "length_scale": settings.PIPER_TTS_LENGTH_SCALE,
        "noise_scale": settings.PIPER_TTS_NOISE_SCALE,
        "noise_w_scale": settings.PIPER_TTS_NOISE_W_SCALE,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        settings.PIPER_TTS_URL,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "audio/wav"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=settings.PIPER_TTS_TIMEOUT) as response:
            content_type = response.headers.get("Content-Type", "").lower()
            audio = response.read()
            status_code = response.status
    except HTTPError as exc:
        detalle = exc.read(512).decode("utf-8", errors="replace")
        logger.error("Piper respondió HTTP %s: %s", exc.code, detalle)
        raise PiperServiceError(
            f"El servicio Piper respondió con HTTP {exc.code}."
        ) from exc
    except (URLError, TimeoutError, OSError) as exc:
        logger.exception("No se pudo conectar con Piper en %s", settings.PIPER_TTS_URL)
        raise PiperServiceError(
            "No se pudo conectar con el servicio de voz Piper."
        ) from exc

    if status_code != 200:
        raise PiperServiceError(
            f"Piper devolvió un estado HTTP inesperado: {status_code}."
        )

    if not audio.startswith(b"RIFF") or audio[8:12] != b"WAVE":
        logger.error("Piper devolvió una respuesta que no es WAV (%s).", content_type)
        raise PiperServiceError("Piper no devolvió un audio WAV válido.")

    return audio


class AudioConversionError(RuntimeError):
    """Error al convertir el WAV de Piper a MP3."""


def convertir_wav_a_mp3(audio_wav: bytes) -> bytes:
    """Convierte WAV a MP3 en memoria usando FFmpeg; no escribe archivos."""
    if not audio_wav or not audio_wav.startswith(b"RIFF"):
        raise AudioConversionError("Piper no entregó un WAV válido para convertir.")

    comando = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        "-i", "pipe:0",
        "-map", "0:a:0",
        "-vn",
        "-codec:a", "libmp3lame",
        "-b:a", "128k",
        "-ar", "44100",
        "-ac", "1",
        "-f", "mp3",
        "pipe:1",
    ]

    try:
        resultado = subprocess.run(
            comando,
            input=audio_wav,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=False,
        )
    except FileNotFoundError as exc:
        raise AudioConversionError(
            "FFmpeg no está instalado en el contenedor backend."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise AudioConversionError("La conversión del audio a MP3 agotó el tiempo de espera.") from exc
    except OSError as exc:
        raise AudioConversionError("No se pudo ejecutar FFmpeg para convertir el audio.") from exc

    if resultado.returncode != 0 or not resultado.stdout:
        detalle = resultado.stderr.decode("utf-8", errors="replace")[-500:]
        logger.error("FFmpeg no pudo convertir WAV a MP3: %s", detalle)
        raise AudioConversionError("No se pudo convertir la locución a MP3.")

    return resultado.stdout
