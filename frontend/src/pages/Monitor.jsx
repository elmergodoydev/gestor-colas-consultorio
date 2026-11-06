import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";
import { generarAudioLlamado } from "../services/speechService";
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
    const baseFrontend = new URL(
      import.meta.env.BASE_URL,
      window.location.origin
    );
    const urlResuelta = new URL(url, baseFrontend);

    // Admite respuestas antiguas que devuelvan /media/ sin el subdirectorio.
    // No duplica el prefijo cuando Django ya devuelve /gestor-colas/media/.
    const esRecursoLocal =
      urlResuelta.origin === window.location.origin &&
      (urlResuelta.pathname.startsWith("/media/") ||
        urlResuelta.pathname.startsWith("/static/"));

    if (esRecursoLocal && baseFrontend.pathname !== "/") {
      const prefijo = baseFrontend.pathname.replace(/\/$/, "");
      urlResuelta.pathname = `${prefijo}${urlResuelta.pathname}`;
    }

    return urlResuelta.href;
  } catch {
    return url;
  }
}


/**
 * URL HTTP del MP3 silencioso publicado en frontend/public.
 * Se evita Blob URL para comprobar compatibilidad con navegadores Smart TV.
 */
function obtenerUrlAudioSilencioso() {
  const baseFrontend = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL("monitor-silence.mp3", baseFrontend).href;
}

function esperarAudioListo(audio, tiempoMaximo = 12000) {
  return new Promise((resolve, reject) => {
    if (audio.readyState >= 3) {
      resolve();
      return;
    }

    let finalizado = false;
    let temporizador = null;

    const limpiar = () => {
      audio.removeEventListener("canplay", alEstarListo);
      audio.removeEventListener("error", alOcurrirError);
      if (temporizador !== null) {
        window.clearTimeout(temporizador);
      }
    };

    const alEstarListo = () => {
      if (finalizado) return;
      finalizado = true;
      limpiar();
      resolve();
    };

    const alOcurrirError = () => {
      if (finalizado) return;
      finalizado = true;
      limpiar();
      reject(new Error("El MP3 no pudo cargarse correctamente."));
    };

    audio.addEventListener("canplay", alEstarListo);
    audio.addEventListener("error", alOcurrirError);

    temporizador = window.setTimeout(() => {
      if (finalizado) return;
      finalizado = true;
      limpiar();
      reject(new Error("Tiempo de espera agotado al preparar el audio."));
    }, tiempoMaximo);
  });
}

