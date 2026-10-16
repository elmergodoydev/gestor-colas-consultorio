
from django.core.management.base import BaseCommand, CommandError

from citas.providers.json_provider import obtener_citas
from citas.services.sincronizacion import sincronizar_citas


class Command(BaseCommand):
    help = "Sincroniza las citas desde el JSON de prueba de SIHCE."

    def handle(self, *args, **options):
        try:
            datos = obtener_citas()
            resultado = sincronizar_citas(datos)

        except (
            ValueError,
            FileNotFoundError,
            KeyError,
            TypeError,
        ) as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS("Sincronización completada.")
        )

        establecimiento = datos["establecimiento"]

        self.stdout.write(
            f"IPRESS: {establecimiento['codigo_renipress']} - "
            f"{establecimiento['nombre_ipress']}"
        )
        self.stdout.write(
            f"Citas procesadas: {resultado['procesadas']}"
        )
        self.stdout.write(
            f"Citas nuevas: {resultado['nuevas']}"
        )
        self.stdout.write(
            f"Citas actualizadas: {resultado['actualizadas']}"
        )
        self.stdout.write(
            f"Consultorios nuevos: "
            f"{resultado['consultorios_nuevos']}"
        )
        self.stdout.write(
            f"Turnos creados: {resultado['turnos_creados']}"
        )
        self.stdout.write(
            f"Turnos conservados: {resultado['turnos_conservados']}"
        )
