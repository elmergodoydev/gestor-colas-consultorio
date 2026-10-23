"""Utilidades para administrar la lista de reproducción de cada monitor.

Reutiliza los modelos Monitor, Video y la tabla intermedia ya existentes.
No añade tablas ni requiere migraciones.
"""
from django.db import models
from rest_framework.exceptions import ValidationError

from citas.models import Monitor, Video
from citas.video_views import serializar_video

CAMPOS_ORDEN = (
    "orden_reproduccion",
    "orden_visualizacion",
    "orden",
    "posicion",
    "secuencia",
    "position",
    "sort_order",
    "order",
)


def _relacion_intermedia():
    campo_videos = Monitor._meta.get_field("videos")
    modelo_intermedio = campo_videos.remote_field.through

    fk_monitor = next(
        (
            campo for campo in modelo_intermedio._meta.fields
            if isinstance(campo, models.ForeignKey)
            and campo.remote_field.model == Monitor
        ),
        None,
    )
    fk_video = next(
        (
            campo for campo in modelo_intermedio._meta.fields
            if isinstance(campo, models.ForeignKey)
            and campo.remote_field.model == Video
        ),
        None,
    )

    if fk_monitor is None or fk_video is None:
        raise ValidationError(
            {"videos": "No se pudo identificar la relación entre monitores y videos."}
        )

    campo_orden = None
    for nombre in CAMPOS_ORDEN:
        try:
            candidato = modelo_intermedio._meta.get_field(nombre)
        except Exception:
            continue
        if isinstance(candidato, models.IntegerField):
            campo_orden = candidato
            break

    return modelo_intermedio, fk_monitor, fk_video, campo_orden


def obtener_videos_ordenados(monitor):
    """Devuelve los videos según el orden de la tabla intermedia."""
    through, fk_monitor, fk_video, campo_orden = _relacion_intermedia()
    relaciones = through.objects.filter(**{fk_monitor.name: monitor})
    if campo_orden is not None:
        relaciones = relaciones.order_by(campo_orden.name, through._meta.pk.name)
    else:
        # Cuando la tabla no dispone de campo de orden, se conserva el orden
        # de inserción usando la clave primaria de la relación.
        relaciones = relaciones.order_by(through._meta.pk.name)

    ids = list(relaciones.values_list(fk_video.attname, flat=True))
    por_id = Video.objects.in_bulk(ids)
    return [por_id[video_id] for video_id in ids if video_id in por_id]


def serializar_playlist_monitor(monitor):
    return [serializar_video(video) for video in obtener_videos_ordenados(monitor)]


def validar_video_ids(valor):
    """Valida IDs enviados por el formulario; None significa no modificar."""
    if valor is None:
        return None
    if not isinstance(valor, list):
        raise ValidationError({"video_ids": "La lista de videos debe ser un arreglo de identificadores."})

    ids = []
    for item in valor:
        try:
            video_id = int(item)
        except (TypeError, ValueError) as exc:
            raise ValidationError({"video_ids": "Todos los identificadores de video deben ser números enteros."}) from exc
        if video_id < 1:
            raise ValidationError({"video_ids": "Los identificadores de video deben ser positivos."})
        ids.append(video_id)

    if len(ids) != len(set(ids)):
        raise ValidationError({"video_ids": "Un video no puede aparecer dos veces en la lista de reproducción."})

    existentes = set(Video.objects.filter(pk__in=ids).values_list("pk", flat=True))
    desconocidos = [video_id for video_id in ids if video_id not in existentes]
    if desconocidos:
        raise ValidationError({"video_ids": f"No existen estos videos: {', '.join(map(str, desconocidos))}."})
    return ids


def establecer_playlist_monitor(monitor, video_ids):
    """Reemplaza la lista de reproducción en el orden recibido.

    video_ids=None mantiene la lista actual, útil para clientes antiguos que
    actualizan solo el nombre o los consultorios.
    """
    if video_ids is None:
        return

    through, fk_monitor, fk_video, campo_orden = _relacion_intermedia()
    relaciones_actuales = through.objects.filter(**{fk_monitor.name: monitor})
    relaciones_actuales.delete()

    videos_por_id = Video.objects.in_bulk(video_ids)
    for indice, video_id in enumerate(video_ids):
        video = videos_por_id[video_id]
        valores = {
            fk_monitor.name: monitor,
            fk_video.name: video,
        }
        if campo_orden is not None:
            valores[campo_orden.name] = indice

        # Completa únicamente campos obligatorios adicionales reconocibles.
        for campo in through._meta.fields:
            if (
                campo.primary_key
                or campo.name in valores
                or isinstance(campo, models.ForeignKey)
                or getattr(campo, "auto_now", False)
                or getattr(campo, "auto_now_add", False)
                or campo.has_default()
                or campo.null
                or campo.blank
                or not campo.editable
            ):
                continue
            if isinstance(campo, models.BooleanField):
                valores[campo.name] = True
            elif isinstance(campo, models.IntegerField) and campo_orden is None:
                # Si no existe un nombre de orden conocido, el contador ofrece
                # un valor seguro para otro campo entero obligatorio.
                valores[campo.name] = indice
            else:
                raise ValidationError({
                    "videos": (
                        f"No se puede completar automáticamente el campo obligatorio "
                        f"'{campo.name}' de la relación MonitorVideo."
                    )
                })

        through.objects.create(**valores)
