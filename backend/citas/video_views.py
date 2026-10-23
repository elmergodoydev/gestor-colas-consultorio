"""API de la biblioteca de videos.

Reutiliza los modelos Video, Monitor y MonitorVideo existentes. Los nombres de
campos de archivo/título se detectan desde los metadatos del modelo para evitar
asumir nombres que puedan variar entre versiones del modelo.
"""
import mimetypes
from pathlib import PurePath

from django.db import models, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from citas.models import Monitor, Video

MAX_VIDEO_SIZE = 500 * 1024 * 1024
EXTENSIONES_PERMITIDAS = {".mp4", ".webm"}
CAMPOS_TITULO = ("titulo", "nombre", "nombre_video", "titulo_video", "descripcion")
CAMPOS_NOMBRE_ARCHIVO = ("nombre_archivo", "filename", "nombre_original")
CAMPOS_MIME = ("mime_type", "tipo_mime", "content_type", "tipo_contenido")
CAMPOS_TAMANO = ("tamano_bytes", "tamaño_bytes", "file_size", "size_bytes", "peso_bytes")
CAMPOS_FECHA = ("creado_en", "fecha_creacion", "fecha_subida", "created_at", "uploaded_at")


def _campo_archivo():
    for campo in Video._meta.fields:
        if isinstance(campo, models.FileField):
            return campo
    raise ValidationError(
        {"archivo": "El modelo Video no tiene un campo FileField configurado."}
    )


def _campo_por_nombres(nombres, tipos=None):
    for nombre in nombres:
        for campo in Video._meta.fields:
            if campo.name == nombre and (tipos is None or isinstance(campo, tipos)):
                return campo
    return None


def _campo_titulo(campo_archivo):
    campo = _campo_por_nombres(CAMPOS_TITULO, (models.CharField, models.TextField))
    if campo and campo.name != campo_archivo.name:
        return campo
    for candidato in Video._meta.fields:
        if (
            isinstance(candidato, (models.CharField, models.TextField))
            and candidato.name != campo_archivo.name
            and not candidato.primary_key
        ):
            return candidato
    return None


def _valor_campo(objeto, nombres, predeterminado=None):
    for nombre in nombres:
        if any(campo.name == nombre for campo in Video._meta.fields):
            valor = getattr(objeto, nombre, None)
            if valor is not None:
                return valor
    return predeterminado


def serializar_video(video, request=None):
    campo_archivo = _campo_archivo()
    campo_titulo = _campo_titulo(campo_archivo)
    archivo = getattr(video, campo_archivo.name)
    url = archivo.url if archivo and getattr(archivo, "name", "") else ""
    if url and request:
        # Deja una URL relativa al mismo origen. Nginx publica /media/.
        pass

    titulo = getattr(video, campo_titulo.name, "") if campo_titulo else ""
    nombre_archivo = PurePath(archivo.name).name if archivo and getattr(archivo, "name", "") else ""
    if not titulo:
        titulo = PurePath(nombre_archivo).stem or "Video"

    campo_tamano = _campo_por_nombres(CAMPOS_TAMANO, (models.IntegerField,))
    tamano = getattr(video, campo_tamano.name, None) if campo_tamano else None
    if tamano is None and archivo and getattr(archivo, "name", ""):
        try:
            tamano = archivo.size
        except (OSError, ValueError):
            tamano = 0

    campo_activo = _campo_por_nombres(("activo", "habilitado", "enabled"), models.BooleanField)
    activo = bool(getattr(video, campo_activo.name)) if campo_activo else True

    fecha = _valor_campo(video, CAMPOS_FECHA)
    mime = _valor_campo(video, CAMPOS_MIME)
    if not mime:
        mime = mimetypes.guess_type(nombre_archivo)[0] or "application/octet-stream"

    return {
        "id": video.pk,
        "titulo": str(titulo),
        "nombre_archivo": nombre_archivo,
        "url": url,
        "tamano_bytes": int(tamano or 0),
        "mime_type": str(mime),
        "activo": activo,
        "creado_en": fecha.isoformat() if fecha else None,
    }


