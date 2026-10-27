
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  CircularProgress,
  Tooltip,
} from "@mui/material";

import SearchIcon from "@mui/icons-material/Search";
import CampaignIcon from "@mui/icons-material/Campaign";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import PersonOffOutlinedIcon from "@mui/icons-material/PersonOffOutlined";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import PhoneForwardedOutlinedIcon from "@mui/icons-material/PhoneForwardedOutlined";
import ComputerOutlinedIcon from "@mui/icons-material/ComputerOutlined";

import api from "../services/api";

function limpiarActivacionLocal() {
  localStorage.removeItem("equipo_token");
  localStorage.removeItem("equipo_id");
  localStorage.removeItem("equipo_consultorio");
  localStorage.removeItem("equipo_establecimiento");
}

function mensajeDeError(error, predeterminado) {
  const datos = error?.response?.data;

  if (typeof datos?.codigo === "string") return datos.codigo;
  if (typeof datos?.detail === "string") return datos.detail;
  if (typeof datos?.mensaje === "string") return datos.mensaje;

  if (datos && typeof datos === "object") {
    const mensajes = Object.values(datos).flatMap((valor) =>
      Array.isArray(valor) ? valor.map(String) : [String(valor)]
    );
    if (mensajes.length) return mensajes.join(" · ");
  }

  return predeterminado;
}

