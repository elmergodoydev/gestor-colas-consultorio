
import hashlib
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from citas.models import MonitorActivado


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

    # Verifica que el monitor tenga consultorios asignados
    # pertenecientes a su propia IPRESS.
    tiene_consultorios = monitor.consultorios.filter(
        establecimiento_id=monitor.establecimiento_id
    ).exists()

    if not tiene_consultorios:
        return None

    return monitor.id


class MonitorConsumer(AsyncJsonWebsocketConsumer):

    async def connect(self):
        query_string = self.scope.get(
            "query_string", b""
        ).decode("utf-8")

        parametros = parse_qs(query_string)
        token = parametros.get("token", [None])[0]

        monitor_id = await obtener_monitor_por_token(token)

        if monitor_id is None:
            await self.close(code=4401)
            return

        self.monitor_id = monitor_id
        self.grupo_monitor = f"monitor_{monitor_id}"

        await self.channel_layer.group_add(
            self.grupo_monitor,
            self.channel_name,
        )

        await self.accept()

        # Confirma la conexión, sin enviar datos de pacientes.
        await self.send_json({
            "tipo": "conexion_establecida",
            "monitor_id": monitor_id,
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
        # Reenvía solo el contenido autorizado que publique
        # el backend en el grupo de este monitor.
        await self.send_json({
            "tipo": "actualizar_monitor",
            "evento_id": event.get("evento_id"),
            "accion": event.get("accion"),
        })