def _crear_video(titulo, uploaded):
    campo_archivo = _campo_archivo()
    campo_titulo = _campo_titulo(campo_archivo)
    valores = {campo_archivo.name: uploaded}
    if campo_titulo:
        valores[campo_titulo.name] = titulo

    for campo in Video._meta.fields:
        if campo.primary_key or campo.name in valores or campo.many_to_many:
            continue
        if getattr(campo, "auto_now", False) or getattr(campo, "auto_now_add", False):
            continue
        if campo.has_default() or campo.null or campo.blank or not campo.editable:
            continue
        if isinstance(campo, (models.ForeignKey, models.OneToOneField)):
            raise ValidationError({campo.name: "El modelo Video requiere una relación que no puede asignarse automáticamente."})
        if isinstance(campo, (models.CharField, models.TextField)):
            nombre = campo.name.lower()
            if any(palabra in nombre for palabra in ("mime", "content_type", "tipo_contenido", "tipo_mime")):
                valores[campo.name] = uploaded.content_type or mimetypes.guess_type(uploaded.name)[0] or "application/octet-stream"
            elif any(palabra in nombre for palabra in ("archivo", "filename", "nombre_original")):
                valores[campo.name] = uploaded.name[:campo.max_length] if campo.max_length else uploaded.name
            elif campo.choices:
                valores[campo.name] = campo.choices[0][0]
            else:
                valores[campo.name] = titulo[:campo.max_length] if campo.max_length else titulo
        elif isinstance(campo, models.BooleanField):
            valores[campo.name] = True
        elif isinstance(campo, models.IntegerField):
            nombre = campo.name.lower()
            valores[campo.name] = uploaded.size if any(p in nombre for p in ("tamano", "tamaño", "size", "peso", "byte")) else 0
        else:
            raise ValidationError({campo.name: "El modelo Video tiene un campo obligatorio sin valor predeterminado."})

    return Video.objects.create(**valores)


def _video_tiene_asignaciones(video):
    campo_videos = Monitor._meta.get_field("videos")
    through = campo_videos.remote_field.through
    fk_video = next(
        (campo for campo in through._meta.fields
         if isinstance(campo, models.ForeignKey) and campo.remote_field.model == Video),
        None,
    )
    if fk_video is None:
        return False
    return through.objects.filter(**{fk_video.name: video}).exists()


class BibliotecaVideosAPIView(APIView):
    """Lista videos existentes y recibe cargas multipart/form-data."""
    permission_classes = [AllowAny]  # Igual que los endpoints de administración actuales.
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        videos = Video.objects.all().order_by("-pk")
        return Response({"videos": [serializar_video(video, request) for video in videos]})

    @transaction.atomic
    def post(self, request):
        uploaded = request.FILES.get("archivo")
        if uploaded is None:
            campo_archivo = _campo_archivo()
            uploaded = request.FILES.get(campo_archivo.name)
        if uploaded is None:
            raise ValidationError({"archivo": "Selecciona un archivo de video."})

        extension = PurePath(uploaded.name).suffix.lower()
        if extension not in EXTENSIONES_PERMITIDAS:
            raise ValidationError({"archivo": "Formato no permitido. Sube un video MP4 o WebM."})
        if uploaded.size <= 0:
            raise ValidationError({"archivo": "El archivo está vacío."})
        if uploaded.size > MAX_VIDEO_SIZE:
            raise ValidationError({"archivo": "El video supera el máximo permitido de 500 MB."})

        titulo = str(request.data.get("titulo") or PurePath(uploaded.name).stem).strip()
        if not titulo:
            titulo = PurePath(uploaded.name).stem or "Video institucional"
        campo_titulo = _campo_titulo(_campo_archivo())
        if campo_titulo and campo_titulo.max_length and len(titulo) > campo_titulo.max_length:
            raise ValidationError({"titulo": f"El título no puede superar {campo_titulo.max_length} caracteres."})

        video = _crear_video(titulo, uploaded)
        return Response({
            "mensaje": "Video cargado correctamente.",
            "video": serializar_video(video, request),
        }, status=status.HTTP_201_CREATED)


class BibliotecaVideoDetalleAPIView(APIView):
    permission_classes = [AllowAny]

    def delete(self, request, video_id):
        video = get_object_or_404(Video, pk=video_id)
        if _video_tiene_asignaciones(video):
            return Response({
                "detail": "Este video está asignado a uno o más monitores. Retíralo de sus listas de reproducción antes de eliminarlo."
            }, status=status.HTTP_409_CONFLICT)
        video.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
