
from rest_framework import serializers

from citas.models import Cita, Consultorio, Turno


class ConsultorioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Consultorio
        fields = [
            "id",
            "codigo",
            "nombre",
            "codigo_ambiente",
            "nombre_ambiente",
            "piso_ambiente",
            "codigo_servicio",
            "nombre_servicio",
        ]


class CitaSerializer(serializers.ModelSerializer):
    codigo_consultorio = serializers.CharField(
        source="consultorio.codigo",
        read_only=True,
    )
    nombre_consultorio = serializers.CharField(
        source="consultorio.nombre",
        read_only=True,
    )

    class Meta:
        model = Cita
        fields = [
            "id_sihce",
            "fecha_cita",
            "hora_cita",
            "estado_sihce",
            "codigo_consultorio",
            "nombre_consultorio",
            "nombres_paciente",
            "apellido_paterno_paciente",
            "apellido_materno_paciente",
            "nombre_profesional",
        ]


class CrearTurnoSerializer(serializers.Serializer):
    renipress = serializers.CharField()
    id_cita = serializers.CharField()


class TurnoSerializer(serializers.ModelSerializer):
    id_cita = serializers.CharField(
        source="cita.id_sihce",
        read_only=True,
    )
    codigo_consultorio = serializers.CharField(
        source="consultorio.codigo",
        read_only=True,
    )
    nombre_consultorio = serializers.CharField(
        source="consultorio.nombre",
        read_only=True,
    )
    hora_cita = serializers.TimeField(
        source="cita.hora_cita",
        read_only=True,
    )
    nombres_paciente = serializers.CharField(
        source="cita.nombres_paciente",
        read_only=True,
    )
    apellido_paterno_paciente = serializers.CharField(
        source="cita.apellido_paterno_paciente",
        read_only=True,
    )

    class Meta:
        model = Turno
        fields = [
            "id",
            "id_cita",
            "codigo_consultorio",
            "nombre_consultorio",
            "codigo",
            "fecha",
            "hora_cita",
            "nombres_paciente",
            "apellido_paterno_paciente",
            "estado",
        ]
        read_only_fields = fields



class GenerarCodigoActivacionSerializer(serializers.Serializer):
    renipress = serializers.CharField(max_length=20)
    codigo_consultorio = serializers.CharField(max_length=50)
    nombre_equipo = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
        default="",
    )


class CanjearCodigoActivacionSerializer(serializers.Serializer):
    codigo = serializers.CharField(max_length=20)
    nombre_equipo = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
        default="",
    )
