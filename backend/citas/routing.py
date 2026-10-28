
from django.urls import path

from citas.consumers import MonitorConsumer

websocket_urlpatterns = [
    path(
        "ws/monitor/",
        MonitorConsumer.as_asgi(),
        name="monitor-websocket",
    ),
]
