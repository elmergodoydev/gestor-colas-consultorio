import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";
import "./Monitor.css";

const INTERVALO = 3000;
const MAX_HISTORIAL = 6;
const MAX_CONSULTORIOS = 6;

function obtenerNombrePaciente(nombreCompleto = "", nombresSeparados = "", apellidoPaternoSeparado = "") {
  const nombres = (nombresSeparados || nombreCompleto).trim().split(/\s+/).filter(Boolean);
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
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date());
}

function horaEvento(fecha) {
  if (!fecha) return "--:--";
  const valor = new Date(fecha);
  if (Number.isNaN(valor.getTime())) return "--:--";
  return valor.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fechaActual() {
  return new Intl.DateTimeFormat("es-PE", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  }).format(new Date());
}

function claseCuadricula(cantidad) {
  if (cantidad <= 1) return "grid-one";
  if (cantidad === 2) return "grid-two";
  if (cantidad === 3) return "grid-three";
  if (cantidad <= 4) return "grid-four";
  return "grid-dense";
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

function IconoAltavoz() {
  return (
    <svg className="monitor-speaker-svg" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M18.5 6.5a9 9 0 0 1 0 11" />
    </svg>
  );
}

function IconoTV() {
  return (
    <svg viewBox="0 0 64 64" width="88" height="88" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="12" width="50" height="35" rx="4" />
      <path d="m22 55 10-8 10 8M23 24l7 6-7 6M36 36h7" />
    </svg>
  );
}

function IconoPantallaCompleta({ activo = false }) {
  return activo ? (
    <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
  const [eventos, setEventos] = useState([]);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ultimaActualizacion, setUltimaActualizacion] = useState("");
  const [sonidoActivo, setSonidoActivo] = useState(true);
  const [pantallaCompleta, setPantallaCompleta] = useState(Boolean(document.fullscreenElement));
  const [indiceVideo, setIndiceVideo] = useState(0);
  const clavePlaylist = (datos?.videos_reproduccion || []).map((video) => video.id).join("|");

  useEffect(() => {
    setIndiceVideo(0);
  }, [clavePlaylist]);

  const cursorRef = useRef(null);
  const colaVozRef = useRef([]);
  const reproduciendoRef = useRef(false);
  const sonidoActivoRef = useRef(true);
  const procesandoEventosRef = useRef(false);
  const montadoRef = useRef(false);
  const anunciadosRef = useRef(new Set());
  const temporizadorVozRef = useRef(null);

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
    } catch (err) {
      setError("No se pudo activar la pantalla completa. Prueba con F11 en el teclado.");
    }
  }

  const limpiarSesionLocal = useCallback((mensajeUsuario = "") => {
    localStorage.removeItem("monitor_token");
    localStorage.removeItem("monitor_nombre_equipo");
    setMonitorToken("");
    setDatos(null);
    setEventos([]);
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
      const respuesta = await api.post("monitor/activar/", {
        codigo: codigoLimpio,
      });
      const token = respuesta.data?.token;
      if (!token) throw new Error("El servidor no devolvió el token de activación.");

      localStorage.setItem("monitor_token", token);
      localStorage.removeItem("monitor_nombre_equipo");
      cursorRef.current = null;
      anunciadosRef.current = new Set();
      setCodigo("");
      setDatos(null);
      setEventos([]);
      setMonitorToken(token);
      setSonidoActivo(true);
      sonidoActivoRef.current = true;
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
      setUltimaActualizacion(horaActual());
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
    if (!sonidoActivoRef.current || reproduciendoRef.current || colaVozRef.current.length === 0 || !("speechSynthesis" in window)) return;
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

  function alternarSonido() {
    const nuevoEstado = !sonidoActivoRef.current;
    sonidoActivoRef.current = nuevoEstado;
    setSonidoActivo(nuevoEstado);
    if (nuevoEstado) {
      // Un clic habilita el sintetizador de voz en navegadores con restricciones de reproducción.
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
        setEventos((anteriores) => [...nuevosEventos.slice().reverse(), ...anteriores].slice(0, MAX_HISTORIAL));
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
      setEventos([]);
      setCargandoSesion(false);
      return undefined;
    }

    let cancelado = false;
    montadoRef.current = true;
    setCargandoSesion(true);
    cursorRef.current = null;
    procesandoEventosRef.current = false;
    anunciadosRef.current = new Set();
    setDatos(null);
    setEventos([]);

    const cargar = async () => {
      if (cancelado) return;
      await obtenerDatos(monitorToken);
      if (cancelado) return;
      await obtenerEventos(monitorToken);
    };
    cargar();
    const intervalo = window.setInterval(cargar, INTERVALO);

    return () => {
      cancelado = true;
      montadoRef.current = false;
      window.clearInterval(intervalo);
      if (temporizadorVozRef.current) {
        window.clearTimeout(temporizadorVozRef.current);
        temporizadorVozRef.current = null;
      }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      colaVozRef.current = [];
      reproduciendoRef.current = false;
    };
  }, [monitorToken, obtenerDatos, obtenerEventos]);

  async function cambiarMonitor() {
    const confirmar = window.confirm("¿Deseas desactivar este monitor en este equipo? Para volver a usarlo necesitarás otro código de activación.");
    if (!confirmar) return;
    try {
      await api.post("monitor/desactivar/", {}, credenciales(monitorToken));
    } catch (err) {
      // Una sesión inválida no debe impedir borrar las credenciales locales.
      console.warn("No se pudo cerrar la activación en el servidor:", err);
    }
    limpiarSesionLocal("Monitor desactivado. Ingresa un nuevo código para activarlo.");
  }

  const llamados = datos?.llamados_activos || [];
  const atendidos = (datos?.atendidos_por_consultorio || []).slice(0, MAX_CONSULTORIOS);
  const gruposAtendidos = atendidos.length > 3 ? [atendidos.slice(0, 3), atendidos.slice(3, 6)] : [atendidos];
  const historial = datos
    ? [...(datos.ultimos_llamados || []), ...eventos]
      .filter((evento, indice, lista) => lista.findIndex((otro) => String(otro.evento_id ?? otro.id) === String(evento.evento_id ?? evento.id)) === indice)
      .sort((a, b) => new Date(b.fecha_evento) - new Date(a.fecha_evento))
      .slice(0, MAX_HISTORIAL)
    : [];
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
    return <main className="monitor-loading-screen"><div className="monitor-loader-large" /><h1>Conectando con el monitor…</h1><p>Verificando la activación y cargando los consultorios asignados.</p>{error && <div className="monitor-error">{error}</div>}</main>;
  }

  return (
    <main className="monitor">
      <header className="monitor-header">
        <div className="monitor-brand">
          <div className="monitor-logo"><img src="/minsa-logo.png" alt="Logo del MINSA" /></div>
          <div className="monitor-brand-text">
            <span className="monitor-eyebrow">MINISTERIO DE SALUD · {renipress || "IPRESS"}</span>
            <h1>{nombreIPRESS}</h1>
            <p>{nombreMonitor}</p>
          </div>
        </div>
        <div className="monitor-header-right">
          <div className="monitor-date"><strong>{fechaActual()}</strong><span>{ultimaActualizacion ? `Actualizado a las ${ultimaActualizacion}` : "Conectando con el servidor…"}</span></div>
          <button
            className="monitor-fullscreen-button"
            type="button"
            onClick={alternarPantallaCompleta}
            aria-label={pantallaCompleta ? "Salir de pantalla completa" : "Activar pantalla completa"}
            title={pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            <IconoPantallaCompleta activo={pantallaCompleta} />
          </button>
          <button className={`monitor-sound-button ${sonidoActivo ? "is-active" : "is-muted"}`} onClick={alternarSonido} type="button" aria-pressed={sonidoActivo}>
            <span className="monitor-sound-icon"><IconoAltavoz /></span>
            <span className="sound-button-copy"><strong>Llamado por voz</strong><small>{sonidoActivo ? "ACTIVADO" : "DESACTIVADO"}</small></span>
          </button>
          <button className="monitor-change-button" onClick={cambiarMonitor} type="button">Cambiar monitor</button>
        </div>
      </header>

      {error && <div className="monitor-error" role="status">{error}</div>}

      <section className="monitor-stage">
        <div className="monitor-calls-section">
          <div className="monitor-section-heading">
            <div><h2>Llamados actuales</h2></div>
            <div className="monitor-live"><span className="monitor-live-dot" /> EN VIVO</div>
          </div>

          {!datos ? (
            <div className="monitor-empty monitor-empty-main"><div className="monitor-loader" /><h3>Conectando con los consultorios…</h3></div>
          ) : llamados.length === 0 ? (
            <div className="monitor-empty monitor-empty-main"><div className="monitor-empty-icon">✓</div><h3>No hay llamados activos</h3><p>Los nuevos llamados aparecerán automáticamente aquí.</p></div>
          ) : (
            <div className={`monitor-calls-grid ${claseCuadricula(llamados.length)}`}>
              {llamados.map((llamado, indice) => {
                const paciente = obtenerNombrePaciente(llamado.nombre_paciente, llamado.nombres_paciente, llamado.apellido_paterno_paciente);
                return (
                  <article className={`monitor-call-card call-color-${indice % 5}`} key={llamado.id}>
                    <div className="monitor-card-top"><span className="monitor-call-label">LLAMADO ACTIVO</span><span className="monitor-call-status"><span className="monitor-speaker"><IconoAltavoz /></span>ACÉRQUESE</span></div>
                    <div className="monitor-card-main">
                      <div className="monitor-consultorio">{llamado.nombre_consultorio}</div>
                      {llamado.nombre_servicio && <div className="monitor-servicio">{llamado.nombre_servicio}</div>}
                      <div className="monitor-patient">{paciente.visible}</div>
                    </div>
                    <div className="monitor-card-bottom"><span>TURNO</span><strong>{llamado.codigo}</strong></div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="monitor-video-section" aria-label="Contenido institucional">
          <div className="monitor-video-heading">
            <span>{videoActual ? "CONTENIDO INSTITUCIONAL" : "INFORMACIÓN PARA EL PACIENTE"}</span>
            <span className={`video-ready-dot ${videoActual ? "is-ready" : ""}`} />
          </div>
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
                onEnded={() => setIndiceVideo((actual) => (actual + 1) % videosReproduccion.length)}
                aria-label={`Video institucional: ${videoActual.titulo}`}
              >
                Tu navegador no puede reproducir este formato de video.
              </video>
              <div className="monitor-video-caption">
                <strong>{videoActual.titulo}</strong>
                {videosReproduccion.length > 1 && <span>{indiceVideo + 1} / {videosReproduccion.length}</span>}
              </div>
            </div>
          ) : videoActual ? (
            <div className="monitor-video-placeholder"><div className="monitor-video-icon"><IconoTV /></div><h2>Video no disponible</h2><p>Comprueba el archivo multimedia asignado a este monitor.</p></div>
          ) : (
            <div className="monitor-video-placeholder"><div className="monitor-video-icon"><IconoTV /></div><h2>Aquí irá el video</h2><p>Selecciona videos desde la administración del monitor para reproducirlos en bucle.</p></div>
          )}
        </aside>
      </section>

      <section className="monitor-bottom">
        <div className="monitor-panel monitor-attended-panel">
          <div className="monitor-panel-heading"><div className="monitor-panel-icon">✓</div><div><h2>Atendidos hoy</h2></div></div>
          {atendidos.length === 0 ? <p className="monitor-muted">Sin datos de atención.</p> : (
            <div className={`monitor-attended-columns ${atendidos.length > 3 ? "has-two-columns" : ""}`}>
              {gruposAtendidos.map((grupo, indice) => <div className="monitor-attended-list" key={indice}>{grupo.map((item) => <div className="monitor-attended-row" key={item.codigo_consultorio}><span>{item.nombre_consultorio}</span><strong>{item.cantidad}</strong></div>)}</div>)}
            </div>
          )}
        </div>

        <div className="monitor-panel monitor-history-panel">
          <div className="monitor-panel-heading"><div className="monitor-panel-icon history-icon">↗</div><div><h2>Últimos llamados</h2></div></div>
          {historial.length > 0 && (
            <div className="monitor-history-grid">{historial.map((evento, indice) => {
              const paciente = obtenerNombrePaciente(evento.nombre_paciente, evento.nombres_paciente, evento.apellido_paterno_paciente);
              return <div className="monitor-history-row" key={`${evento.evento_id ?? evento.id}-${indice}`}><span className="monitor-history-time">{horaEvento(evento.fecha_evento)}</span><span className="monitor-history-patient">{paciente.visible}</span><span className="monitor-history-consultorio">{evento.nombre_consultorio}</span></div>;
            })}</div>
          )}
        </div>
      </section>

    </main>
  );
}
