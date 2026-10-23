import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import TvOutlinedIcon from "@mui/icons-material/TvOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import MedicalServicesOutlinedIcon from "@mui/icons-material/MedicalServicesOutlined";
import api from "../services/api";

function obtenerMensajeError(error, predeterminado) {
  const datos = error.response?.data;
  if (typeof datos?.detail === "string") return datos.detail;
  if (typeof datos?.mensaje === "string") return datos.mensaje;
  if (datos && typeof datos === "object") {
    return Object.entries(datos)
      .map(([campo, valor]) => `${campo}: ${Array.isArray(valor) ? valor.join(", ") : String(valor)}`)
      .join(" · ");
  }
  return predeterminado;
}

function fechaVisible(fecha) {
  if (!fecha) return "—";
  const valor = new Date(fecha);
  return Number.isNaN(valor.getTime()) ? "—" : valor.toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" });
}

function formatoBytesMonitor(bytes = 0) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return "Tamaño desconocido";
  const unidades = ["B", "KB", "MB", "GB"];
  let valor = Number(bytes);
  let indice = 0;
  while (valor >= 1024 && indice < unidades.length - 1) {
    valor /= 1024;
    indice += 1;
  }
  return `${valor.toLocaleString("es-PE", { maximumFractionDigits: 1 })} ${unidades[indice]}`;
}

