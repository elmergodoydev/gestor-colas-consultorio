
from django.urls import path

from citas.views import (
    ConsultorioListAPIView,
    CitaListAPIView,
    TurnoCrearAPIView,
    TurnoColaListAPIView,
    TurnoAccionAPIView,
    GenerarCodigoActivacionAPIView,
    CanjearCodigoActivacionAPIView,
    TurnoAtendidosListAPIView,
    MonitorAPIView,
    MonitorEventosAPIView,
    ConfiguracionIPRESSAPIView,

)


urlpatterns = [
    path(
        "consultorios/",
        ConsultorioListAPIView.as_view(),
        name="lista-consultorios",
    ),
    path(
        "citas/",
        CitaListAPIView.as_view(),
        name="lista-citas",
    ),
    path(
        "turnos/",
        TurnoCrearAPIView.as_view(),
        name="crear-turno",
    ),
    path(
        "turnos/cola/",
        TurnoColaListAPIView.as_view(),
        name="cola-turnos", 
    ),
    path(
        "turnos/atendidos/",
        TurnoAtendidosListAPIView.as_view(),
        name="turnos-atendidos",
    ),
    path(
        "turnos/<int:pk>/accion/",
        TurnoAccionAPIView.as_view(),
        name="accion-turno",
    ),
    path(
        "activaciones/generar/",
        GenerarCodigoActivacionAPIView.as_view(),
        name="generar-codigo-activacion",
    ),
    path(
        "activaciones/canjear/",
        CanjearCodigoActivacionAPIView.as_view(),
        name="canjear-codigo-activacion",
    ),
    path(
        "monitor/",
        MonitorAPIView.as_view(),
        name="monitor",
    ),
    path(
        "monitor/eventos/",
        MonitorEventosAPIView.as_view(),
        name="monitor-eventos",
    ),
    path(
        "configuracion/ipress/",
        ConfiguracionIPRESSAPIView.as_view(),
        name="configuracion-ipress",
    ),
]
