
import hashlib
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from citas.models import MonitorActivado, MonitorConsultorio


@database_sync_to_async
def obtener_monitor_por_token(token):
    if not token:
        return None

    token_hash = hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()

    activacion = (
        MonitorActivado.objects
        .select_related("monitor", "monitor__establecimiento")
        .filter(
            token_hash=token_hash,
            activo=True,
            monitor__activo=True,
        )
        .first()
    )

    if activacion is None:
        return None

    monitor = activacion.monitor

    tiene_consultorios = MonitorConsultorio.objects.filter(
        monitor=monitor,
        consultorio__establecimiento_id=monitor.establecimiento_id,
    ).exists()

    if not tiene_consultorios:
        return None

    return {
        "activacion_id": activacion.id,
        "monitor_id": monitor.id,
    }


@database_sync_to_async
def validar_acceso_monitor(
    activacion_id,
    monitor_id,
    establecimiento_id,
    consultorio_id,
):
    """
    Revalida la activación y la asignación del consultorio
    antes de entregar cada notificación.
    """
    activacion_valida = MonitorActivado.objects.filter(
        pk=activacion_id,
        monitor_id=monitor_id,
        activo=True,
        monitor__activo=True,
        monitor__establecimiento_id=establecimiento_id,
    ).exists()

    if not activacion_valida:
        return False

    return MonitorConsultorio.objects.filter(
        monitor_id=monitor_id,
        monitor__establecimiento_id=establecimiento_id,
        consultorio_id=consultorio_id,
        consultorio__establecimiento_id=establecimiento_id,
    ).exists()


class MonitorConsumer(AsyncJsonWebsocketConsumer):

    async def connect(self):
        query_string = self.scope.get(
            "query_string", b""
        ).decode("utf-8")

        parametros = parse_qs(query_string)
        token = parametros.get("token", [None])[0]

        datos_monitor = await obtener_monitor_por_token(token)

        if datos_monitor is None:
            await self.close(code=4401)
            return

        self.activacion_id = datos_monitor["activacion_id"]
        self.monitor_id = datos_monitor["monitor_id"]
        self.grupo_monitor = f"monitor_{self.monitor_id}"

        await self.channel_layer.group_add(
            self.grupo_monitor,
            self.channel_name,
        )

        await self.accept()

        await self.send_json({
            "tipo": "conexion_establecida",
            "monitor_id": self.monitor_id,
        })

    async def disconnect(self, close_code):
        grupo_monitor = getattr(
            self, "grupo_monitor", None
        )

        if grupo_monitor:
            await self.channel_layer.group_discard(
                grupo_monitor,
                self.channel_name,
            )

    async def notificacion_llamado(self, event):
        autorizado = await validar_acceso_monitor(
            activacion_id=self.activacion_id,
            monitor_id=self.monitor_id,
            establecimiento_id=event.get("establecimiento_id"),
            consultorio_id=event.get("consultorio_id"),
        )

        if not autorizado:
            await self.close(code=4403)
            return

        await self.send_json({
            "tipo": "actualizar_monitor",
            "evento_id": event.get("evento_id"),
            "accion": event.get("accion"),
            "turno_id": event.get("turno_id"),
        })
