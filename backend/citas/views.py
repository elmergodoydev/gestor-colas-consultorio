
from datetime import date, datetime
import logging
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from django.shortcuts import get_object_or_404
from citas.providers.ipress_provider import obtener_ipress
from citas.serializers import ValidarRENIPRESSSerializer

from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
import hashlib
import secrets
import uuid
from datetime import timedelta
from django.utils import timezone
from rest_framework.permissions import AllowAny
from citas.models import (
    CodigoActivacion,
    ConfiguracionIPRESS,
    EquipoActivado,
)

from citas.authentication import EquipoTokenAuthentication, EsEquipoActivado
from citas.serializers import (
    GenerarCodigoActivacionSerializer,
    CanjearCodigoActivacionSerializer,
)

from citas.models import (
    Cita,
    Consultorio,
    Establecimiento,
    EventoLlamado,
    Monitor,
    Sincronizacion,
    Turno,
    MonitorConsultorio,
)

from citas.serializers import (
    CitaSerializer,
    ConsultorioSerializer,
    CrearTurnoSerializer,
    EstablecimientoSerializer,
    TurnoSerializer,
)

from django.db.models.deletion import ProtectedError

logger = logging.getLogger(__name__)


def notificar_monitores_turno(
    turno_id,
    establecimiento_id,
    consultorio_id,
    evento_id,
    accion,
):
    """
    Notifica a los monitores activos que tienen asignado
    el consultorio del turno dentro de la misma IPRESS.
    """
    channel_layer = get_channel_layer()

    if channel_layer is None:
        logger.error("No hay una capa de canales configurada.")
        return

    monitor_ids = (
        MonitorConsultorio.objects
        .filter(
            consultorio_id=consultorio_id,
            consultorio__establecimiento_id=establecimiento_id,
            monitor__establecimiento_id=establecimiento_id,
            monitor__activo=True,
            monitor__equipo_activado__activo=True,
        )
        .values_list("monitor_id", flat=True)
        .distinct()
    )

    for monitor_id in monitor_ids:
        try:
            async_to_sync(channel_layer.group_send)(
                f"monitor_{monitor_id}",
                {
                    "type": "notificacion_llamado",
                    "evento_id": evento_id,
                    "accion": accion,
                    "turno_id": turno_id,
                    "establecimiento_id": establecimiento_id,
                    "consultorio_id": consultorio_id,

                },
            )
        except Exception:
            # El turno ya puede estar guardado en la base de datos.
            # Un fallo de Redis no debe convertir la acción en un error HTTP.
            logger.exception(
                "No se pudo notificar al monitor %s sobre el evento %s.",
                monitor_id,
                evento_id,
            )


def obtener_establecimiento(request):
    renipress = request.query_params.get("renipress")

    if not renipress:
        raise ValidationError({
            "renipress": "El parámetro RENIPRESS es obligatorio."
        })

    return get_object_or_404(
        Establecimiento,
        codigo_renipress=renipress,
    )


class ConsultorioListAPIView(generics.ListAPIView):
    serializer_class = ConsultorioSerializer

    def get_queryset(self):
        establecimiento = obtener_establecimiento(self.request)

        return Consultorio.objects.filter(
            establecimiento=establecimiento
        ).order_by("nombre")

