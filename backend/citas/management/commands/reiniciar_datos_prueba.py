from django.apps import apps
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q


RENIPRESS_DEFAULT = "00005644"
CODIGOS_CONSULTORIO_VALIDOS = {
    "CONS-MED-01",
    "CONS-MED-02",
    "CONS-ODO-01",
}

# El orden importa: primero se eliminan eventos y entidades dependientes,
# después las activaciones/asignaciones y finalmente los monitores.
MODELOS_A_LIMPIAR = (
    "EventoLlamado",
    "Turno",
    "Cita",
    "CodigoActivacion",
    "EquipoActivado",
    "CodigoActivacionMonitor",
    "MonitorActivado",
    "MonitorConsultorio",
    "MonitorVideo",
    "Monitor",
    "Sincronizacion",
)


class Command(BaseCommand):
    help = (
        "Reinicia los datos operativos de prueba de una IPRESS: borra citas, turnos, "
        "llamados, activaciones de ventanilla y monitor, monitores registrados y sus "
        "asignaciones. Conserva la IPRESS, su configuración, los tres consultorios de "
        "prueba y la biblioteca de videos. Luego vuelve a importar las citas JSON."
    )

    def add_arguments(self, parser):
        parser.add_argument("--renipress", default=RENIPRESS_DEFAULT)
        parser.add_argument(
            "--confirmar",
            action="store_true",
            help="Confirma que se eliminen los datos operativos de prueba.",
        )
        parser.add_argument(
            "--sin-importar-citas",
            action="store_true",
            help="Limpia los datos, pero no ejecuta importar_citas_json al finalizar.",
        )

    @staticmethod
    def _paths_to_establecimiento(model, establishment_model, max_depth=4):
        """Encuentra rutas FK/OneToOne desde un modelo hasta Establecimiento."""
        results = []
        queue = [(model, "", frozenset({model}))]
        while queue:
            current_model, prefix, visited = queue.pop(0)
            profundidad = prefix.count("__") + (1 if prefix else 0)
            if profundidad >= max_depth:
                continue

            for field in current_model._meta.get_fields():
                if not getattr(field, "is_relation", False):
                    continue
                if not getattr(field, "concrete", False) or getattr(field, "auto_created", False):
                    continue
                if not (
                    getattr(field, "many_to_one", False)
                    or getattr(field, "one_to_one", False)
                ):
                    continue

                related_model = getattr(field, "related_model", None)
                if related_model is None:
                    continue

                path = f"{prefix}__{field.name}" if prefix else field.name
                if related_model == establishment_model:
                    results.append(path)
                elif related_model not in visited:
                    queue.append((related_model, path, visited | {related_model}))
        return results

    @classmethod
    def _for_establishment(cls, model, establishment, establishment_model):
        paths = cls._paths_to_establecimiento(model, establishment_model)
        if not paths:
            raise CommandError(
                f"No se encontró una relación desde {model.__name__} hasta "
                "Establecimiento. No se realizó la limpieza."
            )

        condition = Q()
        for path in paths:
            condition |= Q(**{path: establishment})
        return model.objects.filter(condition).distinct()

    def handle(self, *args, **options):
        if not options["confirmar"]:
            raise CommandError(
                "No se eliminó nada. Revisa el RENIPRESS objetivo y vuelve a ejecutar "
                "el comando agregando --confirmar."
            )

        renipress = str(options["renipress"]).strip()
        try:
            Establecimiento = apps.get_model("citas", "Establecimiento")
            Consultorio = apps.get_model("citas", "Consultorio")
        except LookupError as exc:
            raise CommandError(f"No se encontró el modelo esperado: {exc}") from exc

        try:
            establecimiento = Establecimiento.objects.get(codigo_renipress=renipress)
        except Establecimiento.DoesNotExist as exc:
            raise CommandError(
                f"No existe una IPRESS con RENIPRESS {renipress}. No se eliminó nada."
            ) from exc

        consultorios = Consultorio.objects.filter(establecimiento=establecimiento)
        codigos_existentes = set(consultorios.values_list("codigo", flat=True))
        faltantes = CODIGOS_CONSULTORIO_VALIDOS - codigos_existentes
        if faltantes:
            raise CommandError(
                "No se realizó la limpieza porque faltan consultorios del catálogo de "
                "prueba: " + ", ".join(sorted(faltantes)) + ". Sincroniza primero el catálogo."
            )

        modelos = {}
        for nombre in MODELOS_A_LIMPIAR:
            try:
                modelos[nombre] = apps.get_model("citas", nombre)
            except LookupError as exc:
                raise CommandError(
                    f"No se encontró el modelo {nombre}. No se realizó la limpieza. "
                    "Verifica que las migraciones y el código estén actualizados."
                ) from exc

        resumen = []
        antiguos_count = 0
        with transaction.atomic():
            for nombre in MODELOS_A_LIMPIAR:
                model = modelos[nombre]
                queryset = self._for_establishment(model, establecimiento, Establecimiento)
                count = queryset.count()
                if count:
                    queryset.delete()
                resumen.append((nombre, count))

            # Mantiene exclusivamente los tres consultorios de la fixture actual.
            antiguos = Consultorio.objects.filter(establecimiento=establecimiento).exclude(
                codigo__in=CODIGOS_CONSULTORIO_VALIDOS
            )
            antiguos_count = antiguos.count()
            if antiguos_count:
                try:
                    antiguos.delete()
                except Exception as exc:
                    raise CommandError(
                        "No se pudieron eliminar consultorios antiguos por una relación "
                        "que todavía los referencia. La transacción se revirtió. Detalle: "
                        f"{exc}"
                    ) from exc

        self.stdout.write(self.style.SUCCESS(
            f"Limpieza completada para RENIPRESS {renipress} — {establecimiento.nombre_ipress}."
        ))
        for nombre, count in resumen:
            self.stdout.write(f"  {nombre}: {count} registros eliminados")
        self.stdout.write(f"  Consultorios antiguos eliminados: {antiguos_count}")

        self.stdout.write("Consultorios conservados:")
        actuales = Consultorio.objects.filter(establecimiento=establecimiento).order_by("codigo")
        for consultorio in actuales:
            self.stdout.write(f"  {consultorio.codigo} — {consultorio.nombre}")

        if options["sin_importar_citas"]:
            self.stdout.write(self.style.WARNING(
                "No se importaron citas por solicitud. Para importarlas ejecuta: "
                "py manage.py importar_citas_json"
            ))
            return

        self.stdout.write("\nImportando las citas desde la fixture JSON…")
        try:
            call_command("importar_citas_json")
        except Exception as exc:
            raise CommandError(
                "La limpieza sí terminó, pero la importación automática de citas falló. "
                "Puedes corregir el error y ejecutar después `py manage.py importar_citas_json`. "
                f"Detalle: {exc}"
            ) from exc

        self.stdout.write(self.style.SUCCESS(
            "Reinicio completado: datos operativos limpios, monitores desregistrados y citas de prueba importadas."
        ))
