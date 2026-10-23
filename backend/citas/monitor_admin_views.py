from datetime import timedelta

from django.db import transaction
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from citas.models import (
    CodigoActivacionMonitor,
    Consultorio,
    Establecimiento,
    Monitor,
)
from citas.video_playlist import (
    establecer_playlist_monitor,
    serializar_playlist_monitor,
    validar_video_ids,
)
from citas.providers.ipress_provider import obtener_ipress


class CatalogoIPRESSNoDisponible(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "No se pudo consultar el catálogo de consultorios de la IPRESS."
    default_code = "catalogo_no_disponible"


def obtener_catalogo_api(establecimiento):
    """Lee y valida el catálogo del proveedor; no lo obtiene desde la BD."""
    try:
        datos = obtener_ipress(establecimiento.codigo_renipress)
    except (FileNotFoundError, ValueError) as exc:
        raise CatalogoIPRESSNoDisponible() from exc

    if datos is None:
        raise NotFound("No se encontró esta IPRESS en el proveedor de catálogo.")

    catalogo = datos.get("consultorios")
    if not isinstance(catalogo, list):
        raise CatalogoIPRESSNoDisponible(
            "El proveedor devolvió un catálogo de consultorios no válido."
        )

    preparados = []
    codigos_vistos = set()
    for posicion, item in enumerate(catalogo, start=1):
        if not isinstance(item, dict):
            raise CatalogoIPRESSNoDisponible(
                f"El elemento {posicion} del catálogo no es válido."
            )

        codigo = str(item.get("codigo") or "").strip()
        nombre = str(item.get("nombre") or "").strip()
        if not codigo or not nombre:
            raise CatalogoIPRESSNoDisponible(
                f"El elemento {posicion} no contiene código y nombre."
            )
        if codigo in codigos_vistos:
            raise CatalogoIPRESSNoDisponible(
                "El proveedor devolvió códigos de consultorio duplicados."
            )
        if len(codigo) > 50 or len(nombre) > 150:
            raise CatalogoIPRESSNoDisponible(
                "Un consultorio supera la longitud permitida por el modelo."
            )
        codigos_vistos.add(codigo)
        preparados.append({
            "codigo": codigo,
            "nombre": nombre,
            "codigo_ambiente": str(item.get("codigo_ambiente") or "").strip(),
            "nombre_ambiente": str(item.get("nombre_ambiente") or "").strip(),
            "piso_ambiente": str(item.get("piso_ambiente") or "").strip(),
            "codigo_servicio": str(item.get("codigo_servicio") or "").strip(),
            "nombre_servicio": str(item.get("nombre_servicio") or "").strip(),
        })

    return preparados, datos.get("fuente", "proveedor")


def guardar_consultorios_catalogo(establecimiento, catalogo):
    """Persiste las entidades FK necesarias, sin borrar consultorios antiguos."""
    consultorios = {}
    for item in catalogo:
        datos = dict(item)
        codigo = datos.pop("codigo")
        nombre = datos.pop("nombre")
        consultorio, _ = Consultorio.objects.update_or_create(
            establecimiento=establecimiento,
            codigo=codigo,
            defaults={"nombre": nombre, **datos},
        )
        consultorios[codigo] = consultorio
    return consultorios


def serializar_monitor(monitor):
    consultorios = [
        {
            "id": consultorio.id,
            "codigo": consultorio.codigo,
            "nombre": consultorio.nombre,
            "nombre_servicio": consultorio.nombre_servicio,
        }
        for consultorio in monitor.consultorios.all().order_by("nombre")
    ]
    videos = serializar_playlist_monitor(monitor)
    return {
        "id": monitor.id,
        "nombre": monitor.nombre,
        "consultorios": consultorios,
        "cantidad_consultorios": len(consultorios),
        "videos": videos,
        "cantidad_videos": len(videos),
    }


def validar_datos_monitor(request_data, catalogo):
    nombre = str(request_data.get("nombre") or "").strip()
    codigos = request_data.get("codigos_consultorios")

    if not nombre:
        raise ValidationError({"nombre": "Escribe un nombre para el monitor."})
    if len(nombre) > 120:
        raise ValidationError({"nombre": "El nombre no puede superar 120 caracteres."})
    if not isinstance(codigos, list) or not codigos:
        raise ValidationError({
            "codigos_consultorios": "Selecciona al menos un consultorio para el monitor."
        })

    codigos = [str(codigo).strip() for codigo in codigos if str(codigo).strip()]
    if len(codigos) != len(set(codigos)):
        raise ValidationError({
            "codigos_consultorios": "No selecciones el mismo consultorio más de una vez."
        })

    permitidos = {item["codigo"] for item in catalogo}
    no_validos = sorted(set(codigos) - permitidos)
    if no_validos:
        raise ValidationError({
            "codigos_consultorios": (
                "Algunos consultorios ya no pertenecen al catálogo actual: "
                + ", ".join(no_validos)
                + ". Actualiza la selección."
            )
        })
    video_ids = validar_video_ids(request_data.get("video_ids") if "video_ids" in request_data else None)
    return nombre, codigos, video_ids


class MonitoresIPRESSAPIView(APIView):
    """Lista monitores y el catálogo actual de consultorios del proveedor."""
    permission_classes = [AllowAny]  # Desarrollo; restringir antes de producción.

    def get(self, request, pk):
        establecimiento = get_object_or_404(Establecimiento, pk=pk)
        catalogo, fuente = obtener_catalogo_api(establecimiento)
        monitores = (
            Monitor.objects.filter(establecimiento=establecimiento)
            .prefetch_related("consultorios")
            .order_by("nombre", "id")
        )
        return Response({
            "establecimiento": {
                "id": establecimiento.id,
                "codigo_renipress": establecimiento.codigo_renipress,
                "nombre_ipress": establecimiento.nombre_ipress,
            },
            "catalogo_consultorios": catalogo,
            "fuente_catalogo": fuente,
            "monitores": [serializar_monitor(monitor) for monitor in monitores],
        })

    @transaction.atomic
    def post(self, request, pk):
        establecimiento = get_object_or_404(
            Establecimiento.objects.select_for_update(), pk=pk
        )
        catalogo, _ = obtener_catalogo_api(establecimiento)
        nombre, codigos, video_ids = validar_datos_monitor(request.data, catalogo)

        if Monitor.objects.filter(
            establecimiento=establecimiento, nombre__iexact=nombre
        ).exists():
            raise ValidationError({
                "nombre": "Ya existe un monitor con ese nombre en esta IPRESS."
            })

        consultorios_guardados = guardar_consultorios_catalogo(
            establecimiento, catalogo
        )
        monitor = Monitor.objects.create(
            establecimiento=establecimiento,
            nombre=nombre,
        )
        monitor.consultorios.set([consultorios_guardados[codigo] for codigo in codigos])
        establecer_playlist_monitor(monitor, video_ids)

        return Response({
            "mensaje": "Monitor registrado correctamente.",
            "monitor": serializar_monitor(monitor),
        }, status=status.HTTP_201_CREATED)


class MonitorDetalleIPRESSAPIView(APIView):
    """Edita las asignaciones o elimina un monitor que no tenga dependencias protegidas."""
    permission_classes = [AllowAny]  # Desarrollo; restringir antes de producción.

    @transaction.atomic
    def patch(self, request, pk, monitor_id):
        establecimiento = get_object_or_404(Establecimiento, pk=pk)
        monitor = get_object_or_404(
            Monitor.objects.select_for_update().filter(establecimiento=establecimiento),
            pk=monitor_id,
        )
        catalogo, _ = obtener_catalogo_api(establecimiento)
        nombre, codigos, video_ids = validar_datos_monitor(request.data, catalogo)

        if Monitor.objects.filter(
            establecimiento=establecimiento,
            nombre__iexact=nombre,
        ).exclude(pk=monitor.pk).exists():
            raise ValidationError({
                "nombre": "Ya existe otro monitor con ese nombre en esta IPRESS."
            })

        consultorios_guardados = guardar_consultorios_catalogo(
            establecimiento, catalogo
        )
        monitor.nombre = nombre
        monitor.save(update_fields=["nombre"])
        monitor.consultorios.set([consultorios_guardados[codigo] for codigo in codigos])
        establecer_playlist_monitor(monitor, video_ids)

        return Response({
            "mensaje": "Monitor actualizado correctamente.",
            "monitor": serializar_monitor(monitor),
        })

    @transaction.atomic
    def delete(self, request, pk, monitor_id):
        establecimiento = get_object_or_404(Establecimiento, pk=pk)
        monitor = get_object_or_404(
            Monitor.objects.select_for_update().filter(establecimiento=establecimiento),
            pk=monitor_id,
        )
        try:
            monitor.delete()
        except ProtectedError:
            return Response({
                "mensaje": (
                    "No se puede eliminar este monitor porque tiene códigos "
                    "de activación o una activación asociada."
                )
            }, status=status.HTTP_409_CONFLICT)
        return Response(status=status.HTTP_204_NO_CONTENT)


class GenerarCodigoActivacionMonitorAPIView(APIView):
    """Genera un código de un solo uso válido por 30 minutos."""
    permission_classes = [AllowAny]  # Desarrollo; restringir antes de producción.

    @transaction.atomic
    def post(self, request, pk, monitor_id):
        establecimiento = get_object_or_404(Establecimiento, pk=pk)
        monitor = get_object_or_404(
            Monitor.objects.select_for_update().filter(establecimiento=establecimiento),
            pk=monitor_id,
        )
        if not monitor.consultorios.exists():
            raise ValidationError({
                "consultorios": "Asigna al menos un consultorio antes de activar el monitor."
            })

        ahora = timezone.now()
        CodigoActivacionMonitor.objects.filter(
            monitor=monitor,
            utilizado_en__isnull=True,
            expira_en__gt=ahora,
        ).update(expira_en=ahora)

        codigo = CodigoActivacionMonitor.generar_codigo()
        while CodigoActivacionMonitor.objects.filter(
            codigo_hash=CodigoActivacionMonitor.calcular_hash(codigo)
        ).exists():
            codigo = CodigoActivacionMonitor.generar_codigo()

        registro = CodigoActivacionMonitor.objects.create(
            monitor=monitor,
            codigo_hash=CodigoActivacionMonitor.calcular_hash(codigo),
            expira_en=ahora + timedelta(minutes=30),
        )
        return Response({
            "mensaje": "Código de activación generado.",
            "codigo": codigo,
            "expira_en": registro.expira_en,
            "monitor": {"id": monitor.id, "nombre": monitor.nombre},
        }, status=status.HTTP_201_CREATED)