class SincronizarConsultoriosIPRESSAPIView(APIView):
    """
    Actualiza el catálogo de consultorios de una IPRESS
    usando el proveedor independiente de IPRESS.

    No elimina consultorios ni modifica las citas existentes.
    """

    permission_classes = [AllowAny]

    def post(self, request, pk):
        establecimiento = get_object_or_404(
            Establecimiento,
            pk=pk,
        )

        try:
            datos_ipress = obtener_ipress(
                establecimiento.codigo_renipress
            )
        except (FileNotFoundError, ValueError):
            return Response(
                {
                    "mensaje": (
                        "El proveedor del catálogo no está disponible "
                        "o sus datos no tienen un formato válido."
                    )
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if datos_ipress is None:
            return Response(
                {
                    "mensaje": (
                        "No se encontró el catálogo de esta IPRESS "
                        "en el proveedor de pruebas."
                    )
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        catalogo = datos_ipress.get("consultorios", [])

        if not isinstance(catalogo, list):
            return Response(
                {"mensaje": "El catálogo de consultorios no es válido."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # Validar todo el catálogo antes de escribir en la base de datos.
        consultorios_preparados = []
        codigos_vistos = set()

        for item in catalogo:
            if not isinstance(item, dict):
                return Response(
                    {
                        "mensaje": (
                            "El catálogo contiene un consultorio "
                            "con formato inválido."
                        )
                    },
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            codigo = str(item.get("codigo") or "").strip()
            nombre = str(item.get("nombre") or "").strip()

            if not codigo or not nombre:
                return Response(
                    {
                        "mensaje": (
                            "Cada consultorio debe tener código y nombre."
                        )
                    },
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            if codigo in codigos_vistos:
                return Response(
                    {
                        "mensaje": (
                            "El catálogo contiene códigos de consultorio "
                            "duplicados."
                        )
                    },
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            codigos_vistos.add(codigo)

            campos = {
                "codigo_ambiente": (
                    str(item.get("codigo_ambiente") or "").strip()
                ),
                "nombre_ambiente": (
                    str(item.get("nombre_ambiente") or "").strip()
                ),
                "piso_ambiente": (
                    str(item.get("piso_ambiente") or "").strip()
                ),
                "codigo_servicio": (
                    str(item.get("codigo_servicio") or "").strip()
                ),
                "nombre_servicio": (
                    str(item.get("nombre_servicio") or "").strip()
                ),
            }

            if (
                len(codigo) > 50
                or len(nombre) > 150
                or len(campos["codigo_ambiente"]) > 50
                or len(campos["nombre_ambiente"]) > 150
                or len(campos["piso_ambiente"]) > 100
                or len(campos["codigo_servicio"]) > 50
                or len(campos["nombre_servicio"]) > 200
            ):
                return Response(
                    {
                        "mensaje": (
                            "Un consultorio supera la longitud permitida "
                            "por el modelo de datos."
                        )
                    },
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            consultorios_preparados.append({
                "codigo": codigo,
                "nombre": nombre,
                **campos,
            })

        creados = 0
        actualizados = 0
        consultorios_respuesta = []

        with transaction.atomic():
            for item in consultorios_preparados:
                codigo = item.pop("codigo")
                nombre = item.pop("nombre")

                consultorio, creado = (
                    Consultorio.objects.update_or_create(
                        establecimiento=establecimiento,
                        codigo=codigo,
                        defaults={
                            "nombre": nombre,
                            **item,
                        },
                    )
                )

                if creado:
                    creados += 1
                else:
                    actualizados += 1

                consultorios_respuesta.append({
                    "id": consultorio.id,
                    "codigo": consultorio.codigo,
                    "nombre": consultorio.nombre,
                    "codigo_ambiente": consultorio.codigo_ambiente,
                    "nombre_ambiente": consultorio.nombre_ambiente,
                    "piso_ambiente": consultorio.piso_ambiente,
                    "codigo_servicio": consultorio.codigo_servicio,
                    "nombre_servicio": consultorio.nombre_servicio,
                })

        return Response(
            {
                "mensaje": "Catálogo de consultorios actualizado.",
                "establecimiento": {
                    "id": establecimiento.id,
                    "codigo_renipress": (
                        establecimiento.codigo_renipress
                    ),
                    "nombre_ipress": establecimiento.nombre_ipress,
                },
                "total": len(consultorios_respuesta),
                "creados": creados,
                "actualizados": actualizados,
                "consultorios": consultorios_respuesta,
                "fuente": datos_ipress.get("fuente"),
            },
            status=status.HTTP_200_OK,
        )


class EquiposActivadosIPRESSAPIView(APIView):
    """
    Lista los puestos de atención activados pertenecientes
    a una IPRESS.
    """

    permission_classes = [AllowAny]

    def get(self, request, pk):
        establecimiento = get_object_or_404(
            Establecimiento,
            pk=pk,
        )

        equipos = (
            EquipoActivado.objects
            .filter(
                establecimiento=establecimiento,
                activo=True,
            )
            .select_related("consultorio")
            .order_by("consultorio__nombre", "nombre_equipo")
        )

        resultados = []

        for equipo in equipos:
            resultados.append({
                "id": equipo.pk,
                "equipo_id": str(equipo.identificador_equipo),
                "nombre_equipo": equipo.nombre_equipo,
                "activo": equipo.activo,
                "activado_en": equipo.activado_en.isoformat(),
                "actualizado_en": equipo.actualizado_en.isoformat(),
                "consultorio": {
                    "id": equipo.consultorio_id,
                    "codigo": equipo.consultorio.codigo,
                    "nombre": equipo.consultorio.nombre,
                },
            })

        return Response({
            "establecimiento": {
                "id": establecimiento.id,
                "codigo_renipress": establecimiento.codigo_renipress,
                "nombre_ipress": establecimiento.nombre_ipress,
            },
            "total": len(resultados),
            "equipos": resultados,
        })


class CitaListAPIView(generics.ListAPIView):
    serializer_class = CitaSerializer

    def get_queryset(self):
        establecimiento = obtener_establecimiento(self.request)

        queryset = Cita.objects.filter(
            establecimiento=establecimiento
        ).select_related("consultorio")

        fecha = self.request.query_params.get("fecha")

        if fecha:
            try:
                fecha_validada = date.fromisoformat(fecha)
            except ValueError as exc:
                raise ValidationError({
                    "fecha": "La fecha debe tener formato AAAA-MM-DD."
                }) from exc

            queryset = queryset.filter(fecha_cita=fecha_validada)

        return queryset.order_by("fecha_cita", "hora_cita")


class TurnoCrearAPIView(APIView):
    """
    Creación manual para pruebas.
    En el flujo normal, los turnos elegibles se crean
    durante la sincronización de citas.
    """

    @transaction.atomic
    def post(self, request):
        serializer = CrearTurnoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        renipress = serializer.validated_data["renipress"]
        id_cita = serializer.validated_data["id_cita"]

        establecimiento = get_object_or_404(
            Establecimiento.objects.select_for_update(),
            codigo_renipress=renipress,
        )

        cita = get_object_or_404(
            Cita.objects.select_related("consultorio"),
            establecimiento=establecimiento,
            id_sihce=id_cita,
        )

        turno_existente = Turno.objects.filter(cita=cita).first()

        if turno_existente:
            raise ValidationError({
                "id_cita": "Esta cita ya tiene un turno registrado."
            })

        fecha_turno = cita.fecha_cita

        codigos_usados = set(
            Turno.objects.filter(
                establecimiento=establecimiento,
                fecha=fecha_turno,
            ).values_list("codigo", flat=True)
        )

        codigo = next(
            (
                f"{numero:03d}"
                for numero in range(1, 1000)
                if f"{numero:03d}" not in codigos_usados
            ),
            None,
        )

        if codigo is None:
            raise ValidationError({
                "codigo": "No quedan códigos disponibles para esta fecha."
            })

        turno = Turno.objects.create(
            establecimiento=establecimiento,
            consultorio=cita.consultorio,
            cita=cita,
            codigo=codigo,
            fecha=fecha_turno,
        )

        return Response(
            TurnoSerializer(turno).data,
            status=status.HTTP_201_CREATED,
        )




class TurnoColaListAPIView(generics.ListAPIView):
    serializer_class = TurnoSerializer
    authentication_classes = [EquipoTokenAuthentication]
    permission_classes = [EsEquipoActivado]

    def get_queryset(self):
        equipo = self.request.user
        hoy = timezone.localdate()

        return (
            Turno.objects.filter(
                establecimiento=equipo.establecimiento,
                consultorio=equipo.consultorio,
                fecha=hoy,
                estado__in=[
                    Turno.Estado.EN_ESPERA,
                    Turno.Estado.LLAMANDO,
                ],
            )
            .select_related("cita", "consultorio")
            .order_by("cita__hora_cita", "codigo")
        )




class TurnoAccionAPIView(APIView):

    authentication_classes = [EquipoTokenAuthentication]
    permission_classes = [EsEquipoActivado]

    ACCIONES = {
        "llamar": {
            "estados_permitidos": ["EN_ESPERA"],
            "nuevo_estado": "LLAMANDO",
            "evento": EventoLlamado.Tipo.LLAMADO,
        },
        "rellamar": {
            "estados_permitidos": ["LLAMANDO"],
            "nuevo_estado": "LLAMANDO",
            "evento": EventoLlamado.Tipo.RE_LLAMADO,
        },
        "retirar_llamado": {
            "estados_permitidos": ["LLAMANDO"],
            "nuevo_estado": "EN_ESPERA",
            "evento": EventoLlamado.Tipo.RETIRAR_LLAMADO,
        },
        "finalizar": {
            "estados_permitidos": ["LLAMANDO"],
            "nuevo_estado": "ATENDIDO",
            "evento": EventoLlamado.Tipo.ATENDIDO,
        },
        "cancelar": {
            "estados_permitidos": ["EN_ESPERA", "LLAMANDO"],
            "nuevo_estado": "CANCELADO",
            "evento": EventoLlamado.Tipo.CANCELADO,
        },
        "restaurar": {
            "estados_permitidos": ["ATENDIDO", "CANCELADO"],
            "nuevo_estado": "EN_ESPERA",
            "evento": EventoLlamado.Tipo.RESTAURADO,
        },
    }

    @transaction.atomic
    def post(self, request, pk):
        accion = request.data.get("accion")

        if accion not in self.ACCIONES:
            raise ValidationError({
                "accion": (
                    "Acción inválida. Usa llamar, rellamar, retirar_llamado, "
                    "finalizar, cancelar o restaurar."
                )
            })

        equipo = request.user

        turno = get_object_or_404(
            Turno.objects.select_for_update(),
            pk=pk,
            establecimiento=equipo.establecimiento,
            consultorio=equipo.consultorio,
        )

        configuracion = self.ACCIONES[accion]

        if turno.estado not in configuracion["estados_permitidos"]:
            raise ValidationError({
                "estado": (
                    f"No se puede ejecutar '{accion}' "
                    f"cuando el turno está en {turno.estado}."
                )
            })

        turno.estado = configuracion["nuevo_estado"]
        turno.save(update_fields=["estado"])

        evento = EventoLlamado.objects.create(
            turno=turno,
            tipo=configuracion["evento"],
        )

        transaction.on_commit(
            lambda turno_id=turno.id,
                establecimiento_id=turno.establecimiento_id,
                consultorio_id=turno.consultorio_id,
                evento_id=evento.id,
                accion=accion: notificar_monitores_turno(
                    turno_id=turno_id,
                    establecimiento_id=establecimiento_id,
                    consultorio_id=consultorio_id,
                    evento_id=evento_id,
                    accion=accion,
                ),
            robust=True,
        )


        turno = Turno.objects.select_related(
            "cita",
            "consultorio",
        ).get(pk=turno.pk)

        return Response(
            TurnoSerializer(turno).data,
            status=status.HTTP_200_OK,
        )



class GenerarCodigoActivacionAPIView(APIView):
    # Solo para desarrollo local. Antes de producción se debe
    # exigir autorización al personal de OTI.
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = GenerarCodigoActivacionSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        renipress = serializer.validated_data["renipress"].strip()
        codigo_consultorio = serializer.validated_data[
            "codigo_consultorio"
        ].strip()
        nombre_equipo = serializer.validated_data["nombre_equipo"]

        establecimiento = get_object_or_404(
            Establecimiento,
            codigo_renipress=renipress,
        )

        consultorio = get_object_or_404(
            Consultorio,
            establecimiento=establecimiento,
            codigo=codigo_consultorio,
        )

        # Evitar múltiples códigos activos simultáneamente
        # para el mismo consultorio.
        ahora = timezone.now()
        CodigoActivacion.objects.filter(
            consultorio=consultorio,
            utilizado_en__isnull=True,
            expira_en__gt=ahora,
        ).update(expira_en=ahora)

        codigo = CodigoActivacion.generar_codigo()
        codigo_hash = CodigoActivacion.calcular_hash(codigo)

        registro = CodigoActivacion.objects.create(
            establecimiento=establecimiento,
            consultorio=consultorio,
            codigo_hash=codigo_hash,
            expira_en=ahora + timedelta(minutes=30),
        )

        return Response(
            {
                "codigo": codigo,
                "expira_en": registro.expira_en,
                "consultorio": {
                    "codigo": consultorio.codigo,
                    "nombre": consultorio.nombre,
                },
                "establecimiento": {
                    "codigo_renipress": establecimiento.codigo_renipress,
                    "nombre_ipress": establecimiento.nombre_ipress,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class CanjearCodigoActivacionAPIView(APIView):
    # Temporal para desarrollo. Antes de producción,
    # debemos implementar controles de acceso y limitar intentos.
    permission_classes = [AllowAny]

    @transaction.atomic
    def post(self, request):
        serializer = CanjearCodigoActivacionSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        codigo = serializer.validated_data["codigo"].strip().upper()
        nombre_equipo = serializer.validated_data["nombre_equipo"]

        codigo_hash = CodigoActivacion.calcular_hash(codigo)

        registro = (
            CodigoActivacion.objects
            .select_for_update()
            .filter(codigo_hash=codigo_hash)
            .first()
        )

        if (
            registro is None
            or registro.utilizado_en is not None
            or registro.expira_en <= timezone.now()
        ):
            raise ValidationError({
                "codigo": (
                    "El código es inválido, venció o ya fue utilizado."
                )
            })

        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(
            token.encode("utf-8")
        ).hexdigest()

        equipo = EquipoActivado.objects.create(
            establecimiento=registro.establecimiento,
            consultorio=registro.consultorio,
            identificador_equipo=uuid.uuid4(),
            token_hash=token_hash,
            nombre_equipo=nombre_equipo,
            activo=True,
        )

        registro.utilizado_en = timezone.now()
        registro.save(update_fields=["utilizado_en"])

        return Response(
            {
                "mensaje": "Equipo activado correctamente.",
                "equipo_id": str(equipo.identificador_equipo),
                "token": token,
                "consultorio": {
                    "codigo": equipo.consultorio.codigo,
                    "nombre": equipo.consultorio.nombre,
                },
                "establecimiento": {
                    "codigo_renipress": (
                        equipo.establecimiento.codigo_renipress
                    ),
                    "nombre_ipress": (
                        equipo.establecimiento.nombre_ipress
                    ),
                },
            },
            status=status.HTTP_201_CREATED,
        )


class DesactivarEquipoAPIView(APIView):
    """Revoca la activación del equipo autenticado actualmente."""

    authentication_classes = [EquipoTokenAuthentication]
    permission_classes = [EsEquipoActivado]

    @transaction.atomic
    def post(self, request):
        equipo = (
            EquipoActivado.objects
            .select_for_update()
            .filter(pk=request.user.pk, activo=True)
            .first()
        )

        if equipo is None:
            raise ValidationError({
                "detail": "El equipo ya está desactivado o la credencial no es válida."
            })

        equipo.activo = False
        equipo.save(update_fields=["activo", "actualizado_en"])

        return Response(
            {
                "mensaje": "Equipo desactivado correctamente.",
                "equipo_id": str(equipo.identificador_equipo),
                "activo": False,
            },
            status=status.HTTP_200_OK,
        )


class TurnoAtendidosListAPIView(generics.ListAPIView):
    serializer_class = TurnoSerializer
    authentication_classes = [EquipoTokenAuthentication]
    permission_classes = [EsEquipoActivado]

    def get_queryset(self):
        equipo = self.request.user
        hoy = timezone.localdate()

        return (
            Turno.objects.filter(
                establecimiento=equipo.establecimiento,
                consultorio=equipo.consultorio,
                fecha=hoy,
                estado=Turno.Estado.ATENDIDO,
            )
            .select_related("cita", "consultorio")
            .order_by("-actualizado_en", "-id")
        )


class TurnoCanceladosListAPIView(generics.ListAPIView):
    serializer_class = TurnoSerializer
    authentication_classes = [EquipoTokenAuthentication]
    permission_classes = [EsEquipoActivado]

    def get_queryset(self):
        equipo = self.request.user
        hoy = timezone.localdate()

        return (
            Turno.objects.filter(
                establecimiento=equipo.establecimiento,
                consultorio=equipo.consultorio,
                fecha=hoy,
                estado=Turno.Estado.CANCELADO,
            )
            .select_related("cita", "consultorio")
            .order_by("-actualizado_en", "-id")
        )


class ValidarIPRESSAPIView(APIView):
    """
    Valida un código RENIPRESS y devuelve los datos de la IPRESS.

    Actualmente usa el proveedor JSON de pruebas.
    No consulta todavía la API oficial de SIHCE.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ValidarRENIPRESSSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        codigo = serializer.validated_data["codigo_renipress"]

        try:
            datos_ipress = obtener_ipress(codigo)
        except (FileNotFoundError, ValueError):
            return Response(
                {
                    "valida": False,
                    "detalle": (
                        "El proveedor de pruebas no está disponible "
                        "o el archivo JSON no es válido."
                    ),
                },
                status=503,
            )

        if datos_ipress is None:
            return Response(
                {
                    "valida": False,
                    "detalle": (
                        "El RENIPRESS no se encuentra en el proveedor "
                        "de pruebas."
                    ),
                },
                status=404,
            )

        return Response(
            {
                "valida": True,
                "establecimiento": {
                    "codigo_renipress": (
                        datos_ipress["codigo_renipress"]
                    ),
                    "nombre_ipress": datos_ipress["nombre_ipress"],
                },
                "consultorios": datos_ipress["consultorios"],
                "fuente": datos_ipress["fuente"],
            },
            status=200,
        )


class IPRESSListCreateAPIView(APIView):
    """
    Lista las IPRESS registradas y permite registrar una nueva.

    La información del establecimiento y su catálogo se obtienen
    del proveedor configurado, actualmente el JSON de pruebas.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        establecimientos = Establecimiento.objects.all().order_by(
            "nombre_ipress"
        )

        serializer = EstablecimientoSerializer(
            establecimientos,
            many=True,
        )

        return Response(serializer.data)

    @transaction.atomic
    def post(self, request):
        serializer = ValidarRENIPRESSSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        codigo = serializer.validated_data["codigo_renipress"]

        if Establecimiento.objects.filter(
            codigo_renipress=codigo
        ).exists():
            return Response(
                {
                    "mensaje": (
                        "Ya existe una IPRESS registrada con ese "
                        "código RENIPRESS."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        try:
            datos_ipress = obtener_ipress(codigo)
        except (FileNotFoundError, ValueError):
            return Response(
                {
                    "mensaje": (
                        "El proveedor de IPRESS no está disponible "
                        "o sus datos no tienen un formato válido."
                    )
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if datos_ipress is None:
            return Response(
                {
                    "mensaje": (
                        "No se encontró el RENIPRESS en el proveedor "
                        "de pruebas."
                    )
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        nombre = str(
            datos_ipress.get("nombre_ipress") or ""
        ).strip()

        consultorios = datos_ipress.get("consultorios", [])

        if not nombre or not isinstance(consultorios, list):
            return Response(
                {
                    "mensaje": (
                        "Los datos del establecimiento o su catálogo "
                        "de consultorios no son válidos."
                    )
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        establecimiento = Establecimiento.objects.create(
            codigo_renipress=codigo,
            nombre_ipress=nombre,
        )

        consultorios_creados = 0

        for item in consultorios:
            if not isinstance(item, dict):
                raise ValidationError(
                    "El catálogo contiene un consultorio no válido."
                )

            codigo_consultorio = str(
                item.get("codigo") or ""
            ).strip()

            nombre_consultorio = str(
                item.get("nombre") or ""
            ).strip()

            if not codigo_consultorio or not nombre_consultorio:
                raise ValidationError(
                    "Cada consultorio debe tener código y nombre."
                )

            _, creado = Consultorio.objects.update_or_create(
                establecimiento=establecimiento,
                codigo=codigo_consultorio,
                defaults={
                    "nombre": nombre_consultorio,
                    "codigo_ambiente": str(
                        item.get("codigo_ambiente") or ""
                    ).strip(),
                    "nombre_ambiente": str(
                        item.get("nombre_ambiente") or ""
                    ).strip(),
                    "piso_ambiente": str(
                        item.get("piso_ambiente") or ""
                    ).strip(),
                    "codigo_servicio": str(
                        item.get("codigo_servicio") or ""
                    ).strip(),
                    "nombre_servicio": str(
                        item.get("nombre_servicio") or ""
                    ).strip(),
                },
            )

            if creado:
                consultorios_creados += 1

        return Response(
            {
                "mensaje": "IPRESS registrada correctamente.",
                "establecimiento": EstablecimientoSerializer(
                    establecimiento
                ).data,
                "consultorios_creados": consultorios_creados,
            },
            status=status.HTTP_201_CREATED,
        )


class IPRESSDestroyAPIView(APIView):
    """
    Elimina una IPRESS únicamente cuando no tiene registros asociados.
    """

    permission_classes = [AllowAny]

    def delete(self, request, pk):
        establecimiento = get_object_or_404(
            Establecimiento,
            pk=pk,
        )

        dependencias = [
            (
                "configuración del sistema",
                ConfiguracionIPRESS.objects.filter(
                    establecimiento=establecimiento
                ).exists(),
            ),
            (
                "consultorios",
                Consultorio.objects.filter(
                    establecimiento=establecimiento
                ).exists(),
            ),
            (
                "citas",
                Cita.objects.filter(
                    establecimiento=establecimiento
                ).exists(),
            ),
            (
                "turnos",
                Turno.objects.filter(
                    establecimiento=establecimiento
                ).exists(),
            ),
            (
                "historial de sincronizaciones",
                Sincronizacion.objects.filter(
                    establecimiento=establecimiento
                ).exists(),
            ),
            (
                "códigos de activación de consultorios",
                CodigoActivacion.objects.filter(
                    establecimiento=establecimiento
                ).exists(),
            ),
            (
                "equipos de consultorio activados",
                EquipoActivado.objects.filter(
                    establecimiento=establecimiento
                ).exists(),
            ),
            (
                "monitores configurados",
                Monitor.objects.filter(
                    establecimiento=establecimiento
                ).exists(),
            ),
        ]

        motivos = [
            nombre
            for nombre, existe in dependencias
            if existe
        ]

        if motivos:
            return Response(
                {
                    "mensaje": (
                        "No se puede eliminar la IPRESS porque "
                        "tiene registros asociados."
                    ),
                    "dependencias": motivos,
                },
                status=status.HTTP_409_CONFLICT,
            )

        try:
            with transaction.atomic():
                establecimiento.delete()
        except ProtectedError:
            return Response(
                {
                    "mensaje": (
                        "No se puede eliminar la IPRESS porque "
                        "existen otros registros relacionados."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        return Response(status=status.HTTP_204_NO_CONTENT)


class ConfiguracionIPRESSAPIView(APIView):
    """
    Lee y guarda la IPRESS activa del sistema.
    La configuración se conserva en PostgreSQL.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        configuracion = (
            ConfiguracionIPRESS.objects
            .select_related("establecimiento")
            .filter(clave="principal")
            .first()
        )

        if configuracion is None:
            return Response({
                "configurada": False,
                "establecimiento": None,
            })

        establecimiento = configuracion.establecimiento

        return Response({
            "configurada": True,
            "establecimiento": {
                "codigo_renipress": establecimiento.codigo_renipress,
                "nombre_ipress": establecimiento.nombre_ipress,
            },
            "actualizado_en": configuracion.actualizado_en.isoformat(),
        })

    @transaction.atomic
    def post(self, request):
        codigo = (
            request.data.get("codigo_renipress")
            or request.data.get("renipress")
            or ""
        ).strip()

        nombre = (
            request.data.get("nombre_ipress") or ""
        ).strip()

        if not codigo:
            raise ValidationError({
                "codigo_renipress": "Ingresa el código RENIPRESS."
            })

        establecimiento = (
            Establecimiento.objects
            .select_for_update()
            .filter(codigo_renipress=codigo)
            .first()
        )

        if establecimiento is None:
            if not nombre:
                raise ValidationError({
                    "nombre_ipress": (
                        "Ingresa el nombre de la IPRESS para "
                        "registrar un establecimiento nuevo."
                    )
                })

            establecimiento = Establecimiento.objects.create(
                codigo_renipress=codigo,
                nombre_ipress=nombre,
            )

        elif nombre and establecimiento.nombre_ipress != nombre:
            establecimiento.nombre_ipress = nombre
            establecimiento.save(update_fields=["nombre_ipress"])

        configuracion, _ = ConfiguracionIPRESS.objects.update_or_create(
            clave="principal",
            defaults={"establecimiento": establecimiento},
        )

        return Response({
            "mensaje": "IPRESS guardada correctamente.",
            "configurada": True,
            "establecimiento": {
                "codigo_renipress": establecimiento.codigo_renipress,
                "nombre_ipress": establecimiento.nombre_ipress,
            },
            "actualizado_en": configuracion.actualizado_en.isoformat(),
        })




class MonitorAPIView(APIView):
    """
    Información de solo lectura para el monitor de sala de espera.
    Recibe el RENIPRESS del establecimiento.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        establecimiento = obtener_establecimiento(request)
        hoy = timezone.localdate()

        # Turnos que se están llamando en los consultorios.
        turnos_activos = (
            Turno.objects.filter(
                establecimiento=establecimiento,
                fecha=hoy,
                estado=Turno.Estado.LLAMANDO,
            )
            .select_related("cita", "consultorio")
            .order_by("consultorio__nombre", "creado_en")
        )

        llamados_activos = [
            {
                "id": turno.id,
                "codigo": turno.codigo,
                "estado": turno.estado,

                # Nombre completo, conservado por compatibilidad.
                "nombre_paciente": (
                    f"{turno.cita.nombres_paciente} "
                    f"{turno.cita.apellido_paterno_paciente} "
                    f"{turno.cita.apellido_materno_paciente}"
                ).strip(),

                # Campos separados para el nombre en pantalla y la voz.
                "nombres_paciente": turno.cita.nombres_paciente,
                "apellido_paterno_paciente": (
                    turno.cita.apellido_paterno_paciente
                ),

                "nombre_consultorio": turno.consultorio.nombre,
                "codigo_consultorio": turno.consultorio.codigo,
                "nombre_servicio": turno.consultorio.nombre_servicio,
                "hora_cita": turno.cita.hora_cita.strftime("%H:%M"),
            }
            for turno in turnos_activos
        ]

        # Últimos 10 llamados y rellamados realizados hoy.
        ultimos_eventos = (
            EventoLlamado.objects.filter(
                turno__establecimiento=establecimiento,
                turno__fecha=hoy,
                tipo__in=[
                    EventoLlamado.Tipo.LLAMADO,
                    EventoLlamado.Tipo.RE_LLAMADO,
                ],
            )
            .select_related(
                "turno",
                "turno__cita",
                "turno__consultorio",
            )
            .order_by("-id")[:10]
        )

        ultimos_llamados = [
            {
                "evento_id": evento.id,
                "tipo": evento.tipo,
                "fecha_evento": evento.fecha_evento.isoformat(),
                "codigo": evento.turno.codigo,

                # Nombre completo para mantener compatibilidad.
                "nombre_paciente": (
                    f"{evento.turno.cita.nombres_paciente} "
                    f"{evento.turno.cita.apellido_paterno_paciente} "
                    f"{evento.turno.cita.apellido_materno_paciente}"
                ).strip(),

                # Campos separados.
                "nombres_paciente": (
                    evento.turno.cita.nombres_paciente
                ),
                "apellido_paterno_paciente": (
                    evento.turno.cita.apellido_paterno_paciente
                ),

                "nombre_consultorio": evento.turno.consultorio.nombre,
                "nombre_servicio": (
                    evento.turno.consultorio.nombre_servicio
                ),
            }
            for evento in ultimos_eventos
        ]

        # Cantidad de turnos atendidos hoy por consultorio.
        consultorios = Consultorio.objects.filter(
            establecimiento=establecimiento
        ).order_by("nombre")

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


class MonitorEventosAPIView(APIView):
    """
    Entrega los eventos nuevos para que el frontend pueda
    anunciar cada llamado o rellamado una sola vez.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        establecimiento = obtener_establecimiento(request)
        hoy = timezone.localdate()
        desde_id = request.query_params.get("desde_id")

        eventos_base = EventoLlamado.objects.filter(
            turno__establecimiento=establecimiento,
            turno__fecha=hoy,
            tipo__in=[
                EventoLlamado.Tipo.LLAMADO,
                EventoLlamado.Tipo.RE_LLAMADO,
            ],
        )

        ultimo_evento_id = (
            eventos_base.order_by("-id")
            .values_list("id", flat=True)
            .first()
            or 0
        )

        # Primera consulta: establece el cursor sin reproducir
        # anuncios anteriores a la apertura del monitor.
        if desde_id is None:
            return Response({
                "eventos": [],
                "ultimo_evento_id": ultimo_evento_id,
            })

        try:
            cursor = int(desde_id)

            if cursor < 0:
                raise ValueError

        except (TypeError, ValueError):
            raise ValidationError({
                "desde_id": "Debe ser un identificador numérico válido."
            })

        eventos = (
            eventos_base.filter(id__gt=cursor)
            .select_related(
                "turno",
                "turno__cita",
                "turno__consultorio",
            )
            .order_by("id")[:100]
        )

        resultados = [
            {
                "id": evento.id,
                "tipo": evento.tipo,
                "fecha_evento": evento.fecha_evento.isoformat(),
                "turno_id": evento.turno_id,
                "codigo": evento.turno.codigo,

                # Nombre completo, conservado por compatibilidad.
                "nombre_paciente": (
                    f"{evento.turno.cita.nombres_paciente} "
                    f"{evento.turno.cita.apellido_paterno_paciente} "
                    f"{evento.turno.cita.apellido_materno_paciente}"
                ).strip(),

                # Campos separados para identificar con precisión
                # el primer nombre y el apellido paterno.
                "nombres_paciente": (
                    evento.turno.cita.nombres_paciente
                ),
                "apellido_paterno_paciente": (
                    evento.turno.cita.apellido_paterno_paciente
                ),

                "nombre_consultorio": evento.turno.consultorio.nombre,
                "nombre_servicio": (
                    evento.turno.consultorio.nombre_servicio
                ),
            }
            for evento in eventos
        ]

        ultimo_id_entregado = (
            resultados[-1]["id"] if resultados else cursor
        )

        return Response({
            "eventos": resultados,
            "ultimo_evento_id": ultimo_id_entregado,
        })



class MonitorEventosAPIView(APIView):
    """
    Entrega los eventos nuevos para que el frontend pueda
    anunciar cada llamado o rellamado una sola vez.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        establecimiento = obtener_establecimiento(request)
        hoy = timezone.localdate()

        desde_id = request.query_params.get("desde_id")

        eventos_base = EventoLlamado.objects.filter(
            turno__establecimiento=establecimiento,
            turno__fecha=hoy,
            tipo__in=[
                EventoLlamado.Tipo.LLAMADO,
                EventoLlamado.Tipo.RE_LLAMADO,
            ],
        )

        ultimo_evento_id = (
            eventos_base.order_by("-id")
            .values_list("id", flat=True)
            .first()
            or 0
        )

        # En la primera consulta solo entregamos el cursor.
        # Así no se reproducen llamadas antiguas al abrir el monitor.
        if desde_id is None:
            return Response({
                "eventos": [],
                "ultimo_evento_id": ultimo_evento_id,
            })

        try:
            cursor = int(desde_id)
            if cursor < 0:
                raise ValueError
        except (TypeError, ValueError):
            raise ValidationError({
                "desde_id": "Debe ser un identificador numérico válido."
            })

        eventos = (
            eventos_base.filter(id__gt=cursor)
            .select_related(
                "turno",
                "turno__cita",
                "turno__consultorio",
            )
            .order_by("id")[:100]
        )

        resultados = [
            {
                "id": evento.id,
                "tipo": evento.tipo,
                "fecha_evento": evento.fecha_evento.isoformat(),
                "turno_id": evento.turno_id,
                "codigo": evento.turno.codigo,
                "nombre_paciente": (
                    f"{evento.turno.cita.nombres_paciente} "
                    f"{evento.turno.cita.apellido_paterno_paciente} "
                    f"{evento.turno.cita.apellido_materno_paciente}"
                ).strip(),
                "nombre_consultorio": evento.turno.consultorio.nombre,
                "nombre_servicio": (
                    evento.turno.consultorio.nombre_servicio
                ),
            }
            for evento in eventos
        ]

        ultimo_id_entregado = (
            resultados[-1]["id"] if resultados else cursor
        )

        return Response({
            "eventos": resultados,
            "ultimo_evento_id": ultimo_id_entregado,
        })
