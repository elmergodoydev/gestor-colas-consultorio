
from django.db import models
import hashlib
import secrets


class Establecimiento(models.Model):
    codigo_renipress = models.CharField(max_length=20, unique=True)
    nombre_ipress = models.CharField(max_length=200)

    class Meta:
        ordering = ["nombre_ipress"]
        verbose_name = "Establecimiento"
        verbose_name_plural = "Establecimientos"

    def __str__(self):
        return f"{self.codigo_renipress} - {self.nombre_ipress}"


class ConfiguracionIPRESS(models.Model):
    # Solo habrá una configuración activa identificada por "principal".
    clave = models.CharField(
        max_length=30,
        unique=True,
        default="principal",
        editable=False,
    )

    establecimiento = models.ForeignKey(
        Establecimiento,
        on_delete=models.PROTECT,
        related_name="configuraciones_sistema",
    )

    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Configuración de IPRESS"
        verbose_name_plural = "Configuración de IPRESS"

    def __str__(self):
        return (
            f"{self.clave} - "
            f"{self.establecimiento.codigo_renipress}"
        )



class Consultorio(models.Model):
    establecimiento = models.ForeignKey(
        Establecimiento,
        on_delete=models.PROTECT,
        related_name="consultorios",
    )

    codigo = models.CharField(max_length=50)
    nombre = models.CharField(max_length=150)

    codigo_ambiente = models.CharField(max_length=50)
    nombre_ambiente = models.CharField(max_length=150)
    piso_ambiente = models.CharField(max_length=100)

    codigo_servicio = models.CharField(max_length=50)
    nombre_servicio = models.CharField(max_length=200)

    class Meta:
        ordering = ["nombre"]
        constraints = [
            models.UniqueConstraint(
                fields=["establecimiento", "codigo"],
                name="uq_consultorio_ipress_codigo",
            )
        ]
        verbose_name = "Consultorio"
        verbose_name_plural = "Consultorios"

    def __str__(self):
        return f"{self.codigo} - {self.nombre}"


class Cita(models.Model):
    establecimiento = models.ForeignKey(
        Establecimiento,
        on_delete=models.PROTECT,
        related_name="citas",
    )

    id_sihce = models.CharField(max_length=100)

    consultorio = models.ForeignKey(
        Consultorio,
        on_delete=models.PROTECT,
        related_name="citas",
    )

    fecha_cita = models.DateField()
    hora_cita = models.TimeField()
    estado_sihce = models.CharField(max_length=50)

    dni_paciente = models.CharField(max_length=20)
    nombres_paciente = models.CharField(max_length=150)
    apellido_paterno_paciente = models.CharField(max_length=100)
    apellido_materno_paciente = models.CharField(max_length=100)

    dni_profesional = models.CharField(max_length=20)
    nombre_profesional = models.CharField(max_length=150)

    class Meta:
        ordering = ["fecha_cita", "hora_cita"]
        constraints = [
            models.UniqueConstraint(
                fields=["establecimiento", "id_sihce"],
                name="uq_cita_ipress_id_sihce",
            )
        ]
        indexes = [
            models.Index(
                fields=["establecimiento", "fecha_cita"],
                name="idx_cita_ipress_fecha",
            ),
            models.Index(
                fields=["consultorio", "fecha_cita"],
                name="idx_cita_cons_fecha",
            ),
        ]
        verbose_name = "Cita"
        verbose_name_plural = "Citas"

    def __str__(self):
        return f"{self.id_sihce} - {self.fecha_cita} {self.hora_cita}"


class Turno(models.Model):
    class Estado(models.TextChoices):
        EN_ESPERA = "EN_ESPERA", "En espera"
        LLAMANDO = "LLAMANDO", "Llamando"
        ATENDIDO = "ATENDIDO", "Atendido"
        NO_PRESENTADO = "NO_PRESENTADO", "No presentado"
        CANCELADO = "CANCELADO", "Cancelado"

    establecimiento = models.ForeignKey(
        Establecimiento,
        on_delete=models.PROTECT,
        related_name="turnos",
    )

    consultorio = models.ForeignKey(
        Consultorio,
        on_delete=models.PROTECT,
        related_name="turnos",
    )

    cita = models.OneToOneField(
        Cita,
        on_delete=models.PROTECT,
        related_name="turno",
    )

    codigo = models.CharField(max_length=3)
    fecha = models.DateField()
    estado = models.CharField(
        max_length=20,
        choices=Estado.choices,
        default=Estado.EN_ESPERA,
    )

    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["creado_en"]
        constraints = [
            models.UniqueConstraint(
                fields=["establecimiento", "fecha", "codigo"],
                name="uq_turno_ipress_fecha_codigo",
            )
        ]
        indexes = [
            models.Index(
                fields=["consultorio", "fecha", "estado"],
                name="idx_turno_cons_fecha_estado",
            )
        ]
        verbose_name = "Turno"
        verbose_name_plural = "Turnos"

    def __str__(self):
        return f"{self.codigo} - {self.estado}"



