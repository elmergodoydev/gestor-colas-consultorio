"""Endpoint autenticado de locuciones MP3 para monitores.

POST genera el audio y lo conserva temporalmente en Redis.
GET entrega el audio mediante una URL opaca de corta duración.
No se crean archivos en el disco.
"""

import logging
import secrets

from django.core.cache import cache
from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from citas.monitor_activation_views import obtener_monitor_activado
from citas.tts_service import (
    AudioConversionError,
    PiperServiceError,
    convertir_wav_a_mp3,
    generar_audio_wav,
)

logger = logging.getLogger(__name__)

LONGITUD_MAXIMA_TEXTO = 250
TTL_AUDIO_SEGUNDOS = 120
PREFIJO_CACHE_AUDIO = "monitor_tts:"


class MonitorVozAPIView(APIView):
    """POST genera un ticket temporal; GET entrega el MP3 asociado."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        # El POST sí exige un monitor activado. La URL GET posterior se
        # protege mediante un token aleatorio de alta entropía y corta vida.
        obtener_monitor_activado(request)

        texto = request.data.get("texto", "")
        if not isinstance(texto, str):
            return Response(
                {"detail": "El campo texto debe ser una cadena."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        texto = texto.strip()
        if not texto:
            return Response(
                {"detail": "El texto para la locución es obligatorio."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(texto) > LONGITUD_MAXIMA_TEXTO:
            return Response(
                {"detail": f"El texto no puede superar {LONGITUD_MAXIMA_TEXTO} caracteres."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            audio_wav = generar_audio_wav(texto)
            audio_mp3 = convertir_wav_a_mp3(audio_wav)
        except (PiperServiceError, AudioConversionError) as exc:
            logger.warning("No se pudo generar la locución del monitor: %s", exc)
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception:
            logger.exception("Error inesperado al generar una locución del monitor.")
            return Response(
                {"detail": "No se pudo generar la locución. Revisa el servicio de voz."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # El token no contiene el nombre ni el texto del paciente.
        ticket = secrets.token_urlsafe(32)
        cache_key = f"{PREFIJO_CACHE_AUDIO}{ticket}"

        try:
            guardado = cache.set(cache_key, audio_mp3, timeout=TTL_AUDIO_SEGUNDOS)
        except Exception:
            logger.exception("No se pudo guardar temporalmente el audio del monitor en Redis.")
            return Response(
                {"detail": "No se pudo preparar la reproducción temporal del audio."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Django cache.set normalmente devuelve None; comprobamos disponibilidad
        # mediante una lectura para detectar fallos del backend de caché.
        try:
            disponible = cache.get(cache_key)
        except Exception:
            logger.exception("No se pudo verificar el audio temporal del monitor.")
            return Response(
                {"detail": "No se pudo preparar la reproducción temporal del audio."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if disponible is None:
            return Response(
                {"detail": "El audio temporal no quedó disponible en la caché."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        audio_url = f"{request.path}?ticket={ticket}"
        return Response(
            {
                "audio_url": audio_url,
                "expires_in": TTL_AUDIO_SEGUNDOS,
            },
            status=status.HTTP_200_OK,
        )

    def get(self, request):
        ticket = request.query_params.get("ticket", "").strip()
        if not ticket or len(ticket) > 128:
            return Response(
                {"detail": "El enlace de audio no es válido o ha vencido."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            audio_mp3 = cache.get(f"{PREFIJO_CACHE_AUDIO}{ticket}")
        except Exception:
            logger.exception("No se pudo recuperar el audio temporal del monitor.")
            return Response(
                {"detail": "No se pudo recuperar el audio temporal."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if not audio_mp3:
            return Response(
                {"detail": "El audio ya venció. Solicita una nueva locución."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Se conserva hasta el TTL para permitir la reproducción doble y
        # posibles solicitudes Range del reproductor del televisor.
        rango = request.headers.get("Range", "")
        inicio, fin = 0, len(audio_mp3) - 1
        status_code = status.HTTP_200_OK

        if rango.startswith("bytes="):
            try:
                especificacion = rango[6:].split(",", 1)[0].strip()
                primero, separador, ultimo = especificacion.partition("-")
                if not separador:
                    raise ValueError("Rango inválido")
                if primero:
                    inicio = int(primero)
                    fin = int(ultimo) if ultimo else len(audio_mp3) - 1
                else:
                    sufijo = int(ultimo)
                    inicio = max(0, len(audio_mp3) - sufijo)
                    fin = len(audio_mp3) - 1
                if inicio < 0 or fin < inicio or inicio >= len(audio_mp3):
                    raise ValueError("Rango fuera de límites")
                fin = min(fin, len(audio_mp3) - 1)
                status_code = status.HTTP_206_PARTIAL_CONTENT
            except (TypeError, ValueError):
                respuesta = HttpResponse(status=416)
                respuesta["Content-Range"] = f"bytes */{len(audio_mp3)}"
                respuesta["Cache-Control"] = "no-store"
                return respuesta

        contenido = audio_mp3[inicio:fin + 1]
        respuesta = HttpResponse(contenido, content_type="audio/mpeg", status=status_code)
        respuesta["Cache-Control"] = "private, no-store, no-cache, must-revalidate, max-age=0"
        respuesta["Pragma"] = "no-cache"
        respuesta["X-Content-Type-Options"] = "nosniff"
        respuesta["Accept-Ranges"] = "bytes"
        respuesta["Content-Length"] = str(len(contenido))
        if status_code == status.HTTP_206_PARTIAL_CONTENT:
            respuesta["Content-Range"] = f"bytes {inicio}-{fin}/{len(audio_mp3)}"
        return respuesta
