import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import VerifiedOutlinedIcon from "@mui/icons-material/VerifiedOutlined";

import api from "../services/api";
import "./IPRESS.css";

function obtenerMensajeError(error, mensajePredeterminado) {
  const datos = error.response?.data;

  if (typeof datos?.mensaje === "string") {
    return datos.mensaje;
  }


  if (typeof datos?.detalle === "string") {
    return datos.detalle;
  }

  if (typeof datos?.detail === "string") {
    return datos.detail;
  }

  if (datos && typeof datos === "object") {
    return Object.entries(datos)
      .map(([campo, valor]) => {
        const texto = Array.isArray(valor)
          ? valor.join(", ")
          : typeof valor === "object" && valor !== null
            ? JSON.stringify(valor)
            : String(valor);

        return `${campo}: ${texto}`;
      })
      .join(" · ");
  }

  return mensajePredeterminado;
}

export default function IPRESS() {
  const navigate = useNavigate();

  const [ipress, setIpress] = useState([]);
  const [cargandoLista, setCargandoLista] = useState(true);

  const [dialogoRegistro, setDialogoRegistro] = useState(false);
  const [codigoRenipress, setCodigoRenipress] = useState("");
  const [datosValidados, setDatosValidados] = useState(null);

  const [validando, setValidando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const [ipressEliminar, setIpressEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);

  const [errorPagina, setErrorPagina] = useState("");
  const [errorFormulario, setErrorFormulario] = useState("");
  const [mensajePagina, setMensajePagina] = useState("");

  const cargarIPRESS = useCallback(async () => {
    setCargandoLista(true);

    try {
      const respuesta = await api.get("ipress/");

      const lista = Array.isArray(respuesta.data)
        ? respuesta.data
        : respuesta.data.results ?? [];

      setIpress(lista);
      setErrorPagina("");
    } catch (err) {
      setErrorPagina(
        obtenerMensajeError(
          err,
          "No se pudieron cargar las IPRESS registradas."
        )
      );
    } finally {
      setCargandoLista(false);
    }
  }, []);

  useEffect(() => {
    cargarIPRESS();
  }, [cargarIPRESS]);

  function abrirRegistro() {
    setCodigoRenipress("");
    setDatosValidados(null);
    setErrorFormulario("");
    setDialogoRegistro(true);
  }

  function cerrarRegistro() {
    if (validando || guardando) return;

    setDialogoRegistro(false);
    setCodigoRenipress("");
    setDatosValidados(null);
    setErrorFormulario("");
  }

  async function validarIPRESS() {
    const codigo = codigoRenipress.trim();

    if (!codigo) {
      setErrorFormulario("Ingresa el código RENIPRESS.");
      return;
    }

    setValidando(true);
    setDatosValidados(null);
    setErrorFormulario("");

    try {
      const respuesta = await api.post(
        "configuracion/ipress/validar/",
        {
          codigo_renipress: codigo,
        }
      );

      if (!respuesta.data?.valida) {
        setErrorFormulario(
          respuesta.data?.detalle ??
            "No se pudo validar el código RENIPRESS."
        );
        return;
      }

      setDatosValidados(respuesta.data);
    } catch (err) {
      setErrorFormulario(
        obtenerMensajeError(
          err,
          "No se pudo validar el código RENIPRESS."
        )
      );
    } finally {
      setValidando(false);
    }
  }

  async function registrarIPRESS() {
    if (!datosValidados?.valida) {
      setErrorFormulario("Primero debes validar el código RENIPRESS.");
      return;
    }

    setGuardando(true);
    setErrorFormulario("");

    try {
      const respuesta = await api.post("ipress/", {
        codigo_renipress: codigoRenipress.trim(),
      });

      const establecimiento = respuesta.data.establecimiento;
      const totalConsultorios = respuesta.data.consultorios_creados ?? 0;

      setDialogoRegistro(false);
      setCodigoRenipress("");
      setDatosValidados(null);

      setMensajePagina(
        `${establecimiento.nombre_ipress} se registró correctamente. ` +
          `Consultorios nuevos: ${totalConsultorios}.`
      );

      await cargarIPRESS();
    } catch (err) {
      setErrorFormulario(
        obtenerMensajeError(
          err,
          "No se pudo registrar la IPRESS."
        )
      );
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarIPRESS() {
    if (!ipressEliminar) return;

    setEliminando(true);
    setErrorPagina("");
    setMensajePagina("");

    try {
      await api.delete(`ipress/${ipressEliminar.id}/`);

      setMensajePagina(
        `${ipressEliminar.nombre_ipress} fue eliminada correctamente.`
      );

      setIpressEliminar(null);
      await cargarIPRESS();
    } catch (err) {
      setErrorPagina(
        obtenerMensajeError(
          err,
          "No se pudo eliminar la IPRESS."
        )
      );

      setIpressEliminar(null);
    } finally {
      setEliminando(false);
    }
  }

  return (
    <Box className="ipress-page">
      <Box className="ipress-page__content">
        <Box className="ipress-page__header">
          <Typography className="ipress-page__eyebrow">
            REGISTRAR IPRESS
          </Typography>

        </Box>

        {errorPagina && (
          <Alert
            severity="error"
            onClose={() => setErrorPagina("")}
            sx={{ mb: 2.5, borderRadius: 2 }}
          >
            {errorPagina}
          </Alert>
        )}

        {mensajePagina && (
          <Alert
            severity="success"
            onClose={() => setMensajePagina("")}
            sx={{ mb: 2.5, borderRadius: 2 }}
          >
            {mensajePagina}
          </Alert>
        )}

        <Box className="ipress-page__toolbar">
          <Box>
            <Typography
              variant="h6"
              fontWeight={700}
              color="#1e293b"
            >
              Establecimientos registrados
            </Typography>

            <Typography variant="body2" color="text.secondary">
              {ipress.length}{" "}
              {ipress.length === 1
                ? "establecimiento registrado"
                : "establecimientos registrados"}
            </Typography>
          </Box>

          <Box className="ipress-page__toolbar-actions">
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={cargarIPRESS}
              disabled={cargandoLista}
              sx={{
                borderRadius: 2,
                textTransform: "none",
                minHeight: 42,
              }}
            >
              Actualizar
            </Button>

            <Button
              variant="contained"
              startIcon={<AddCircleOutlinedIcon />}
              onClick={abrirRegistro}
              sx={{
                borderRadius: 2,
                textTransform: "none",
                minHeight: 42,
                boxShadow: "none",
              }}
            >
              Agregar IPRESS
            </Button>
          </Box>
        </Box>

        {cargandoLista ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              py: 8,
            }}
          >
            <CircularProgress />
          </Box>
        ) : ipress.length === 0 ? (
          <Box className="ipress-page__empty">
            <BusinessOutlinedIcon
              sx={{ fontSize: 42, color: "#94a3b8", mb: 2 }}
            />

            <Typography variant="h6" fontWeight={700}>
              No hay IPRESS registradas
            </Typography>

            <Typography
              color="text.secondary"
              sx={{ mt: 1, mb: 2.5 }}
            >
              Registra un establecimiento para comenzar.
            </Typography>

            <Button
              variant="contained"
              startIcon={<AddCircleOutlinedIcon />}
              onClick={abrirRegistro}
              sx={{ textTransform: "none", borderRadius: 2 }}
            >
              Registrar primera IPRESS
            </Button>
          </Box>
        ) : (
          <Box className="ipress-page__grid">
            {ipress.map((establecimiento) => (
              <Card
                key={establecimiento.id}
                variant="outlined"
                className="ipress-card"
              >
                <CardActionArea
                  className="ipress-card__action"
                  onClick={() =>
                    navigate(
                      `/ipress/${establecimiento.id}/consultorios`
                    )
                  }
                >
                  <CardContent className="ipress-card__content">
                    <Box className="ipress-card__icon">
                      <BusinessOutlinedIcon />
                    </Box>

                    <Typography className="ipress-card__label">
                      CÓDIGO RENIPRESS
                    </Typography>

                    <Typography className="ipress-card__code">
                      {establecimiento.codigo_renipress}
                    </Typography>

                    <Typography className="ipress-card__name">
                      {establecimiento.nombre_ipress}
                    </Typography>

                    <Typography className="ipress-card__open">
                      Administrar establecimiento →
                    </Typography>
                  </CardContent>
                </CardActionArea>

                <CardActions className="ipress-card__actions">
                  <Button
                    color="error"
                    variant="text"
                    size="small"
                    startIcon={<DeleteOutlinedIcon />}
                    onClick={() => {
                      setErrorPagina("");
                      setIpressEliminar(establecimiento);
                    }}
                    disabled={eliminando}
                    sx={{
                      textTransform: "none",
                      cursor: "pointer",
                    }}
                  >
                    Eliminar
                  </Button>
                </CardActions>
              </Card>
            ))}
          </Box>
        )}
      </Box>

      <Dialog
        open={dialogoRegistro}
        onClose={cerrarRegistro}
        fullWidth
        maxWidth="sm"
        PaperProps={{
          sx: { borderRadius: 3 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          Registrar IPRESS
        </DialogTitle>

        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Introduce el código RENIPRESS y valídalo antes de guardar.
              El nombre se obtiene del proveedor de datos.
            </Typography>

            <TextField
              label="Código RENIPRESS"
              value={codigoRenipress}
              onChange={(event) => {
                setCodigoRenipress(event.target.value);
                setDatosValidados(null);
                setErrorFormulario("");
              }}
              inputProps={{ maxLength: 20 }}
              placeholder="Ej. 00005644"
              fullWidth
              autoFocus
              disabled={validando || guardando}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !validando && !guardando) {
                  validarIPRESS();
                }
              }}
            />

            <Button
              variant="outlined"
              fullWidth
              startIcon={
                validando ? (
                  <CircularProgress size={18} />
                ) : (
                  <VerifiedOutlinedIcon />
                )
              }
              onClick={validarIPRESS}
              disabled={
                !codigoRenipress.trim() || validando || guardando
              }
              sx={{
                minHeight: 44,
                borderRadius: 2,
                textTransform: "none",
              }}
            >
              {validando ? "Validando RENIPRESS..." : "Validar RENIPRESS"}
            </Button>

            {errorFormulario && (
              <Alert
                severity="error"
                onClose={() => setErrorFormulario("")}
                sx={{ borderRadius: 2 }}
              >
                {errorFormulario}
              </Alert>
            )}

            {datosValidados?.valida && (
              <Alert
                severity="success"
                icon={<VerifiedOutlinedIcon />}
                sx={{ borderRadius: 2 }}
              >
                <Typography fontWeight={700}>
                  {datosValidados.establecimiento.nombre_ipress}
                </Typography>

                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  RENIPRESS:{" "}
                  {datosValidados.establecimiento.codigo_renipress}
                </Typography>

                <Typography variant="body2">
                  Consultorios encontrados:{" "}
                  {datosValidados.consultorios?.length ?? 0}
                </Typography>

                <Typography
                  variant="caption"
                  display="block"
                  sx={{ mt: 1 }}
                >
                  Fuente de datos: {datosValidados.fuente}
                </Typography>
              </Alert>
            )}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ p: 2.5, pt: 1 }}>
          <Button
            onClick={cerrarRegistro}
            disabled={guardando || validando}
            sx={{ textTransform: "none" }}
          >
            Cancelar
          </Button>

          <Button
            variant="contained"
            onClick={registrarIPRESS}
            disabled={
              !datosValidados?.valida || guardando || validando
            }
            sx={{
              minWidth: 145,
              borderRadius: 2,
              textTransform: "none",
              boxShadow: "none",
            }}
          >
            {guardando ? (
              <CircularProgress size={22} color="inherit" />
            ) : (
              "Guardar IPRESS"
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(ipressEliminar)}
        onClose={() => {
          if (!eliminando) setIpressEliminar(null);
        }}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: { borderRadius: 3 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          Eliminar IPRESS
        </DialogTitle>

        <DialogContent>
          <DialogContentText>
            ¿Confirmas que deseas eliminar{" "}
            <strong>{ipressEliminar?.nombre_ipress}</strong> (
            {ipressEliminar?.codigo_renipress})?
            <br />
            <br />
            Solo se podrá eliminar si no tiene consultorios, citas, turnos
            ni configuraciones relacionadas. Esta operación no se puede
            deshacer.
          </DialogContentText>
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button
            onClick={() => setIpressEliminar(null)}
            disabled={eliminando}
            sx={{ textTransform: "none" }}
          >
            Cancelar
          </Button>

          <Button
            color="error"
            variant="contained"
            onClick={eliminarIPRESS}
            disabled={eliminando}
            sx={{
              borderRadius: 2,
              textTransform: "none",
              boxShadow: "none",
            }}
          >
            {eliminando ? (
              <CircularProgress size={22} color="inherit" />
            ) : (
              "Confirmar eliminación"
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}