export default function MonitoresAdmin() {
  const { id } = useParams();
  const [establecimiento, setEstablecimiento] = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [fuenteCatalogo, setFuenteCatalogo] = useState("");
  const [monitores, setMonitores] = useState([]);
  const [nombre, setNombre] = useState("");
  const [codigosSeleccionados, setCodigosSeleccionados] = useState([]);
  const [monitorEditando, setMonitorEditando] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [actualizando, setActualizando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [codigoGenerado, setCodigoGenerado] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const [videosDisponibles, setVideosDisponibles] = useState([]);
  const [videoIdsSeleccionados, setVideoIdsSeleccionados] = useState([]);
  const [errorVideos, setErrorVideos] = useState("");

  const videosSeleccionados = useMemo(
    () => videoIdsSeleccionados
      .map((videoId) => videosDisponibles.find((video) => String(video.id) === String(videoId)))
      .filter(Boolean),
    [videoIdsSeleccionados, videosDisponibles]
  );

  const seleccionValida = useMemo(
    () => codigosSeleccionados.filter((codigo) => catalogo.some((item) => item.codigo === codigo)),
    [codigosSeleccionados, catalogo]
  );

  const cargarDatos = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    setError("");
    try {
      const respuesta = await api.get(`ipress/${id}/monitores/`);
      setEstablecimiento(respuesta.data?.establecimiento ?? null);
      setCatalogo(respuesta.data?.catalogo_consultorios ?? []);
      setFuenteCatalogo(respuesta.data?.fuente_catalogo ?? "proveedor");
      setMonitores(respuesta.data?.monitores ?? []);
      try {
        const respuestaVideos = await api.get("videos/");
        setVideosDisponibles(respuestaVideos.data?.videos ?? []);
        setErrorVideos("");
      } catch (errorVideo) {
        setVideosDisponibles([]);
        setErrorVideos(obtenerMensajeError(errorVideo, "No se pudo cargar la biblioteca de videos."));
      }
    } catch (err) {
      setError(obtenerMensajeError(err, "No se pudo cargar la información de los monitores."));
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  function limpiarFormulario() {
    setNombre("");
    setCodigosSeleccionados([]);
    setVideoIdsSeleccionados([]);
    setMonitorEditando(null);
    setCodigoGenerado(null);
    setCopiado(false);
  }

  function alternarConsultorio(codigo, marcado) {
    setCodigosSeleccionados((actuales) =>
      marcado ? [...new Set([...actuales, codigo])] : actuales.filter((actual) => actual !== codigo)
    );
  }

  function alternarVideo(videoId, marcado) {
    setVideoIdsSeleccionados((actuales) => {
      if (marcado) return [...actuales.filter((id) => String(id) !== String(videoId)), videoId];
      return actuales.filter((id) => String(id) !== String(videoId));
    });
  }

  function moverVideo(indice, direccion) {
    setVideoIdsSeleccionados((actuales) => {
      const destino = indice + direccion;
      if (destino < 0 || destino >= actuales.length) return actuales;
      const siguiente = [...actuales];
      [siguiente[indice], siguiente[destino]] = [siguiente[destino], siguiente[indice]];
      return siguiente;
    });
  }

  async function guardarMonitor(event) {
    event.preventDefault();
    if (!nombre.trim()) {
      setError("Escribe un nombre para el monitor.");
      return;
    }
    if (seleccionValida.length === 0) {
      setError("Selecciona al menos un consultorio.");
      return;
    }

    setGuardando(true);
    setError("");
    setMensaje("");
    setCodigoGenerado(null);
    try {
      const datos = { nombre: nombre.trim(), codigos_consultorios: seleccionValida, video_ids: videoIdsSeleccionados.map(Number) };
      if (monitorEditando) {
        await api.patch(`ipress/${id}/monitores/${monitorEditando}/`, datos);
        setMensaje("Monitor actualizado correctamente.");
      } else {
        await api.post(`ipress/${id}/monitores/`, datos);
        setMensaje("Monitor registrado correctamente.");
      }
      limpiarFormulario();
      await cargarDatos(true);
    } catch (err) {
      setError(obtenerMensajeError(err, "No se pudo guardar el monitor."));
    } finally {
      setGuardando(false);
    }
  }

  function iniciarEdicion(monitor) {
    setMonitorEditando(monitor.id);
    setNombre(monitor.nombre);
    setCodigosSeleccionados(monitor.consultorios.map((item) => item.codigo));
    setVideoIdsSeleccionados((monitor.videos || []).map((item) => item.id));
    setCodigoGenerado(null);
    setCopiado(false);
    setMensaje("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function eliminarMonitor(monitor) {
    if (!window.confirm(`¿Deseas eliminar el monitor «${monitor.nombre}»? Esta acción no se podrá deshacer.`)) return;
    setError("");
    setMensaje("");
    try {
      await api.delete(`ipress/${id}/monitores/${monitor.id}/`);
      setMensaje(`Monitor «${monitor.nombre}» eliminado correctamente.`);
      if (monitorEditando === monitor.id) limpiarFormulario();
      await cargarDatos(true);
    } catch (err) {
      setError(obtenerMensajeError(err, "No se pudo eliminar el monitor."));
    }
  }

  async function generarCodigo(monitor) {
    setError("");
    setMensaje("");
    setCopiado(false);
    try {
      const respuesta = await api.post(`ipress/${id}/monitores/${monitor.id}/generar-codigo/`);
      setCodigoGenerado(respuesta.data);
    } catch (err) {
      setError(obtenerMensajeError(err, "No se pudo generar el código de activación."));
    }
  }

  async function copiarCodigo() {
    if (!codigoGenerado?.codigo) return;
    try {
      await navigator.clipboard.writeText(codigoGenerado.codigo);
      setCopiado(true);
    } catch {
      setError("No se pudo copiar automáticamente. Selecciona el código y cópialo manualmente.");
    }
  }

  if (cargando) {
    return <Box sx={{ minHeight: "60vh", display: "grid", placeItems: "center" }}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ width: "100%", minWidth: 0, minHeight: "100vh", bgcolor: "#f8fafc", px: { xs: 2, sm: 3, lg: 4 }, py: { xs: 3, md: 4 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1}>ADMINISTRACIÓN · IPRESS</Typography>
          <Typography variant="h4" fontWeight={700} sx={{ mt: 0.5, color: "#0f172a", fontSize: { xs: 27, md: 32 } }}>Registrar monitores</Typography>
          {establecimiento && <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1, alignItems: { xs: "flex-start", sm: "center" } }}>
            <BusinessOutlinedIcon sx={{ color: "#64748b", fontSize: 20 }} />
            <Typography color="text.secondary">{establecimiento.nombre_ipress}</Typography>
            <Chip size="small" variant="outlined" label={`RENIPRESS: ${establecimiento.codigo_renipress}`} sx={{ bgcolor: "#fff", borderColor: "#cbd5e1" }} />
          </Stack>}
        </Box>

        {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}
        {mensaje && <Alert severity="success" onClose={() => setMensaje("")}>{mensaje}</Alert>}

        {codigoGenerado && <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, borderColor: "#bfdbfe", bgcolor: "#f8fbff" }}>
          <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
            <Chip color="success" size="small" label="Código de activación generado" />
            <Typography variant="h6" fontWeight={700}>{codigoGenerado.monitor?.nombre}</Typography>
            <Typography variant="h3" fontWeight={800} sx={{ color: "#0f172a", letterSpacing: { xs: 2, sm: 5 }, overflowWrap: "anywhere", fontSize: { xs: 32, sm: 40 } }}>{codigoGenerado.codigo}</Typography>
            <Typography variant="body2" color="text.secondary">Vence: {fechaVisible(codigoGenerado.expira_en)}</Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Button variant="outlined" startIcon={<ContentCopyOutlinedIcon />} onClick={copiarCodigo} sx={{ textTransform: "none" }}>{copiado ? "Código copiado" : "Copiar código"}</Button>
              <Button variant="text" onClick={() => setCodigoGenerado(null)} sx={{ textTransform: "none" }}>Cerrar</Button>
            </Stack>
            <Alert severity="info" sx={{ width: "100%" }}>El código vence en 30 minutos y solo puede utilizarse una vez. Al activarlo, el monitor cargará sus consultorios y reproducirá los videos seleccionados en bucle.</Alert>
          </Stack>
        </Paper>}

        <Card variant="outlined" sx={{ borderRadius: 3, borderColor: "#e2e8f0", boxShadow: "none" }}>
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Stack spacing={2.5} component="form" onSubmit={guardarMonitor} sx={{ alignItems: "stretch" }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: "#eff6ff", color: "#1565c0", display: "grid", placeItems: "center" }}><TvOutlinedIcon /></Box>
                <Box>
                  <Typography variant="h6" fontWeight={700}>{monitorEditando ? "Editar monitor" : "Nuevo monitor"}</Typography>
                  <Typography variant="body2" color="text.secondary">Selecciona los consultorios cuyos llamados aparecerán en esta pantalla.</Typography>
                </Box>
              </Stack>
              <TextField fullWidth label="Nombre del monitor" placeholder="Ej. Monitor sala de espera principal" value={nombre} onChange={(event) => setNombre(event.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} required />
              <Box>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 1, alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}>
                  <Typography fontWeight={700}>Consultorios para mostrar</Typography>
                  <Chip size="small" label={`${seleccionValida.length} seleccionados`} variant="outlined" />
                </Stack>
                {catalogo.length === 0 ? <Alert severity="warning">La API no ha devuelto consultorios para esta IPRESS.</Alert> : <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1.25 }}>
                  {catalogo.map((consultorio) => {
                    const marcado = codigosSeleccionados.includes(consultorio.codigo);
                    return <Paper key={consultorio.codigo} variant="outlined" sx={{ borderRadius: 2, p: 1.25, borderColor: marcado ? "primary.main" : "#e2e8f0", bgcolor: marcado ? "#f5f9ff" : "#fff" }}>
                      <FormControlLabel sx={{ display: "flex", alignItems: "flex-start", m: 0, width: "100%" }} control={<Checkbox checked={marcado} onChange={(event) => alternarConsultorio(consultorio.codigo, event.target.checked)} />} label={<Box sx={{ pt: 0.5 }}><Typography fontWeight={700}>{consultorio.nombre}</Typography><Typography variant="caption" color="text.secondary">{consultorio.codigo}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{consultorio.nombre_ambiente || "Ambiente no registrado"} · {consultorio.nombre_servicio || "Servicio no registrado"}</Typography></Box>} />
                    </Paper>;
                  })}
                </Box>}
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Catálogo obtenido desde el proveedor: {fuenteCatalogo || "API"}. Las asignaciones elegidas se guardan en PostgreSQL.</Typography>
              </Box>

              <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2.5, borderColor: "#e2e8f0", bgcolor: "#fbfdff" }}>
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
                  <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: "#f1eaff", color: "#6840a8", display: "grid", placeItems: "center", flexShrink: 0, fontSize: 21, fontWeight: 900 }}>▶</Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography fontWeight={800}>Videos para reproducir</Typography>
                    <Typography variant="body2" color="text.secondary">Selecciona los videos que verá esta pantalla. Puedes ordenar la reproducción debajo.</Typography>
                  </Box>
                  <Chip size="small" label={`${videoIdsSeleccionados.length} seleccionados`} variant="outlined" />
                </Stack>

                {errorVideos && <Alert severity="warning" sx={{ mb: 1.5 }}>{errorVideos}</Alert>}
                {!errorVideos && videosDisponibles.length === 0 ? (
                  <Alert severity="info">La biblioteca todavía no tiene videos. Puedes guardar el monitor sin videos y añadirlos después.</Alert>
                ) : (
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1 }}>
                    {videosDisponibles.map((video) => {
                      const marcado = videoIdsSeleccionados.some((videoId) => String(videoId) === String(video.id));
                      const posicion = videoIdsSeleccionados.findIndex((videoId) => String(videoId) === String(video.id));
                      return (
                        <Paper key={video.id} variant="outlined" sx={{ p: 1, minWidth: 0, borderRadius: 2, borderColor: marcado ? "#8b6dcc" : "#e2e8f0", bgcolor: marcado ? "#faf7ff" : "#fff" }}>
                          <FormControlLabel
                            sx={{ m: 0, width: "100%", alignItems: "flex-start" }}
                            control={<Checkbox size="small" checked={marcado} onChange={(event) => alternarVideo(video.id, event.target.checked)} />}
                            label={<Box sx={{ pt: 0.4, minWidth: 0 }}>
                              <Typography fontWeight={750} sx={{ lineHeight: 1.25, overflowWrap: "anywhere" }}>{video.titulo}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25, overflowWrap: "anywhere" }}>{video.nombre_archivo} · {formatoBytesMonitor(video.tamano_bytes)}</Typography>
                              {marcado && <Chip size="small" color="secondary" variant="outlined" label={`En la lista: ${posicion + 1}`} sx={{ mt: 0.5, height: 22 }} />}
                            </Box>}
                          />
                        </Paper>
                      );
                    })}
                  </Box>
                )}

                {videosSeleccionados.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Divider sx={{ mb: 1.5 }} />
                    <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Orden de reproducción</Typography>
                    <Stack spacing={0.75}>
                      {videosSeleccionados.map((video, indice) => (
                        <Paper key={video.id} variant="outlined" sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, borderRadius: 2, minWidth: 0 }}>
                          <Chip size="small" label={indice + 1} color="secondary" />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={750} sx={{ overflowWrap: "anywhere" }}>{video.titulo}</Typography>
                            <Typography variant="caption" color="text.secondary">{video.nombre_archivo}</Typography>
                          </Box>
                          <Button type="button" size="small" variant="outlined" onClick={() => moverVideo(indice, -1)} disabled={indice === 0} aria-label={`Mover ${video.titulo} arriba`} sx={{ minWidth: 35, px: 1, textTransform: "none" }}>↑</Button>
                          <Button type="button" size="small" variant="outlined" onClick={() => moverVideo(indice, 1)} disabled={indice === videosSeleccionados.length - 1} aria-label={`Mover ${video.titulo} abajo`} sx={{ minWidth: 35, px: 1, textTransform: "none" }}>↓</Button>
                        </Paper>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Paper>

              <Divider />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                <Button type="submit" variant="contained" startIcon={guardando ? <CircularProgress size={18} color="inherit" /> : monitorEditando ? <EditOutlinedIcon /> : undefined} disabled={guardando || catalogo.length === 0} sx={{ minHeight: 44, borderRadius: 2, textTransform: "none", boxShadow: "none" }}>{guardando ? "Guardando..." : monitorEditando ? "Guardar cambios" : "Registrar monitor"}</Button>
                {monitorEditando && <Button type="button" variant="text" onClick={limpiarFormulario} sx={{ minHeight: 44, textTransform: "none" }}>Cancelar edición</Button>}
                <Button type="button" variant="text" startIcon={actualizando ? <CircularProgress size={18} /> : <RefreshIcon />} onClick={async () => { setActualizando(true); await cargarDatos(true); setActualizando(false); }} disabled={actualizando} sx={{ minHeight: 44, textTransform: "none" }}>Actualizar catálogo</Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Box>
          <Stack direction="row" spacing={2} sx={{ mb: 1.5, alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="h6" fontWeight={700} color="#0f172a">Monitores registrados</Typography>
            <Chip size="small" variant="outlined" label={monitores.length} />
          </Stack>
          {monitores.length === 0 ? <Paper variant="outlined" sx={{ p: 4, textAlign: "center", borderRadius: 3, borderColor: "#e2e8f0" }}>
            <TvOutlinedIcon sx={{ fontSize: 42, color: "#94a3b8", mb: 1 }} />
            <Typography fontWeight={700}>Todavía no hay monitores registrados</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Registra un monitor y selecciona los consultorios que debe mostrar.</Typography>
          </Paper> : <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "repeat(2, minmax(0, 1fr))" }, gap: 2 }}>
            {monitores.map((monitor) => <Card key={monitor.id} variant="outlined" sx={{ borderRadius: 3, borderColor: "#e2e8f0", boxShadow: "none" }}>
              <CardContent sx={{ p: 2.5 }}>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                    <Box sx={{ width: 42, height: 42, flexShrink: 0, borderRadius: 2, bgcolor: "#f1f5f9", display: "grid", placeItems: "center", color: "#475569" }}><TvOutlinedIcon /></Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={800} sx={{ overflowWrap: "anywhere" }}>{monitor.nombre}</Typography>
                      <Typography variant="body2" color="text.secondary">{monitor.cantidad_consultorios} consultorio(s) asignado(s) · {(monitor.videos || []).length} video(s)</Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }} useFlexGap>
                    {monitor.consultorios.map((consultorio) => <Chip key={consultorio.codigo} size="small" icon={<MedicalServicesOutlinedIcon />} label={`${consultorio.nombre} (${consultorio.codigo})`} variant="outlined" sx={{ maxWidth: "100%" }} />)}
                  </Stack>
                  {(monitor.videos || []).length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight={800}>LISTA DE REPRODUCCIÓN</Typography>
                      <Stack direction="row" spacing={0.75} sx={{ mt: 0.6, flexWrap: "wrap" }} useFlexGap>
                        {(monitor.videos || []).map((video, indice) => <Chip key={video.id} size="small" label={`${indice + 1}. ${video.titulo}`} variant="outlined" sx={{ maxWidth: "100%" }} />)}
                      </Stack>
                    </Box>
                  )}
                  <Divider />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
                    <Button size="small" variant="outlined" startIcon={<KeyOutlinedIcon />} onClick={() => generarCodigo(monitor)} sx={{ textTransform: "none" }}>Generar código</Button>
                    <Button size="small" variant="text" startIcon={<EditOutlinedIcon />} onClick={() => iniciarEdicion(monitor)} sx={{ textTransform: "none" }}>Editar</Button>
                    <Button size="small" color="error" variant="text" onClick={() => eliminarMonitor(monitor)} sx={{ textTransform: "none" }}>Eliminar</Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>)}
          </Box>}
        </Box>
      </Stack>
    </Box>
  );
}
