
from datetime import date, datetime

from django.db import transaction

from citas.models import (
    Cita,
    Consultorio,
    Establecimiento,
    Sincronizacion,
    Turno,
)


ESTADOS_SIHCE_PENDIENTE = {"PENDIENTE"}


def obtener_codigo_turno(establecimiento, fecha):
    """
    Devuelve el primer código de tres dígitos disponible
    para una IPRESS y fecha determinadas.
    """
    codigos_usados = set(
        Turno.objects.filter(
            establecimiento=establecimiento,
            fecha=fecha,
        ).values_list("codigo", flat=True)
    )

    for numero in range(1, 1000):
        codigo = f"{numero:03d}"
        if codigo not in codigos_usados:
            return codigo

    raise ValueError(
        f"No hay códigos disponibles para la fecha {fecha}."
    )


def validar_objeto(item, campo, posicion):
    valor = item.get(campo)

    if not isinstance(valor, dict):
        raise ValueError(
            f"Cita en posición {posicion}: "
            f"'{campo}' debe ser un objeto."
        )

    return valor


@transaction.atomic
def sincronizar_citas(datos):
    establecimiento_json = datos.get("establecimiento", {})
    codigo_renipress = establecimiento_json.get("codigo_renipress")

    if not codigo_renipress:
        raise ValueError("No se recibió el código RENIPRESS.")

    establecimiento = (
        Establecimiento.objects
        .select_for_update()
        .filter(codigo_renipress=codigo_renipress)
        .first()
    )

    if establecimiento is None:
        raise ValueError(
            f"La IPRESS {codigo_renipress} no está registrada."
        )

    citas_json = datos.get("citas")

    if not isinstance(citas_json, list):
        raise ValueError("El campo 'citas' debe ser una lista.")

    # Validar estructura e identificadores antes de modificar datos.
    ids = []

    for posicion, item in enumerate(citas_json, start=1):
        if not isinstance(item, dict):
            raise ValueError(
                f"La cita en posición {posicion} no es un objeto."
            )

        campos = (
            "id_cita",
            "fecha_cita",
            "hora_cita",
            "estado_cita",
            "ambiente",
            "consultorio",
            "servicio",
            "paciente",
            "profesional",
        )

        faltantes = [
            campo for campo in campos
            if campo not in item
        ]

        if faltantes:
            raise ValueError(
                f"Cita en posición {posicion}: faltan "
                f"{', '.join(faltantes)}."
            )

        for campo in (
            "ambiente",
            "consultorio",
            "servicio",
            "paciente",
            "profesional",
        ):
            validar_objeto(item, campo, posicion)

        id_cita = item["id_cita"]

        if not isinstance(id_cita, str) or not id_cita.strip():
            raise ValueError(
                f"Cita en posición {posicion}: id_cita inválido."
            )

        ids.append(id_cita)

    if len(ids) != len(set(ids)):
        raise ValueError(
            "El JSON contiene identificadores de cita duplicados."
        )

    resultado = {
        "procesadas": 0,
        "nuevas": 0,
        "actualizadas": 0,
        "consultorios_nuevos": 0,
        "turnos_creados": 0,
        "turnos_conservados": 0,
    }

    sincronizacion = Sincronizacion.objects.create(
        establecimiento=establecimiento,
        exitosa=False,
    )

    for item in citas_json:
        ambiente = item["ambiente"]
        consultorio_json = item["consultorio"]
        servicio = item["servicio"]
        paciente = item["paciente"]
        profesional = item["profesional"]

        codigo_consultorio = consultorio_json.get("codigo")

        if not codigo_consultorio:
            raise ValueError(
                f"La cita {item['id_cita']} "
                "no tiene consultorio.codigo."
            )

        consultorio, consultorio_creado = (
            Consultorio.objects.update_or_create(
                establecimiento=establecimiento,
                codigo=codigo_consultorio,
                defaults={
                    "nombre": consultorio_json["nombre"],
                    "codigo_ambiente": ambiente["codigo"],
                    "nombre_ambiente": ambiente["nombre"],
                    "piso_ambiente": ambiente["piso"],
                    "codigo_servicio": servicio["codigo"],
                    "nombre_servicio": servicio["nombre"],
                },
            )
        )

        if consultorio_creado:
            resultado["consultorios_nuevos"] += 1

        fecha_cita = date.fromisoformat(item["fecha_cita"])
        hora_cita = datetime.strptime(
            item["hora_cita"], "%H:%M:%S"
        ).time()

        cita, cita_creada = Cita.objects.update_or_create(
            establecimiento=establecimiento,
            id_sihce=item["id_cita"],
            defaults={
                "consultorio": consultorio,
                "fecha_cita": fecha_cita,
                "hora_cita": hora_cita,
                "estado_sihce": item["estado_cita"],
                "dni_paciente": paciente["dni"],
                "nombres_paciente": paciente["nombres"],
                "apellido_paterno_paciente": (
                    paciente["apellido_paterno"]
                ),
                "apellido_materno_paciente": (
                    paciente["apellido_materno"]
                ),
                "dni_profesional": profesional["dni"],
                "nombre_profesional": profesional["nombre"],
            },
        )

        if cita_creada:
            resultado["nuevas"] += 1
        else:
            resultado["actualizadas"] += 1

        # Si ya existe un turno, nunca reiniciar su estado local.
        turno = Turno.objects.filter(cita=cita).first()

        if turno is not None:
            if turno.estado in ("EN_ESPERA", "LLAMANDO"):
                cambios = []

                if turno.consultorio_id != consultorio.id:
                    turno.consultorio = consultorio
                    cambios.append("consultorio")

                if turno.fecha != fecha_cita:
                    turno.fecha = fecha_cita
                    cambios.append("fecha")

                if cambios:
                    turno.save(update_fields=cambios)

            resultado["turnos_conservados"] += 1

        else:
            # Solo crear un turno para una cita pendiente.
            estado_sihce = str(item["estado_cita"]).strip().upper()

            if estado_sihce in ESTADOS_SIHCE_PENDIENTE:
                codigo = obtener_codigo_turno(
                    establecimiento,
                    fecha_cita,
                )

                Turno.objects.create(
                    establecimiento=establecimiento,
                    consultorio=consultorio,
                    cita=cita,
                    codigo=codigo,
                    fecha=fecha_cita,
                )

                resultado["turnos_creados"] += 1

        resultado["procesadas"] += 1

    sincronizacion.cantidad_citas_procesadas = (
        resultado["procesadas"]
    )
    sincronizacion.exitosa = True
    sincronizacion.save(
        update_fields=[
            "cantidad_citas_procesadas",
            "exitosa",
        ]
    )

    return resultado
