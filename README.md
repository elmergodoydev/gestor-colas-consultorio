# Gestor de Colas de Consultorios

Aplicación web para gestionar los llamados y visualizar la atención por consultorio. Utiliza React, Django, PostgreSQL y Docker Compose.

> **Nota:** actualmente se usan archivos JSON ficticios para las citas y el catálogo de consultorios. La integración con la API oficial de SIHCE está pendiente.

## Requisitos

- Acceso al repositorio de GitLab desde una computadora con Git.
- Windows con OpenSSH (`scp`) y `tar`, para transferir el proyecto si el servidor no puede acceder a GitLab.
- Servidor Linux con Docker Engine y Docker Compose v2.
- Conectividad de red al servidor y un puerto disponible para la aplicación.

## 1. Descargar el proyecto en Windows

Clonar el repositorio (si todavía no está descargado):

```powershell
git clone --branch develop https://git.minsa.gob.pe/interoperabilidad/gestor-colas-consultorios.git gestor-colas
```

## 2. Empaquetar y copiarlo al servidor

Desde PowerShell, sustituir la ruta por la carpeta donde se descargó el proyecto:

```powershell
tar.exe -czf "$env:USERPROFILE\Desktop\gestor-colas.tar.gz" -C "C:\RUTA\AL\PROYECTO" .
```

En el servidor, crear la carpeta de destino (se puede ejecutar por SSH):

```bash
mkdir -p ~/apps
```

Desde PowerShell, transferir el archivo. Sustituir `USUARIO` e `IP_SERVIDOR` por los valores del servidor:

```powershell
scp "$env:USERPROFILE\Desktop\gestor-colas.tar.gz" USUARIO@IP_SERVIDOR:/home/USUARIO/apps/
```

## 3. Extraer el proyecto en el servidor

Conectarse por SSH y ejecutar:

```bash
mkdir -p ~/apps/gestor-colas-sihce
tar -xzf ~/apps/gestor-colas.tar.gz -C ~/apps/gestor-colas
cd ~/apps/gestor-colas
```

## 4. Configurar el entorno

Crear y editar el archivo `.env`:

```bash
cp .env.example .env
nano .env
```

Configurar estos valores según el servidor:

```dotenv
APP_BIND_IP=0.0.0.0
APP_PORT=8091
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,IP_SERVIDOR
DJANGO_CSRF_TRUSTED_ORIGINS=http://IP_SERVIDOR:8091
```

Reemplazar `IP_SERVIDOR` por la IP real del servidor. Configurar también las credenciales de PostgreSQL y `DJANGO_SECRET_KEY`. Usar contraseñas fuertes y una clave secreta única. No subir ni compartir el archivo `.env`.

## 5. Construir e iniciar la aplicación

Ejecutar desde `~/apps/gestor-colas`:

```bash
docker compose build
docker compose up -d
docker compose run --rm backend python manage.py migrate
docker compose run --rm backend python manage.py collectstatic --noinput
```

## 6. Configuración inicial y datos de prueba

1. Abrir `http://IP_SERVIDOR:8091` desde un equipo de la red.
2. En la sección **IPRESS**, registrar el establecimiento de prueba con RENIPRESS `00005933` y nombre `C.S. ALFA Y OMEGA`.
3. Entrar en la sección de consultorios de esa IPRESS y sincronizar el catálogo de prueba.
4. Importar las citas ficticias:

   ```bash
   docker compose run --rm backend python manage.py importar_citas_json
   ```

5. Activar los equipos en este orden:

   **a. Activar la computadora de consultorio**
   - En la administración de consultorios, generar un código de activación para el equipo.
   - En esa computadora, abrir `http://IP_SERVIDOR:8091/consultorio` e introducir el código.

   **b. Registrar y activar el monitor de TV**
   - En la administración de monitores, registrar el monitor, asignarle los consultorios correspondientes y generar su código de activación.
   - En la pantalla de TV, abrir `http://IP_SERVIDOR:8091/pantalla` e introducir el código.

El archivo `backend/data/citas_sihce_prueba.json` contiene citas ficticias.