function FormularioActivacion({ onActivado, mensajeInicial = "" }) {
  const [codigo, setCodigo] = useState("");
  const [cargandoActivacion, setCargandoActivacion] = useState(false);
  const [errorActivacion, setErrorActivacion] = useState("");
  const [mensaje, setMensaje] = useState(mensajeInicial);

  useEffect(() => {
    setMensaje(mensajeInicial);
  }, [mensajeInicial]);

  async function activarEquipo(event) {
    event.preventDefault();
    const codigoLimpio = codigo.trim().toUpperCase();

    if (!codigoLimpio) {
      setErrorActivacion("Introduce el código de activación.");
      return;
    }

    setCargandoActivacion(true);
    setErrorActivacion("");
    setMensaje("");

    try {
      const respuesta = await api.post("activaciones/canjear/", {
        codigo: codigoLimpio,
        nombre_equipo: "",
      });
      const datos = respuesta.data;

      localStorage.setItem("equipo_token", datos.token);
      localStorage.setItem("equipo_id", datos.equipo_id);
      localStorage.setItem("equipo_consultorio", JSON.stringify(datos.consultorio));
      localStorage.setItem("equipo_establecimiento", JSON.stringify(datos.establecimiento));

      setCodigo("");
      onActivado();
    } catch (err) {
      setErrorActivacion(
        mensajeDeError(
          err,
          "No se pudo activar la computadora. Verifica el código e inténtalo nuevamente."
        )
      );
    } finally {
      setCargandoActivacion(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#F4F7FB", display: "grid", placeItems: "center", px: 2, py: 4 }}>
      <Container maxWidth="sm">
        <Card variant="outlined" sx={{ borderRadius: 3, boxShadow: "0 12px 40px rgba(16,61,112,0.08)" }}>
          <CardContent sx={{ p: { xs: 3, md: 5 } }}>
            <Box
              component="form"
              onSubmit={activarEquipo}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                width: "100%",
              }}
            >
              <Box sx={{ width: 68, height: 68, display: "grid", placeItems: "center", bgcolor: "#EAF3FF", color: "#103D70", borderRadius: 3 }}>
                <ComputerOutlinedIcon sx={{ fontSize: 38 }} />
              </Box>

              <Box sx={{ textAlign: "center" }}>
                <Typography variant="overline" color="primary" fontWeight={700} sx={{ letterSpacing: 1 }}>
                  GESTOR DE COLAS
                </Typography>
                <Typography variant="h4" fontWeight={800} color="#14294B" sx={{ mt: 1 }}>
                  Activar puesto de atención
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                  Introduce el código de activación para vincular esta computadora a un consultorio.
                </Typography>
              </Box>

              {mensaje && <Alert severity="info" sx={{ width: "100%" }}>{mensaje}</Alert>}
              {errorActivacion && <Alert severity="error" sx={{ width: "100%" }}>{errorActivacion}</Alert>}

              <TextField
                fullWidth
                label="Código de activación"
                value={codigo}
                onChange={(event) => setCodigo(event.target.value.toUpperCase())}
                placeholder="Ej. ABCD-1234"
                autoComplete="off"
                slotProps={{ htmlInput: { maxLength: 20, style: { textTransform: "uppercase", letterSpacing: 2 } } }}
                disabled={cargandoActivacion}
                helperText="El código vence a los 30 minutos y solo puede utilizarse una vez."
              />

              <Button type="submit" variant="contained" fullWidth disabled={!codigo.trim() || cargandoActivacion} sx={{ minHeight: 48, borderRadius: 2, textTransform: "none", fontWeight: 700, boxShadow: "none" }}>
                {cargandoActivacion ? <CircularProgress size={22} color="inherit" /> : "Activar computadora"}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}

export default function Consultorio() {
  const [estadoActivacion, setEstadoActivacion] = useState("verificando");
  const [errorVerificacion, setErrorVerificacion] = useState("");
  const [mensajeActivacion, setMensajeActivacion] = useState("");
  const [intentoVerificacion, setIntentoVerificacion] = useState(0);

  useEffect(() => {
    let cancelado = false;

    async function verificarActivacion() {
      const token = localStorage.getItem("equipo_token");
      if (!token) {
        limpiarActivacionLocal();
        setEstadoActivacion("inactivo");
        return;
      }

      setEstadoActivacion("verificando");
      setErrorVerificacion("");

      try {
        // La cola es un endpoint protegido: una respuesta correcta confirma
        // que el token corresponde a un equipo que sigue activo en el backend.
        await api.get("turnos/cola/");
        if (!cancelado) setEstadoActivacion("activo");
      } catch (error) {
        if (cancelado) return;
        const statusCode = error?.response?.status;

        if (statusCode === 401 || statusCode === 403) {
          limpiarActivacionLocal();
          setMensajeActivacion("Esta computadora no está activada o su activación fue revocada. Ingresa un nuevo código para continuar.");
          setEstadoActivacion("inactivo");
        } else {
          setErrorVerificacion("No se pudo comprobar la activación con el servidor. Verifica que Django esté ejecutándose y vuelve a intentarlo.");
          setEstadoActivacion("error");
        }
      }
    }

    verificarActivacion();
    return () => { cancelado = true; };
  }, [intentoVerificacion]);

  async function desactivarEquipo() {
    // El servidor invalida el equipo antes de borrar el token local.
    await api.post("activaciones/desactivar/");
    limpiarActivacionLocal();
    setMensajeActivacion("Computadora desactivada. Introduce un nuevo código para asociarla a otro consultorio.");
    setErrorVerificacion("");
    setEstadoActivacion("inactivo");
  }

  if (estadoActivacion === "verificando") {
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#F4F7FB", display: "grid", placeItems: "center" }}>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <CircularProgress />
          <Typography color="text.secondary">Verificando activación del puesto...</Typography>
        </Stack>
      </Box>
    );
  }

  if (estadoActivacion === "error") {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>{errorVerificacion}</Alert>
        <Button variant="contained" onClick={() => setIntentoVerificacion((valor) => valor + 1)}>
          Volver a comprobar
        </Button>
      </Container>
    );
  }

  if (estadoActivacion === "inactivo") {
    return <FormularioActivacion mensajeInicial={mensajeActivacion} onActivado={() => {
      setMensajeActivacion("");
      setEstadoActivacion("activo");
    }} />;
  }

  return <ConsultorioOperativo onCambiarConsultorio={desactivarEquipo} />;
}

function nombreVisible(turno) {
  const nombres = (turno.nombres_paciente || "").trim();
  const apellido = (turno.apellido_paterno_paciente || "").trim();

  const primerNombre = nombres.split(/\s+/).filter(Boolean)[0];
  const inicial = primerNombre?.charAt(0).toLocaleUpperCase("es-PE");

  return [inicial ? `${inicial}.` : "", apellido]
    .filter(Boolean)
    .join(" ") || "Nombre no disponible";
}

function horaVisible(hora) {
  return hora ? String(hora).slice(0, 5) : "—";
}

function estadoVisible(estado) {
  const estados = {
    EN_ESPERA: "En espera",
    LLAMANDO: "Llamando",
    ATENDIDO: "Atendido",
    NO_PRESENTADO: "No presentado",
    CANCELADO: "Cancelado",
  };

  return estados[estado] || estado || "Desconocido";
}

