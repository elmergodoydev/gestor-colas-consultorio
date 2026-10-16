
from datetime import date, datetime

from django.db import transaction
from django.shortcuts import get_object_or_404

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
    Turno,
)
from citas.serializers import (
    CitaSerializer,
    ConsultorioSerializer,
    CrearTurnoSerializer,
    TurnoSerializer,
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
            "evento": "LLAMADO",
        },
        "rellamar": {
            "estados_permitidos": ["LLAMANDO"],
            "nuevo_estado": "LLAMANDO",
            "evento": "RE_LLAMADO",
        },
        "finalizar": {
            "estados_permitidos": ["LLAMANDO"],
            "nuevo_estado": "ATENDIDO",
            "evento": "ATENDIDO",
        },
        "no_presentado": {
            "estados_permitidos": ["EN_ESPERA", "LLAMANDO"],
            "nuevo_estado": "NO_PRESENTADO",
            "evento": "NO_PRESENTADO",
        },
        "cancelar": {
            "estados_permitidos": ["EN_ESPERA", "LLAMANDO"],
            "nuevo_estado": "CANCELADO",
            "evento": "CANCELADO",
        },
    }

    @transaction.atomic
    def post(self, request, pk):
        accion = request.data.get("accion")

        if accion not in self.ACCIONES:
            raise ValidationError({
                "accion": (
                    "Acción inválida. Usa llamar, rellamar, finalizar, "
                    "no_presentado o cancelar."
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

        EventoLlamado.objects.create(
            turno=turno,
            tipo=configuracion["evento"],
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
