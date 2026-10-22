import json

from django.conf import settings


def obtener_ipress(codigo_renipress):
    """
    Consulta una IPRESS usando el proveedor JSON de pruebas.

    Este proveedor es temporal. No realiza conexiones con SIHCE.
    Permite probar la validación de RENIPRESS antes de implementar
    la integración con la API oficial.
    """

    codigo_buscado = str(codigo_renipress).strip()

    if not codigo_buscado:
        raise ValueError("El código RENIPRESS es obligatorio.")

    ruta_json = (
        settings.BASE_DIR
        / "data"
        / "ipress_sihce_prueba.json"
    )

    if not ruta_json.is_file():
        raise FileNotFoundError(
            "No se encontró el archivo JSON de pruebas: "
            f"{ruta_json}"
        )

    with ruta_json.open("r", encoding="utf-8-sig") as archivo:
        datos = json.load(archivo)

    establecimiento = datos.get("establecimiento")

    if not isinstance(establecimiento, dict):
        raise ValueError(
            "El JSON de pruebas no contiene un establecimiento válido."
        )

    codigo_archivo = str(
        establecimiento.get("codigo_renipress", "")
    ).strip()

    if codigo_archivo != codigo_buscado:
        return None

    consultorios = establecimiento.get("consultorios", [])

    if not isinstance(consultorios, list):
        raise ValueError(
            "El catálogo de consultorios no tiene un formato válido."
        )

    return {
        "codigo_renipress": codigo_archivo,
        "nombre_ipress": establecimiento.get(
            "nombre_ipress", ""
        ),
        "consultorios": consultorios,
        "fuente": "json_prueba",
    }