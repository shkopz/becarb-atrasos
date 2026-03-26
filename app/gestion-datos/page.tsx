"use client";

import React, { useEffect, useMemo, useState } from "react";

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
  const [copyMessage, setCopyMessage] = useState("");

  const fetchUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    if (query.trim()) params.set("q", query.trim());
    if (course.trim()) params.set("course", course.trim());
    if (month.trim()) params.set("month", month.trim());
    return `/api/data-management?${params.toString()}`;
  }, [page, query, course, month]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(fetchUrl, { method: "GET", cache: "no-store" });
        const result: DataManagementResponse = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(result.message || "No se pudo cargar la gestión de datos.");
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
          setError(err instanceof Error ? err.message : "Error desconocido.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [fetchUrl, monthInput]);

  useEffect(() => {
    if (!copyMessage) return;
    const timer = window.setTimeout(() => setCopyMessage(""), 2200);
    return () => window.clearTimeout(timer);
  }, [copyMessage]);

  async function copyEmail(email: string) {
    if (!email) {
      setCopyMessage("Este estudiante no tiene correo registrado.");
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
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

      setCopyMessage(`Correo copiado al portapapeles: ${email}`);
    } catch {
      setCopyMessage("No se pudo copiar el correo.");
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

  function handleBackToSystem() {
    try {
      window.location.assign("/");
    } catch {
      window.location.href = "/";
    }
  }

  const records = data?.records || [];
  const courses = data?.course_options || [];
  const periods = data?.periods || [];
  const totalPages = data?.total_pages || 1;
  const totalRecords = data?.total_records || 0;

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "24px",
        background: "linear-gradient(180deg, #f8fbfd 0%, #eef6fb 100%)",
        fontFamily: "Inter, Arial, sans-serif",
        color: "#1d2430",
      }}
    >
      <div
        style={{
          width: "min(1240px, 100%)",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <section
          style={{
            background: "#ffffff",
            borderRadius: "24px",
            padding: "24px",
            boxShadow: "0 18px 40px rgba(14, 34, 60, 0.12)",
          }}
        >
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

            <button
              type="button"
              onClick={handleBackToSystem}
              style={{
                minHeight: "46px",
                border: "1px solid rgba(29, 116, 183, 0.16)",
                borderRadius: "14px",
                padding: "0 16px",
                background: "rgba(29, 116, 183, 0.08)",
                color: "#1d74b7",
                fontWeight: 800,
                fontSize: "14px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              ← Volver al sistema
            </button>
          </div>
        </section>

        <section
          style={{
            background: "#ffffff",
            borderRadius: "24px",
            padding: "24px",
            boxShadow: "0 18px 40px rgba(14, 34, 60, 0.12)",
          }}
        >
          <form
            onSubmit={handleApplyFilters}
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(0, 1.4fr) minmax(220px, 0.8fr) minmax(240px, 0.9fr) auto auto",
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

            <button type="button" onClick={handleClearFilters} style={secondaryButtonStyle}>
              Limpiar
            </button>
          </form>
        </section>

        {copyMessage ? (
          <div
            style={{
              position: "fixed",
              right: "20px",
              bottom: "20px",
              zIndex: 9999,
              maxWidth: "320px",
              borderRadius: "16px",
              padding: "14px 16px",
              background: "rgba(11, 159, 107, 0.96)",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 700,
              boxShadow: "0 14px 30px rgba(11,159,107,0.24)",
            }}
          >
            {copyMessage}
          </div>
        ) : null}

        <section
          style={{
            background: "#ffffff",
            borderRadius: "24px",
            padding: "24px",
            boxShadow: "0 18px 40px rgba(14, 34, 60, 0.12)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              marginBottom: "16px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: "24px", color: "#1d2430" }}>
                Marcajes registrados
              </h2>
              <p style={{ margin: "6px 0 0", color: "#5f6570", fontSize: "14px" }}>
                Página {page} de {totalPages} · {totalRecords} registro(s)
              </p>
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
                        "Origen",
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
                            title={record.email ? `Copiar ${record.email}` : "Sin correo registrado"}
                          >
                            {formatDisplayName(record.nombre_completo)}
                          </button>
                        </td>
                        <td style={tdStyle}>{formatRut(record.rut_completo || record.rut_base)}</td>
                        <td style={tdStyle}>{record.curso}</td>
                        <td style={tdStyle}>
                          <span style={pillStyle(record.categoria)}>{record.categoria}</span>
                        </td>
                        <td style={tdStyle}>{record.source}</td>
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
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
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
    <section
      style={{
        background: "#ffffff",
        borderRadius: "24px",
        padding: "24px",
        boxShadow: "0 18px 40px rgba(14, 34, 60, 0.12)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: "22px", color: "#1d2430" }}>{title}</h2>
      <p style={{ margin: "8px 0 0", color: "#5f6570", fontSize: "14px", lineHeight: 1.5 }}>
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