
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../services/api";
import "./Monitor.css";

const INTERVALO = 3000;
const MAX_HISTORIAL = 10;
const MAX_CONSULTORIOS = 10;

function obtenerNombrePaciente(
  nombreCompleto = "",
  nombresSeparados = "",
  apellidoPaternoSeparado = ""
) {
  const nombres = (nombresSeparados || nombreCompleto)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!nombres.length) {
    return { visible: "Paciente", voz: "Paciente" };
  }

  const primerNombre = nombres[0];
  let apellidoPaterno = apellidoPaternoSeparado.trim();

  // Compatibilidad con respuestas antiguas de la API.
  if (!apellidoPaterno) {
    const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean);
    apellidoPaterno =
      partes.length >= 3 ? partes[partes.length - 2] : partes[1] || "";
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

function horaEvento(fecha) {
  if (!fecha) return "--:--";

  const valor = new Date(fecha);
  if (Number.isNaN(valor.getTime())) return "--:--";

  return valor.toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fechaActual() {
  return new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function claseCuadricula(cantidad) {
  if (cantidad <= 1) return "grid-one";
  if (cantidad === 2) return "grid-two";
  if (cantidad === 3) return "grid-three";
  if (cantidad <= 8) return "grid-four";
  return "grid-five";
}

function IconoAltavoz() {
  return (
    <svg
      className="monitor-speaker-svg"
      viewBox="0 0 24 24"
      width="30"
      height="30"
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

export default function Monitor() {
  const [searchParams] = useSearchParams();

  // El parámetro de URL es opcional y sirve para hacer pruebas.
  // Si no existe, usamos la IPRESS guardada en PostgreSQL.
  const renipressEnURL = searchParams.get("renipress")?.trim() || "";

  const [renipress, setRenipress] = useState("");
  const [nombreIPRESS, setNombreIPRESS] = useState("");
  const [cargandoConfiguracion, setCargandoConfiguracion] =
    useState(true);

  const [datos, setDatos] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [error, setError] = useState("");
  const [ultimaActualizacion, setUltimaActualizacion] = useState("");
  const [sonidoActivo, setSonidoActivo] = useState(false);

  const cursorRef = useRef(null);
  const colaVozRef = useRef([]);
  const reproduciendoRef = useRef(false);
  const sonidoActivoRef = useRef(false);
  const procesandoEventosRef = useRef(false);
  const montadoRef = useRef(false);
  const anunciadosRef = useRef(new Set());
  const temporizadorVozRef = useRef(null);

  // Activa el modo pantalla completa solo para el monitor.
  useEffect(() => {
    document.documentElement.classList.add("monitor-active");
    document.body.classList.add("monitor-active");

    return () => {
      document.documentElement.classList.remove("monitor-active");
      document.body.classList.remove("monitor-active");
    };
  }, []);

  // Recupera la IPRESS activa guardada en PostgreSQL.
  useEffect(() => {
    let cancelado = false;

    async function cargarIPRESSActiva() {
      setCargandoConfiguracion(true);
      setError("");

      try {
        if (renipressEnURL) {
          setRenipress(renipressEnURL);
          setCargandoConfiguracion(false);
          return;
        }

        const respuesta = await api.get("configuracion/ipress/");

        if (cancelado) return;

        const configuracion = respuesta.data;
        const establecimiento = configuracion?.establecimiento;
        const codigo = establecimiento?.codigo_renipress;

        if (configuracion?.configurada && codigo) {
          setRenipress(codigo);
          setNombreIPRESS(establecimiento.nombre_ipress || "");
        } else {
          setRenipress("");
          setNombreIPRESS("");
          setError(
            "No hay una IPRESS configurada. Ve a Configuración y guarda el establecimiento."
          );
        }
      } catch (err) {
        if (cancelado) return;

        console.error("Error al recuperar la IPRESS:", err);
        setError(
          "No se pudo recuperar la IPRESS configurada. Verifica la conexión con Django."
        );
      } finally {
        if (!cancelado) {
          setCargandoConfiguracion(false);
        }
      }
    }

    cargarIPRESSActiva();

    return () => {
      cancelado = true;
    };
  }, [renipressEnURL]);

  const obtenerDatos = useCallback(async () => {
    if (!renipress) return;

    try {
      const respuesta = await api.get("monitor/", {
        params: { renipress },
      });

      if (!montadoRef.current) return;

      setDatos(respuesta.data);
      setNombreIPRESS(
        respuesta.data?.establecimiento?.nombre_ipress || ""
      );
      setError("");
      setUltimaActualizacion(horaActual());
    } catch (err) {
      if (!montadoRef.current) return;

      console.error("Error al cargar el monitor:", err);
      setError(
        "No se pudo actualizar la información. Verifica la conexión con el servidor."
      );
    }
  }, [renipress]);

  const procesarVoz = useCallback(() => {
    if (
      !sonidoActivoRef.current ||
      reproduciendoRef.current ||
      colaVozRef.current.length === 0 ||
      !("speechSynthesis" in window)
    ) {
      return;
    }

    const anuncio = colaVozRef.current.shift();

    if (!anuncio?.nombre || !anuncio?.consultorio) {
      temporizadorVozRef.current = window.setTimeout(
        procesarVoz,
        0
      );
      return;
    }

    reproduciendoRef.current = true;

    const hablar = (repeticion) => {
      if (!sonidoActivoRef.current) {
        reproduciendoRef.current = false;
        return;
      }

      const mensaje = new SpeechSynthesisUtterance(
        `${anuncio.nombre}, acercarse a ${anuncio.consultorio}.`
      );

      mensaje.lang = "es-PE";
      mensaje.rate = 0.88;
      mensaje.pitch = 1;
      mensaje.volume = 1;

      mensaje.onend = () => {
        if (repeticion === 1 && sonidoActivoRef.current) {
          temporizadorVozRef.current = window.setTimeout(
            () => hablar(2),
            1000
          );
        } else {
          reproduciendoRef.current = false;
          temporizadorVozRef.current = window.setTimeout(
            procesarVoz,
            300
          );
        }
      };

      mensaje.onerror = () => {
        reproduciendoRef.current = false;
        temporizadorVozRef.current = window.setTimeout(
          procesarVoz,
          300
        );
      };

      window.speechSynthesis.speak(mensaje);
    };

    hablar(1);
  }, []);

  function activarSonido() {
    sonidoActivoRef.current = true;
    setSonidoActivo(true);
    procesarVoz();
  }

  function desactivarSonido() {
    sonidoActivoRef.current = false;
    setSonidoActivo(false);
    colaVozRef.current = [];
    reproduciendoRef.current = false;

    if (temporizadorVozRef.current) {
      window.clearTimeout(temporizadorVozRef.current);
      temporizadorVozRef.current = null;
    }

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  const obtenerEventos = useCallback(async () => {
    if (!renipress || procesandoEventosRef.current) return;

    procesandoEventosRef.current = true;

    try {
      const params = { renipress };

      if (cursorRef.current !== null) {
        params.desde_id = cursorRef.current;
      }

      const respuesta = await api.get("monitor/eventos/", {
        params,
      });

      if (!montadoRef.current) return;

      const nuevosEventos = respuesta.data.eventos || [];

      // La primera consulta establece el cursor. Así no se
      // reproducen llamados antiguos al abrir el monitor.
      if (cursorRef.current === null) {
        cursorRef.current = respuesta.data.ultimo_evento_id ?? 0;
        return;
      }

      if (nuevosEventos.length > 0) {
        cursorRef.current = respuesta.data.ultimo_evento_id;

        setEventos((anteriores) =>
          [...nuevosEventos.slice().reverse(), ...anteriores].slice(
            0,
            MAX_HISTORIAL
          )
        );

        for (const evento of nuevosEventos) {
          if (anunciadosRef.current.has(evento.id)) continue;

          anunciadosRef.current.add(evento.id);

          const paciente = obtenerNombrePaciente(
            evento.nombre_paciente,
            evento.nombres_paciente,
            evento.apellido_paterno_paciente
          );

          colaVozRef.current.push({
            nombre: paciente.voz,
            consultorio: evento.nombre_consultorio,
          });
        }

        procesarVoz();
      } else {
        cursorRef.current = respuesta.data.ultimo_evento_id;
      }
    } catch (err) {
      console.error("Error al consultar eventos:", err);
    } finally {
      procesandoEventosRef.current = false;
    }
  }, [renipress, procesarVoz]);

  // Consulta los datos solo cuando tenemos el RENIPRESS.
  useEffect(() => {
    if (!renipress) {
      setDatos(null);
      setEventos([]);
      return;
    }

    montadoRef.current = true;
    cursorRef.current = null;
    procesandoEventosRef.current = false;
    anunciadosRef.current = new Set();
    setDatos(null);
    setEventos([]);

    obtenerDatos();
    obtenerEventos();

    const intervaloDatos = window.setInterval(
      obtenerDatos,
      INTERVALO
    );

    const intervaloEventos = window.setInterval(
      obtenerEventos,
      INTERVALO
    );

    return () => {
      montadoRef.current = false;
      window.clearInterval(intervaloDatos);
      window.clearInterval(intervaloEventos);

      if (temporizadorVozRef.current) {
        window.clearTimeout(temporizadorVozRef.current);
        temporizadorVozRef.current = null;
      }

      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      colaVozRef.current = [];
      reproduciendoRef.current = false;
    };
  }, [renipress, obtenerDatos, obtenerEventos]);

  const llamados = datos?.llamados_activos || [];

  const atendidos = (
    datos?.atendidos_por_consultorio || []
  ).slice(0, MAX_CONSULTORIOS);

  const gruposAtendidos =
    atendidos.length > 5
      ? [atendidos.slice(0, 5), atendidos.slice(5, 10)]
      : [atendidos];

  const historial = datos
    ? [...(datos.ultimos_llamados || []), ...eventos]
        .filter(
          (evento, indice, lista) =>
            lista.findIndex(
              (otro) =>
                String(otro.evento_id ?? otro.id) ===
                String(evento.evento_id ?? evento.id)
            ) === indice
        )
        .sort(
          (a, b) =>
            new Date(b.fecha_evento) - new Date(a.fecha_evento)
        )
        .slice(0, MAX_HISTORIAL)
    : [];

  return (
    <main className="monitor">
      <header className="monitor-header">
        <div className="monitor-brand">
          <div className="monitor-logo">
            <img src="/minsa-logo.png" alt="Logo del MINSA" />
          </div>

          <div className="monitor-brand-text">
            <span className="monitor-eyebrow">
              MINISTERIO DE SALUD
            </span>

            <h1>
              {datos?.establecimiento?.nombre_ipress ||
                nombreIPRESS ||
                "Monitor de atención"}
            </h1>

            <p>Sistema de llamado de pacientes</p>
          </div>
        </div>

        <div className="monitor-header-right">
          <div className="monitor-date">
            <strong>{fechaActual()}</strong>
            <span>
              {ultimaActualizacion
                ? `Actualizado a las ${ultimaActualizacion}`
                : "Conectando con el servidor…"}
            </span>
          </div>

          <button
            className={`monitor-sound-button ${
              sonidoActivo ? "is-active" : ""
            }`}
            onClick={
              sonidoActivo ? desactivarSonido : activarSonido
            }
            type="button"
          >
            <span aria-hidden="true">
              {sonidoActivo ? "♫" : "♪"}
            </span>
            {sonidoActivo ? "Sonido activado" : "Activar sonido"}
          </button>
        </div>
      </header>

      {error && (
        <div className="monitor-error" role="status">
          {error}
        </div>
      )}

      <section className="monitor-section">
        <div className="monitor-section-heading">
          <div>
            <span className="monitor-section-kicker">
              ATENCIÓN
            </span>
            <h2>Llamados actuales</h2>
          </div>

          <div className="monitor-live">
            <span className="monitor-live-dot" />
            EN VIVO
          </div>
        </div>

        {cargandoConfiguracion ? (
          <div className="monitor-empty">
            <div className="monitor-loader" />
            <p>Cargando configuración de la IPRESS…</p>
          </div>
        ) : !renipress ? (
          <div className="monitor-empty">
            <h3>IPRESS no configurada</h3>
            <p>
              Ve a Configuración y guarda el establecimiento para
              iniciar el monitor.
            </p>
          </div>
        ) : !datos ? (
          <div className="monitor-empty">
            <div className="monitor-loader" />
            <p>Cargando información de los consultorios…</p>
          </div>
        ) : llamados.length === 0 ? (
          <div className="monitor-empty">
            <div className="monitor-empty-icon">✓</div>
            <h3>No hay llamados activos</h3>
            <p>
              Los nuevos llamados aparecerán automáticamente
              en esta pantalla.
            </p>
          </div>
        ) : (
          <div
            className={`monitor-calls-grid ${claseCuadricula(
              llamados.length
            )} ${llamados.length > 4 ? "grid-dense" : ""}`}
          >
            {llamados.map((llamado) => {
              const paciente = obtenerNombrePaciente(
                llamado.nombre_paciente,
                llamado.nombres_paciente,
                llamado.apellido_paterno_paciente
              );

              return (
                <article
                  className="monitor-call-card"
                  key={llamado.id}
                >
                  <div className="monitor-card-top">
                    <span className="monitor-call-label">
                      LLAMADO ACTIVO
                    </span>

                    <span className="monitor-call-status">
                      <span className="monitor-speaker">
                        <IconoAltavoz />
                      </span>
                      <span>ACÉRQUESE</span>
                    </span>
                  </div>

                  <div className="monitor-card-main">
                    <div className="monitor-consultorio">
                      {llamado.nombre_consultorio}
                    </div>

                    {llamado.nombre_servicio && (
                      <div className="monitor-servicio">
                        {llamado.nombre_servicio}
                      </div>
                    )}

                    <div className="monitor-patient">
                      {paciente.visible}
                    </div>
                  </div>

                  <div className="monitor-card-bottom">
                    <span>Turno</span>
                    <strong>{llamado.codigo}</strong>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="monitor-bottom">
        <div className="monitor-panel monitor-attended-panel">
          <div className="monitor-panel-heading">
            <div className="monitor-panel-icon">✓</div>
            <div>
              <h2>Atendidos hoy</h2>
              <p>Resumen por consultorio</p>
            </div>
          </div>

          {atendidos.length === 0 ? (
            <p className="monitor-muted">
              Sin datos de atención.
            </p>
          ) : (
            <div
              className={`monitor-attended-columns ${
                atendidos.length > 5 ? "has-two-columns" : ""
              }`}
            >
              {gruposAtendidos.map((grupo, indice) => (
                <div
                  className="monitor-attended-list"
                  key={indice}
                >
                  {grupo.map((item) => (
                    <div
                      className="monitor-attended-row"
                      key={item.codigo_consultorio}
                    >
                      <span>{item.nombre_consultorio}</span>
                      <strong>{item.cantidad}</strong>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="monitor-panel monitor-history-panel">
          <div className="monitor-panel-heading">
            <div className="monitor-panel-icon history-icon">
              ↗
            </div>
            <div>
              <h2>Últimos llamados</h2>
              <p>Actividad reciente de los consultorios</p>
            </div>
          </div>

          {historial.length === 0 ? (
            <p className="monitor-muted">
              Aún no hay llamados registrados.
            </p>
          ) : (
            <div className="monitor-history-grid">
              {historial.map((evento, indice) => {
                const paciente = obtenerNombrePaciente(
                  evento.nombre_paciente,
                  evento.nombres_paciente,
                  evento.apellido_paterno_paciente
                );

                return (
                  <div
                    className="monitor-history-row"
                    key={`${evento.evento_id ?? evento.id}-${indice}`}
                  >
                    <span className="monitor-history-time">
                      {horaEvento(evento.fecha_evento)}
                    </span>
                    <span className="monitor-history-patient">
                      {paciente.visible}
                    </span>
                    <span className="monitor-history-consultorio">
                      {evento.nombre_consultorio}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <footer className="monitor-footer">
        <span>
          <span className="monitor-footer-dot" />
          {datos?.establecimiento?.nombre_ipress ||
            nombreIPRESS ||
            "IPRESS"}{" "}
          · {renipress || "Sin RENIPRESS"}
        </span>

        <span>Por favor, preste atención a los llamados.</span>
      </footer>
    </main>
  );
}
