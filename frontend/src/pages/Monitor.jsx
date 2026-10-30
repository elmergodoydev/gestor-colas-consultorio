import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";
import "./Monitor.css";

const RETRASO_RECONEXION_INICIAL = 2000;
const RETRASO_RECONEXION_MAXIMO = 15000;

function obtenerNombrePaciente(
  nombreCompleto = "",
  nombresSeparados = "",
  apellidoPaternoSeparado = ""
) {
  const nombres = (nombresSeparados || nombreCompleto)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!nombres.length) return { visible: "Paciente", voz: "Paciente" };

  const primerNombre = nombres[0];
  let apellidoPaterno = (apellidoPaternoSeparado || "").trim();

  if (!apellidoPaterno) {
    const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean);
    apellidoPaterno = partes.length >= 3 ? partes[partes.length - 2] : partes[1] || "";
  }

  return {
    visible: `${primerNombre.charAt(0).toUpperCase()}. ${apellidoPaterno.toUpperCase()}`.trim(),
    voz: `${primerNombre} ${apellidoPaterno}`.trim(),
  };
}

function horaActual() {
  return new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function fechaActual() {
  return new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function obtenerMensajeError(error, predeterminado) {
  const datos = error?.response?.data;
  if (typeof datos?.detail === "string") return datos.detail;
  if (typeof datos?.mensaje === "string") return datos.mensaje;
  if (datos && typeof datos === "object") {
    return Object.entries(datos)
      .map(([campo, valor]) => `${campo}: ${Array.isArray(valor) ? valor.join(", ") : String(valor)}`)
      .join(" · ");
  }
  return predeterminado;
}

function IconoAltavoz({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="32"
      height="32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M18.5 6.5a9 9 0 0 1 0 11" />
    </svg>
  );
}

function IconoOjo({ controlesVisibles }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="27"
      height="27"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.2 12s3.5-7 9.8-7 9.8 7 9.8 7-3.5 7-9.8 7-9.8-7-9.8-7Z" />
      <circle cx="12" cy="12" r="3.2" />
      {controlesVisibles && <path d="m4 4 16 16" />}
    </svg>
  );
}

function IconoPantallaCompleta({ activo = false }) {
  return activo ? (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  );
}

function credenciales(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function resolverUrlVideo(url) {
  if (!url) return "";
  try {
    const baseAPI = api.defaults?.baseURL || window.location.origin;
    const origenAPI = new URL(baseAPI, window.location.origin).origin;
    return new URL(url, origenAPI).href;
  } catch {
    return url;
  }
}

export default function Monitor() {
  const [monitorToken, setMonitorToken] = useState(() => localStorage.getItem("monitor_token") || "");
  const [codigo, setCodigo] = useState("");
  const [activando, setActivando] = useState(false);
  const [cargandoSesion, setCargandoSesion] = useState(Boolean(localStorage.getItem("monitor_token")));
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [sonidoActivo, setSonidoActivo] = useState(true);
  const [audioHabilitado, setAudioHabilitado] = useState(false);
  const [pantallaCompleta, setPantallaCompleta] = useState(Boolean(document.fullscreenElement));
  const [controlesVisibles, setControlesVisibles] = useState(false);
  const [indiceVideo, setIndiceVideo] = useState(0);
  const [horaReloj, setHoraReloj] = useState(horaActual);
  const clavePlaylist = (datos?.videos_reproduccion || []).map((video) => video.id).join("|");

  const cursorRef = useRef(null);
  const colaVozRef = useRef([]);
  const reproduciendoRef = useRef(false);
  const sonidoActivoRef = useRef(true);
  const audioHabilitadoRef = useRef(false);
  const procesandoEventosRef = useRef(false);
  const montadoRef = useRef(false);
  const anunciadosRef = useRef(new Set());
  const temporizadorVozRef = useRef(null);

  useEffect(() => {
    setIndiceVideo(0);
  }, [clavePlaylist]);

  useEffect(() => {
    const temporizador = window.setInterval(() => setHoraReloj(horaActual()), 1000);
    return () => window.clearInterval(temporizador);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("monitor-active");
    document.body.classList.add("monitor-active");
    return () => {
      document.documentElement.classList.remove("monitor-active");
      document.body.classList.remove("monitor-active");
    };
  }, []);

  useEffect(() => {
    const actualizarPantallaCompleta = () => setPantallaCompleta(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", actualizarPantallaCompleta);
    actualizarPantallaCompleta();
    return () => document.removeEventListener("fullscreenchange", actualizarPantallaCompleta);
  }, []);

  async function alternarPantallaCompleta() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else {
        setError("Este navegador no permite activar la pantalla completa desde la página. Usa F11.");
      }
    } catch {
      setError("No se pudo activar la pantalla completa. Prueba con F11 en el teclado.");
    }
  }

  const limpiarSesionLocal = useCallback((mensajeUsuario = "") => {
    localStorage.removeItem("monitor_token");
    localStorage.removeItem("monitor_nombre_equipo");
    setMonitorToken("");
    setDatos(null);
    audioHabilitadoRef.current = false;
    setAudioHabilitado(false);
    setError(mensajeUsuario);
    setCargandoSesion(false);
    cursorRef.current = null;
    colaVozRef.current = [];
    reproduciendoRef.current = false;
    if (temporizadorVozRef.current) window.clearTimeout(temporizadorVozRef.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  async function activarMonitor(event) {
    event.preventDefault();
    const codigoLimpio = codigo.trim().toUpperCase();
    if (!codigoLimpio) {
      setError("Ingresa el código de activación generado para este monitor.");
      return;
    }

    setActivando(true);
    setError("");
    setMensaje("");
    try {
      const respuesta = await api.post("monitor/activar/", { codigo: codigoLimpio });
      const token = respuesta.data?.token;
      if (!token) throw new Error("El servidor no devolvió el token de activación.");

      localStorage.setItem("monitor_token", token);
      localStorage.removeItem("monitor_nombre_equipo");
      cursorRef.current = null;
      anunciadosRef.current = new Set();
      setCodigo("");
      setDatos(null);
      setMonitorToken(token);
      setSonidoActivo(true);
      sonidoActivoRef.current = true;
      audioHabilitadoRef.current = false;
      setAudioHabilitado(false);
      setControlesVisibles(false);
      setMensaje("Monitor activado correctamente.");
    } catch (err) {
      setError(err.message && !err.response ? err.message : obtenerMensajeError(err, "No se pudo activar el monitor. Verifica el código e inténtalo nuevamente."));
    } finally {
      setActivando(false);
    }
  }

  const obtenerDatos = useCallback(async (token) => {
    try {
      const respuesta = await api.get("monitor/", credenciales(token));
      if (!montadoRef.current) return;
      setDatos(respuesta.data);
      setError("");
      setCargandoSesion(false);
    } catch (err) {
      if (!montadoRef.current) return;
      if (err.response?.status === 401 || err.response?.status === 403) {
        limpiarSesionLocal("La activación ya no es válida. Ingresa un nuevo código para volver a activar este monitor.");
      } else {
        setError("No se pudo actualizar la información. Verifica la conexión con el servidor.");
        setCargandoSesion(false);
      }
    }
  }, [limpiarSesionLocal]);

  const procesarVoz = useCallback(() => {
    // Chrome exige una interacción real del usuario antes de permitir
    // SpeechSynthesis.speak(). La cola se conserva hasta habilitar el audio.
    if (!audioHabilitadoRef.current || !sonidoActivoRef.current || reproduciendoRef.current || colaVozRef.current.length === 0 || !("speechSynthesis" in window)) return;
    const anuncio = colaVozRef.current.shift();
    if (!anuncio?.nombre || !anuncio?.consultorio) {
      temporizadorVozRef.current = window.setTimeout(() => procesarVoz(), 0);
      return;
    }

    reproduciendoRef.current = true;
    const hablar = (repeticion) => {
      if (!sonidoActivoRef.current) {
        reproduciendoRef.current = false;
        return;
      }
      const mensajeVoz = new SpeechSynthesisUtterance(`${anuncio.nombre}, acercarse a ${anuncio.consultorio}.`);
      mensajeVoz.lang = "es-PE";
      mensajeVoz.rate = 0.88;
      mensajeVoz.pitch = 1;
      mensajeVoz.volume = 1;
      mensajeVoz.onend = () => {
        if (repeticion === 1 && sonidoActivoRef.current) {
          temporizadorVozRef.current = window.setTimeout(() => hablar(2), 850);
        } else {
          reproduciendoRef.current = false;
          temporizadorVozRef.current = window.setTimeout(() => procesarVoz(), 250);
        }
      };
      mensajeVoz.onerror = () => {
        reproduciendoRef.current = false;
        temporizadorVozRef.current = window.setTimeout(() => procesarVoz(), 250);
      };
      window.speechSynthesis.speak(mensajeVoz);
    };
    hablar(1);
  }, []);

  // Se ejecuta directamente desde el clic del usuario. Esto habilita
  // SpeechSynthesis para el resto de la sesión de esta página.
  const habilitarAudio = useCallback(() => {
    if (!("speechSynthesis" in window)) {
      setError("Este navegador no admite los anuncios de voz.");
      return;
    }

    const sintesis = window.speechSynthesis;
    sintesis.cancel();

    audioHabilitadoRef.current = true;
    sonidoActivoRef.current = true;
    setAudioHabilitado(true);
    setSonidoActivo(true);
    setError("");

    // La primera locución debe iniciarse dentro del propio evento click.
    const confirmacion = new SpeechSynthesisUtterance("Audio de llamados habilitado.");
    confirmacion.lang = "es-PE";
    confirmacion.rate = 0.9;
    confirmacion.pitch = 1;
    confirmacion.volume = 0;

    reproduciendoRef.current = true;

    confirmacion.onend = () => {
      reproduciendoRef.current = false;
      procesarVoz();
    };

    confirmacion.onerror = (evento) => {
      console.error("No se pudo iniciar la voz de confirmación:", evento.error);
      reproduciendoRef.current = false;
      audioHabilitadoRef.current = false;
      setAudioHabilitado(false);
      setError("No se pudo habilitar el audio. Verifica el volumen y los permisos de sonido del navegador e inténtalo nuevamente.");
    };

    try {
      sintesis.speak(confirmacion);
    } catch (error) {
      console.error("Error al habilitar SpeechSynthesis:", error);
      reproduciendoRef.current = false;
      audioHabilitadoRef.current = false;
      setAudioHabilitado(false);
      setError("El navegador no pudo habilitar el audio. Inténtalo nuevamente.");
    }
  }, [procesarVoz]);

  function alternarSonido() {
    if (!audioHabilitadoRef.current) {
      habilitarAudio();
      return;
    }

    const nuevoEstado = !sonidoActivoRef.current;
    sonidoActivoRef.current = nuevoEstado;
    setSonidoActivo(nuevoEstado);
    if (nuevoEstado) {
      procesarVoz();
    } else {
      colaVozRef.current = [];
      reproduciendoRef.current = false;
      if (temporizadorVozRef.current) window.clearTimeout(temporizadorVozRef.current);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    }
  }

  const obtenerEventos = useCallback(async (token) => {
    if (procesandoEventosRef.current) return;
    procesandoEventosRef.current = true;
    try {
      const params = {};
      if (cursorRef.current !== null) params.desde_id = cursorRef.current;
      const respuesta = await api.get("monitor/eventos/", { ...credenciales(token), params });
      if (!montadoRef.current) return;
      const nuevosEventos = respuesta.data?.eventos || [];

      if (cursorRef.current === null) {
        cursorRef.current = respuesta.data?.ultimo_evento_id ?? 0;
        return;
      }

      cursorRef.current = respuesta.data?.ultimo_evento_id ?? cursorRef.current;
      if (nuevosEventos.length) {
        for (const evento of nuevosEventos) {
          if (anunciadosRef.current.has(evento.id)) continue;
          anunciadosRef.current.add(evento.id);
          const paciente = obtenerNombrePaciente(evento.nombre_paciente, evento.nombres_paciente, evento.apellido_paterno_paciente);
          colaVozRef.current.push({ nombre: paciente.voz, consultorio: evento.nombre_consultorio });
        }
        procesarVoz();
      }
    } catch (err) {
      if (!montadoRef.current) return;
      if (err.response?.status === 401 || err.response?.status === 403) {
        limpiarSesionLocal("La activación ya no es válida. Ingresa un nuevo código para volver a activar este monitor.");
      } else {
        console.error("Error al consultar los eventos del monitor:", err);
      }
    } finally {
      procesandoEventosRef.current = false;
    }
  }, [limpiarSesionLocal, procesarVoz]);

  useEffect(() => {
    if (!monitorToken) {
      setDatos(null);
      setCargandoSesion(false);
      return undefined;
    }

    let cancelado = false;
    let socket = null;
    let temporizadorInicio = null;
    let temporizadorReconexion = null;
    let retrasoReconexion = RETRASO_RECONEXION_INICIAL;
    let sincronizacionEnCurso = false;
    let sincronizacionPendiente = false;

    montadoRef.current = true;
    setCargandoSesion(true);
    cursorRef.current = null;
    procesandoEventosRef.current = false;
    anunciadosRef.current = new Set();
    setDatos(null);

    // La API REST se utiliza para obtener los datos completos, pero solo al iniciar
    // y cuando llega una notificación WebSocket. No existe polling periódico.
    const cargar = async () => {
      if (cancelado) return;

      if (sincronizacionEnCurso) {
        sincronizacionPendiente = true;
        return;
      }

      sincronizacionEnCurso = true;

      try {
        do {
          sincronizacionPendiente = false;

          await obtenerDatos(monitorToken);
          if (cancelado || !localStorage.getItem("monitor_token")) return;

          await obtenerEventos(monitorToken);
        } while (sincronizacionPendiente && !cancelado);
      } finally {
        sincronizacionEnCurso = false;
      }
    };

    const programarReconexion = () => {
      if (cancelado || temporizadorReconexion !== null) return;

      const demora = retrasoReconexion;
      temporizadorReconexion = window.setTimeout(() => {
        temporizadorReconexion = null;
        conectarWebSocket();
      }, demora);

      retrasoReconexion = Math.min(
        retrasoReconexion * 2,
        RETRASO_RECONEXION_MAXIMO
      );
    };

    const conectarWebSocket = () => {
      if (cancelado) return;

      if (
        socket &&
        (socket.readyState === WebSocket.CONNECTING ||
          socket.readyState === WebSocket.OPEN)
      ) {
        return;
      }

      try {
        const baseAPI = api.defaults?.baseURL || window.location.origin;
        const urlAPI = new URL(baseAPI, window.location.origin);
        const protocoloWebSocket =
          urlAPI.protocol === "https:" ? "wss:" : "ws:";

        const urlWebSocket = new URL("/ws/monitor/", urlAPI.origin);
        urlWebSocket.protocol = protocoloWebSocket;
        urlWebSocket.searchParams.set("token", monitorToken);

        const nuevaConexion = new WebSocket(urlWebSocket.toString());
        socket = nuevaConexion;

        nuevaConexion.onopen = () => {
          if (cancelado || socket !== nuevaConexion) {
            nuevaConexion.close();
            return;
          }

          console.info("WebSocket del monitor conectado.");
          retrasoReconexion = RETRASO_RECONEXION_INICIAL;

          // Recupera cambios que hayan ocurrido mientras la conexión estuvo caída.
          void cargar();
        };

        nuevaConexion.onmessage = (event) => {
          if (cancelado || socket !== nuevaConexion) return;

          try {
            const mensajeWebSocket = JSON.parse(event.data);

            if (mensajeWebSocket.tipo === "actualizar_monitor") {
              console.info(
                "Notificación recibida por WebSocket:",
                mensajeWebSocket
              );

              // El WebSocket avisa del cambio; la API devuelve los datos completos.
              void cargar();
            }
          } catch (error) {
            console.error(
              "No se pudo procesar el mensaje del WebSocket:",
              error
            );
          }
        };

        nuevaConexion.onerror = (error) => {
          if (cancelado) return;
          console.error("Error en la conexión WebSocket del monitor:", error);
          // El evento close se encarga de programar la reconexión.
        };

        nuevaConexion.onclose = (event) => {
          if (socket === nuevaConexion) socket = null;
          if (cancelado) return;

          console.warn(
            `WebSocket desconectado (código ${event.code}). Se intentará reconectar.`
          );

          // Estos códigos indican que la activación dejó de ser válida
          // o que el monitor ya no tiene autorización.
          if (event.code === 4401 || event.code === 4403) {
            limpiarSesionLocal(
              "La activación del monitor ya no es válida o no tiene acceso. Ingresa un nuevo código."
            );
            return;
          }

          programarReconexion();
        };
      } catch (error) {
        console.error("No se pudo crear la conexión WebSocket:", error);
        socket = null;
        programarReconexion();
      }
    };

    // Carga inicial: establece el estado y el cursor de eventos existentes.
    void cargar();

    // Se difiere la conexión un ciclo para evitar abrir y cerrar un socket
    // innecesariamente durante el montaje de comprobación de React StrictMode.
    temporizadorInicio = window.setTimeout(() => {
      temporizadorInicio = null;
      conectarWebSocket();
    }, 0);

    return () => {
      cancelado = true;
      montadoRef.current = false;

      if (temporizadorInicio !== null) {
        window.clearTimeout(temporizadorInicio);
        temporizadorInicio = null;
      }

      if (temporizadorReconexion !== null) {
        window.clearTimeout(temporizadorReconexion);
        temporizadorReconexion = null;
      }

      if (socket) {
        // Evita que el cierre provocado por el desmontaje active una reconexión.
        const conexionAnterior = socket;
        socket = null;
        conexionAnterior.onopen = null;
        conexionAnterior.onmessage = null;
        conexionAnterior.onerror = null;
        conexionAnterior.onclose = null;
        if (
          conexionAnterior.readyState === WebSocket.CONNECTING ||
          conexionAnterior.readyState === WebSocket.OPEN
        ) {
          conexionAnterior.close();
        }
      }

      if (temporizadorVozRef.current) {
        window.clearTimeout(temporizadorVozRef.current);
        temporizadorVozRef.current = null;
      }

      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      colaVozRef.current = [];
      reproduciendoRef.current = false;
    };
  }, [monitorToken, obtenerDatos, obtenerEventos, limpiarSesionLocal]);

  async function cambiarMonitor() {
    const confirmar = window.confirm("¿Deseas desactivar este monitor en este equipo? Para volver a usarlo necesitarás otro código de activación.");
    if (!confirmar) return;
    try {
      await api.post("monitor/desactivar/", {}, credenciales(monitorToken));
    } catch (err) {
      console.warn("No se pudo cerrar la activación en el servidor:", err);
    }
    limpiarSesionLocal("Monitor desactivado. Ingresa un nuevo código para activarlo.");
  }

  const llamados = datos?.llamados_activos || [];
  const nombreMonitor = datos?.monitor?.nombre || "Monitor de atención";
  const nombreIPRESS = datos?.establecimiento?.nombre_ipress || "Establecimiento de salud";
  const renipress = datos?.establecimiento?.codigo_renipress || "";
  const videosReproduccion = datos?.videos_reproduccion || [];
  const videoActual = videosReproduccion[indiceVideo] || videosReproduccion[0] || null;

  if (!monitorToken) {
    return (
      <main className="monitor-activation-screen">
        <section className="monitor-activation-card">
          <div className="activation-logo-wrap"><img src="/minsa-logo.png" alt="Logo del MINSA" /></div>
          <h1>Activación del monitor</h1>
          <p className="activation-description">Ingresa el código generado desde la configuración de monitores para cargar los consultorios asignados a esta pantalla.</p>
          <form className="monitor-activation-form" onSubmit={activarMonitor}>
            <label htmlFor="codigo-activacion">Código de activación</label>
            <input
              id="codigo-activacion"
              type="text"
              placeholder="ABCD-1234"
              value={codigo}
              onChange={(event) => setCodigo(event.target.value.toUpperCase())}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              maxLength={9}
              required
              autoFocus
            />
            {error && <div className="monitor-activation-error" role="alert">{error}</div>}
            {mensaje && <div className="monitor-activation-success" role="status">{mensaje}</div>}
            <button className="monitor-activate-button" type="submit" disabled={activando}>
              {activando ? "Activando monitor…" : "Activar monitor"}
            </button>
          </form>
          <div className="activation-footnote">El código se utiliza una sola vez y vence a los 30 minutos.</div>
        </section>
      </main>
    );
  }

  if (cargandoSesion && !datos) {
    return (
      <main className="monitor-loading-screen">
        <div className="monitor-loader-large" />
        <h1>Conectando con el monitor…</h1>
        <p>Verificando la activación y cargando los consultorios asignados.</p>
        {error && <div className="monitor-error">{error}</div>}
      </main>
    );
  }

  return (
    <main className="monitor">
      <header className="monitor-header">
        <div className="monitor-brand">
          <div className="monitor-logo"><img src="/minsa-logo.png" alt="Logo del MINSA" /></div>
          <div className="monitor-brand-text">
            <span className="monitor-renipress">{renipress || "RENIPRESS"}</span>
            <h1>{nombreIPRESS}</h1>
            <p>{nombreMonitor}</p>
          </div>
        </div>

        <div className="monitor-header-right">
          <div className="monitor-date">
            <strong>{fechaActual()}</strong>
          </div>
          <div className="monitor-clock" aria-label={`Hora actual ${horaReloj}`}>{horaReloj.slice(0, 5)}</div>
          <div className="monitor-tools-wrap">
            <button
              className={`monitor-eye-button ${controlesVisibles ? "is-open" : ""}`}
              type="button"
              onClick={() => setControlesVisibles((actual) => !actual)}
              aria-label={controlesVisibles ? "Ocultar controles del monitor" : "Mostrar controles del monitor"}
              aria-expanded={controlesVisibles}
              title={controlesVisibles ? "Ocultar controles" : "Mostrar controles"}
            >
              <IconoOjo controlesVisibles={controlesVisibles} />
            </button>
            {controlesVisibles && (
              <div className="monitor-controls-popover" role="group" aria-label="Controles del monitor">
                <button className="monitor-tool-button" type="button" onClick={alternarPantallaCompleta}>
                  <IconoPantallaCompleta activo={pantallaCompleta} />
                  <span>{pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa"}</span>
                </button>
                <button className={`monitor-tool-button monitor-tool-sound ${sonidoActivo ? "is-active" : "is-muted"}`} type="button" onClick={alternarSonido} aria-pressed={sonidoActivo}>
                  <IconoAltavoz />
                  <span>Llamado por voz: {sonidoActivo ? "activado" : "desactivado"}</span>
                </button>
                <button className="monitor-tool-button" type="button" onClick={cambiarMonitor}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4M8 10h8" /></svg>
                  <span>Cambiar monitor</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!audioHabilitado && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="monitor-audio-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            background: "rgba(10, 25, 45, 0.58)",
            backdropFilter: "blur(5px)",
          }}
        >
          <section
            style={{
              width: "min(460px, 100%)",
              padding: "32px",
              borderRadius: "18px",
              background: "#ffffff",
              color: "#18324b",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              textAlign: "center",
            }}
          >
            <div style={{ color: "#1479b8", marginBottom: "12px" }}>
              <IconoAltavoz />
            </div>
            <h2 id="monitor-audio-title" style={{ margin: "0 0 12px", fontSize: "24px" }}>
              Activar llamados por voz
            </h2>
            <p style={{ margin: "0 0 24px", color: "#5b6b7b", lineHeight: 1.5 }}>
              Para escuchar los nombres de los pacientes, habilita el audio de este monitor. Solo necesitas hacerlo una vez al abrir esta pantalla.
            </p>
            <button
              type="button"
              onClick={habilitarAudio}
              style={{
                width: "100%",
                minHeight: "48px",
                border: 0,
                borderRadius: "10px",
                background: "#0879bd",
                color: "#ffffff",
                fontSize: "16px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Habilitar audio
            </button>
          </section>
        </div>
      )}

      {error && <div className="monitor-error" role="status">{error}</div>}

      <section className="monitor-screen-grid" aria-label="Panel de atención">
        <aside className="monitor-video-section" aria-label="Contenido institucional">
          {videoActual?.url ? (
            <div className="monitor-video-playback">
              <video
                key={videoActual.id}
                className="monitor-video-player"
                src={resolverUrlVideo(videoActual.url)}
                autoPlay
                muted
                playsInline
                preload="auto"
                loop={videosReproduccion.length === 1}
                onEnded={() => {
                  if (videosReproduccion.length > 1) setIndiceVideo((actual) => (actual + 1) % videosReproduccion.length);
                }}
                onError={() => setError("No se pudo reproducir un video institucional. Verifica el archivo y la ruta multimedia asignada.")}
                aria-label={`Video institucional: ${videoActual.titulo || "Contenido institucional"}`}
              >
                Tu navegador no puede reproducir este formato de video.
              </video>
              <div className="monitor-video-overlay">
                <span>MINISTERIO DE SALUD</span>
                <strong>{videoActual.titulo || "Contenido institucional"}</strong>
                {videosReproduccion.length > 1 && <small>{indiceVideo + 1} / {videosReproduccion.length}</small>}
              </div>
            </div>
          ) : (
            <div className="monitor-video-placeholder">
              <div className="monitor-video-placeholder-mark">MINSA</div>
              <h2>Contenido institucional</h2>
              <p>Los videos asignados a este monitor se mostrarán aquí.</p>
            </div>
          )}
        </aside>

        <section className="monitor-call-section" aria-label="Llamados activos">
          <div className="monitor-call-list-heading">
            <div>
              <h2>Llamados actuales</h2>
            </div>
            <span className="monitor-live"><span className="monitor-live-dot" /> EN VIVO</span>
          </div>

          {!datos ? (
            <div className="monitor-empty-call-list"><div className="monitor-loader" /><h3>Conectando con los consultorios…</h3></div>
          ) : llamados.length === 0 ? (
            <div className="monitor-empty-call-list">
              <div className="monitor-empty-icon">✓</div>
              <h3>No hay llamados activos</h3>
              <p>Los nuevos llamados aparecerán automáticamente aquí.</p>
            </div>
          ) : (
            <div className="monitor-call-list">
              {llamados.map((llamado) => {
                const paciente = obtenerNombrePaciente(llamado.nombre_paciente, llamado.nombres_paciente, llamado.apellido_paterno_paciente);
                return (
                  <article className="monitor-call-row" key={llamado.id}>
                    <div className="monitor-call-speaker"><IconoAltavoz /></div>
                    <div className="monitor-call-consultorio" title={llamado.nombre_consultorio}>{llamado.nombre_consultorio || "Consultorio"}</div>
                    <div className="monitor-call-divider" aria-hidden="true" />
                    <div className="monitor-call-patient" title={paciente.visible}>{paciente.visible}</div>
                  </article>
                );
              })}
            </div>
          )}
          {llamados.length > 8 && <div className="monitor-more-calls">Hay {llamados.length} llamados activos · desliza para ver todos</div>}
        </section>
      </section>
    </main>
  );
}
