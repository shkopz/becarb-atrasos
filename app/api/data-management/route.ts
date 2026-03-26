import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function getChileCurrentMonthKey() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}`;
}

function monthNameEs(month: number) {
  return [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ][month - 1];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(Number(searchParams.get("page") || 1), 1);
    const pageSize = 15;
    const query = String(searchParams.get("q") || "").trim();
    const course = String(searchParams.get("course") || "").trim();
    const month = String(searchParams.get("month") || "").trim();

    const { data: tardyData, error: tardyError } = await supabase
      .from("tardy_records")
      .select(`
        id,
        fecha,
        hora,
        categoria,
        source,
        created_by,
        rut_base,
        cancelled,
        students (
          rut_completo,
          nombres,
          apellidos,
          curso,
          email
        )
      `)
      .eq("cancelled", false)
      .order("fecha", { ascending: false })
      .order("hora", { ascending: false });

    if (tardyError) {
      return NextResponse.json(
        { ok: false, message: "No se pudieron leer los marcajes." },
        { status: 500 }
      );
    }

    const flatRecords = (tardyData || []).map((record: any) => {
      const nombres = record.students?.nombres || "";
      const apellidos = record.students?.apellidos || "";
      const nombreCompleto = `${nombres} ${apellidos}`.trim();
      const monthKey = String(record.fecha || "").slice(0, 7);

      return {
        id: record.id,
        fecha: record.fecha,
        hora: record.hora,
        categoria: record.categoria,
        source: record.source,
        created_by: record.created_by,
        rut_base: record.rut_base,
        rut_completo: record.students?.rut_completo || "",
        nombres,
        apellidos,
        nombre_completo: nombreCompleto,
        curso: record.students?.curso || "",
        email: record.students?.email || "",
        month_key: monthKey,
      };
    });

    const currentMonthKey = getChileCurrentMonthKey();

    const periodSet = new Set<string>();
    periodSet.add(currentMonthKey);

    flatRecords.forEach((record) => {
      if (/^\d{4}-\d{2}$/.test(record.month_key)) {
        periodSet.add(record.month_key);
      }
    });

    const periods = [...periodSet]
      .sort((a, b) => (a < b ? 1 : -1))
      .map((key) => {
        const [year, monthNumber] = key.split("-").map(Number);
        const isCurrent = key === currentMonthKey;

        return {
          key,
          year,
          month: monthNumber,
          label: isCurrent
            ? `${monthNameEs(monthNumber)} ${year} · mes en curso`
            : `${monthNameEs(monthNumber)} ${year}`,
          is_current: isCurrent,
        };
      });

    const normalizedQuery = normalizeText(query);
    const normalizedCourse = normalizeText(course);
    const normalizedMonth = normalizeText(month);

    const filteredRecords = flatRecords.filter((record) => {
      const matchesQuery =
        !normalizedQuery ||
        normalizeText(record.nombre_completo).includes(normalizedQuery) ||
        normalizeText(record.rut_base).includes(normalizedQuery) ||
        normalizeText(record.rut_completo).includes(normalizedQuery);

      const matchesCourse =
        !normalizedCourse ||
        normalizeText(record.curso) === normalizedCourse;

      const matchesMonth =
        !normalizedMonth ||
        normalizeText(record.month_key) === normalizedMonth;

      return matchesQuery && matchesCourse && matchesMonth;
    });

    const totalRecords = filteredRecords.length;
    const totalPages = Math.max(Math.ceil(totalRecords / pageSize), 1);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;

    const paginatedRecords = filteredRecords.slice(start, end);

    const courseOptions = [...new Set(
      flatRecords
        .map((record) => record.curso)
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "es"));

    const { data: countersData, error: countersError } = await supabase
      .from("student_counters")
      .select(`
        current_month_count,
        total_historic_count,
        students (
          rut_base,
          rut_completo,
          nombres,
          apellidos,
          curso,
          email,
          activo
        )
      `);

    if (countersError) {
      return NextResponse.json(
        { ok: false, message: "No se pudieron leer los rankings." },
        { status: 500 }
      );
    }

    const counters = (countersData || [])
      .filter((row: any) => row.students && row.students.activo !== false)
      .map((row: any) => ({
        rut_base: row.students?.rut_base || "",
        rut_completo: row.students?.rut_completo || "",
        nombres: row.students?.nombres || "",
        apellidos: row.students?.apellidos || "",
        nombre_completo: `${row.students?.nombres || ""} ${row.students?.apellidos || ""}`.trim(),
        curso: row.students?.curso || "",
        email: row.students?.email || "",
        current_month_count: row.current_month_count || 0,
        total_historic_count: row.total_historic_count || 0,
      }));

    const historicalRanking = [...counters]
      .filter((row) => row.total_historic_count > 0)
      .sort((a, b) =>
        b.total_historic_count - a.total_historic_count ||
        a.nombre_completo.localeCompare(b.nombre_completo, "es")
      )
      .slice(0, 5);

    const currentRanking = [...counters]
      .filter((row) => row.current_month_count > 0)
      .sort((a, b) =>
        b.current_month_count - a.current_month_count ||
        a.nombre_completo.localeCompare(b.nombre_completo, "es")
      )
      .slice(0, 5);

    return NextResponse.json({
      ok: true,
      filters: {
        query,
        course,
        month,
        page: safePage,
        page_size: pageSize,
      },
      total_records: totalRecords,
      total_pages: totalPages,
      course_options: courseOptions,
      periods,
      records: paginatedRecords,
      rankings: {
        historical: historicalRanking,
        current: currentRanking,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido al cargar gestión de datos";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}