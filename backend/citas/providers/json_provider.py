
import json
from pathlib import Path


# Raíz del proyecto: gestor-colas-sihce/
BASE_DIR = Path(__file__).resolve().parents[2]

# Archivo JSON utilizado como fuente de prueba.
RUTA_JSON = BASE_DIR / "data" / "citas_sihce_prueba.json"


def obtener_citas():
    """
    Lee el archivo JSON de prueba y devuelve sus datos.

    No consulta ni modifica la base de datos.
    """

    if not RUTA_JSON.is_file():
        raise FileNotFoundError(
            f"No se encontró el archivo JSON: {RUTA_JSON}"
        )

    try:
        with RUTA_JSON.open("r", encoding="utf-8-sig") as archivo:
            datos = json.load(archivo)

    except json.JSONDecodeError as exc:
        raise ValueError(
            f"El archivo JSON tiene un formato inválido: {exc}"
        ) from exc

    if not isinstance(datos, dict):
        raise ValueError(
            "La raíz del JSON debe ser un objeto."
        )

    if not isinstance(datos.get("establecimiento"), dict):
        raise ValueError(
            "El JSON debe contener un objeto 'establecimiento'."
        )

    if not isinstance(datos.get("citas"), list):
        raise ValueError(
            "El JSON debe contener una lista llamada 'citas'."
        )

    return datos