function esperarFinAudio(audio, cancelarEsperaRef) {
  return new Promise((resolve, reject) => {
    let finalizado = false;

    const limpiar = () => {
      audio.onended = null;
      audio.onerror = null;
      if (cancelarEsperaRef.current === cancelar) {
        cancelarEsperaRef.current = null;
      }
    };

    const terminar = (resultado, error = null) => {
      if (finalizado) return;
      finalizado = true;
      limpiar();
      if (error) reject(error);
      else resolve(resultado);
    };

    const cancelar = () => terminar(false);
    cancelarEsperaRef.current = cancelar;
    audio.onended = () => terminar(true);
    audio.onerror = () => terminar(false, new Error("El navegador no pudo reproducir el audio MP3."));

    try {
      const promesa = audio.play();
      if (promesa && typeof promesa.catch === "function") {
        promesa.catch((error) => terminar(false, error));
      }
    } catch (error) {
      terminar(false, error);
    }
  });
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
  const [habilitandoAudio, setHabilitandoAudio] = useState(false);
  const [diagnosticoAudio, setDiagnosticoAudio] = useState("");
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
  const temporizadorHabilitacionRef = useRef(null);
  const reproductorAudioRef = useRef(null);
  const reproductorVideoRef = useRef(null);
  const solicitudVozAbortRef = useRef(null);
  const cancelarEsperaAudioRef = useRef(null);
  const urlAudioRef = useRef(null);
  const urlSilencioRef = useRef(null);
  const versionVozRef = useRef(0);

  const detenerAudio = useCallback(() => {
    // Invalida cualquier síntesis/reproducción que siga pendiente.
    versionVozRef.current += 1;

    if (solicitudVozAbortRef.current) {
      if (typeof solicitudVozAbortRef.current.abort === "function") {
        solicitudVozAbortRef.current.abort();
      }
      solicitudVozAbortRef.current = null;
    }

    if (cancelarEsperaAudioRef.current) {
      cancelarEsperaAudioRef.current();
      cancelarEsperaAudioRef.current = null;
    }

    if (temporizadorVozRef.current) {
      window.clearTimeout(temporizadorVozRef.current);
      temporizadorVozRef.current = null;
    }

    if (temporizadorHabilitacionRef.current) {
      window.clearTimeout(temporizadorHabilitacionRef.current);
      temporizadorHabilitacionRef.current = null;
    }

    const reproductor = reproductorAudioRef.current;
    if (reproductor) {
      reproductor.pause();
      reproductor.onended = null;
      reproductor.onerror = null;
      reproductor.onplay = null;
      reproductor.removeAttribute("src");
      reproductor.load();
    }

    if (urlAudioRef.current) {
      URL.revokeObjectURL(urlAudioRef.current);
      urlAudioRef.current = null;
    }

    // La prueba usa un recurso HTTP estático, no un Blob URL.
    urlSilencioRef.current = null;

    reproduciendoRef.current = false;
  }, []);

  // En algunos navegadores de Smart TV, la reproducción de un audio puede
  // dejar pausado el elemento de video. Se intenta recuperar el video al terminar
  // cada locución, sin recargar su fuente ni reiniciar su posición.
  const recuperarVideo = useCallback((motivo = "recuperación") => {
    const video = reproductorVideoRef.current;
    if (!video) return;

    // No forzamos el silencio desde JavaScript: los controles nativos
    // del televisor deben permitir al usuario activar/desactivar el audio.

    if (!video.paused && !video.ended) return;

    console.info(`[Monitor] Reanudando video (${motivo}).`, {
      paused: video.paused,
      ended: video.ended,
      readyState: video.readyState,
      currentTime: video.currentTime,
      currentSrc: video.currentSrc,
    });

    try {
      const promesa = video.play();
      if (promesa && typeof promesa.catch === "function") {
        promesa.catch((error) => {
          console.warn(`[Monitor] El navegador no permitió reanudar el video (${motivo}):`, error);
        });
      }
    } catch (error) {
      console.warn(`[Monitor] Error al reanudar el video (${motivo}):`, error);
    }
  }, []);

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
    detenerAudio();
    localStorage.removeItem("monitor_token");
    localStorage.removeItem("monitor_nombre_equipo");
    setMonitorToken("");
    setDatos(null);
    audioHabilitadoRef.current = false;
    sonidoActivoRef.current = false;
    setAudioHabilitado(false);
    setHabilitandoAudio(false);
    setError(mensajeUsuario);
    setCargandoSesion(false);
    cursorRef.current = null;
    colaVozRef.current = [];
    anunciadosRef.current = new Set();
  }, [detenerAudio]);

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

  const procesarVoz = useCallback(async () => {
    if (
      !audioHabilitadoRef.current ||
      !sonidoActivoRef.current ||
      reproduciendoRef.current ||
      colaVozRef.current.length === 0
    ) {
      return;
    }

    const anuncio = colaVozRef.current.shift();
    if (!anuncio?.nombre || !anuncio?.consultorio) {
      temporizadorVozRef.current = window.setTimeout(() => {
        void procesarVoz();
      }, 0);
      return;
    }

    const texto = `${anuncio.nombre}, acercarse a ${anuncio.consultorio}.`;
    const versionActual = ++versionVozRef.current;
    let urlGenerada = null;
    let controlador = null;
    reproduciendoRef.current = true;

    try {
      // AbortController no está disponible en algunos navegadores antiguos de TV.
      // La síntesis funciona igualmente; solo se pierde la cancelación HTTP.
      controlador = typeof AbortController !== "undefined"
        ? new AbortController()
        : null;
      solicitudVozAbortRef.current = controlador;

      // Django genera el MP3 y devuelve una URL HTTP temporal.
      // El audio se conserva brevemente en Redis, no como archivo en disco.
      const urlAudio = await generarAudioLlamado(
        texto,
        monitorToken,
        controlador?.signal
      );

      if (
        versionActual !== versionVozRef.current ||
        !audioHabilitadoRef.current ||
        !sonidoActivoRef.current
      ) {
        return;
      }

      urlGenerada = urlAudio;
      urlAudioRef.current = urlGenerada;

      const reproductor = reproductorAudioRef.current;
      if (!reproductor) {
        throw new Error("El reproductor de audio del monitor no está disponible.");
      }
      reproductor.preload = "auto";
      reproductor.volume = 1;
      reproductor.src = urlGenerada;
      reproductor.load();

      // Espera a que el navegador tenga datos suficientes antes de iniciar
      // la locución. Esto evita que algunos Smart TV corten el comienzo del audio.
      await esperarAudioListo(reproductor);

      if (
        versionActual !== versionVozRef.current ||
        !audioHabilitadoRef.current ||
        !sonidoActivoRef.current
      ) {
        return;
      }

      // Se reproduce dos veces la misma URL temporal. No se vuelve a sintetizar.
      for (let repeticion = 0; repeticion < 2; repeticion += 1) {
        if (
          versionActual !== versionVozRef.current ||
          !sonidoActivoRef.current
        ) {
          break;
        }

        if (repeticion > 0) {
          reproductor.currentTime = 0;
        }

        const finalizo = await esperarFinAudio(
          reproductor,
          cancelarEsperaAudioRef
        );

        if (!finalizo || versionActual !== versionVozRef.current) {
          break;
        }

        if (repeticion === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 850));
        }
      }
    } catch (err) {
      if (
        versionActual === versionVozRef.current &&
        err?.name !== "AbortError" &&
        err?.code !== "ERR_CANCELED"
      ) {
        console.error("No se pudo generar o reproducir la locución:", err);
        setError(
          err?.message ||
            "No se pudo generar el audio del llamado. Verifica el servicio de voz del servidor."
        );
      }
    } finally {
      // Una reproducción cancelada no debe limpiar los recursos de otra nueva.
      if (versionActual === versionVozRef.current) {
        const reproductor = reproductorAudioRef.current;
        if (reproductor) {
          reproductor.pause();
          reproductor.onended = null;
          reproductor.onerror = null;
          reproductor.removeAttribute("src");
          reproductor.load();
        }

        if (urlGenerada) {
          // Las URLs HTTP pertenecen al servidor y vencen por TTL en Redis.
          // Solo revocamos URLs Blob si en el futuro se vuelve a utilizar ese mecanismo.
          if (urlGenerada.startsWith("blob:")) {
            URL.revokeObjectURL(urlGenerada);
          }
          if (urlAudioRef.current === urlGenerada) {
            urlAudioRef.current = null;
          }
        }

        if (solicitudVozAbortRef.current === controlador) {
          solicitudVozAbortRef.current = null;
        }

        cancelarEsperaAudioRef.current = null;
        reproduciendoRef.current = false;

        // La recuperación se realiza al finalizar la locución completa.
        // No se llama load(): así se conserva la fuente y el punto del video.
        recuperarVideo("fin de locución");

        if (
          audioHabilitadoRef.current &&
          sonidoActivoRef.current &&
          colaVozRef.current.length > 0
        ) {
          temporizadorVozRef.current = window.setTimeout(() => {
            void procesarVoz();
          }, 250);
        }
      }
    }
  }, [monitorToken, recuperarVideo]);

  // Se ejecuta directamente desde el clic. El elemento <audio> persistente
  // reproduce el MP3 de prueba y luego se reutiliza para las locuciones de Piper.
  const habilitarAudio = useCallback(() => {
    if (audioHabilitadoRef.current || habilitandoAudio) return;

    setError("");
    setDiagnosticoAudio("");
    setHabilitandoAudio(true);

    // El elemento <audio> está montado permanentemente en el DOM.
    // Reutilizar el mismo elemento es importante en navegadores de Smart TV:
    // la reproducción inicial ocurre directamente dentro del clic del usuario
    // y ese mismo reproductor se reutiliza luego para las locuciones de Piper.
    const reproductor = reproductorAudioRef.current;
    if (!reproductor) {
      setHabilitandoAudio(false);
      setError("No se encontró el reproductor de audio del monitor. Recarga la pantalla e inténtalo nuevamente.");
      return;
    }

    reproductor.pause();
    reproductor.removeAttribute("src");

    // Recurso MP3 estático servido por HTTP desde frontend/public.
    const urlSilenciosa = obtenerUrlAudioSilencioso();
    urlSilencioRef.current = urlSilenciosa;

    let finalizada = false;

    const limpiarPrueba = (conservarFuente = true) => {
      if (temporizadorHabilitacionRef.current) {
        window.clearTimeout(temporizadorHabilitacionRef.current);
        temporizadorHabilitacionRef.current = null;
      }
      reproductor.onended = null;
      reproductor.onerror = null;
      reproductor.pause();

      // Conservamos el elemento y su fuente después de la prueba. No se crea
      // otro Audio: el mismo reproductor recibirá después la URL HTTP de Piper.
      try {
        reproductor.currentTime = 0;
      } catch {
        // Algunos navegadores antiguos no permiten cambiar currentTime aún.
      }

      if (!conservarFuente) {
        reproductor.removeAttribute("src");
        reproductor.load();
      }
      if (urlSilencioRef.current === urlSilenciosa) {
        urlSilencioRef.current = null;
      }
    };

    const finalizarHabilitacion = () => {
      if (finalizada) return;
      finalizada = true;
      limpiarPrueba(true);

      audioHabilitadoRef.current = true;
      sonidoActivoRef.current = true;
      setAudioHabilitado(true);
      setSonidoActivo(true);
      setHabilitandoAudio(false);
      setDiagnosticoAudio("");

      // Se intenta iniciar el video después de habilitar el audio de los llamados.
      // El volumen queda bajo control de los controles nativos del reproductor.
      recuperarVideo("habilitación inicial del audio");

      void procesarVoz();
    };

    const fallarHabilitacion = (error, origen = "reproducción de prueba") => {
      if (finalizada) return;
      finalizada = true;
      const errorMedia = reproductor.error;
      const codigosMedia = {
        1: "reproducción abortada",
        2: "error de red",
        3: "error al decodificar el MP3",
        4: "formato o fuente no compatible",
      };
      const soporteMp3 = reproductor.canPlayType
        ? (reproductor.canPlayType('audio/mpeg; codecs="mp3"') || reproductor.canPlayType("audio/mpeg") || "no reconocido")
        : "canPlayType no disponible";
      const detalleMedia = errorMedia
        ? `${errorMedia.code}: ${codigosMedia[errorMedia.code] || "error multimedia desconocido"}`
        : "sin MediaError del navegador";
      const detalleError = `${error?.name || "Error"}: ${error?.message || String(error || "sin detalle")}`;
      const diagnostico = [
        `Origen: ${origen}`,
        `Detalle: ${detalleError}`,
        `Soporte MP3: ${soporteMp3}`,
        `Media: ${detalleMedia}`,
        `readyState: ${reproductor.readyState}`,
        `networkState: ${reproductor.networkState}`,
        `Fuente de prueba: ${urlSilenciosa}`,
        `User-Agent: ${navigator.userAgent || "no disponible"}`,
      ].join(" · ");

      limpiarPrueba(false);
      setHabilitandoAudio(false);
      setDiagnosticoAudio(diagnostico);
      setError("El navegador del televisor no confirmó la reproducción MP3 de prueba. Revisa el diagnóstico mostrado en esta ventana.");
      console.error("Diagnóstico de habilitación de audio del monitor:", {
        origen,
        error,
        soporteMp3,
        mediaError: errorMedia,
        readyState: reproductor.readyState,
        networkState: reproductor.networkState,
        urlSilenciosa,
        userAgent: navigator.userAgent,
      });
    };

    reproductor.onended = finalizarHabilitacion;
    reproductor.onerror = () => {
      fallarHabilitacion(
        new Error("El elemento Audio rechazó el MP3 silencioso."),
        "evento error del elemento Audio"
      );
    };
    reproductor.src = urlSilenciosa;

    // No llamamos load() antes de play(): en algunos Smart TV, load() puede
    // interrumpir el gesto de usuario que autoriza la reproducción.
    // play() se invoca sincrónicamente dentro del manejador del botón.
    temporizadorHabilitacionRef.current = window.setTimeout(() => {
      fallarHabilitacion(
        new Error("El navegador no terminó la reproducción del MP3 silencioso en 8 segundos."),
        "tiempo de espera agotado"
      );
    }, 8000);

    try {
      const promesa = reproductor.play();
      if (promesa && typeof promesa.catch === "function") {
        promesa.catch((error) => {
          fallarHabilitacion(error, "rechazo de HTMLAudioElement.play()");
        });
      }
    } catch (error) {
      fallarHabilitacion(error, "excepción al llamar HTMLAudioElement.play()");
    }
  }, [habilitandoAudio, procesarVoz, recuperarVideo]);

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
      detenerAudio();
      // Se conserva el permiso obtenido con el clic inicial.
      audioHabilitadoRef.current = true;
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
        // Usa la misma base pública de Vite que React Router y Axios.
        // Ejemplo: /gestor-colas/ws/monitor/ o /ws/monitor/ en la raíz.
        const baseFrontend = new URL(
          import.meta.env.BASE_URL,
          window.location.origin
        );
        const urlWebSocket = new URL("ws/monitor/", baseFrontend);

        urlWebSocket.protocol =
          window.location.protocol === "https:" ? "wss:" : "ws:";
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

      colaVozRef.current = [];
      detenerAudio();
      reproductorAudioRef.current = null;
    };
  }, [monitorToken, obtenerDatos, obtenerEventos, limpiarSesionLocal, detenerAudio]);

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
          <div className="activation-logo-wrap"><img src={`${import.meta.env.BASE_URL}minsa-logo.png`} alt="Logo del MINSA" /></div>
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
      {/* Reproductor único y persistente para navegadores Smart TV. */}
      <audio
        ref={reproductorAudioRef}
        preload="auto"
        style={{ display: "none" }}
        aria-hidden="true"
      />
      <header className="monitor-header">
        <div className="monitor-brand">
          <div className="monitor-logo"><img src={`${import.meta.env.BASE_URL}minsa-logo.png`} alt="Logo del MINSA" /></div>
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
            background: "rgba(10, 25, 45, 0.42)",
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
            {(error || diagnosticoAudio) && (
              <div
                role="alert"
                style={{
                  margin: "0 0 16px",
                  padding: "12px",
                  borderRadius: "8px",
                  background: "#fff0f0",
                  border: "1px solid #e6a0a0",
                  color: "#9b1c1c",
                  fontSize: "13px",
                  lineHeight: 1.45,
                  textAlign: "left",
                  overflowWrap: "anywhere",
                }}
              >
                <strong>{error || "No se pudo habilitar la reproducción de audio."}</strong>
                {diagnosticoAudio && (
                  <p style={{ margin: "8px 0 0", fontSize: "12px" }}>
                    {diagnosticoAudio}
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={habilitarAudio}
              disabled={habilitandoAudio}
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
              {habilitandoAudio ? "Habilitando audio…" : "Habilitar audio"}
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
                ref={reproductorVideoRef}
                className="monitor-video-player"
                src={resolverUrlVideo(videoActual.url)}
                autoPlay
                muted
                defaultMuted
                controls
                playsInline
                preload="auto"
                loop={videosReproduccion.length === 1}
                onPause={() => {
                  const video = reproductorVideoRef.current;
                  console.info("[Monitor] Video pausado.", {
                    currentTime: video?.currentTime,
                    readyState: video?.readyState,
                    currentSrc: video?.currentSrc,
                  });
                }}
                onWaiting={() => console.info("[Monitor] Video esperando datos (waiting).")}
                onStalled={() => console.warn("[Monitor] Video detenido por falta de datos (stalled).")}
                onPlaying={() => console.info("[Monitor] Video reproduciéndose.")}
                onEmptied={() => console.warn("[Monitor] La fuente del video quedó vacía (emptied).")}
                onEnded={() => {
                  if (videosReproduccion.length > 1) setIndiceVideo((actual) => (actual + 1) % videosReproduccion.length);
                }}
                onError={() => setError("No se pudo reproducir un video institucional. Verifica el archivo y la ruta multimedia asignada.")}
                aria-label={`Video institucional: ${videoActual.titulo || "Contenido institucional"}`}
              >
                Tu navegador no puede reproducir este formato de video.
              </video>
              <div className="monitor-video-overlay">
                {videosReproduccion.length > 1 && <small>{indiceVideo + 1} / {videosReproduccion.length}</small>}
              </div>
            </div>
          ) : (
            <div className="monitor-video-placeholder">
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
