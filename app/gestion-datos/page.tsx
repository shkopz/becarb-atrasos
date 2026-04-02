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
  telefon: string;
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
  telefon: string;
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

type LevelKey = "all" | "prebasica" | "basica" | "media";

type DataManagementResponse = {
  ok: boolean;
  filters: {
    query: string;
    course: string;
    month: string;
    level: LevelKey;
    page: number;
    page_size: number;
  };
  total_records: number;
  total_pages: number;
  course_options: string[];
  periods: PeriodRow[];
  records: RecordRow[];
  rankings?: {
    historical: RankingRow[];
    current: RankingRow[];
  };
  ranking?: RankingRow[];
  ranking_limit?: number;
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

type ImportResultState = {
  file_name: string;
  processed_rows: number;
  inserted_rows: number;
  updated_rows: number;
  unchanged_rows: number;
  invalid_rows: number;
  counters_created: number;
  warnings: string[];
};

const SESSION_CHECK_INTERVAL_MS = 60_000;
const DATA_REFRESH_INTERVAL_MS = 60_000;
const AUTO_REFRESH_STORAGE_KEY = "becarb-gestion-datos-auto-refresh";
const APP_HOME_URL = "/demo-ui/interface-base.html";
const APP_VERSION = "1.1";

const LEVEL_LABELS: Record<LevelKey, string> = {
  all: "Todos",
  prebasica: "Prebásica",
  basica: "Básica",
  media: "Media",
};

export default function GestionDatosPage() {
  const [queryInput, setQueryInput] = useState("");
  const [courseInput, setCourseInput] = useState("");
  const [monthInput, setMonthInput] = useState("");
  const [levelInput, setLevelInput] = useState<LevelKey>("all");

  const [query, setQuery] = useState("");
  const [course, setCourse] = useState("");
  const [month, setMonth] = useState("");
  const [level, setLevel] = useState<LevelKey>("all");
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
  const [selectedReportMonth, setSelectedReportMonth] = useState("");
  const [rankingLimit, setRankingLimit] = useState(5);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importResult, setImportResult] = useState<ImportResultState | null>(null);

  const redirectTimerRef = useRef<number | null>(null);
  const emailTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const fetchUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    if (query.trim()) params.set("q", query.trim());
    if (course.trim()) params.set("course", course.trim());
    if (month.trim()) params.set("month", month.trim());
    if (level !== "all") params.set("level", level);
    params.set("ranking_limit", String(rankingLimit));
    return `/api/data-management?${params.toString()}`;
  }, [page, query, course, month, level, rankingLimit]);

  const filteredExportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (course.trim()) params.set("course", course.trim());
    if (month.trim()) params.set("month", month.trim());
    if (level !== "all") params.set("level", level);
    return `/api/export-data-management-filtered?${params.toString()}`;
  }, [query, course, month, level]);

  const reportExportUrl = useMemo(() => {
    if (!selectedReportMonth) return "";
    const params = new URLSearchParams();
    params.set("month", selectedReportMonth);
    return `/api/export-monthly-full?${params.toString()}`;
  }, [selectedReportMonth]);

  const rankingExportUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(rankingLimit));
    return `/api/export-ranking?${params.toString()}`;
  }, [rankingLimit]);

  const records = data?.records || [];
  const rankingRows = data?.ranking || data?.rankings?.current || [];
  const allCourses = data?.course_options || [];
  const periods = data?.periods || [];
  const totalPages = data?.total_pages || 1;
  const totalRecords = data?.total_records || 0;

  const levelCourseOptions = useMemo(() => {
    return allCourses.filter((item) => matchesLevel(item, levelInput));
  }, [allCourses, levelInput]);

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
          window.location.href = APP_HOME_URL;
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
          window.location.href = APP_HOME_URL;
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
              window.location.href = APP_HOME_URL;
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
    if (selectedReportMonth) return;

    const previousPeriod = periods.find((item) => !item.is_current);
    const fallbackPeriod = periods[0];

    if (previousPeriod) {
      setSelectedReportMonth(previousPeriod.key);
      return;
    }

    if (fallbackPeriod) {
      setSelectedReportMonth(fallbackPeriod.key);
    }
  }, [periods, selectedReportMonth]);

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

  useEffect(() => {
    if (!courseInput) return;
    if (levelInput === "all") return;
    if (!matchesLevel(courseInput, levelInput)) {
      setCourseInput("");
    }
  }, [levelInput, courseInput]);

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
    setLevel(levelInput);
  }

  function handleClearFilters() {
    const current = data?.periods?.find((item) => item.is_current);
    setQueryInput("");
    setCourseInput("");
    setMonthInput(current?.key || "");
    setLevelInput("all");
    setQuery("");
    setCourse("");
    setMonth(current?.key || "");
    setLevel("all");
    setPage(1);
  }

  function handleLevelTabClick(nextLevel: LevelKey) {
    setLevelInput(nextLevel);
    setCourseInput((prev) => (prev && !matchesLevel(prev, nextLevel) ? "" : prev));
    setQuery(queryInput.trim());
    setCourse((prev) => (prev && !matchesLevel(prev, nextLevel) ? "" : prev));
    setMonth(monthInput.trim());
    setLevel(nextLevel);
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

  function handleCsvFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] || null;
    setCsvFile(nextFile);
  }

  async function handleImportStudentsCsv() {
    if (!csvFile || importingCsv) {
      setToast({
        tone: "info",
        message: "Selecciona un archivo CSV antes de actualizar la base de datos.",
      });
      return;
    }

    try {
      setImportingCsv(true);

      const formData = new FormData();
      formData.append("file", csvFile);

      const response = await fetch("/api/import-students-csv", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message || "No se pudo actualizar la base de datos de estudiantes."
        );
      }

      setImportResult({
        file_name: payload.file_name || csvFile.name,
        processed_rows: Number(payload.processed_rows || 0),
        inserted_rows: Number(payload.inserted_rows || 0),
        updated_rows: Number(payload.updated_rows || 0),
        unchanged_rows: Number(payload.unchanged_rows || 0),
        invalid_rows: Number(payload.invalid_rows || 0),
        counters_created: Number(payload.counters_created || 0),
        warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      });

      setToast({
        tone: "success",
        message: "Base de datos actualizada correctamente desde el CSV.",
      });

      setCsvFile(null);
      if (csvInputRef.current) {
        csvInputRef.current.value = "";
      }

      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      setToast({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Ocurrió un error al actualizar la base de datos.",
      });
    } finally {
      setImportingCsv(false);
    }
  }

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
              <a href={APP_HOME_URL} style={backLinkStyle}>
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
                <div style={{ marginBottom: "6px", fontSize: "13px", color: "#1d74b7", fontWeight: 800 }}>
                  Versión 1.1
                </div>
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
                  Revisa los marcajes registrados, filtra por nombre, RUT, nivel, curso o mes, y consulta los rankings de atrasos históricos y vigentes.
                </p>
              </div>
            </div>

            <a href={APP_HOME_URL} style={backLinkStyle}>
              ← Volver al sistema
            </a>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={tabsWrapStyle}>
            {(Object.keys(LEVEL_LABELS) as LevelKey[]).map((tabKey) => {
              const active = levelInput === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => handleLevelTabClick(tabKey)}
                  style={active ? tabActiveStyle : tabStyle}
                >
                  {LEVEL_LABELS[tabKey]}
                </button>
              );
            })}
          </div>

          <form
            onSubmit={handleApplyFilters}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "12px",
              alignItems: "end",
              marginTop: "16px",
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
                <option value="">
                  {levelInput === "all"
                    ? "Todos los cursos"
                    : `Todos los cursos de ${LEVEL_LABELS[levelInput]}`}
                </option>
                {levelCourseOptions.map((item) => (
                  <option key={repairText(item)} value={repairText(item)}>
                    {repairText(item)}
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
                href={filteredExportUrl}
                style={secondaryActionLinkStyle}
                title="Exportar a Excel los datos actualmente filtrados"
              >
                Exportar filtros a Excel
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
      "Teléfono",
      "Correo",
      "Notificar",
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
        <span style={{ fontWeight: 800, color: "#1d2430" }}>
          {formatDisplayName(record.nombre_completo)}
        </span>
      </td>
      <td style={tdStyle}>
        {formatRut(record.rut_completo || record.rut_base)}
      </td>
      <td style={tdStyle}>{repairText(record.curso)}</td>
      <td style={tdStyle}>
        <span style={pillStyle(record.categoria)}>
          {record.categoria}
        </span>
      </td>
      <td style={tdStyle}>{formatPhone(record.telefon)}</td>
      <td style={tdStyle}>
        <button
          type="button"
          onClick={() => copyEmail(record.email)}
          disabled={!record.email}
          style={record.email ? mailIconButtonStyle : disabledMailIconButtonStyle}
          title={record.email || "Sin correo registrado"}
          aria-label={record.email ? `Copiar ${record.email}` : "Sin correo registrado"}
        >
          ✉
        </button>
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
          {record.email ? "Notificar" : "Sin correo"}
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

        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "16px",
              flexWrap: "wrap",
              marginBottom: "16px",
            }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "22px",
                  color: "#1d2430",
                  fontWeight: 800,
                }}
              >
                Ranking general de atrasos
              </h2>
              <p
                style={{
                  margin: "8px 0 0",
                  color: "#5f6570",
                  fontSize: "14px",
                  lineHeight: 1.6,
                  maxWidth: "760px",
                }}
              >
                Se muestra un solo ranking ordenado por atrasos vigentes y, como referencia, el histórico acumulado. Puedes elegir cuántas filas mostrar y exportarlo a Excel.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <label style={{ ...labelStyle, minWidth: "130px" }}>
                Mostrar
                <select
                  value={rankingLimit}
                  onChange={(event) => setRankingLimit(Number(event.target.value) || 5)}
                  style={inputStyle}
                >
                  {[5, 10, 15, 20].map((value) => (
                    <option key={value} value={value}>
                      Top {value}
                    </option>
                  ))}
                </select>
              </label>

              <a href={rankingExportUrl} style={secondaryActionLinkStyle}>
                Exportar ranking a Excel
              </a>
            </div>
          </div>

          <RankingBoard items={rankingRows} onCopyEmail={copyEmail} />
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: "18px",
          }}
        >
          <section style={cardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
                flexWrap: "wrap",
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: "22px",
                    color: "#1d2430",
                    fontWeight: 800,
                  }}
                >
                  Exportar meses anteriores
                </h2>
                <p
                  style={{
                    margin: "8px 0 0",
                    color: "#5f6570",
                    fontSize: "14px",
                    lineHeight: 1.6,
                    maxWidth: "760px",
                  }}
                >
                  Selecciona un período para descargar el reporte completo del mes. Esta sección quedó al final de la página, como pediste.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <select
                  value={selectedReportMonth}
                  onChange={(event) => setSelectedReportMonth(event.target.value)}
                  style={{ ...inputStyle, minWidth: "260px" }}
                >
                  <option value="">Selecciona un período</option>
                  {periods.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <a
                  href={reportExportUrl || undefined}
                  style={reportExportUrl ? primaryActionLinkStyle : disabledActionLinkStyle}
                  aria-disabled={!reportExportUrl}
                  onClick={(event) => {
                    if (!reportExportUrl) event.preventDefault();
                  }}
                >
                  Exportar período completo
                </a>
              </div>
            </div>
          </section>

          <section style={cardStyle}>
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "22px",
                  color: "#1d2430",
                  fontWeight: 800,
                }}
              >
                Actualizar base de datos
              </h2>
              <p
                style={{
                  margin: "8px 0 0",
                  color: "#5f6570",
                  fontSize: "14px",
                  lineHeight: 1.6,
                  maxWidth: "760px",
                }}
              >
                Sube un archivo CSV para sincronizar la tabla <strong>students</strong> usando <strong>rut_base</strong> como llave. Se actualizan datos de ficha, incluyendo teléfono cuando la columna <strong>telefon</strong> esté presente, se crean alumnos nuevos y no se modifican los contadores de atrasos históricos ni vigentes.
              </p>
            </div>

            <div
              style={{
                marginTop: "16px",
                display: "grid",
                gap: "12px",
              }}
            >
              <label style={labelStyle}>
                Archivo CSV
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileChange}
                  style={{ ...inputStyle, padding: "10px 14px", minHeight: "54px" }}
                />
              </label>

              <div
                style={{
                  fontSize: "13px",
                  color: "#5f6570",
                  lineHeight: 1.6,
                }}
              >
                Archivo seleccionado: <strong>{csvFile?.name || "Ninguno"}</strong>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  onClick={handleImportStudentsCsv}
                  style={primaryButtonStyle}
                  disabled={importingCsv}
                >
                  {importingCsv ? "Actualizando..." : "Actualizar desde CSV"}
                </button>
              </div>

              {importResult ? (
                <div style={summaryCardStyle}>
                  <div style={summaryGridStyle}>
                    <SummaryMetric label="Filas procesadas" value={importResult.processed_rows} />
                    <SummaryMetric label="Nuevos alumnos" value={importResult.inserted_rows} />
                    <SummaryMetric label="Datos actualizados" value={importResult.updated_rows} />
                    <SummaryMetric label="Sin cambios" value={importResult.unchanged_rows} />
                    <SummaryMetric label="Filas inválidas" value={importResult.invalid_rows} />
                    <SummaryMetric label="Contadores creados" value={importResult.counters_created} />
                  </div>

                  <div
                    style={{
                      marginTop: "12px",
                      fontSize: "13px",
                      color: "#5f6570",
                      lineHeight: 1.6,
                    }}
                  >
                    Último archivo procesado: <strong>{importResult.file_name}</strong>
                  </div>

                  {importResult.warnings.length ? (
                    <div style={{ marginTop: "14px", ...infoBoxStyle }}>
                      <strong>Observaciones:</strong>
                      <ul style={{ margin: "10px 0 0", paddingLeft: "18px" }}>
                        {importResult.warnings.slice(0, 8).map((warning, index) => (
                          <li key={`${warning}-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
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
          Control de Atrasos v{APP_VERSION} - Desarrollado por{" "}
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
              <strong>Curso:</strong> {repairText(emailTarget.curso) || "Sin curso"}
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


function RankingBoard({
  items,
  onCopyEmail,
}: {
  items: RankingRow[];
  onCopyEmail: (email: string) => void;
}) {
  return (
    <section>
      {items.length === 0 ? (
        <div style={infoBoxStyle}>
          No hay datos disponibles para el ranking.
        </div>
      ) : (
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
                  "#",
                  "Alumno",
                  "RUT",
                  "Curso",
                  "Teléfono",
                  "Correo",
                  "Vigentes",
                  "Históricos",
                ].map((header) => (
                  <th key={header} style={thStyle}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.rut_base}-${index}`}>
                  <td style={tdStyle}>
                    <span
                      style={{
                        width: "30px",
                        height: "30px",
                        borderRadius: "999px",
                        background: "rgba(29,116,183,0.10)",
                        color: "#1d74b7",
                        display: "inline-grid",
                        placeItems: "center",
                        fontWeight: 800,
                        fontSize: "13px",
                      }}
                    >
                      {index + 1}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 800, color: "#1d2430" }}>
                      {formatDisplayName(item.nombre_completo)}
                    </span>
                  </td>
                  <td style={tdStyle}>{formatRut(item.rut_completo || item.rut_base)}</td>
                  <td style={tdStyle}>{repairText(item.curso)}</td>
                  <td style={tdStyle}>{formatPhone(item.telefon)}</td>
                  <td style={tdStyle}>
                    <button
                      type="button"
                      onClick={() => onCopyEmail(item.email)}
                      disabled={!item.email}
                      style={item.email ? mailIconButtonStyle : disabledMailIconButtonStyle}
                      title={item.email || "Sin correo registrado"}
                      aria-label={item.email ? `Copiar ${item.email}` : "Sin correo registrado"}
                    >
                      ✉
                    </button>
                  </td>
                  <td style={tdStyle}>
                    <span style={counterPillStyle("#d63649", "rgba(214,54,73,0.10)")}>
                      {item.current_month_count}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={counterPillStyle("#1d74b7", "rgba(29,116,183,0.10)")}>
                      {item.total_historic_count}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div
      style={{
        borderRadius: "16px",
        padding: "14px 16px",
        background: "rgba(29, 116, 183, 0.05)",
        display: "grid",
        gap: "6px",
      }}
    >
      <span style={{ fontSize: "12px", color: "#5f6570", fontWeight: 800 }}>
        {label}
      </span>
      <span style={{ fontSize: "24px", color: "#1d2430", fontWeight: 800 }}>
        {value}
      </span>
    </div>
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

function matchesLevel(course: string, level: LevelKey) {
  if (level === "all") return true;
  const normalized = normalizeRole(course);

  if (level === "prebasica") {
    return (
      normalized.includes("kinder") ||
      normalized.includes("prek") ||
      normalized.includes("pre k") ||
      normalized.includes("pre-bas") ||
      normalized.includes("pre bas") ||
      normalized.includes("parv")
    );
  }

  if (level === "basica") {
    return normalized.includes("basico");
  }

  if (level === "media") {
    return normalized.includes("medio");
  }

  return true;
}

function formatDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function countSuspiciousCharacters(value: string) {
  return (value.match(/[ÃÂ�]/g) || []).length;
}

function repairText(value: string) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  let normalized = cleaned.normalize("NFC");

  if (/[ÃÂ�]/.test(normalized)) {
    try {
      const bytes = Uint8Array.from(Array.from(normalized).map((char) => char.charCodeAt(0) & 0xff));
      const repaired = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (countSuspiciousCharacters(repaired) < countSuspiciousCharacters(normalized)) {
        normalized = repaired.normalize("NFC");
      }
    } catch {
      // Si falla la reparación, se conserva el valor original.
    }
  }

  return normalized;
}

function formatDisplayName(value: string) {
  return repairText(value);
}

function formatRut(value: string) {
  return (value || "").trim().toUpperCase();
}

function formatPhone(value: string) {
  const phone = String(value || "").trim();
  return phone || "—";
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

const summaryCardStyle: React.CSSProperties = {
  marginTop: "4px",
  borderRadius: "18px",
  padding: "16px",
  background: "rgba(29, 116, 183, 0.04)",
  border: "1px solid rgba(29, 116, 183, 0.10)",
};

const summaryGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "12px",
};

const tabsWrapStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

const tabStyle: React.CSSProperties = {
  minHeight: "44px",
  border: "1px solid rgba(29, 116, 183, 0.14)",
  borderRadius: "999px",
  padding: "0 16px",
  background: "#ffffff",
  color: "#1d74b7",
  fontSize: "14px",
  fontWeight: 800,
  cursor: "pointer",
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  background: "linear-gradient(135deg, rgba(29,116,183,0.14), rgba(73,182,222,0.22))",
  border: "1px solid rgba(29, 116, 183, 0.24)",
  color: "#1d2430",
  boxShadow: "0 12px 24px rgba(29,116,183,0.12)",
};

const primaryActionLinkStyle: React.CSSProperties = {
  minHeight: "48px",
  border: "none",
  borderRadius: "14px",
  padding: "0 18px",
  background: "#1d74b7",
  color: "#fff",
  fontWeight: 800,
  fontSize: "14px",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
};

const secondaryActionLinkStyle: React.CSSProperties = {
  minHeight: "48px",
  border: "1px solid rgba(29, 116, 183, 0.18)",
  borderRadius: "14px",
  padding: "0 18px",
  background: "#fff",
  color: "#1d74b7",
  fontWeight: 800,
  fontSize: "14px",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
};

const disabledActionLinkStyle: React.CSSProperties = {
  ...primaryActionLinkStyle,
  opacity: 0.45,
  pointerEvents: "none",
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

const mailIconButtonStyle: React.CSSProperties = {
  width: "38px",
  height: "38px",
  border: "1px solid rgba(29, 116, 183, 0.18)",
  borderRadius: "12px",
  background: "rgba(29, 116, 183, 0.08)",
  color: "#1d74b7",
  fontWeight: 800,
  fontSize: "16px",
  cursor: "pointer",
  display: "inline-grid",
  placeItems: "center",
};

const disabledMailIconButtonStyle: React.CSSProperties = {
  ...mailIconButtonStyle,
  opacity: 0.45,
  cursor: "default",
};

function counterPillStyle(color: string, background: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "42px",
    padding: "6px 10px",
    borderRadius: "999px",
    fontWeight: 800,
    fontSize: "12px",
    color,
    background,
  };
}

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
