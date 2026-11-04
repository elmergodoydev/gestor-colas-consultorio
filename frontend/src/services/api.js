import axios from "axios";

const api = axios.create({
  baseURL: `${import.meta.env.BASE_URL}api/`,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const autorizacionExplicita = Boolean(
    config.headers?.Authorization ||
    config.headers?.authorization
  );

  const tokenEquipo = localStorage.getItem("equipo_token");

  if (!autorizacionExplicita && tokenEquipo) {
    config.headers.Authorization = `Bearer ${tokenEquipo}`;
  }

  return config;
});

export default api;