
import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import api from "../services/api";

export default function Configuracion() {
  const [renipress, setRenipress] = useState("");
  const [nombreIPRESS, setNombreIPRESS] = useState("");
  const [consultorios, setConsultorios] = useState([]);
  const [consultorioCodigo, setConsultorioCodigo] = useState("");
  const [validado, setValidado] = useState(false);

  const [cargando, setCargando] = useState(false);
  const [generandoCodigo, setGenerandoCodigo] = useState(false);
  const [codigoActivacion, setCodigoActivacion] = useState(null);

  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const consultorioSeleccionado = consultorios.find(
    (item) => item.codigo === consultorioCodigo
  );

  // Recupera la IPRESS guardada y sus consultorios al abrir Configuración.
  useEffect(() => {
    let cancelado = false;

    async function cargarConfiguracion() {
      try {
        const respuesta = await api.get("configuracion/ipress/");
        const configuracion = respuesta.data;

        if (
          cancelado ||
          !configuracion?.configurada ||
          !configuracion.establecimiento
        ) {
          return;
        }

        const establecimiento = configuracion.establecimiento;
        const codigo = establecimiento.codigo_renipress;

        setRenipress(codigo);
        setNombreIPRESS(establecimiento.nombre_ipress);

        const respuestaConsultorios = await api.get("consultorios/", {
          params: { renipress: codigo },
        });

        if (cancelado) return;

        const lista = Array.isArray(respuestaConsultorios.data)
          ? respuestaConsultorios.data
          : respuestaConsultorios.data.results ?? [];

        setConsultorios(lista);
        setValidado(true);

        setMensaje(
          lista.length > 0
            ? `Configuración cargada. Se encontraron ${lista.length} consultorio(s).`
            : "La IPRESS está guardada, pero todavía no tiene consultorios registrados."
        );
      } catch (err) {
        if (cancelado) return;

        console.error("Error al cargar la configuración:", err);
        setError(
          "No se pudo recuperar la configuración guardada. Verifica que Django esté ejecutándose."
        );
      }
    }

    cargarConfiguracion();

    return () => {
      cancelado = true;
    };
  }, []);

  function limpiarSeleccion() {
    setValidado(false);
    setConsultorios([]);
    setConsultorioCodigo("");
    setCodigoActivacion(null);
    setMensaje("");
    setError("");
  }

  async function validarIPRESS() {
    const codigo = renipress.trim();
    const nombre = nombreIPRESS.trim();

    if (!codigo) {
      setError("Ingresa el código RENIPRESS.");
      return;
    }

    setCargando(true);
    limpiarSeleccion();

    try {
      // Guarda la selección activa y registra la IPRESS si aún no existe.
      const respuestaConfiguracion = await api.post(
        "configuracion/ipress/",
        {
          codigo_renipress: codigo,
          nombre_ipress: nombre,
        }
      );

      const establecimiento =
        respuestaConfiguracion.data.establecimiento;

      setRenipress(establecimiento.codigo_renipress);
      setNombreIPRESS(establecimiento.nombre_ipress);

      // Recupera los consultorios asociados a esa IPRESS.
      const respuestaConsultorios = await api.get("consultorios/", {
        params: {
          renipress: establecimiento.codigo_renipress,
        },
      });

      const lista = Array.isArray(respuestaConsultorios.data)
        ? respuestaConsultorios.data
        : respuestaConsultorios.data.results ?? [];

      setConsultorios(lista);
      setValidado(true);

      setMensaje(
        lista.length > 0
          ? `IPRESS guardada y seleccionada. Se encontraron ${lista.length} consultorio(s).`
          : "IPRESS guardada y seleccionada. Aún no hay consultorios registrados para este establecimiento."
      );
    } catch (err) {
      console.error("Error al guardar la IPRESS:", err);

      const detalle = err.response?.data;
      let mensajeError = "No se pudo guardar o validar la IPRESS.";

      if (typeof detalle?.detail === "string") {
        mensajeError = detalle.detail;
      } else if (detalle && typeof detalle === "object") {
        mensajeError = Object.entries(detalle)
          .map(([campo, valor]) => {
            const texto = Array.isArray(valor)
              ? valor.join(" ")
              : String(valor);

            return `${campo}: ${texto}`;
          })
          .join(" · ");
      }

      setError(mensajeError);
    } finally {
      setCargando(false);
    }
  }

  async function generarCodigoActivacion() {
    if (!validado || !consultorioCodigo) {
      setError("Guarda la IPRESS y selecciona un consultorio.");
      return;
    }

    setGenerandoCodigo(true);
    setError("");
    setMensaje("");
    setCodigoActivacion(null);

    try {
      const respuesta = await api.post("activaciones/generar/", {
        renipress: renipress.trim(),
        codigo_consultorio: consultorioCodigo,
        nombre_equipo: "",
      });

      setCodigoActivacion(respuesta.data);
      setMensaje(
        "Código generado correctamente. Entrégalo al profesional para activar su computadora."
      );
    } catch (err) {
      const detalle = err.response?.data;

      setError(
        typeof detalle?.detail === "string"
          ? detalle.detail
          : typeof detalle === "object"
            ? JSON.stringify(detalle)
            : "No se pudo generar el código de activación."
      );
    } finally {
      setGenerandoCodigo(false);
    }
  }

  async function copiarCodigo() {
    if (!codigoActivacion?.codigo) return;

    try {
      await navigator.clipboard.writeText(codigoActivacion.codigo);
      setMensaje("Código copiado al portapapeles.");
    } catch {
      setError(
        "No se pudo copiar automáticamente. Selecciona y copia el código manualmente."
      );
    }
  }

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography
            variant="overline"
            color="primary"
            fontWeight={700}
          >
            GESTOR DE COLAS · SIHCE
          </Typography>

          <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
            Configuración del establecimiento
          </Typography>

          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Registra la IPRESS activa, consulta sus consultorios y
            genera códigos para activar las computadoras del personal.
          </Typography>
        </Box>

        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: { xs: 2.5, md: 4 } }}>
            <Stack spacing={3}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <BusinessOutlinedIcon color="primary" fontSize="large" />
                <Box>
                  <Typography variant="h6" fontWeight={600}>
                    1. Identificar IPRESS
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Los datos se guardan en PostgreSQL y se recuperan al
                    volver a entrar en esta pantalla.
                  </Typography>
                </Box>
              </Stack>

              <TextField
                label="Código RENIPRESS"
                value={renipress}
                onChange={(event) => {
                  setRenipress(event.target.value);
                  limpiarSeleccion();
                }}
                fullWidth
                inputProps={{ maxLength: 20 }}
                placeholder="Ej. 00005644"
                helperText="Introduce el código del establecimiento."
              />

              <TextField
                label="Nombre de la IPRESS"
                value={nombreIPRESS}
                onChange={(event) => {
                  setNombreIPRESS(event.target.value);
                  limpiarSeleccion();
                }}
                fullWidth
                inputProps={{ maxLength: 200 }}
                placeholder="Ej. C.M.I. RÍMAC"
                helperText="Necesario para registrar una IPRESS nueva. Si ya existe, puedes conservar su nombre."
              />

              <Button
                variant="contained"
                onClick={validarIPRESS}
                disabled={!renipress.trim() || cargando}
                sx={{ minHeight: 52 }}
              >
                {cargando ? (
                  <CircularProgress size={22} color="inherit" />
                ) : (
                  "Guardar y validar IPRESS"
                )}
              </Button>

              {error && <Alert severity="error">{error}</Alert>}

              {mensaje && (
                <Alert severity={error ? "error" : "success"}>
                  {mensaje}
                </Alert>
              )}

              <Box>
                <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
                  2. Seleccionar consultorio
                </Typography>

                <TextField
                  select
                  fullWidth
                  label="Consultorio"
                  value={consultorioCodigo}
                  onChange={(event) => {
                    setConsultorioCodigo(event.target.value);
                    setCodigoActivacion(null);
                    setMensaje("");
                    setError("");
                  }}
                  disabled={!validado || consultorios.length === 0}
                  helperText={
                    validado
                      ? "Selecciona el consultorio que deseas activar."
                      : "Primero guarda y valida la IPRESS."
                  }
                >
                  {consultorios.map((consultorio) => (
                    <MenuItem
                      key={consultorio.id}
                      value={consultorio.codigo}
                    >
                      {consultorio.codigo} — {consultorio.nombre}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>

              {consultorioSeleccionado && (
                <Box
                  sx={{
                    p: 2,
                    bgcolor: "action.hover",
                    borderRadius: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Ambiente
                  </Typography>
                  <Typography fontWeight={500}>
                    {consultorioSeleccionado.nombre_ambiente ||
                      "No registrado"}
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 1 }}
                  >
                    Servicio
                  </Typography>
                  <Typography fontWeight={500}>
                    {consultorioSeleccionado.nombre_servicio ||
                      "No registrado"}
                  </Typography>
                </Box>
              )}

              <Button
                variant="contained"
                size="large"
                onClick={generarCodigoActivacion}
                disabled={
                  !validado ||
                  !consultorioCodigo ||
                  generandoCodigo
                }
              >
                {generandoCodigo ? (
                  <CircularProgress size={22} color="inherit" />
                ) : (
                  "Generar código de activación"
                )}
              </Button>

              {codigoActivacion && (
                <Card
                  variant="outlined"
                  sx={{
                    borderRadius: 3,
                    borderColor: "success.main",
                    bgcolor: "background.paper",
                  }}
                >
                  <CardContent>
                    <Stack spacing={2} alignItems="center">
                      <Typography
                        variant="overline"
                        color="success.main"
                        fontWeight={700}
                      >
                        CÓDIGO GENERADO
                      </Typography>

                      <Typography
                        variant="h3"
                        fontWeight={800}
                        textAlign="center"
                        sx={{
                          letterSpacing: { xs: 2, sm: 5 },
                          overflowWrap: "anywhere",
                        }}
                      >
                        {codigoActivacion.codigo}
                      </Typography>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                        textAlign="center"
                      >
                        {codigoActivacion.establecimiento.nombre_ipress}
                      </Typography>

                      <Typography fontWeight={600} textAlign="center">
                        {codigoActivacion.consultorio.codigo} —{" "}
                        {codigoActivacion.consultorio.nombre}
                      </Typography>

                      <Typography variant="body2" color="text.secondary">
                        Vence:{" "}
                        {new Date(
                          codigoActivacion.expira_en
                        ).toLocaleString()}
                      </Typography>

                      <Button
                        variant="outlined"
                        startIcon={<ContentCopyOutlinedIcon />}
                        onClick={copiarCodigo}
                      >
                        Copiar código
                      </Button>

                      <Alert severity="warning" sx={{ width: "100%" }}>
                        El código vence en 30 minutos y solo puede
                        utilizarse una vez. Entrégalo únicamente al
                        profesional autorizado para este consultorio.
                      </Alert>
                    </Stack>
                  </CardContent>
                </Card>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Typography variant="caption" color="text.secondary">

        </Typography>
      </Stack>
    </Container>
  );
}
