"""Activación de monitores y lecturas limitadas a sus consultorios asignados.

Este módulo reutiliza los modelos Monitor, CodigoActivacionMonitor y
MonitorActivado ya existentes. No necesita migraciones nuevas.
"""
import hashlib
import secrets
import uuid

from django.db import transaction
from django.utils import timezone

from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from citas.models import (
    CodigoActivacionMonitor,
    Consultorio,
    EventoLlamado,
    MonitorActivado,
    Turno,
)


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def obtener_monitor_activado(request):
    """Valida el Bearer token del monitor sin depender de EquipoActivado."""
    encabezado = request.headers.get("Authorization", "").strip()
    partes = encabezado.split(None, 1)
    if len(partes) != 2 or partes[0].lower() != "bearer" or not partes[1].strip():
        raise AuthenticationFailed("Este monitor no está activado. Ingresa un código de activación.")

    token_hash = hash_token(partes[1].strip())
    activacion = (
        MonitorActivado.objects
        .select_related("monitor", "monitor__establecimiento")
        .filter(token_hash=token_hash, activo=True)
        .first()
    )
    if activacion is None:
        raise AuthenticationFailed("La activación del monitor no es válida o fue reemplazada.")
    return activacion


def datos_paciente(cita):
    return {
        "nombre_paciente": (
            f"{cita.nombres_paciente} {cita.apellido_paterno_paciente} "
            f"{cita.apellido_materno_paciente}"
        ).strip(),
        "nombres_paciente": cita.nombres_paciente,
        "apellido_paterno_paciente": cita.apellido_paterno_paciente,
    }


class CanjearCodigoActivacionMonitorAPIView(APIView):
    """Canjea un código de monitor de un solo uso y entrega un token opaco."""
    permission_classes = [AllowAny]

    @transaction.atomic
    def post(self, request):
        codigo = str(request.data.get("codigo") or "").strip().upper()
        nombre_equipo = str(request.data.get("nombre_equipo") or "Monitor de sala de espera").strip()

        if not codigo:
            raise ValidationError({"codigo": "Ingresa el código de activación."})
        if len(nombre_equipo) > 100:
            raise ValidationError({"nombre_equipo": "El nombre del equipo no puede superar 100 caracteres."})
        if not nombre_equipo:
            nombre_equipo = "Monitor de sala de espera"

        codigo_hash = CodigoActivacionMonitor.calcular_hash(codigo)
        registro = (
            CodigoActivacionMonitor.objects
            .select_for_update()
            .select_related("monitor", "monitor__establecimiento")
            .filter(codigo_hash=codigo_hash)
            .first()
        )
        ahora = timezone.now()
        if registro is None or registro.utilizado_en is not None or registro.expira_en <= ahora:
            raise ValidationError({"codigo": "El código es inválido, venció o ya fue utilizado."})

        monitor = registro.monitor
        if not monitor.consultorios.exists():
            raise ValidationError({"consultorios": "Este monitor no tiene consultorios asignados. Configúralo antes de activarlo."})

        token = secrets.token_urlsafe(32)
        token_hash = hash_token(token)
        # Si se usa un código nuevo para el mismo monitor, se reemplaza la
        # sesión anterior. El token previo queda inválido al cambiar su hash.
        activacion, _ = MonitorActivado.objects.update_or_create(
            monitor=monitor,
            defaults={
                "identificador_equipo": uuid.uuid4(),
                "token_hash": token_hash,
                "nombre_equipo": nombre_equipo,
                "activo": True,
            },
        )

        registro.utilizado_en = ahora
        registro.save(update_fields=["utilizado_en"])

        consultorios = [
            {
                "id": consultorio.id,
                "codigo": consultorio.codigo,
                "nombre": consultorio.nombre,
            }
            for consultorio in monitor.consultorios.all().order_by("nombre")
        ]
        establecimiento = monitor.establecimiento
        return Response({
            "mensaje": "Monitor activado correctamente.",
            "token": token,
            "equipo_id": str(activacion.identificador_equipo),
            "monitor": {"id": monitor.id, "nombre": monitor.nombre, "consultorios": consultorios},
            "establecimiento": {
                "codigo_renipress": establecimiento.codigo_renipress,
                "nombre_ipress": establecimiento.nombre_ipress,
            },
        }, status=status.HTTP_201_CREATED)


