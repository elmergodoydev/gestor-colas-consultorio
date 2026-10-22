# Gestor de Colas de Consultorios - SIHCE

Sistema web para gestionar los llamados y visualizar la atención por consultorio. La aplicación está compuesta por un frontend React, un backend Django y una base de datos PostgreSQL, desplegados mediante Docker Compose.

> **Estado de la integración SIHCE:** actualmente se utilizan archivos JSON ficticios para el catálogo de la IPRESS y las citas. La conexión con la API oficial de SIHCE queda pendiente de contar con las credenciales, documentación y autorización correspondientes.

## 1. Arquitectura y tecnologías

- **Frontend:** React, Vite y Material UI.
- **Backend:** Django y Django REST Framework.
- **Base de datos:** PostgreSQL.
- **Servidor web:** Nginx (según la configuración Docker del proyecto).
- **Despliegue:** Docker Engine y Docker Compose v2.
- **Datos de prueba:** archivos JSON ubicados en `backend/data/`.

## 2. Requisitos del servidor

- Git y acceso al repositorio de GitLab.
- Docker Engine (Linux) o Docker Desktop (Windows).
- Docker Compose v2 (`docker compose`, con espacio).
- Acceso a la red donde se utilizará la aplicación.
- Puerto TCP seleccionado para la aplicación, permitido por el firewall únicamente a los clientes autorizados.

En un servidor Linux, verificar la instalación:

```bash
docker --version
docker compose version
```

## 3. Clonar el repositorio

```bash
git clone https://git.minsa.gob.pe/interoperabilidad/gestor-colas-consultorios.git
cd gestor-colas-consultorios
```

Se necesita permiso de acceso al repositorio de GitLab.

## 4. Configurar las variables de entorno

Crear el archivo `.env` a partir de la plantilla:

**Linux:**

```bash
cp .env.example .env
```

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

Editar `.env` y establecer los valores de base de datos, clave secreta de Django y demás opciones definidas en `.env.example`. No publicar ni enviar este archivo al repositorio.

Los valores de `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD` deben coincidir con `DB_NAME`, `DB_USER` y `DB_PASSWORD`, respectivamente.

### Dirección y puerto de acceso

Para probar únicamente desde el mismo servidor, la configuración puede ser:

```dotenv
APP_BIND_IP=127.0.0.1
APP_PORT=8088
```

Para que otras computadoras de la red local accedan a la aplicación, configurar la dirección de publicación para todas las interfaces de red:

```dotenv
APP_BIND_IP=0.0.0.0
APP_PORT=8088
```

`0.0.0.0` permite publicar el puerto en las interfaces del servidor; no es la dirección que se escribe en el navegador. Configurar el firewall para permitir el puerto `8088` únicamente desde la red autorizada. No exponerlo directamente a Internet sin controles de seguridad y HTTPS.

## 5. Construir las imágenes

Desde la raíz del repositorio:

```bash
docker compose build
```

## 6. Iniciar PostgreSQL

```bash
docker compose up -d db
docker compose ps
```

Verificar que el servicio `db` esté en ejecución antes de continuar.

## 7. Ejecutar las migraciones de Django

```bash
docker compose run --rm backend python manage.py migrate
```

## 8. Recopilar archivos estáticos

```bash
docker compose run --rm backend python manage.py collectstatic --noinput
```

## 9. Iniciar la aplicación

```bash
docker compose up -d backend frontend
docker compose ps
```

Consultar los registros si algún servicio no inicia:

```bash
docker compose logs --tail=100 backend
docker compose logs --tail=100 frontend
docker compose logs --tail=100 db
```

## 10. Acceder desde el navegador

Desde el mismo servidor, si se configuró `APP_BIND_IP=127.0.0.1`:

- Aplicación: `http://127.0.0.1:8088`

Desde otra computadora de la red, si se configuró `APP_BIND_IP=0.0.0.0`:

- Aplicación: `http://IP_DEL_SERVIDOR:8088`

Reemplazar `IP_DEL_SERVIDOR` por la dirección IP real del servidor. Comprobar que el firewall permita la conexión desde la red de pruebas.

## 11. Configuración inicial de la IPRESS y consultorios

