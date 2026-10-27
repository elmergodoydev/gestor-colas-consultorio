import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import MedicalServicesOutlinedIcon from "@mui/icons-material/MedicalServicesOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ComputerOutlinedIcon from "@mui/icons-material/ComputerOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";

import api from "../services/api";

function obtenerLista(respuesta) {
  if (Array.isArray(respuesta)) {
    return respuesta;
  }

  if (Array.isArray(respuesta?.results)) {
    return respuesta.results;
  }

  return [];
}

function obtenerMensajeError(error, predeterminado) {
  const datos = error.response?.data;

  if (typeof datos?.mensaje === "string") {
    return datos.mensaje;
  }

  if (typeof datos?.detail === "string") {
    return datos.detail;
  }

  if (typeof datos?.detalle === "string") {
    return datos.detalle;
  }

  if (datos && typeof datos === "object") {
    return Object.entries(datos)
      .map(([campo, valor]) => {
        const contenido = Array.isArray(valor)
          ? valor.join(", ")
          : String(valor);

        return `${campo}: ${contenido}`;
      })
      .join(" · ");
  }

  return predeterminado;
}

function formatoFecha(fecha) {
  if (!fecha) {
    return "No disponible";
  }

  const fechaConvertida = new Date(fecha);

  if (Number.isNaN(fechaConvertida.getTime())) {
    return "No disponible";
  }

  return fechaConvertida.toLocaleString("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ConsultoriosAdmin() {
  const { id } = useParams();

  const [establecimiento, setEstablecimiento] = useState(null);
  const [consultorios, setConsultorios] = useState([]);
  const [equipos, setEquipos] = useState([]);

  const [codigoConsultorio, setCodigoConsultorio] = useState("");
  const [codigoGenerado, setCodigoGenerado] = useState(null);

  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [cargandoEquipos, setCargandoEquipos] = useState(false);

  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [mensajeCodigo, setMensajeCodigo] = useState("");

  const consultorioSeleccionado = useMemo(
    () =>
      consultorios.find(
        (consultorio) => consultorio.codigo === codigoConsultorio
      ) ?? null,
    [consultorios, codigoConsultorio]
  );

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError("");

    try {
      const respuestaIPRESS = await api.get("ipress/");
      const listaIPRESS = obtenerLista(respuestaIPRESS.data);

      const ipressSeleccionada = listaIPRESS.find(
        (item) => String(item.id) === String(id)
      );

      if (!ipressSeleccionada) {
        setEstablecimiento(null);
        setConsultorios([]);
        setEquipos([]);
        setError("No se encontró la IPRESS seleccionada.");
        return;
      }

      setEstablecimiento(ipressSeleccionada);

      // El catálogo visible se obtiene del proveedor mediante el endpoint
      // de sincronización; no se construye leyendo la lista de PostgreSQL.
      const [respuestaCatalogo, respuestaEquipos] = await Promise.all([
        api.post(`ipress/${id}/consultorios/sincronizar/`),
        api.get(`ipress/${id}/equipos-activados/`),
      ]);

      const listaConsultorios = obtenerLista(
        respuestaCatalogo.data?.consultorios
      );

      setConsultorios(listaConsultorios);
      setEquipos(respuestaEquipos.data?.equipos ?? []);

      setCodigoConsultorio((seleccionActual) =>
        listaConsultorios.some(
          (item) => item.codigo === seleccionActual
        )
          ? seleccionActual
          : ""
      );
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          "No se pudo cargar la información de la IPRESS."
        )
      );
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  async function actualizarCatalogo() {
    if (!establecimiento) {
      return;
    }

    setSincronizando(true);
    setError("");
    setMensaje("");
    setCodigoGenerado(null);
    setMensajeCodigo("");

    try {
      const respuestaSincronizacion = await api.post(
        `ipress/${id}/consultorios/sincronizar/`
      );

      const respuestaEquipos = await api.get(
        `ipress/${id}/equipos-activados/`
      );

      // La lista mostrada procede de la respuesta del catálogo de la API,
      // no de GET /consultorios/ (que devuelve registros de PostgreSQL).
      const listaConsultorios = obtenerLista(
        respuestaSincronizacion.data?.consultorios
      );

      setConsultorios(listaConsultorios);
      setEquipos(respuestaEquipos.data?.equipos ?? []);

      setCodigoConsultorio((seleccionActual) =>
        listaConsultorios.some(
          (item) => item.codigo === seleccionActual
        )
          ? seleccionActual
          : ""
      );

      const datos = respuestaSincronizacion.data;

      const cantidadConsultorios = Array.isArray(datos.consultorios)
        ? datos.consultorios.length
        : Number(datos.total ?? listaConsultorios.length);

      setMensaje(
        `Catálogo actualizado: ${cantidadConsultorios} consultorios.`
      );
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          "No se pudo actualizar el catálogo de consultorios."
        )
      );
    } finally {
      setSincronizando(false);
    }
  }

  async function actualizarEquipos() {
    setCargandoEquipos(true);
    setError("");

    try {
      const respuesta = await api.get(
        `ipress/${id}/equipos-activados/`
      );

      setEquipos(respuesta.data?.equipos ?? []);
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          "No se pudo consultar la lista de equipos activados."
        )
      );
    } finally {
      setCargandoEquipos(false);
    }
  }

  async function generarCodigo() {
    if (!establecimiento || !consultorioSeleccionado) {
      setError("Selecciona un consultorio para generar el código.");
      return;
    }

    setGenerando(true);
    setError("");
    setMensaje("");
    setCodigoGenerado(null);
    setMensajeCodigo("");

    try {
      const respuesta = await api.post("activaciones/generar/", {
        renipress: establecimiento.codigo_renipress,
        codigo_consultorio: consultorioSeleccionado.codigo,
        nombre_equipo: "",
      });

      setCodigoGenerado(respuesta.data);
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          "No se pudo generar el código de activación."
        )
      );
    } finally {
      setGenerando(false);
    }
  }

  async function copiarCodigo() {
    if (!codigoGenerado?.codigo) {
      return;
    }

    try {
      await navigator.clipboard.writeText(codigoGenerado.codigo);
      setMensajeCodigo("Código copiado al portapapeles.");
    } catch {
      setMensajeCodigo(
        "No se pudo copiar automáticamente. Selecciona el código y cópialo."
      );
    }
  }

  if (cargando) {
    return (
      <Box
        sx={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "#f8fafc",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!establecimiento) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          {error || "No se encontró la IPRESS."}
        </Alert>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: "100%",
        minWidth: 0,
        minHeight: "100vh",
        bgcolor: "#f8fafc",
      }}
    >
      <Box
        sx={{
          width: "100%",
          px: { xs: 2, sm: 3, lg: 4 },
          py: { xs: 3, md: 4 },
        }}
      >
        <Stack spacing={3}>
          {/* Encabezado de la IPRESS */}
          <Box>
            <Typography
              variant="h4"
              fontWeight={700}
              sx={{
                mt: 0.5,
                color: "#0f172a",
                fontSize: { xs: 27, md: 32 },
              }}
            >
              Consultorios
            </Typography>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ 
                alignItems: { xs: "flex-start", sm: "center" },
                mt: 1
               }}
            >
              <BusinessOutlinedIcon
                sx={{ color: "#64748b", fontSize: 20 }}
              />

              <Typography color="text.secondary">
                {establecimiento.nombre_ipress}
              </Typography>

              <Chip
                label={`RENIPRESS: ${establecimiento.codigo_renipress}`}
                variant="outlined"
                size="small"
                sx={{
                  borderColor: "#cbd5e1",
                  bgcolor: "#fff",
                }}
              />
            </Stack>
          </Box>

          {error && (
            <Alert
              severity="error"
              onClose={() => setError("")}
              sx={{ borderRadius: 2 }}
            >
              {error}
            </Alert>
          )}

          {mensaje && (
            <Alert
              severity="success"
              onClose={() => setMensaje("")}
              sx={{ borderRadius: 2 }}
            >
              {mensaje}
            </Alert>
          )}

          {/* Catálogo y actualización */}
          <Card
            variant="outlined"
            sx={{
              borderColor: "#e2e8f0",
              borderRadius: 3,
              boxShadow: "none",
            }}
          >
            <CardContent sx={{ p: { xs: 2, md: 3 } }}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{
                  alignItems: { xs: "stretch", sm: "center" },
                  justifyContent: "space-between",
                }}
              >
                <Stack direction="row" spacing={1.5} sx={{alignItems: "center"}}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 2,
                      bgcolor: "#eff6ff",
                      color: "#1565c0",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <MedicalServicesOutlinedIcon />
                  </Box>

                  <Box>
                    <Typography variant="h6" fontWeight={700}>
                      Catálogo de consultorios
                    </Typography>

                    <Typography variant="body2" color="text.secondary">
                      {consultorios.length} consultorio(s) recibidos de la API
                    </Typography>
                  </Box>
                </Stack>

                <Button
                  variant="outlined"
                  startIcon={
                    sincronizando ? (
                      <CircularProgress size={18} />
                    ) : (
                      <RefreshIcon />
                    )
                  }
                  onClick={actualizarCatalogo}
                  disabled={sincronizando}
                  sx={{
                    alignSelf: { xs: "stretch", sm: "center" },
                    borderRadius: 2,
                    textTransform: "none",
                    minHeight: 42,
                  }}
                >
                  {sincronizando
                    ? "Actualizando..."
                    : "Actualizar consultorios"}
                </Button>
              </Stack>
            </CardContent>
          </Card>

          {/* Generación de códigos */}
          <Card
            variant="outlined"
            sx={{
              borderColor: "#e2e8f0",
              borderRadius: 3,
              boxShadow: "none",
            }}
          >
            <CardContent sx={{ p: { xs: 2, md: 3 } }}>
              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    Activar un puesto de atención
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    Genera un código y colócalo en la computadora del
                    consultorio que deseas activar.
                  </Typography>
                </Box>

                <TextField
                  select
                  fullWidth
                  label="Seleccionar consultorio"
                  value={codigoConsultorio}
                  onChange={(event) => {
                    setCodigoConsultorio(event.target.value);
                    setCodigoGenerado(null);
                    setMensajeCodigo("");
                    setError("");
                  }}
                  disabled={
                    consultorios.length === 0 ||
                    generando ||
                    sincronizando
                  }
                  helperText={
                    consultorios.length === 0
                      ? "Actualiza el catálogo para obtener consultorios."
                      : "Selecciona el consultorio que se asociará al equipo."
                  }
                >
                  {consultorios.map((consultorio) => (
                    <MenuItem
                      key={consultorio.id}
                      value={consultorio.codigo}
                    >
                      {consultorio.nombre} ({consultorio.codigo})
                    </MenuItem>
                  ))}
                </TextField>

                {consultorioSeleccionado && (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      borderColor: "#e2e8f0",
                      bgcolor: "#fbfdff",
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                    >
                      DETALLE DEL CONSULTORIO
                    </Typography>

                    <Typography fontWeight={700} sx={{ mt: 0.5 }}>
                      {consultorioSeleccionado.nombre}
                    </Typography>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5 }}
                    >
                      Código: {consultorioSeleccionado.codigo}
                    </Typography>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                    >
                      Ambiente:{" "}
                      {consultorioSeleccionado.nombre_ambiente ||
                        "No registrado"}
                    </Typography>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                    >
                      Servicio:{" "}
                      {consultorioSeleccionado.nombre_servicio ||
                        "No registrado"}
                    </Typography>
                  </Paper>
                )}

                <Button
                  variant="contained"
                  startIcon={
                    generando ? (
                      <CircularProgress size={18} color="inherit" />
                    ) : (
                      <KeyOutlinedIcon />
                    )
                  }
                  onClick={generarCodigo}
                  disabled={!consultorioSeleccionado || generando}
                  sx={{
                    alignSelf: { xs: "stretch", sm: "flex-start" },
                    minHeight: 44,
                    px: 2.5,
                    borderRadius: 2,
                    textTransform: "none",
                    boxShadow: "none",
                  }}
                >
                  {generando
                    ? "Generando código..."
                    : "Generar código de activación"}
                </Button>

                {codigoGenerado && (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: { xs: 2, md: 3 },
                      borderRadius: 3,
                      borderColor: "#bfdbfe",
                      bgcolor: "#f8fbff",
                    }}
                  >
                    <Stack spacing={2} alignItems="flex-start">
                      <Box>
                        <Typography
                          variant="h3"
                          fontWeight={800}
                          sx={{
                            mt: 1,
                            color: "#0f172a",
                            letterSpacing: { xs: 2, sm: 5 },
                            overflowWrap: "anywhere",
                            fontSize: { xs: 32, sm: 40 },
                          }}
                        >
                          {codigoGenerado.codigo}
                        </Typography>
                      </Box>

                      <Typography variant="body2">
                        {codigoGenerado.consultorio?.nombre}
                      </Typography>

                      {mensajeCodigo && (
                        <Alert
                          severity={
                            mensajeCodigo.startsWith("Código copiado")
                              ? "success"
                              : "info"
                          }
                          sx={{ width: "100%" }}
                        >
                          {mensajeCodigo}
                        </Alert>
                      )}

                      <Alert severity="info" sx={{ width: "100%" }}>
                        Ingresa este código en la computadora del
                        consultorio. El código vence a los 30 minutos y solo puede
                        utilizarse una vez.
                      </Alert>
                    </Stack>
                  </Paper>
                )}
              </Stack>
            </CardContent>
          </Card>

          {/* Tabla de equipos activados */}
          <Card
            variant="outlined"
            sx={{
              borderColor: "#e2e8f0",
              borderRadius: 3,
              boxShadow: "none",
              overflow: "hidden",
            }}
          >
            <CardContent
              sx={{
                p: { xs: 2, md: 3 },
                pb: "16px !important",
              }}
            >
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{
                    alignItems: { xs: "stretch", sm: "center" },
                    justifyContent: "space-between",
                    }}
              >
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    Consultorios activados
                  </Typography>
                </Box>

                <Button
                  variant="text"
                  startIcon={
                    cargandoEquipos ? (
                      <CircularProgress size={18} />
                    ) : (
                      <RefreshIcon />
                    )
                  }
                  onClick={actualizarEquipos}
                  disabled={cargandoEquipos}
                  sx={{ textTransform: "none" }}
                >
                  Actualizar equipos
                </Button>
              </Stack>
            </CardContent>

            <Divider />

            {equipos.length === 0 ? (
              <Box
                sx={{
                  px: 3,
                  py: 6,
                  textAlign: "center",
                }}
              >
                <ComputerOutlinedIcon
                  sx={{ fontSize: 42, color: "#94a3b8", mb: 1.5 }}
                />

                <Typography fontWeight={700}>
                  No hay equipos activados
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  Genera un código y actívalo desde la computadora
                  del consultorio.
                </Typography>
              </Box>
            ) : (
              <TableContainer sx={{ overflowX: "auto" }}>
                <Table>
                  <TableHead>
                    <TableRow sx={{ bgcolor: "#f8fafc" }}>
                      <TableCell sx={{ fontWeight: 700 }}>
                        Consultorio
                      </TableCell>

                      <TableCell sx={{ fontWeight: 700 }}>
                        Código
                      </TableCell>

                      <TableCell sx={{ fontWeight: 700 }}>
                        Fecha de activación
                      </TableCell>

                      <TableCell sx={{ fontWeight: 700 }}>
                        Estado
                      </TableCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {equipos.map((equipo) => (
                      <TableRow
                        key={equipo.id}
                        hover
                        sx={{
                          "&:last-child td": { borderBottom: 0 },
                        }}
                      >
                        <TableCell>
                          <Typography fontWeight={600}>
                            {equipo.consultorio?.nombre ??
                              "Consultorio no disponible"}
                          </Typography>
                        </TableCell>

                        <TableCell>
                          {equipo.consultorio?.codigo ?? "—"}
                        </TableCell>

                        <TableCell>
                          {formatoFecha(equipo.activado_en)}
                        </TableCell>

                        <TableCell>
                          <Chip
                            size="small"
                            color="success"
                            label="Activado"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Card>
        </Stack>
      </Box>
    </Box>
  );
}