
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ComputerOutlinedIcon from "@mui/icons-material/ComputerOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import api from "../services/api";

export default function Activar() {
  const [codigo, setCodigo] = useState("");
  const [nombreEquipo, setNombreEquipo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [equipo, setEquipo] = useState(null);

  async function activarEquipo(event) {
    event.preventDefault();

    const codigoLimpio = codigo.trim().toUpperCase();

    if (!codigoLimpio) {
      setError("Introduce el código de activación.");
      return;
    }

    setCargando(true);
    setError("");
    setEquipo(null);

    try {
      const respuesta = await api.post("activaciones/canjear/", {
        codigo: codigoLimpio,
        nombre_equipo: nombreEquipo.trim(),
      });

      const datos = respuesta.data;

      // La credencial se entrega una sola vez al equipo activado.
      localStorage.setItem("equipo_token", datos.token);
      localStorage.setItem("equipo_id", datos.equipo_id);
      localStorage.setItem(
        "equipo_consultorio",
        JSON.stringify(datos.consultorio)
      );
      localStorage.setItem(
        "equipo_establecimiento",
        JSON.stringify(datos.establecimiento)
      );

      setEquipo(datos);
      setCodigo("");
    } catch (err) {
      const detalle = err.response?.data;

      setError(
        typeof detalle?.codigo === "string"
          ? detalle.codigo
          : typeof detalle?.detail === "string"
            ? detalle.detail
            : "No se pudo activar el equipo. Verifica el código e inténtalo nuevamente."
      );
    } finally {
      setCargando(false);
    }
  }

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
      <Card variant="outlined" sx={{ borderRadius: 3 }}>
        <CardContent sx={{ p: { xs: 3, md: 5 } }}>
          <Stack spacing={3} alignItems="center">
            {equipo ? (
                <CheckCircleIcon
                color="success"
                sx={{ fontSize: 56 }}
                />
            ) : (
              <ComputerOutlinedIcon
                color="primary"
                sx={{ fontSize: 56 }}
              />
            )}

            <Box textAlign="center">
              <Typography
                variant="overline"
                color="primary"
                fontWeight={700}
              >
                GESTOR DE COLAS · SIHCE
              </Typography>

              <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
                {equipo ? "Equipo activado" : "Activar computadora"}
              </Typography>

              <Typography color="text.secondary" sx={{ mt: 1 }}>
                {equipo
                  ? "Esta computadora quedó vinculada al consultorio indicado."
                  : "Introduce el código que te proporcionó el área de OTI."}
              </Typography>
            </Box>

            {error && (
              <Alert severity="error" sx={{ width: "100%" }}>
                {error}
              </Alert>
            )}

            {equipo ? (
              <Stack spacing={2} sx={{ width: "100%" }}>
                <Alert severity="success">
                  {equipo.mensaje}
                </Alert>

                <Box
                  sx={{
                    p: 2.5,
                    bgcolor: "action.hover",
                    borderRadius: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Establecimiento
                  </Typography>
                  <Typography fontWeight={600}>
                    {equipo.establecimiento.nombre_ipress}
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 2 }}
                  >
                    Consultorio asignado
                  </Typography>
                  <Typography fontWeight={600}>
                    {equipo.consultorio.codigo} —{" "}
                    {equipo.consultorio.nombre}
                  </Typography>
                </Box>

                <Typography variant="body2" color="text.secondary">
                  La activación está registrada. El acceso a la cola
                  requiere completar la protección de la API.
                </Typography>
              </Stack>
            ) : (
              <Box
                component="form"
                onSubmit={activarEquipo}
                sx={{ width: "100%" }}
              >
                <Stack spacing={2.5}>
                  <TextField
                    label="Nombre de la computadora (opcional)"
                    value={nombreEquipo}
                    onChange={(event) =>
                      setNombreEquipo(event.target.value)
                    }
                    placeholder="Ej. PC Obstetricia 01"
                    fullWidth
                    inputProps={{ maxLength: 100 }}
                  />

                  <TextField
                    label="Código de activación"
                    value={codigo}
                    onChange={(event) =>
                      setCodigo(event.target.value.toUpperCase())
                    }
                    placeholder="XXXX-XXXX"
                    fullWidth
                    required
                    inputProps={{
                      maxLength: 20,
                      autoCapitalize: "characters",
                    }}
                  />

                  <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={cargando || !codigo.trim()}
                    sx={{ minHeight: 50 }}
                  >
                    {cargando ? (
                      <CircularProgress size={23} color="inherit" />
                    ) : (
                      "Activar computadora"
                    )}
                  </Button>
                </Stack>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