class MonitorDatosActivadosAPIView(APIView):
    """Devuelve llamados y resúmenes solo de los consultorios del monitor."""
    permission_classes = [AllowAny]

    def get(self, request):
        activacion = obtener_monitor_activado(request)
        monitor = activacion.monitor
        establecimiento = monitor.establecimiento
        consultorios = monitor.consultorios.all().order_by("nombre")
        hoy = timezone.localdate()

        turnos_activos = (
            Turno.objects.filter(
                establecimiento=establecimiento,
                consultorio__in=consultorios,
                fecha=hoy,
                estado=Turno.Estado.LLAMANDO,
            )
            .select_related("cita", "consultorio")
            .order_by("consultorio__nombre", "creado_en")
        )
        llamados_activos = []
        for turno in turnos_activos:
            item = {
                "id": turno.id,
                "codigo": turno.codigo,
                "estado": turno.estado,
                "nombre_consultorio": turno.consultorio.nombre,
                "codigo_consultorio": turno.consultorio.codigo,
                "nombre_servicio": turno.consultorio.nombre_servicio,
                "hora_cita": turno.cita.hora_cita.strftime("%H:%M"),
            }
            item.update(datos_paciente(turno.cita))
            llamados_activos.append(item)

        ultimos_eventos = (
            EventoLlamado.objects.filter(
                turno__establecimiento=establecimiento,
                turno__consultorio__in=consultorios,
                turno__fecha=hoy,
                tipo__in=[EventoLlamado.Tipo.LLAMADO, EventoLlamado.Tipo.RE_LLAMADO],
            )
            .select_related("turno", "turno__cita", "turno__consultorio")
            .order_by("-id")[:10]
        )
        ultimos_llamados = []
        for evento in ultimos_eventos:
            item = {
                "evento_id": evento.id,
                "tipo": evento.tipo,
                "fecha_evento": evento.fecha_evento.isoformat(),
                "codigo": evento.turno.codigo,
                "nombre_consultorio": evento.turno.consultorio.nombre,
                "nombre_servicio": evento.turno.consultorio.nombre_servicio,
            }
            item.update(datos_paciente(evento.turno.cita))
            ultimos_llamados.append(item)

        atendidos_por_consultorio = []
        for consultorio in consultorios:
            cantidad = Turno.objects.filter(
                establecimiento=establecimiento,
                consultorio=consultorio,
                fecha=hoy,
                estado=Turno.Estado.ATENDIDO,
            ).count()
            atendidos_por_consultorio.append({
                "codigo_consultorio": consultorio.codigo,
                "nombre_consultorio": consultorio.nombre,
                "cantidad": cantidad,
            })

        return Response({
            "monitor": {
                "id": monitor.id,
                "nombre": monitor.nombre,
                "consultorios": [
                    {"codigo": c.codigo, "nombre": c.nombre}
                    for c in consultorios
                ],
            },
            "establecimiento": {
                "codigo_renipress": establecimiento.codigo_renipress,
                "nombre_ipress": establecimiento.nombre_ipress,
            },
            "fecha": hoy.isoformat(),
            "llamados_activos": llamados_activos,
            "cantidad_llamados_activos": len(llamados_activos),
            "ultimos_llamados": ultimos_llamados,
            "atendidos_por_consultorio": atendidos_por_consultorio,
        })


class MonitorEventosActivadosAPIView(APIView):
    """Entrega eventos nuevos limitados a los consultorios del monitor."""
    permission_classes = [AllowAny]

    def get(self, request):
        activacion = obtener_monitor_activado(request)
        monitor = activacion.monitor
        hoy = timezone.localdate()
        consultorios = monitor.consultorios.all()
        eventos_base = EventoLlamado.objects.filter(
            turno__establecimiento=monitor.establecimiento,
            turno__consultorio__in=consultorios,
            turno__fecha=hoy,
            tipo__in=[EventoLlamado.Tipo.LLAMADO, EventoLlamado.Tipo.RE_LLAMADO],
        )
        ultimo_evento_id = eventos_base.order_by("-id").values_list("id", flat=True).first() or 0
        desde_id = request.query_params.get("desde_id")

        if desde_id is None:
            return Response({"eventos": [], "ultimo_evento_id": ultimo_evento_id})
        try:
            cursor = int(desde_id)
            if cursor < 0:
                raise ValueError
        except (TypeError, ValueError):
            raise ValidationError({"desde_id": "Debe ser un identificador numérico válido."})

        eventos = (
            eventos_base.filter(id__gt=cursor)
            .select_related("turno", "turno__cita", "turno__consultorio")
            .order_by("id")[:100]
        )
        resultados = []
        for evento in eventos:
            item = {
                "id": evento.id,
                "tipo": evento.tipo,
                "fecha_evento": evento.fecha_evento.isoformat(),
                "turno_id": evento.turno_id,
                "codigo": evento.turno.codigo,
                "nombre_consultorio": evento.turno.consultorio.nombre,
                "nombre_servicio": evento.turno.consultorio.nombre_servicio,
            }
            item.update(datos_paciente(evento.turno.cita))
            resultados.append(item)

        return Response({
            "eventos": resultados,
            "ultimo_evento_id": resultados[-1]["id"] if resultados else cursor,
        })


class DesactivarMonitorAPIView(APIView):
    """Invalida la sesión del monitor en este equipo."""
    permission_classes = [AllowAny]

    def post(self, request):
        activacion = obtener_monitor_activado(request)
        activacion.activo = False
        activacion.save(update_fields=["activo", "actualizado_en"])
        return Response({"mensaje": "Monitor desactivado correctamente."})
