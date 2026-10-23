import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import api from "../services/api";

const MAX_BYTES = 500 * 1024 * 1024;
const FORMATOS = ".mp4,.webm,video/mp4,video/webm";

function mensajeError(error, porDefecto) {
  const data = error?.response?.data;
  if (typeof data?.detail === "string") return data.detail;
  if (typeof data?.mensaje === "string") return data.mensaje;
  if (data && typeof data === "object") {
    return Object.entries(data)
      .map(([campo, valor]) => `${campo}: ${Array.isArray(valor) ? valor.join(", ") : String(valor)}`)
      .join(" · ");
  }
  return porDefecto;
}

function formatoBytes(bytes = 0) {
  if (!bytes) return "Tamaño no disponible";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fechaVisible(fecha) {
  if (!fecha) return "";
  const valor = new Date(fecha);
  return Number.isNaN(valor.getTime())
    ? ""
    : valor.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

export default function BibliotecaVideos() {
  const inputRef = useRef(null);
  const [videos, setVideos] = useState([]);
  const [archivo, setArchivo] = useState(null);
  const [titulo, setTitulo] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [eliminando, setEliminando] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [progreso, setProgreso] = useState(0);

  const cargarVideos = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const respuesta = await api.get("videos/");
      setVideos(respuesta.data?.videos ?? []);
    } catch (err) {
      setError(mensajeError(err, "No se pudo cargar la biblioteca de videos."));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarVideos(); }, [cargarVideos]);

  const videosFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase();
    if (!termino) return videos;
    return videos.filter((video) =>
      `${video.titulo} ${video.nombre_archivo}`.toLocaleLowerCase().includes(termino)
    );
  }, [videos, busqueda]);

  function seleccionarArchivo(event) {
    const elegido = event.target.files?.[0] || null;
    setError("");
    setMensaje("");
    setArchivo(null);
    if (!elegido) return;
    const extension = elegido.name.split(".").pop()?.toLowerCase();
    if (!["mp4", "webm"].includes(extension)) {
      setError("Formato no permitido. Selecciona un archivo MP4 o WebM.");
      event.target.value = "";
      return;
    }
    if (elegido.size <= 0 || elegido.size > MAX_BYTES) {
      setError("El archivo debe tener contenido y no superar 500 MB.");
      event.target.value = "";
      return;
    }
    setArchivo(elegido);
    if (!titulo.trim()) setTitulo(elegido.name.replace(/\.[^.]+$/, ""));
  }

  async function subirVideo(event) {
    event.preventDefault();
    if (!archivo) {
      setError("Selecciona un archivo de video antes de cargarlo.");
      return;
    }
    setSubiendo(true);
    setError("");
    setMensaje("");
    setProgreso(0);
    const formulario = new FormData();
    formulario.append("archivo", archivo);
    formulario.append("titulo", titulo.trim() || archivo.name.replace(/\.[^.]+$/, ""));
    try {
      const respuesta = await api.post("videos/", formulario, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (eventProgress) => {
          if (eventProgress.total) setProgreso(Math.round((eventProgress.loaded * 100) / eventProgress.total));
        },
      });
      setMensaje(respuesta.data?.mensaje || "Video cargado correctamente.");
      setArchivo(null);
      setTitulo("");
      if (inputRef.current) inputRef.current.value = "";
      await cargarVideos();
    } catch (err) {
      setError(mensajeError(err, "No se pudo cargar el video."));
    } finally {
      setSubiendo(false);
      setProgreso(0);
    }
  }

  async function eliminarVideo(video) {
    if (!window.confirm(`¿Eliminar el video «${video.titulo}»? Esta acción no se puede deshacer.`)) return;
    setEliminando(video.id);
    setError("");
    setMensaje("");
    try {
      await api.delete(`videos/${video.id}/`);
      setVideos((actuales) => actuales.filter((item) => item.id !== video.id));
      setMensaje(`Se eliminó «${video.titulo}».`);
    } catch (err) {
      setError(mensajeError(err, "No se pudo eliminar el video."));
    } finally {
      setEliminando(null);
    }
  }

  return (
    <Box sx={{ width: "100%", minWidth: 0, bgcolor: "#f8fafc", px: { xs: 2, sm: 3, lg: 4 }, py: { xs: 2.5, md: 3.25 } }}>
      <Stack spacing={2.5}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="primary.main" fontWeight={800} letterSpacing={1}>GESTOR DE COLAS · ADMINISTRACIÓN</Typography>
            <Typography variant="h4" fontWeight={800} sx={{ mt: 0.25, color: "#0f172a", fontSize: { xs: 26, md: 31 } }}>Biblioteca de videos</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Carga y administra el contenido institucional disponible para los monitores.</Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip label={`${videos.length} video${videos.length === 1 ? "" : "s"}`} variant="outlined" sx={{ bgcolor: "#fff" }} />
            <Button size="small" variant="outlined" onClick={cargarVideos} disabled={cargando} startIcon={cargando ? <CircularProgress size={16} /> : <RefreshIcon />} sx={{ textTransform: "none", whiteSpace: "nowrap" }}>Actualizar</Button>
          </Stack>
        </Stack>

        {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}
        {mensaje && <Alert severity="success" onClose={() => setMensaje("")}>{mensaje}</Alert>}

        <Card variant="outlined" sx={{ borderRadius: 3, borderColor: "#e2e8f0", boxShadow: "none" }}>
          <CardContent sx={{ p: { xs: 2, md: 2.5 }, "&:last-child": { pb: { xs: 2, md: 2.5 } } }}>
            <Stack component="form" onSubmit={subirVideo} direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }}>
              <Box sx={{ width: 48, height: 48, flexShrink: 0, borderRadius: 2, bgcolor: "#eaf3ff", color: "#155db3", display: "grid", placeItems: "center", fontSize: 28, fontWeight: 800 }}>↑</Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography fontWeight={800}>Cargar video institucional</Typography>
                <Typography variant="body2" color="text.secondary">Formatos MP4 y WebM · máximo 500 MB por archivo.</Typography>
                {archivo && <Typography variant="caption" color="primary.main" sx={{ display: "block", mt: 0.5, overflowWrap: "anywhere" }}>{archivo.name} · {formatoBytes(archivo.size)}</Typography>}
              </Box>
              <TextField size="small" label="Título (opcional)" value={titulo} onChange={(event) => setTitulo(event.target.value)} slotProps={{ htmlInput: { maxLength: 180 } }} sx={{ width: { xs: "100%", md: 230 } }} />
              <input ref={inputRef} hidden type="file" accept={FORMATOS} onChange={seleccionarArchivo} />
              <Button type="button" variant="outlined" onClick={() => inputRef.current?.click()} sx={{ minHeight: 40, textTransform: "none", whiteSpace: "nowrap" }}>Elegir archivo</Button>
              <Button type="submit" variant="contained" disabled={!archivo || subiendo} startIcon={subiendo ? <CircularProgress size={17} color="inherit" /> : <span aria-hidden="true">↑</span>} sx={{ minHeight: 40, minWidth: 115, textTransform: "none", boxShadow: "none", whiteSpace: "nowrap" }}>{subiendo ? "Cargando…" : "Subir video"}</Button>
            </Stack>
            {subiendo && <Box sx={{ mt: 2 }}><LinearProgress variant="determinate" value={progreso} /><Typography variant="caption" color="text.secondary">Subiendo archivo: {progreso}%</Typography></Box>}
          </CardContent>
        </Card>

        <Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} sx={{ mb: 1.5 }}>
            <Box>
              <Typography variant="h6" fontWeight={800} color="#0f172a">Videos disponibles</Typography>
              <Typography variant="body2" color="text.secondary">Los videos se guardan en el servidor y quedan disponibles para asignarlos a monitores.</Typography>
            </Box>
            <TextField size="small" placeholder="Buscar video…" value={busqueda} onChange={(event) => setBusqueda(event.target.value)} sx={{ width: { xs: "100%", sm: 270 }, bgcolor: "#fff" }}  />
          </Stack>

          {cargando ? <Box sx={{ display: "grid", placeItems: "center", py: 5 }}><CircularProgress /></Box> : videosFiltrados.length === 0 ? (
            <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 }, borderRadius: 3, textAlign: "center", borderColor: "#e2e8f0", bgcolor: "#fff" }}>
              <Typography aria-hidden="true" sx={{ fontSize: 38, color: "#94a3b8", mb: 1 }}>▶</Typography>
              <Typography fontWeight={800}>{videos.length === 0 ? "La biblioteca está vacía" : "No se encontraron videos"}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{videos.length === 0 ? "Selecciona un archivo arriba para comenzar a cargar contenido institucional." : "Prueba con otro nombre de archivo o título."}</Typography>
            </Paper>
          ) : (
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" }, gap: 1.75 }}>
              {videosFiltrados.map((video) => (
                <Card key={video.id} variant="outlined" sx={{ minWidth: 0, overflow: "hidden", borderRadius: 3, borderColor: "#e2e8f0", boxShadow: "none", bgcolor: "#fff" }}>
                  {video.url ? <Box sx={{ bgcolor: "#0f172a", aspectRatio: "16 / 9", display: "grid", placeItems: "center" }}><video src={video.url} controls preload="metadata" style={{ width: "100%", height: "100%", maxHeight: 220, objectFit: "contain" }}>Tu navegador no puede reproducir este formato de video.</video></Box> : <Box sx={{ bgcolor: "#f1f5f9", aspectRatio: "16 / 9", display: "grid", placeItems: "center", color: "#94a3b8" }}><Typography sx={{ fontSize: 42 }}>▶</Typography></Box>}
                  <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
                    <Stack direction="row" spacing={1} alignItems="flex-start">
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography fontWeight={800} sx={{ overflowWrap: "anywhere", lineHeight: 1.3 }}>{video.titulo}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.45, overflowWrap: "anywhere" }}>{video.nombre_archivo}</Typography>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                          <Chip size="small" label={formatoBytes(video.tamano_bytes)} />
                          <Chip size="small" variant="outlined" label={(video.nombre_archivo.split(".").pop() || "video").toUpperCase()} />
                          {video.creado_en && <Chip size="small" variant="outlined" label={fechaVisible(video.creado_en)} />}
                        </Stack>
                      </Box>
                      <IconButton aria-label={`Eliminar ${video.titulo}`} color="error" size="small" disabled={eliminando === video.id} onClick={() => eliminarVideo(video)} title="Eliminar video">
                        {eliminando === video.id ? <CircularProgress size={20} /> : <Box component="span" sx={{ fontSize: 24, lineHeight: 1 }}>×</Box>}
                      </IconButton>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </Box>
        <Divider />
        <Typography variant="caption" color="text.secondary">Nota: esta sección administra la biblioteca. La selección de videos para cada monitor se configura en la ficha del monitor y se mostrará en bucle en la pantalla de atención.</Typography>
      </Stack>
    </Box>
  );
}
