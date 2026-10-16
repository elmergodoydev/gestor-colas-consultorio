# Gestor de Colas de Consultorios - SIHCE

Sistema web para gestionar y visualizar los turnos de atención por consultorio.

## Tecnologías

- **Frontend:** React, Vite y Material UI.
- **Backend:** Django y Django REST Framework.
- **Base de datos:** PostgreSQL.
- **Servidor web:** Nginx.
- **Contenedores:** Docker y Docker Compose.

## Requisitos

- Git.
- Docker Desktop en Windows o Docker Engine en Linux.
- Docker Compose v2.

## 1. Clonar el repositorio

```bash
git clone https://git.minsa.gob.pe/interoperabilidad/gestor-colas-consultorios.git
cd gestor-colas-consultorios
```

Se requiere tener acceso al repositorio de GitLab.

## 2. Configurar las variables de entorno

Crear el archivo `.env` a partir de la plantilla `.env.example`.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

**Linux:**

```bash
cp .env.example .env
```

Editar el archivo `.env` y configurar las credenciales de PostgreSQL y la clave secreta de Django.

Los valores de `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD` deben coincidir con `DB_NAME`, `DB_USER` y `DB_PASSWORD`, respectivamente.

Para el acceso local, configurar:

```dotenv
APP_BIND_IP=127.0.0.1
APP_PORT=8088
```

## 3. Construir las imágenes Docker

Desde la raíz del proyecto, ejecutar:

```bash
docker compose build
```

## 4. Iniciar PostgreSQL

```bash
docker compose up -d db
```

## 5. Ejecutar las migraciones

```bash
docker compose run --rm backend python manage.py migrate
```

## 6. Recopilar los archivos estáticos

```bash
docker compose run --rm backend python manage.py collectstatic --noinput
```

## 7. Iniciar la aplicación

```bash
docker compose up -d backend frontend
```

## 8. Acceder al sistema

Abrir el navegador y acceder a:

- **Aplicación:** http://127.0.0.1:8088
- **Configuración de la IPRESS:** http://127.0.0.1:8088/config

Registrar el código RENIPRESS y el nombre del establecimiento desde la interfaz de configuración.

## 9. Datos de prueba

Actualmente, el sistema utiliza el archivo JSON de prueba:

`backend/data/citas_sihce_prueba.json`

Este archivo contiene citas y datos ficticios que permiten probar la gestión de turnos y el monitor sin depender de la API de SIHCE.

**Importante:** el sistema muestra las citas del día actual. Para interactuar con los datos de prueba, se deben actualizar las fechas de las citas en el archivo JSON al día en que se realizarán las pruebas. De lo contrario, las citas con fechas anteriores o posteriores no aparecerán en las vistas filtradas por el día actual.

Después de modificar las fechas, ejecutar:

```bash
docker compose run --rm backend python manage.py importar_citas_json
```

Este comando sincroniza las citas del archivo JSON con PostgreSQL y crea los consultorios y turnos correspondientes. Las citas existentes se actualizan y las nuevas se insertan.

La integración con la API real de SIHCE está pendiente de disponer del acceso necesario.

Los datos de PostgreSQL se conservan en el volumen persistente cuando se detienen los servicios con `docker compose down`. No ejecutar `docker compose down -v` si se desea conservar la base de datos.

## Seguridad

- Utilizar únicamente datos ficticios en el archivo JSON de pruebas.
- Restringir el acceso a la aplicación según las políticas de seguridad de la organización.