import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api/",
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  // Respeta el Bearer token enviado explícitamente por una pantalla.
  // Si no hay uno, conserva el comportamiento habitual del equipo de ventanilla.
  const autorizacionExplicita = Boolean(config.headers?.Authorization || config.headers?.authorization);
  const tokenEquipo = localStorage.getItem("equipo_token");

  if (!autorizacionExplicita && tokenEquipo) {
    config.headers.Authorization = `Bearer ${tokenEquipo}`;
  }

  return config;
});

export default api;
