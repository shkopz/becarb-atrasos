"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type RecordRow = {
  id: number;
  fecha: string;
  hora: string;
  categoria: string;
  source: string;
  created_by: string;
  rut_base: string;
  rut_completo: string;
  nombres: string;
  apellidos: string;
  nombre_completo: string;
  curso: string;
  email: string;
  month_key: string;
};

type RankingRow = {
  rut_base: string;
  rut_completo: string;
  nombres: string;
  apellidos: string;
  nombre_completo: string;
  curso: string;
  email: string;
  current_month_count: number;
  total_historic_count: number;
};

type PeriodRow = {
  key: string;
  year: number;
  month: number;
  label: string;
  is_current: boolean;
};

type DataManagementResponse = {
  ok: boolean;
  filters: {
    query: string;
    course: string;
    month: string;
    page: number;
    page_size: number;
  };
  total_records: number;
  total_pages: number;
  course_options: string[];
  periods: PeriodRow[];
  records: RecordRow[];
  rankings: {
    historical: RankingRow[];
    current: RankingRow[];
  };
  message?: string;
};

type SessionValidationResult = {
  ok: boolean;
  role: string;
  message: string;
};

type ToastState = {
  tone: "success" | "error" | "info";
  message: string;
};

type EmailTargetState = {
  rut_base: string;
  nombre: string;
  curso: string;
  email: string;
};

const SESSION_CHECK_INTERVAL_MS = 60_000;
const DATA_REFRESH_INTERVAL_MS = 60_000;
const AUTO_REFRESH_STORAGE_KEY = "becarb-gestion-datos-auto-refresh";