function obtenerLista(respuesta) {
  const datos = respuesta.data;
  return Array.isArray(datos) ? datos : datos?.results ?? [];
}

function BotonAccion({
  item,
  accionEnCurso,
  accionActual,
  ejecutarAccion,
}) {
  const Icono = item.icono;
  const estaProcesando =
    accionEnCurso && accionActual === item.accion;

  return (
    <Button
      fullWidth
      variant={item.variant || "outlined"}
      color={item.color}
      disabled={accionEnCurso}
      onClick={() => ejecutarAccion(item.accion)}
      startIcon={
        estaProcesando ? (
          <CircularProgress size={18} color="inherit" />
        ) : (
          <Icono />
        )
      }
      sx={{
        py: 1.25,
        px: 2,
        justifyContent: "flex-start",
        fontWeight: 700,
        borderRadius: 2,
        textTransform: "none",
        transition:
          "transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: 2,
        },
        "&:active": {
          transform: "scale(0.98)",
        },
        "&.Mui-disabled": {
          opacity: 0.65,
        },
      }}
    >
      {estaProcesando ? "Procesando..." : item.texto}
    </Button>
  );
}

function ConsultorioOperativo({ onCambiarConsultorio }) {
  const [turnos, setTurnos] = useState([]);
  const [turnosAtendidos, setTurnosAtendidos] = useState([]);

  const [seleccionadoId, setSeleccionadoId] = useState(null);
  const [filtro, setFiltro] = useState("TODOS");
  const [busqueda, setBusqueda] = useState("");

  const [cargando, setCargando] = useState(true);
  const [accionEnCurso, setAccionEnCurso] = useState(false);
  const [accionActual, setAccionActual] = useState(null);

  const [error, setError] = useState("");
  const [errorAtendidos, setErrorAtendidos] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ultimaActualizacion, setUltimaActualizacion] = useState(null);
  const [dialogoCambioAbierto, setDialogoCambioAbierto] = useState(false);
  const [cambiandoConsultorio, setCambiandoConsultorio] = useState(false);
  const [errorCambioConsultorio, setErrorCambioConsultorio] = useState("");

  const consultorio = useMemo(() => {
    try {
      return JSON.parse(
        localStorage.getItem("equipo_consultorio") || "null"
      );
    } catch {
      return null;
    }
  }, []);

  const establecimiento = useMemo(() => {
    try {
      return JSON.parse(
        localStorage.getItem("equipo_establecimiento") || "null"
      );
    } catch {
      return null;
    }
  }, []);

  const cargarTurnos = useCallback(async (silencioso = false) => {
    if (!localStorage.getItem("equipo_token")) {
      setError("Esta computadora no está activada. Contacta con OTI.");
      setCargando(false);
      return;
    }

    if (!silencioso) {
      setCargando(true);
    }

    const [resultadoCola, resultadoAtendidos] = await Promise.allSettled([
      api.get("turnos/cola/"),
      api.get("turnos/atendidos/"),
    ]);

    let colaCorrecta = false;

    if (resultadoCola.status === "fulfilled") {
      const lista = obtenerLista(resultadoCola.value);

      setTurnos(lista);
      colaCorrecta = true;
      setError("");
      
      setSeleccionadoId((actual) => {
        if (filtro === "ATENDIDOS") {
          return actual;
        }

        if (lista.some((turno) => turno.id === actual)) {
          return actual;
        }

        return lista[0]?.id ?? null;
      });
    } else {
      const err = resultadoCola.reason;

      if (
        err.response?.status === 401 ||
        err.response?.status === 403
      ) {
        setError(
          "La credencial no es válida o el equipo está desactivado. Contacta con OTI."
        );
      } else {
        setError(
          "No se pudo actualizar la cola. Se volverá a intentar automáticamente."
        );
      }
    }

    if (resultadoAtendidos.status === "fulfilled") {
      setTurnosAtendidos(obtenerLista(resultadoAtendidos.value));
      setErrorAtendidos("");
    } else {
      const err = resultadoAtendidos.reason;

      if (
        err.response?.status === 401 ||
        err.response?.status === 403
      ) {
        setErrorAtendidos(
          "No se pudo validar el acceso al historial de atendidos."
        );
      } else {
        setErrorAtendidos(
          "No se pudo actualizar el historial de atendidos. Se volverá a intentar automáticamente."
        );
      }
    }

    if (colaCorrecta) {
      setUltimaActualizacion(new Date());
    }

    setCargando(false);
  }, [filtro]);

  useEffect(() => {
    cargarTurnos();

    const intervalo = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        cargarTurnos(true);
      }
    }, 3000);

    const alVolver = () => {
      if (document.visibilityState === "visible") {
        cargarTurnos(true);
      }
    };

    document.addEventListener("visibilitychange", alVolver);

    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cargarTurnos]);

  const cantidadEnEspera = turnos.filter(
    (turno) => turno.estado === "EN_ESPERA"
  ).length;

  const cantidadLlamando = turnos.filter(
    (turno) => turno.estado === "LLAMANDO"
  ).length;

  const cantidadAtendidos = turnosAtendidos.length;

  const listaBase = filtro === "ATENDIDOS"
    ? turnosAtendidos
    : turnos;

  const turnosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLocaleLowerCase("es-PE");

    return listaBase.filter((turno) => {
      const coincideEstado =
        filtro === "TODOS" ||
        filtro === "ATENDIDOS" ||
        turno.estado === filtro;

      const coincideNombre =
        !texto ||
        nombreVisible(turno).toLocaleLowerCase("es-PE").includes(texto);

      return coincideEstado && coincideNombre;
    });
  }, [listaBase, filtro, busqueda]);

  const seleccionado = filtro === "ATENDIDOS"
    ? null
    : turnos.find((turno) => turno.id === seleccionadoId);

  async function ejecutarAccion(accion) {
    if (!seleccionado || accionEnCurso) return;

    const accionesConConfirmacion = {
      finalizar: "¿Confirmas que la atención de este paciente ha finalizado?",
      cancelar: "¿Confirmas la cancelación de este turno?",
      no_presentado: "¿Confirmas que el paciente no se presentó?",
    };

    if (accionesConConfirmacion[accion]) {
      if (!window.confirm(accionesConConfirmacion[accion])) {
        return;
      }
    }

    setAccionEnCurso(true);
    setAccionActual(accion);
    setError("");
    setMensaje("");

    try {
      await api.post(`turnos/${seleccionado.id}/accion/`, {
        accion,
      });

      const mensajes = {
        llamar: "Paciente llamado correctamente.",
        rellamar: "Llamada repetida correctamente.",
        finalizar: "Atención finalizada. El paciente figura en Atendidos.",
        no_presentado: "Turno registrado como no presentado.",
        cancelar: "Turno cancelado correctamente.",
      };

      setMensaje(mensajes[accion] || "Acción registrada correctamente.");

      await cargarTurnos(true);
    } catch (err) {
      const detalle = err.response?.data;

      const mensajeError =
        detalle?.estado ||
        detalle?.accion ||
        detalle?.detail ||
        "No se pudo registrar la acción. Inténtalo nuevamente.";

      setError(
        typeof mensajeError === "string"
          ? mensajeError
          : JSON.stringify(mensajeError)
      );
    } finally {
      setAccionEnCurso(false);
      setAccionActual(null);
    }
  }

  async function confirmarCambioConsultorio() {
    setCambiandoConsultorio(true);
    setErrorCambioConsultorio("");

    try {
      await onCambiarConsultorio();
      // El componente operativo se desmonta tras confirmar la desactivación.
    } catch (err) {
      setErrorCambioConsultorio(
        mensajeDeError(
          err,
          "No se pudo desactivar la computadora. Verifica la conexión e inténtalo nuevamente."
        )
      );
      setCambiandoConsultorio(false);
    }
  }

  const accionesDisponibles =
    seleccionado?.estado === "EN_ESPERA"
      ? [
          {
            accion: "llamar",
            texto: "Llamar paciente",
            color: "primary",
            icono: PhoneForwardedOutlinedIcon,
            variant: "contained",
          },
          {
            accion: "no_presentado",
            texto: "No se presentó",
            color: "warning",
            icono: PersonOffOutlinedIcon,
          },
          {
            accion: "cancelar",
            texto: "Cancelar turno",
            color: "error",
            icono: CancelOutlinedIcon,
          },
        ]
      : seleccionado?.estado === "LLAMANDO"
      ? [
          {
            accion: "rellamar",
            texto: "Volver a llamar",
            color: "primary",
            icono: ReplayIcon,
            variant: "contained",
          },
          {
            accion: "finalizar",
            texto: "Finalizar atención",
            color: "success",
            icono: DoneAllIcon,
            variant: "contained",
          },
          {
            accion: "no_presentado",
            texto: "No se presentó",
            color: "warning",
            icono: PersonOffOutlinedIcon,
          },
          {
            accion: "cancelar",
            texto: "Cancelar turno",
            color: "error",
            icono: CancelOutlinedIcon,
          },
        ]
      : [];

  if (cargando) {
    return (
      <Box
        sx={{
          minHeight: "70vh",
          display: "grid",
          placeItems: "center",
          bgcolor: "#F4F7FB",
        }}
      >
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <CircularProgress />
          <Typography color="text.secondary">
            Cargando pacientes del consultorio...
          </Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#F4F7FB", pb: 4 }}>
      {/* Encabezado institucional */}
      <Box
        sx={{
          bgcolor: "#103D70",
          color: "#fff",
          px: { xs: 2, md: 4 },
          py: 1.5,
        }}
      >
        <Container maxWidth="xl" disableGutters>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{
              alignItems: { xs: "flex-start", md: "center" },
              justifyContent: "space-between",
            }}
          >
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Box
                sx={{
                  width: { xs: 105, sm: 145 },
                  height: 52,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  bgcolor: "#fff",
                  borderRadius: 1.5,
                  px: 1,
                  py: 0.5,
                }}
              >
                <Box
                  component="img"
                  src="/minsa-logo.png"
                  alt="Ministerio de Salud del Perú"
                  sx={{
                    display: "block",
                    maxWidth: "100%",
                    maxHeight: "100%",
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                  }}
                />
              </Box>

              <Divider
                orientation="vertical"
                flexItem
                sx={{ borderColor: "rgba(255,255,255,.35)" }}
              />

              <Box>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {establecimiento?.nombre_ipress || "Establecimiento"}
                </Typography>
              </Box>
            </Stack>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              sx={{ alignItems: { xs: "stretch", sm: "center" } }}
            >
              <Box
                sx={{
                  bgcolor: "rgba(255,255,255,.12)",
                  px: 2,
                  py: 1,
                  borderRadius: 1.5,
                }}
              >
                <Typography fontWeight={700}>
                  {consultorio?.nombre || "Sin asignar"}
                </Typography>
              </Box>
              <Button
                variant="outlined"
                color="inherit"
                onClick={() => {
                  setErrorCambioConsultorio("");
                  setDialogoCambioAbierto(true);
                }}
                sx={{
                  borderColor: "rgba(255,255,255,.65)",
                  borderRadius: 1.5,
                  textTransform: "none",
                  whiteSpace: "nowrap",
                  "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,.08)" },
                }}
              >
                Cambiar consultorio
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ pt: 3 }}>
        <Stack spacing={2.5}>
          {/* Título y actualización */}
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{
              alignItems: { xs: "flex-start", md: "center" },
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="h4"
                fontWeight={800}
                color="#14294B"
                sx={{
                  whiteSpace: { xs: "normal", md: "nowrap" },
                  fontSize: { xs: "1.8rem", md: "2.125rem" },
                }}
              >
                Pacientes del consultorio
              </Typography>

            </Box>

            <Box
              sx={{
                flexShrink: 0,
                textAlign: { xs: "left", md: "right" },
                alignSelf: { xs: "stretch", md: "center" },
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {ultimaActualizacion
                  ? `Actualizado a las ${ultimaActualizacion.toLocaleTimeString(
                      "es-PE",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }
                    )}`
                  : "Sincronizando..."}
              </Typography>
            </Box>
          </Stack>

          {error && (
            <Alert severity="error" onClose={() => setError("")}>
              {error}
            </Alert>
          )}

          {mensaje && (
            <Alert severity="success" onClose={() => setMensaje("")}>
              {mensaje}
            </Alert>
          )}

          {/* Indicadores */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Card
              variant="outlined"
              sx={{
                flex: 1,
                border: "1px solid #D7E7FC",
                bgcolor: "#EAF3FF",
                borderRadius: 2.5,
                transition: "transform 180ms ease",
                "&:hover": { transform: "translateY(-2px)" },
              }}
            >
              <Box sx={{ p: 2.5 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <HourglassEmptyIcon sx={{ color: "#245DA8" }} />
                  <Typography color="#245DA8" fontWeight={600}>
                    En espera
                  </Typography>
                </Stack>
                <Typography variant="h3" fontWeight={800} color="#164E9A">
                  {cantidadEnEspera}
                </Typography>
              </Box>
            </Card>

            <Card
              variant="outlined"
              sx={{
                flex: 1,
                border: "1px solid #CBEBD7",
                bgcolor: "#EAF8EF",
                borderRadius: 2.5,
                transition: "transform 180ms ease",
                "&:hover": { transform: "translateY(-2px)" },
              }}
            >
              <Box sx={{ p: 2.5 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <CampaignIcon sx={{ color: "#267044" }} />
                  <Typography color="#267044" fontWeight={600}>
                    Llamando
                  </Typography>
                </Stack>
                <Typography variant="h3" fontWeight={800} color="#17663A">
                  {cantidadLlamando}
                </Typography>
              </Box>
            </Card>

            <Card
              variant="outlined"
              sx={{
                flex: 1,
                border: "1px solid #D9DDF8",
                bgcolor: "#F0F0FF",
                borderRadius: 2.5,
                transition: "transform 180ms ease",
                "&:hover": { transform: "translateY(-2px)" },
              }}
            >
              <Box sx={{ p: 2.5 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <CheckCircleIcon sx={{ color: "#5754A5" }} />
                  <Typography color="#5754A5" fontWeight={600}>
                    Atendidos
                  </Typography>
                </Stack>
                <Typography variant="h3" fontWeight={800} color="#45418C">
                  {cantidadAtendidos}
                </Typography>
              </Box>
            </Card>
          </Stack>

          {/* Tabla y panel de acciones */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                lg: "minmax(0, 2fr) minmax(290px, 1fr)",
              },
              gap: 2,
              alignItems: "start",
            }}
          >
            <Paper
              variant="outlined"
              sx={{ borderRadius: 2.5, overflow: "hidden" }}
            >
              <Box sx={{ px: 2, pt: 1 }}>
                <Tabs
                  value={filtro}
                  onChange={(_, valor) => {
                    setFiltro(valor);
                    setBusqueda("");

                    if (valor !== "ATENDIDOS") {
                      setSeleccionadoId((actual) =>
                        turnos.some((turno) => turno.id === actual)
                          ? actual
                          : turnos[0]?.id ?? null
                      );
                    }
                  }}
                  variant="scrollable"
                  scrollButtons="auto"
                >
                  <Tab
                    value="TODOS"
                    label={`Todos (${turnos.length})`}
                  />
                  <Tab
                    value="EN_ESPERA"
                    label={`En espera (${cantidadEnEspera})`}
                  />
                  <Tab
                    value="LLAMANDO"
                    label={`Llamando (${cantidadLlamando})`}
                  />
                  <Tab
                    value="ATENDIDOS"
                    label={`Atendidos (${cantidadAtendidos})`}
                  />
                </Tabs>
              </Box>

              <Divider />

              {filtro === "ATENDIDOS" && errorAtendidos && (
                <Alert severity="warning" sx={{ m: 2 }}>
                  {errorAtendidos}
                </Alert>
              )}

              <Box sx={{ p: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Buscar paciente por nombre..."
                  value={busqueda}
                  onChange={(event) => setBusqueda(event.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon color="action" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Box>

              <TableContainer>
                <Table size="medium" aria-label="Pacientes del consultorio">
                  <TableHead>
                    <TableRow sx={{ bgcolor: "#F5F8FC" }}>
                      <TableCell sx={{ fontWeight: 700, width: 55 }}>
                        #
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>
                        Paciente
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>
                        Hora cita
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>
                        Estado
                      </TableCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {turnosFiltrados.map((turno, indice) => {
                      const seleccionadoActual =
                        filtro !== "ATENDIDOS" &&
                        turno.id === seleccionadoId;

                      const numero = String(indice + 1).padStart(2, "0");
                      const estaLlamando = turno.estado === "LLAMANDO";

                      return (
                        <TableRow
                          key={turno.id}
                          hover
                          selected={seleccionadoActual}
                          onClick={() => {
                            if (filtro !== "ATENDIDOS") {
                              setSeleccionadoId(turno.id);
                            }
                          }}
                          sx={{
                            cursor:
                              filtro === "ATENDIDOS" ? "default" : "pointer",
                            transition: "background-color 180ms ease",
                            "&.Mui-selected": { bgcolor: "#E6F1FF" },
                            "&.Mui-selected:hover": { bgcolor: "#DCEBFF" },
                          }}
                        >
                          <TableCell>
                            <Typography
                              fontWeight={700}
                              color={
                                seleccionadoActual
                                  ? "primary.main"
                                  : "text.secondary"
                              }
                            >
                              {numero}
                            </Typography>
                          </TableCell>

                          <TableCell>
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: "center" }}
                            >
                              {estaLlamando && (
                                <Box
                                  sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: 30,
                                    height: 30,
                                    borderRadius: "50%",
                                    bgcolor: "#DDF5E6",
                                    color: "#16804A",
                                    animation:
                                      "pulsoBocina 1.5s ease-in-out infinite",
                                    "@keyframes pulsoBocina": {
                                      "0%, 100%": {
                                        transform: "scale(1)",
                                        boxShadow:
                                          "0 0 0 0 rgba(22,128,74,0.22)",
                                      },
                                      "50%": {
                                        transform: "scale(1.08)",
                                        boxShadow:
                                          "0 0 0 5px rgba(22,128,74,0)",
                                      },
                                    },
                                  }}
                                >
                                  <CampaignIcon fontSize="small" />
                                </Box>
                              )}

                              <Box>
                                <Typography fontWeight={700}>
                                  {nombreVisible(turno)}
                                </Typography>

                                {estaLlamando && (
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: "#16804A",
                                      fontWeight: 700,
                                    }}
                                  >
                                    Llamada activa
                                  </Typography>
                                )}
                              </Box>
                            </Stack>
                          </TableCell>

                          <TableCell>
                            <Stack
                              direction="row"
                              spacing={0.7}
                              sx={{ alignItems: "center" }}
                            >
                              <AccessTimeIcon
                                sx={{
                                  fontSize: 16,
                                  color: "text.secondary",
                                }}
                              />
                              <Typography variant="body2">
                                {horaVisible(turno.hora_cita)}
                              </Typography>
                            </Stack>
                          </TableCell>

                          <TableCell>
                            <Chip
                              size="small"
                              label={estadoVisible(turno.estado)}
                              color={
                                turno.estado === "LLAMANDO"
                                  ? "success"
                                  : turno.estado === "ATENDIDO"
                                  ? "default"
                                  : "info"
                              }
                              icon={
                                turno.estado === "ATENDIDO" ? (
                                  <CheckCircleIcon />
                                ) : undefined
                              }
                              sx={{
                                fontWeight: 600,
                                ...(estaLlamando && {
                                  animation:
                                    "pulsoEstado 1.5s ease-in-out infinite",
                                  "@keyframes pulsoEstado": {
                                    "0%, 100%": { opacity: 1 },
                                    "50%": { opacity: 0.65 },
                                  },
                                }),
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {turnosFiltrados.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Stack
                            spacing={1}
                            sx={{ py: 5, px: 2, alignItems: "center" }}
                          >
                            {filtro === "ATENDIDOS" ? (
                              <CheckCircleIcon
                                sx={{ fontSize: 38, color: "text.disabled" }}
                              />
                            ) : (
                              <NotificationsActiveOutlinedIcon
                                sx={{ fontSize: 38, color: "text.disabled" }}
                              />
                            )}

                            <Typography fontWeight={600}>
                              {filtro === "ATENDIDOS"
                                ? "Todavía no hay pacientes atendidos"
                                : "No hay pacientes para mostrar"}
                            </Typography>

                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ textAlign: "center" }}
                            >
                              {filtro === "ATENDIDOS"
                                ? "Los pacientes aparecerán aquí cuando finalices su atención."
                                : "Los nuevos turnos aparecerán cuando estén registrados y asociados a este consultorio."}
                            </Typography>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Divider />

              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {turnosFiltrados.length} paciente(s)
                </Typography>
              </Box>
            </Paper>

            {/* Panel de paciente y acciones */}
            <Stack spacing={2}>
              <Paper
                variant="outlined"
                sx={{ borderRadius: 2.5, p: 2.5 }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <AccountCircleIcon color="primary" />
                  <Typography variant="h6" fontWeight={800}>
                    Paciente seleccionado
                  </Typography>
                </Stack>

                {seleccionado ? (
                  <Box
                    sx={{
                      mt: 2,
                      p: 2,
                      bgcolor:
                        seleccionado.estado === "LLAMANDO"
                          ? "#EAF8EF"
                          : "#EDF5FF",
                      borderRadius: 2,
                      transition: "background-color 200ms ease",
                    }}
                  >
                    {seleccionado.estado === "LLAMANDO" && (
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{
                          alignItems: "center",
                          mb: 1.5,
                          color: "#16804A",
                          animation:
                            "pulsoLlamada 1.5s ease-in-out infinite",
                          "@keyframes pulsoLlamada": {
                            "0%, 100%": { opacity: 1 },
                            "50%": { opacity: 0.65 },
                          },
                        }}
                      >
                        <CampaignIcon />
                        <Typography fontWeight={800}>
                          Llamando al paciente
                        </Typography>
                      </Stack>
                    )}

                    <Typography
                      variant="h5"
                      fontWeight={800}
                      color="#173A6A"
                    >
                      {nombreVisible(seleccionado)}
                    </Typography>

                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ mt: 1.5, alignItems: "center", justifyContent: "space-between" }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        Hora de cita
                      </Typography>
                      <Typography fontWeight={700}>
                        {horaVisible(seleccionado.hora_cita)}
                      </Typography>
                    </Stack>

                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ mt: 1, alignItems: "center", justifyContent: "space-between" }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        Estado
                      </Typography>
                      <Chip
                        size="small"
                        label={estadoVisible(seleccionado.estado)}
                        color={
                          seleccionado.estado === "LLAMANDO"
                            ? "success"
                            : "info"
                        }
                      />
                    </Stack>
                  </Box>
                ) : (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    {filtro === "ATENDIDOS"
                      ? "Estás consultando el historial de pacientes atendidos."
                      : "Selecciona un paciente de la lista para gestionar su turno."}
                  </Alert>
                )}
              </Paper>

              <Paper
                variant="outlined"
                sx={{ borderRadius: 2.5, p: 2.5 }}
              >
                <Typography variant="h6" fontWeight={800}>
                  Acciones del turno
                </Typography>

                {seleccionado && filtro !== "ATENDIDOS" ? (
                  <Stack spacing={1.5} sx={{ mt: 2 }}>
                    {accionesDisponibles.map((item) => (
                      <BotonAccion
                        key={item.accion}
                        item={item}
                        accionEnCurso={accionEnCurso}
                        accionActual={accionActual}
                        ejecutarAccion={ejecutarAccion}
                      />
                    ))}

                    {accionesDisponibles.length === 0 && (
                      <Alert severity="info">
                        Este turno ya no admite acciones desde esta pantalla.
                      </Alert>
                    )}
                  </Stack>
                ) : (
                  <Typography
                    color="text.secondary"
                    variant="body2"
                    sx={{ mt: 1 }}
                  >
                    {filtro === "ATENDIDOS"
                      ? "Los turnos atendidos se muestran como historial y no admiten nuevas acciones."
                      : "Selecciona un paciente de la lista para habilitar sus acciones."}
                  </Typography>
                )}
              </Paper>
            </Stack>
          </Box>
        </Stack>
      </Container>

      <Dialog
        open={dialogoCambioAbierto}
        onClose={() => {
          if (!cambiandoConsultorio) setDialogoCambioAbierto(false);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontWeight: 800 }}>¿Cambiar de consultorio?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Esta computadora se desactivará del consultorio actual y dejará de gestionar su cola. Para continuar, tendrás que introducir un nuevo código de activación. ¿Deseas continuar?
          </DialogContentText>
          {errorCambioConsultorio && (
            <Alert severity="error" sx={{ mt: 2 }}>{errorCambioConsultorio}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2.5, pt: 1 }}>
          <Button
            onClick={() => setDialogoCambioAbierto(false)}
            disabled={cambiandoConsultorio}
            sx={{ textTransform: "none" }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={confirmarCambioConsultorio}
            disabled={cambiandoConsultorio}
            startIcon={cambiandoConsultorio ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ textTransform: "none", boxShadow: "none" }}
          >
            {cambiandoConsultorio ? "Desactivando..." : "Sí, cambiar consultorio"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
