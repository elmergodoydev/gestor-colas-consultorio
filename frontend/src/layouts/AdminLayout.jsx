import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import {
  Box,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";

import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import VideoLibraryOutlinedIcon from "@mui/icons-material/VideoLibraryOutlined";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import MedicalServicesOutlinedIcon from "@mui/icons-material/MedicalServicesOutlined";
import TvOutlinedIcon from "@mui/icons-material/TvOutlined";

import api from "../services/api";

const DRAWER_WIDTH = 250;

const estiloEnlace = {
  mx: 1.5,
  mb: 0.5,
  minHeight: 44,
  borderRadius: 2,
  color: "#475569",
  transition: "background-color 150ms ease, color 150ms ease",

  "&:hover": {
    bgcolor: "#f1f5f9",
  },

  "&.active": {
    bgcolor: "#eaf2ff",
    color: "#1565c0",
  },

  "&.active .MuiListItemIcon-root": {
    color: "#1565c0",
  },
};

export default function AdminLayout() {
  const location = useLocation();

  const coincidencia = location.pathname.match(
    /^\/ipress\/(\d+)\/(consultorios|monitores)\/?$/
  );

  const idIPRESS = coincidencia?.[1] ?? null;

  const [nombreIPRESS, setNombreIPRESS] = useState("");

  useEffect(() => {
    if (!idIPRESS) {
      setNombreIPRESS("");
      return undefined;
    }

    let cancelado = false;

    async function cargarNombre() {
      try {
        const respuesta = await api.get("ipress/");

        const lista = Array.isArray(respuesta.data)
          ? respuesta.data
          : respuesta.data.results ?? [];

        const establecimiento = lista.find(
          (item) => String(item.id) === idIPRESS
        );

        if (!cancelado) {
          setNombreIPRESS(
            establecimiento?.nombre_ipress ??
              "IPRESS seleccionada"
          );
        }
      } catch {
        if (!cancelado) {
          setNombreIPRESS("IPRESS seleccionada");
        }
      }
    }

    cargarNombre();

    return () => {
      cancelado = true;
    };
  }, [idIPRESS]);

  const opcionesGlobales = [
    {
      texto: "Registrar IPRESS",
      ruta: "/ipress",
      icono: <BusinessOutlinedIcon />,
    },
    {
      texto: "Biblioteca de videos",
      ruta: "/videos",
      icono: <VideoLibraryOutlinedIcon />,
    },
  ];

  const opcionesIPRESS = [
    {
      texto: "Registrar consultorios",
      ruta: `/ipress/${idIPRESS}/consultorios`,
      icono: <MedicalServicesOutlinedIcon />,
    },
    {
      texto: "Registrar monitores",
      ruta: `/ipress/${idIPRESS}/monitores`,
      icono: <TvOutlinedIcon />,
    },
  ];

  const opciones = idIPRESS
    ? opcionesIPRESS
    : opcionesGlobales;

  return (
    <Box
      sx={{
        display: "flex",
        width: "100%",
        minWidth: 0,
        minHeight: "100vh",
        bgcolor: "#f8fafc",
      }}
    >
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            bgcolor: "#ffffff",
            borderRight: "1px solid #e2e8f0",
            overflowX: "hidden",
          },
        }}
      >
        <Toolbar
          sx={{
            minHeight: "76px !important",
            px: 2,
            gap: 1.5,
          }}
        >
          <Box
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: 2,
              bgcolor: "#1565c0",
              color: "#fff",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <BusinessOutlinedIcon />
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Typography
              fontWeight={800}
              fontSize={14}
              color="#0f172a"
            >
              GESTOR DE COLAS
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
            >
              
            </Typography>
          </Box>
        </Toolbar>

        <Divider />

        {idIPRESS && (
          <Box sx={{ px: 1.5, py: 2 }}>
            <ListItemButton
              component={NavLink}
              to="/ipress"
              end
              sx={{
                ...estiloEnlace,
                mx: 0,
                mb: 2,
              }}
            >
              <ListItemIcon
                sx={{ minWidth: 36, color: "inherit" }}
              >
                <ArrowBackOutlinedIcon fontSize="small" />
              </ListItemIcon>

              <ListItemText
                primary="Todas las IPRESS"
                slotProps={{
                  primary: {
                    sx: { fontSize: 13 }
                  }
                }}
              />

            </ListItemButton>

            <Typography
              variant="overline"
              color="text.secondary"
              sx={{
                px: 1,
                display: "block",
                fontSize: 10,
                letterSpacing: 1,
              }}
            >
              ESTABLECIMIENTO
            </Typography>

            <Typography
              fontWeight={700}
              fontSize={14}
              sx={{
                px: 1,
                mt: 0.5,
                overflowWrap: "anywhere",
                color: "#0f172a",
              }}
            >
              {nombreIPRESS || "Cargando..."}
            </Typography>

          </Box>
        )}

        <Box sx={{ px: 1, pt: 2 }}>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{
              px: 2,
              display: "block",
              mb: 1,
              fontSize: 10,
              letterSpacing: 1,
            }}
          >
            {idIPRESS ? "CONFIGURACIÓN" : "ADMINISTRACIÓN"}
          </Typography>

          <List disablePadding>
            {opciones.map((opcion) => (
              <ListItemButton
                key={opcion.ruta}
                component={NavLink}
                to={opcion.ruta}
                end
                sx={estiloEnlace}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 40,
                    color: "inherit",
                  }}
                >
                  {opcion.icono}
                </ListItemIcon>

              <ListItemText
                primary={opcion.texto}
                slotProps={{
                  primary: {
                    sx: {
                      fontSize: 13.5,
                      fontWeight: 500,
                    },
                  },
                }}
              />
  
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>

      <Box
        component="main"
        sx={{
          flex: "1 1 0%",
          width: 0,
          minWidth: 0,
          minHeight: "100vh",
          overflowX: "hidden",
          bgcolor: "#f8fafc",
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}