Después de iniciar los servicios:

1. Abrir la sección **IPRESS** (`/ipress`) y registrar o seleccionar el establecimiento de prueba.
2. Entrar a `/ipress/<id>/consultorios`, sustituyendo `<id>` por el identificador de la IPRESS. Sincronizar el catálogo de consultorios de prueba.
3. Entrar a `/ipress/<id>/monitores` para registrar los monitores y asignarles los consultorios que deben mostrar.
4. Usar la sección de videos (`/videos`) para administrar la biblioteca de videos, si corresponde.

El catálogo local de prueba se encuentra en `backend/data/ipress_sihce_prueba.json`. Actualmente contempla estos tres consultorios de prueba:

- `CONS-MED-01` — Consultorio Medicina 01.
- `CONS-MED-02` — Consultorio Medicina 02.
- `CONS-ODO-01` — Consultorio Odontología 01.

### Activar la computadora de ventanilla

Desde la administración de consultorios, generar un código de activación para el consultorio que utilizará esa computadora. Abrir `/consultorio` en la computadora correspondiente e introducir el código. Después de la activación se mostrará la pantalla operativa de ventanilla.

### Activar una pantalla de monitor

Desde `/ipress/<id>/monitores`, registrar el monitor, asignarle uno o más consultorios y generar un código de activación. En la pantalla que se utilizará para mostrar los llamados, abrir `/monitor` e introducir dicho código. Cada monitor debe tener asignaciones y activación propias.

## 12. Citas de prueba

Las citas ficticias se encuentran en:

```text 
backend/data/citas_sihce_prueba.json
```

El archivo de prueba preparado para este entorno incluye citas entre el **22 y el 30 de octubre de 2026**, con seis citas por consultorio por día (tres consultorios, 162 citas en total). Los identificadores de las citas son únicos para evitar conflictos al importarlas.

Las vistas operativas filtran las citas por la fecha actual. Por tanto, en una fecha fuera del intervalo del archivo, las citas de prueba pueden no aparecer. Para repetir pruebas en otra fecha, actualizar las fechas del fixture antes de importarlo.

### Importar o sincronizar citas sin reiniciar todos los datos

Cuando solo se necesita volver a importar las citas del JSON:

```bash
docker compose run --rm backend python manage.py importar_citas_json
```

### Reiniciar los datos operativos de prueba

El proyecto dispone del comando `reiniciar_datos_prueba`, que limpia los datos operativos de prueba, restablece los registros de prueba que administra y vuelve a importar las citas del JSON:

```bash
docker compose run --rm backend python manage.py reiniciar_datos_prueba --confirmar
```

**Advertencia:** este comando elimina registros operativos, incluyendo turnos, eventos y activaciones de equipos/monitores según la implementación actual. Debe usarse únicamente en el entorno de pruebas. Tras reiniciarlo, será necesario generar nuevos códigos y activar nuevamente las pantallas.

## 13. Actualizar una instalación existente

Después de obtener los cambios del repositorio, desde la raíz del proyecto:

```bash
git pull
docker compose build
docker compose up -d db
docker compose run --rm backend python manage.py migrate
docker compose run --rm backend python manage.py collectstatic --noinput
docker compose up -d backend frontend
docker compose ps
```

Revisar los registros si hay problemas:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

Antes de actualizar, conservar una copia de seguridad de la base de datos y del archivo `.env` en un lugar seguro.

## 14. Persistencia de la base de datos

Los datos PostgreSQL se conservan en el volumen persistente de Docker cuando se detienen los servicios con:

```bash
docker compose down
```

No ejecutar `docker compose down -v` salvo que se desee eliminar deliberadamente los volúmenes, ya que puede borrar la base de datos persistente.

## 15. Seguridad y alcance

- Utilizar únicamente datos ficticios en los archivos JSON de prueba.
- No guardar contraseñas ni claves secretas en el repositorio.
- Restringir el puerto de la aplicación a las redes autorizadas.
- Para uso fuera de una red controlada, implementar HTTPS y los controles de seguridad institucionales antes de exponer el servicio.
- La integración con la API real de SIHCE está pendiente; los datos del fixture JSON no representan información consultada en tiempo real desde SIHCE.
