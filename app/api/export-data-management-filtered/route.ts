import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

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

function normalizeRole(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function formatDisplayName(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

function formatDate(value: string) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
}

function sanitizeFilePart(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function getChileNowParts() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    year: String(map.year),
    month: String(map.month),
    day: String(map.day),
  };
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
    return {
      ok: false,
      status: 401,
      message: "Tu sesión expiró o ya no está activa.",
      role,
    };
  }

  if (!["admin", "administrador", "superadmin"].includes(role)) {
    return {
      ok: false,
      status: 403,
      message: "No tienes permisos para exportar desde Gestión de Datos.",
      role,
    };
  }

  return {
    ok: true,
    status: 200,
    message: "",
    role,
  };
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

    const query = String(searchParams.get("q") || "").trim();
    const course = String(searchParams.get("course") || "").trim();
    const month = String(searchParams.get("month") || "").trim();

    const normalizedQuery = normalizeText(query);
    const normalizedCourse = normalizeText(course);
    const normalizedMonth = normalizeText(month);

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
        { ok: false, message: "No se pudieron leer los marcajes para exportar." },
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

    const rows = filteredRecords.map((record) => ({
      fecha: formatDate(record.fecha),
      hora: record.hora,
      alumno: formatDisplayName(record.nombre_completo),
      rut: (record.rut_completo || record.rut_base || "").trim().toUpperCase(),
      curso: record.curso,
      categoria: record.categoria,
      correo: record.email,
      origen: record.source,
      registrado_por: record.created_by,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Gestion de Datos");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    const now = getChileNowParts();
    const fileParts = ["gestion-datos"];

    if (month) {
      fileParts.push(`mes-${sanitizeFilePart(month)}`);
    }
    if (course) {
      fileParts.push(`curso-${sanitizeFilePart(course)}`);
    }
    if (query) {
      fileParts.push(`filtro-${sanitizeFilePart(query).slice(0, 40)}`);
    }

    fileParts.push(`${now.year}-${now.month}-${now.day}`);

    const fileName = `${fileParts.filter(Boolean).join("_")}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido al exportar los filtros de Gestión de Datos";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}
