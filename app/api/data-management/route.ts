import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type LevelKey = "all" | "prebasica" | "basica" | "media";

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function normalizeRole(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
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
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ][month - 1];
}

function matchesLevel(course: string, level: LevelKey) {
  if (level === "all") return true;
  const normalized = normalizeText(course);

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

  if (level === "basica") return normalized.includes("basico");
  if (level === "media") return normalized.includes("medio");
  return true;
}

async function validateRequestSession(request: Request) {
  const sessionUrl = new URL("/api/session", request.url);

  const response = await fetch(sessionUrl.toString(), {
    method: "GET",
    headers: {
      cookie: request.headers.get("cookie") || "",
    },
    cache: "no-store",
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
    return { ok: false, status: 401, message: "Tu sesión expiró o ya no está activa." };
  }

  if (!["admin", "administrador", "superadmin"].includes(role)) {
    return { ok: false, status: 403, message: "No tienes permisos para acceder a Gestión de Datos." };
  }

  return { ok: true, status: 200, message: "" };
}

export async function GET(request: Request) {
  try {
    const session = await validateRequestSession(request);

    if (!session.ok) {
      return NextResponse.json(
        { ok: false, message: session.message },
        { status: session.status }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(Number(searchParams.get("page") || 1), 1);
    const pageSize = Math.min(Math.max(Number(searchParams.get("page_size") || 15), 5), 100);
    const rankingLimit = [5, 10, 15, 20].includes(Number(searchParams.get("ranking_limit"))) ? Number(searchParams.get("ranking_limit")) : 5;
    const query = String(searchParams.get("q") || "").trim();
    const course = String(searchParams.get("course") || "").trim();
    const month = String(searchParams.get("month") || "").trim();
    const level = (searchParams.get("level") || "all") as LevelKey;

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
          email,
          telefon
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
        telefon: record.students?.telefon || "",
        month_key: monthKey,
      };
    });

    const currentMonthKey = getChileCurrentMonthKey();
    const periodSet = new Set<string>([currentMonthKey]);

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
          label: isCurrent ? `${monthNameEs(monthNumber)} ${year} · mes en curso` : `${monthNameEs(monthNumber)} ${year}`,
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

      const matchesCourse = !normalizedCourse || normalizeText(record.curso) === normalizedCourse;
      const matchesMonth = !normalizedMonth || normalizeText(record.month_key) === normalizedMonth;
      const matchesLevelFilter = matchesLevel(record.curso, level);

      return matchesQuery && matchesCourse && matchesMonth && matchesLevelFilter;
    });

    const totalRecords = filteredRecords.length;
    const totalPages = Math.max(Math.ceil(totalRecords / pageSize), 1);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const paginatedRecords = filteredRecords.slice(start, start + pageSize);

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
          telefon,
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
        telefon: row.students?.telefon || "",
        current_month_count: row.current_month_count || 0,
        total_historic_count: row.total_historic_count || 0,
      }));

    const ranking = [...counters]
      .filter((row) => row.current_month_count > 0 || row.total_historic_count > 0)
      .sort((a, b) =>
        b.current_month_count - a.current_month_count ||
        b.total_historic_count - a.total_historic_count ||
        a.nombre_completo.localeCompare(b.nombre_completo, "es")
      )
      .slice(0, rankingLimit);

    return NextResponse.json(
      {
        ok: true,
        filters: {
          query,
          course,
          month,
          level,
          page: safePage,
          page_size: pageSize,
        },
        total_records: totalRecords,
        total_pages: totalPages,
        course_options: courseOptions,
        periods,
        records: paginatedRecords,
        ranking,
        ranking_limit: rankingLimit,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al cargar gestión de datos";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