class EventoLlamado(models.Model):
    class Tipo(models.TextChoices):
        LLAMADO = "LLAMADO", "Llamado"
        RE_LLAMADO = "RE_LLAMADO", "Volver a llamar"
        ATENDIDO = "ATENDIDO", "Atendido"
        NO_PRESENTADO = "NO_PRESENTADO", "No presentado"
        CANCELADO = "CANCELADO", "Cancelado"

    turno = models.ForeignKey(
        Turno,
        on_delete=models.PROTECT,
        related_name="eventos",
    )

    tipo = models.CharField(
        max_length=20,
        choices=Tipo.choices,
    )

    fecha_evento = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["fecha_evento"]
        verbose_name = "Evento de llamado"
        verbose_name_plural = "Eventos de llamados"

    def __str__(self):
        return f"{self.turno.codigo} - {self.get_tipo_display()}"



class Sincronizacion(models.Model):
    establecimiento = models.ForeignKey(
        Establecimiento,
        on_delete=models.PROTECT,
        related_name="sincronizaciones",
    )

    fecha_sincronizacion = models.DateTimeField(auto_now_add=True)
    exitosa = models.BooleanField(default=False)
    cantidad_citas_procesadas = models.PositiveIntegerField(default=0)
    detalle_error = models.TextField(blank=True)

    class Meta:
        ordering = ["-fecha_sincronizacion"]
        verbose_name = "Sincronización"
        verbose_name_plural = "Sincronizaciones"

    def __str__(self):
        return (
            f"{self.establecimiento.codigo_renipress} - "
            f"{self.fecha_sincronizacion}"
        )


class CodigoActivacion(models.Model):
    establecimiento = models.ForeignKey(
        Establecimiento,
        on_delete=models.PROTECT,
        related_name="codigos_activacion",
    )
    consultorio = models.ForeignKey(
        Consultorio,
        on_delete=models.PROTECT,
        related_name="codigos_activacion",
    )
    codigo_hash = models.CharField(max_length=64, unique=True)
    expira_en = models.DateTimeField()
    utilizado_en = models.DateTimeField(null=True, blank=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-creado_en"]
        verbose_name = "Código de activación"
        verbose_name_plural = "Códigos de activación"

    @staticmethod
    def generar_codigo():
        # Ejemplo: A8F3-7K2D
        caracteres = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        codigo = "".join(
            secrets.choice(caracteres) for _ in range(8)
        )
        return f"{codigo[:4]}-{codigo[4:]}"

    @staticmethod
    def calcular_hash(codigo):
        return hashlib.sha256(
            codigo.strip().upper().encode("utf-8")
        ).hexdigest()

    def __str__(self):
        return (
            f"{self.consultorio.codigo} - "
            f"{self.creado_en:%Y-%m-%d %H:%M}"
        )



class EquipoActivado(models.Model):
    establecimiento = models.ForeignKey(
        Establecimiento,
        on_delete=models.PROTECT,
        related_name="equipos_activados",
    )
    consultorio = models.ForeignKey(
        Consultorio,
        on_delete=models.PROTECT,
        related_name="equipos_activados",
    )
    identificador_equipo = models.UUIDField(unique=True)
    token_hash = models.CharField(max_length=64, unique=True,null=True,blank=True,)
    nombre_equipo = models.CharField(max_length=100, blank=True)
    activo = models.BooleanField(default=True)
    activado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["consultorio__nombre"]
        verbose_name = "Equipo activado"
        verbose_name_plural = "Equipos activados"

    def __str__(self):
        return (
            f"{self.consultorio.codigo} - "
            f"{self.identificador_equipo}"
        )