export default function GestionDatosPage() {
  const [queryInput, setQueryInput] = useState("");
  const [courseInput, setCourseInput] = useState("");
  const [monthInput, setMonthInput] = useState("");
  const [query, setQuery] = useState("");
  const [course, setCourse] = useState("");
  const [month, setMonth] = useState("");
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<DataManagementResponse | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [emailTarget, setEmailTarget] = useState<EmailTargetState | null>(null);
  const [emailComment, setEmailComment] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  const redirectTimerRef = useRef<number | null>(null);
  const emailTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const fetchUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    if (query.trim()) params.set("q", query.trim());
    if (course.trim()) params.set("course", course.trim());
    if (month.trim()) params.set("month", month.trim());
    return `/api/data-management?${params.toString()}`;
  }, [page, query, course, month]);

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (course.trim()) params.set("course", course.trim());
    if (month.trim()) params.set("month", month.trim());
    return `/api/export-data-management-filtered?${params.toString()}`;
  }, [query, course, month]);

  useEffect(() => {
    try {
      const savedValue = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
      setAutoRefreshEnabled(savedValue === "true");
    } catch {
      setAutoRefreshEnabled(false);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        AUTO_REFRESH_STORAGE_KEY,
        autoRefreshEnabled ? "true" : "false"
      );
    } catch {
      // Ignorar fallos de storage.
    }
  }, [autoRefreshEnabled]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootSession() {
      const session = await validateSession();

      if (cancelled) return;

      if (!session.ok) {
        setSessionReady(false);
        setSessionError(session.message);
        setLoading(false);

        redirectTimerRef.current = window.setTimeout(() => {
          window.location.href = "/";
        }, 1800);

        return;
      }

      setSessionReady(true);
      setSessionError("");
    }

    bootSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;

    const interval = window.setInterval(async () => {
      const session = await validateSession();

      if (!session.ok) {
        setSessionReady(false);
        setSessionError(session.message);
        setLoading(false);

        if (redirectTimerRef.current) {
          window.clearTimeout(redirectTimerRef.current);
        }

        redirectTimerRef.current = window.setTimeout(() => {
          window.location.href = "/";
        }, 1800);
      }
    }, SESSION_CHECK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [sessionReady]);

  useEffect(() => {
    if (!sessionReady || !autoRefreshEnabled) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setRefreshKey((prev) => prev + 1);
      }
    }, DATA_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [sessionReady, autoRefreshEnabled]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (
        document.visibilityState === "visible" &&
        sessionReady &&
        autoRefreshEnabled
      ) {
        setRefreshKey((prev) => prev + 1);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [sessionReady, autoRefreshEnabled]);

  useEffect(() => {
    if (!sessionReady) return;

    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(fetchUrl, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });

        const result: DataManagementResponse = await response.json();

        if (response.status === 401 || response.status === 403) {
          throw new Error(
            result.message || "Tu sesión ya no permite acceder a esta página."
          );
        }

        if (!response.ok || !result.ok) {
          throw new Error(
            result.message || "No se pudo cargar la gestión de datos."
          );
        }

        if (!cancelled) {
          setData(result);

          if (!monthInput && result.periods?.length > 0) {
            const current = result.periods.find((item) => item.is_current);
            if (current) {
              setMonthInput(current.key);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : "Error desconocido al cargar la gestión de datos.";

          setError(message);
          setData(null);

          if (
            /sesión|acceder a esta página|autorizado|autenticado|permiso/i.test(
              message
            )
          ) {
            setSessionReady(false);
            setSessionError(message);

            if (redirectTimerRef.current) {
              window.clearTimeout(redirectTimerRef.current);
            }

            redirectTimerRef.current = window.setTimeout(() => {
              window.location.href = "/";
            }, 1800);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [fetchUrl, monthInput, sessionReady, refreshKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!emailTarget) return;

    const timer = window.setTimeout(() => {
      emailTextareaRef.current?.focus();
    }, 50);

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !sendingEmail) {
        closeEmailModal();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [emailTarget, sendingEmail]);

  async function copyEmail(email: string) {
    if (!email) {
      setToast({
        tone: "info",
        message: "Este estudiante no tiene correo registrado.",
      });
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(email);
      } else {
        const temp = document.createElement("textarea");
        temp.value = email;
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        document.body.appendChild(temp);
        temp.focus();
        temp.select();
        document.execCommand("copy");
        temp.remove();
      }

      setToast({
        tone: "success",
        message: `Correo copiado al portapapeles: ${email}`,
      });
    } catch {
      setToast({
        tone: "error",
        message: "No se pudo copiar el correo.",
      });
    }
  }

  function handleApplyFilters(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
    setCourse(courseInput.trim());
    setMonth(monthInput.trim());
  }

  function handleClearFilters() {
    const current = data?.periods?.find((item) => item.is_current);
    setQueryInput("");
    setCourseInput("");
    setMonthInput(current?.key || "");
    setQuery("");
    setCourse("");
    setMonth(current?.key || "");
    setPage(1);
  }

  function openEmailModal(record: RecordRow) {
    if (!record.email) {
      setToast({
        tone: "info",
        message: "Este estudiante no tiene correo registrado.",
      });
      return;
    }

    setEmailComment("");
    setEmailTarget({
      rut_base: record.rut_base,
      nombre: formatDisplayName(record.nombre_completo),
      curso: record.curso,
      email: record.email,
    });
  }

  function closeEmailModal() {
    if (sendingEmail) return;
    setEmailTarget(null);
    setEmailComment("");
  }

  async function handleSendEmail() {
    if (!emailTarget || sendingEmail) return;

    try {
      setSendingEmail(true);

      const response = await fetch("/api/send-student-tardy-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          rut_base: emailTarget.rut_base,
          comentario: emailComment.trim(),
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message || "No se pudo enviar el correo al estudiante."
        );
      }

      setToast({
        tone: "success",
        message: "Correo enviado correctamente.",
      });
      setEmailTarget(null);
      setEmailComment("");
    } catch (err) {
      setToast({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Ocurrió un error al enviar el correo.",
      });
    } finally {
      setSendingEmail(false);
    }
  }

  const records = data?.records || [];
  const courses = data?.course_options || [];
  const periods = data?.periods || [];
  const totalPages = data?.total_pages || 1;
  const totalRecords = data?.total_records || 0;

  if (!sessionReady && sessionError) {
    return (
      <main style={mainStyle}>
        <div style={containerStyle}>
          <section style={cardStyle}>
            <h1 style={{ margin: 0, fontSize: "28px", color: "#1d2430", fontWeight: 800 }}>
              Gestión de Datos
            </h1>
            <div style={{ marginTop: "16px", ...errorBoxStyle }}>
              {sessionError}
            </div>
            <p
              style={{
                margin: "16px 0 0",
                color: "#5f6570",
                fontSize: "14px",
                lineHeight: 1.6,
              }}
            >
              Serás redirigido al sistema principal en unos segundos.
            </p>
            <div style={{ marginTop: "18px" }}>
              <a href="/" style={backLinkStyle}>
                ← Volver ahora
              </a>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!sessionReady) {
    return (
      <main style={mainStyle}>
        <div style={containerStyle}>
          <section style={cardStyle}>
            <div style={infoBoxStyle}>Validando sesión y permisos...</div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <div style={containerStyle}>
        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "16px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "20px",
                flexWrap: "wrap",
                flex: 1,
                minWidth: "280px",
              }}
            >
              <div
                style={{
                  width: "clamp(150px, 22vw, 230px)",
                  height: "clamp(64px, 8vw, 92px)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <img
                  src="https://becarb.cl/wp-content/uploads/2019/10/logoweb_becarb_trans.png"
                  alt="Logo Becarb"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              </div>

              <div style={{ minWidth: "260px", flex: 1 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: "15px",
                    fontWeight: 400,
                    color: "#1d74b7",
                    lineHeight: 1.2,
                  }}
                >
                  Control y Auditoría
                </p>
                <h1
                  style={{
                    margin: "6px 0 8px",
                    fontSize: "32px",
                    lineHeight: 1.1,
                    color: "#1d2430",
                    fontWeight: 800,
                  }}
                >
                  Gestión de Datos
                </h1>
                <p
                  style={{
                    margin: 0,
                    color: "#5f6570",
                    fontSize: "15px",
                    lineHeight: 1.6,
                    maxWidth: "760px",
                  }}
                >
                  Revisa los marcajes registrados, filtra por nombre, RUT, curso o mes, y consulta los rankings de atrasos históricos y vigentes.
                </p>
              </div>
            </div>

            <a href="/demo-ui/interface-base.html" style={backLinkStyle}>
             ← Volver
            </a>
          </div>
        </section>

        <section style={cardStyle}>
          <form
            onSubmit={handleApplyFilters}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "12px",
              alignItems: "end",
            }}
          >
            <label style={labelStyle}>
              Buscar por nombre o RUT
              <input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Ej: Hellen, 23222558, 23.222.558-0"
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              Filtrar por curso
              <select
                value={courseInput}
                onChange={(e) => setCourseInput(e.target.value)}
                style={inputStyle}
              >
                <option value="">Todos los cursos</option>
                {courses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              Filtrar por mes
              <select
                value={monthInput}
                onChange={(e) => setMonthInput(e.target.value)}
                style={inputStyle}
              >
                <option value="">Todos los meses</option>
                {periods.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" style={primaryButtonStyle}>
              Aplicar filtros
            </button>

            <button
              type="button"
              onClick={handleClearFilters}
              style={secondaryButtonStyle}
            >
              Limpiar
            </button>
          </form>
        </section>

        {toast ? <Toast tone={toast.tone} message={toast.message} /> : null}

        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "16px",
              marginBottom: "16px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "24px",
                  color: "#1d2430",
                  fontWeight: 800,
                }}
              >
                Marcajes registrados
              </h2>
              <p style={{ margin: "6px 0 0", color: "#5f6570", fontSize: "14px" }}>
                Página {page} de {totalPages} · {totalRecords} registro(s)
              </p>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <a
                href={exportUrl}
                style={totalRecords > 0 ? exportButtonStyle : disabledExportButtonStyle}
                aria-disabled={totalRecords === 0}
                onClick={(event) => {
                  if (totalRecords === 0) {
                    event.preventDefault();
                  }
                }}
                title={
                  totalRecords > 0
                    ? "Exportar a Excel todos los registros que coincidan con los filtros actuales"
                    : "No hay registros filtrados para exportar"
                }
              >
                ⬇ Exportar a Excel
              </a>

              <label style={toggleWrapperStyle}>
                <span style={{ fontSize: "13px", color: "#5f6570", fontWeight: 700 }}>
                  Actualización automática
                </span>

                <button
                  type="button"
                  aria-pressed={autoRefreshEnabled}
                  onClick={() => setAutoRefreshEnabled((prev) => !prev)}
                  style={toggleButtonStyle(autoRefreshEnabled)}
                  title={
                    autoRefreshEnabled
                      ? "Desactivar actualización automática"
                      : "Activar actualización automática"
                  }
                >
                  <span style={toggleKnobStyle(autoRefreshEnabled)} />
                </button>

                <span
                  style={{
                    fontSize: "13px",
                    color: autoRefreshEnabled ? "#0b9f6b" : "#5f6570",
                    fontWeight: 800,
                    minWidth: "34px",
                    textAlign: "right",
                  }}
                >
                  {autoRefreshEnabled ? "ON" : "OFF"}
                </span>
              </label>
            </div>
          </div>

          <div style={legendContainerStyle}>
            <span style={legendTitleStyle}>Leyenda de categorías:</span>

            <div style={legendItemStyle}>
              <span style={pillStyle("A")}>A</span>
              <span style={legendTextStyle}>Atraso leve</span>
            </div>

            <div style={legendItemStyle}>
              <span style={pillStyle("B")}>B</span>
              <span style={legendTextStyle}>Atraso intermedio</span>
            </div>

            <div style={legendItemStyle}>
              <span style={pillStyle("C")}>C</span>
              <span style={legendTextStyle}>Atraso grave</span>
            </div>
          </div>

          {loading ? (
            <div style={infoBoxStyle}>Cargando marcajes...</div>
          ) : error ? (
            <div style={errorBoxStyle}>{error}</div>
          ) : records.length === 0 ? (
            <div style={infoBoxStyle}>No hay registros para los filtros seleccionados.</div>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "14px",
                  }}
                >
                  <thead>
                    <tr>
                      {[
                        "Fecha",
                        "Hora",
                        "Alumno",
                        "RUT",
                        "Curso",
                        "Categoría",
                        "Correo",
                        "Registrado por",
                      ].map((header) => (
                        <th key={header} style={thStyle}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.id}>
                        <td style={tdStyle}>{formatDate(record.fecha)}</td>
                        <td style={tdStyle}>{record.hora}</td>
                        <td style={tdStyle}>
                          <button
                            type="button"
                            onClick={() => copyEmail(record.email)}
                            style={nameButtonStyle}
                            title={
                              record.email
                                ? `Copiar ${record.email}`
                                : "Sin correo registrado"
                            }
                          >
                            {formatDisplayName(record.nombre_completo)}
                          </button>
                        </td>
                        <td style={tdStyle}>
                          {formatRut(record.rut_completo || record.rut_base)}
                        </td>
                        <td style={tdStyle}>{record.curso}</td>
                        <td style={tdStyle}>
                          <span style={pillStyle(record.categoria)}>
                            {record.categoria}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <button
                            type="button"
                            onClick={() => openEmailModal(record)}
                            disabled={!record.email}
                            style={
                              record.email ? emailButtonStyle : disabledEmailButtonStyle
                            }
                            title={
                              record.email
                                ? `Enviar correo a ${record.email}`
                                : "Sin correo registrado"
                            }
                          >
                            {record.email ? "Enviar correo" : "Sin correo"}
                          </button>
                        </td>
                        <td style={tdStyle}>{record.created_by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  marginTop: "18px",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                  style={page <= 1 ? disabledButtonStyle : secondaryButtonStyle}
                >
                  ← Anterior
                </button>

                <div style={{ fontSize: "14px", color: "#5f6570", fontWeight: 700 }}>
                  Página {page} de {totalPages}
                </div>

                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
                  style={page >= totalPages ? disabledButtonStyle : secondaryButtonStyle}
                >
                  Siguiente →
                </button>
              </div>
            </>
          )}
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "18px",
          }}
        >
          <RankingCard
            title="Top 5 · atrasos históricos"
            subtitle="Estudiantes con más atrasos acumulados en total."
            items={data?.rankings.historical || []}
            countKey="total_historic_count"
            onCopyEmail={copyEmail}
          />

          <RankingCard
            title="Top 5 · atrasos vigentes"
            subtitle="Estudiantes con más atrasos vigentes en el período actual."
            items={data?.rankings.current || []}
            countKey="current_month_count"
            onCopyEmail={copyEmail}
          />
        </section>

        <footer
          style={{
            textAlign: "center",
            fontSize: "11px",
            lineHeight: 1.45,
            color: "rgba(95, 101, 112, 0.88)",
            padding: "6px 8px 2px",
          }}
        >
          Control de Atrasos v1.0 - Desarrollado por{" "}
          <a
            href="https://ampliadesign.cl"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#1d74b7",
              textDecoration: "none",
            }}
          >
            ampliadesign.cl
          </a>
        </footer>
      </div>

      {emailTarget ? (
        <div style={modalOverlayStyle} onClick={closeEmailModal}>
          <div
            style={modalCardStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "22px",
                color: "#1d2430",
                fontWeight: 800,
              }}
            >
              Enviar correo al estudiante
            </h3>

            <p
              style={{
                margin: "10px 0 0",
                color: "#5f6570",
                fontSize: "14px",
                lineHeight: 1.6,
              }}
            >
              ¿Desea agregar algún comentario?
            </p>

            <div style={{ marginTop: "14px", color: "#1d2430", fontSize: "14px" }}>
              <strong>Estudiante:</strong> {emailTarget.nombre}
              <br />
              <strong>Curso:</strong> {emailTarget.curso || "Sin curso"}
              <br />
              <strong>Correo:</strong> {emailTarget.email}
            </div>

            <textarea
              ref={emailTextareaRef}
              value={emailComment}
              onChange={(event) => setEmailComment(event.target.value)}
              placeholder="Escribe aquí un comentario opcional para incluir en el correo."
              style={textareaStyle}
              rows={6}
              disabled={sendingEmail}
            />

            <p
              style={{
                margin: "10px 0 0",
                color: "#5f6570",
                fontSize: "13px",
                lineHeight: 1.6,
              }}
            >
              El correo informará la cantidad de atrasos vigentes del estudiante y agregará este comentario debajo del apartado <strong>Comentarios</strong>.
            </p>

            <div
              style={{
                marginTop: "18px",
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={closeEmailModal}
                style={secondaryButtonStyle}
                disabled={sendingEmail}
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleSendEmail}
                style={primaryButtonStyle}
                disabled={sendingEmail}
              >
                {sendingEmail ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function RankingCard({
  title,
  subtitle,
  items,
  countKey,
  onCopyEmail,
}: {
  title: string;
  subtitle: string;
  items: RankingRow[];
  countKey: "total_historic_count" | "current_month_count";
  onCopyEmail: (email: string) => void;
}) {
  return (
    <section style={cardStyle}>
      <h2
        style={{
          margin: 0,
          fontSize: "22px",
          color: "#1d2430",
          fontWeight: 800,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: "8px 0 0",
          color: "#5f6570",
          fontSize: "14px",
          lineHeight: 1.5,
        }}
      >
        {subtitle}
      </p>

      {items.length === 0 ? (
        <div style={{ marginTop: "18px", ...infoBoxStyle }}>
          No hay datos disponibles para este ranking.
        </div>
      ) : (
        <div style={{ marginTop: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {items.map((item, index) => (
            <div
              key={`${item.rut_base}-${index}`}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: "12px",
                alignItems: "center",
                padding: "14px 16px",
                borderRadius: "18px",
                background: "rgba(29, 116, 183, 0.05)",
              }}
            >
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "999px",
                  background: "#1d74b7",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 800,
                  fontSize: "14px",
                }}
              >
                {index + 1}
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => onCopyEmail(item.email)}
                  style={nameButtonStyle}
                  title={item.email ? `Copiar ${item.email}` : "Sin correo registrado"}
                >
                  {formatDisplayName(item.nombre_completo)}
                </button>
                <div style={{ marginTop: "4px", fontSize: "13px", color: "#5f6570" }}>
                  {formatRut(item.rut_completo || item.rut_base)} - {item.curso}
                </div>
              </div>

              <div
                style={{
                  minWidth: "54px",
                  textAlign: "center",
                  padding: "8px 10px",
                  borderRadius: "14px",
                  background: "rgba(214, 54, 73, 0.10)",
                  color: "#d63649",
                  fontWeight: 800,
                  fontSize: "14px",
                }}
              >
                {item[countKey]}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Toast({
  tone,
  message,
}: {
  tone: "success" | "error" | "info";
  message: string;
}) {
  const toneMap = {
    success: {
      background: "rgba(11, 159, 107, 0.96)",
      boxShadow: "0 14px 30px rgba(11,159,107,0.24)",
    },
    error: {
      background: "rgba(214, 54, 73, 0.96)",
      boxShadow: "0 14px 30px rgba(214,54,73,0.24)",
    },
    info: {
      background: "rgba(29, 116, 183, 0.96)",
      boxShadow: "0 14px 30px rgba(29,116,183,0.24)",
    },
  } as const;

  return (
    <div
      style={{
        position: "fixed",
        right: "20px",
        bottom: "20px",
        zIndex: 9999,
        maxWidth: "360px",
        borderRadius: "16px",
        padding: "14px 16px",
        color: "#ffffff",
        fontSize: "14px",
        fontWeight: 700,
        background: toneMap[tone].background,
        boxShadow: toneMap[tone].boxShadow,
      }}
    >
      {message}
    </div>
  );
}

async function validateSession(): Promise<SessionValidationResult> {
  try {
    const response = await fetch("/api/session", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });

    const payload = await response.json().catch(() => ({}));

    const role = normalizeRole(
      payload?.user?.role ||
        payload?.role ||
        payload?.user?.tipo ||
        payload?.tipo ||
        ""
    );

    const authenticated = Boolean(
      payload?.authenticated ??
        payload?.isAuthenticated ??
        payload?.logged_in ??
        payload?.loggedIn ??
        payload?.user ??
        payload?.session
    );

    if (!response.ok || !authenticated) {
      return {
        ok: false,
        role,
        message: "Tu sesión expiró o ya no está activa. Vuelve a iniciar sesión.",
      };
    }

    if (!["admin", "administrador", "superadmin"].includes(role)) {
      return {
        ok: false,
        role,
        message: "No tienes permisos para acceder a Gestión de Datos.",
      };
    }

    return {
      ok: true,
      role,
      message: "",
    };
  } catch {
    return {
      ok: false,
      role: "",
      message: "No se pudo validar tu sesión. Vuelve al sistema principal.",
    };
  }
}

function normalizeRole(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function formatDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatDisplayName(value: string) {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

function formatRut(value: string) {
  return (value || "").trim().toUpperCase();
}

const mainStyle: React.CSSProperties = {
  minHeight: "100vh",
  padding: "24px",
  background: "linear-gradient(180deg, #f8fbfd 0%, #eef6fb 100%)",
  fontFamily: "Inter, Arial, sans-serif",
  color: "#1d2430",
};

const containerStyle: React.CSSProperties = {
  width: "min(1240px, 100%)",
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  gap: "18px",
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "24px",
  padding: "24px",
  boxShadow: "0 18px 40px rgba(14, 34, 60, 0.12)",
};

const backLinkStyle: React.CSSProperties = {
  minHeight: "46px",
  border: "1px solid rgba(29, 116, 183, 0.16)",
  borderRadius: "14px",
  padding: "0 16px",
  background: "rgba(29, 116, 183, 0.08)",
  color: "#1d74b7",
  fontWeight: 800,
  fontSize: "14px",
  whiteSpace: "nowrap",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  fontSize: "14px",
  color: "#1d2430",
  fontWeight: 700,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "48px",
  border: "1px solid rgba(29, 116, 183, 0.18)",
  borderRadius: "14px",
  padding: "0 14px",
  fontSize: "15px",
  color: "#1d2430",
  outline: "none",
  boxSizing: "border-box",
  background: "#fff",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  marginTop: "16px",
  border: "1px solid rgba(29, 116, 183, 0.18)",
  borderRadius: "16px",
  padding: "14px",
  fontSize: "15px",
  color: "#1d2430",
  outline: "none",
  boxSizing: "border-box",
  background: "#fff",
  resize: "vertical",
  minHeight: "140px",
};

const primaryButtonStyle: React.CSSProperties = {
  minHeight: "48px",
  border: "none",
  borderRadius: "14px",
  padding: "0 18px",
  background: "#1d74b7",
  color: "#fff",
  fontWeight: 800,
  fontSize: "14px",
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: "48px",
  border: "1px solid rgba(29, 116, 183, 0.18)",
  borderRadius: "14px",
  padding: "0 18px",
  background: "#fff",
  color: "#1d74b7",
  fontWeight: 800,
  fontSize: "14px",
  cursor: "pointer",
};

const disabledButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  opacity: 0.45,
  cursor: "default",
};

const emailButtonStyle: React.CSSProperties = {
  minHeight: "38px",
  border: "1px solid rgba(29, 116, 183, 0.18)",
  borderRadius: "12px",
  padding: "0 12px",
  background: "rgba(29, 116, 183, 0.08)",
  color: "#1d74b7",
  fontWeight: 800,
  fontSize: "13px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const disabledEmailButtonStyle: React.CSSProperties = {
  ...emailButtonStyle,
  opacity: 0.45,
  cursor: "default",
};

const exportButtonStyle: React.CSSProperties = {
  minHeight: "38px",
  border: "1px solid rgba(11, 159, 107, 0.20)",
  borderRadius: "12px",
  padding: "0 14px",
  background: "rgba(11, 159, 107, 0.10)",
  color: "#0b9f6b",
  fontWeight: 800,
  fontSize: "13px",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
};

const disabledExportButtonStyle: React.CSSProperties = {
  ...exportButtonStyle,
  opacity: 0.45,
  cursor: "default",
};

const toggleWrapperStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

function toggleButtonStyle(active: boolean): React.CSSProperties {
  return {
    position: "relative",
    width: "56px",
    height: "30px",
    border: "none",
    borderRadius: "999px",
    cursor: "pointer",
    background: active ? "#0b9f6b" : "rgba(95, 101, 112, 0.30)",
    transition: "background 0.2s ease",
    padding: 0,
  };
}

function toggleKnobStyle(active: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: "3px",
    left: active ? "29px" : "3px",
    width: "24px",
    height: "24px",
    borderRadius: "999px",
    background: "#ffffff",
    boxShadow: "0 4px 12px rgba(14, 34, 60, 0.18)",
    transition: "left 0.2s ease",
  };
}

const legendContainerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
  padding: "14px 16px",
  borderRadius: "18px",
  background: "rgba(29, 116, 183, 0.05)",
  marginBottom: "16px",
};

const legendTitleStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "#5f6570",
  fontWeight: 800,
};

const legendItemStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
};

const legendTextStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "#1d2430",
  fontWeight: 700,
};

const infoBoxStyle: React.CSSProperties = {
  borderRadius: "16px",
  padding: "14px 16px",
  background: "rgba(29, 116, 183, 0.08)",
  color: "#1d74b7",
  fontSize: "14px",
  lineHeight: 1.5,
  fontWeight: 700,
};

const errorBoxStyle: React.CSSProperties = {
  borderRadius: "16px",
  padding: "14px 16px",
  background: "rgba(214, 54, 73, 0.08)",
  color: "#d63649",
  fontSize: "14px",
  lineHeight: 1.5,
  fontWeight: 700,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 12px",
  borderBottom: "1px solid rgba(29, 116, 183, 0.12)",
  color: "#5f6570",
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 12px",
  borderBottom: "1px solid rgba(29, 116, 183, 0.08)",
  fontSize: "14px",
  verticalAlign: "middle",
};

const nameButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  margin: 0,
  color: "#1d74b7",
  fontWeight: 800,
  cursor: "pointer",
  textAlign: "left",
  fontSize: "14px",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(14, 34, 60, 0.48)",
  display: "grid",
  placeItems: "center",
  padding: "20px",
  zIndex: 10000,
};

const modalCardStyle: React.CSSProperties = {
  width: "min(620px, 100%)",
  background: "#ffffff",
  borderRadius: "24px",
  padding: "24px",
  boxShadow: "0 24px 60px rgba(14, 34, 60, 0.20)",
};

function pillStyle(value: string): React.CSSProperties {
  const tone =
    value === "A"
      ? { bg: "rgba(11,159,107,0.10)", color: "#0b9f6b" }
      : value === "B"
      ? { bg: "rgba(210,142,8,0.12)", color: "#d28e08" }
      : { bg: "rgba(214,54,73,0.10)", color: "#d63649" };

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "34px",
    padding: "6px 10px",
    borderRadius: "999px",
    fontWeight: 800,
    fontSize: "12px",
    background: tone.bg,
    color: tone.color,
  };
}
