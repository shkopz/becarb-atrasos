import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeRole(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function formatDisplayName(value: string) {
  return String(value || "")
    .toLocaleLowerCase("es-CL")
    .replace(/(^|[\s\-('"“”«»¿¡\/])\p{L}/gu, (match) => match.toLocaleUpperCase("es-CL"));
}

async function validateRequestSession(request: Request) {
  const sessionUrl = new URL("/api/session", request.url);
  const response = await fetch(sessionUrl.toString(), {
    method: "GET",
    headers: { cookie: request.headers.get("cookie") || "" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  const role = normalizeRole(payload?.user?.role || payload?.role || payload?.user?.tipo || payload?.tipo || "");
  const authenticated = Boolean(payload?.authenticated ?? payload?.isAuthenticated ?? payload?.logged_in ?? payload?.loggedIn ?? payload?.user ?? payload?.session);
  if (!response.ok || !authenticated) return { ok: false, status: 401, message: "Tu sesión expiró o ya no está activa." };
  if (!["admin", "administrador", "superadmin"].includes(role)) return { ok: false, status: 403, message: "No tienes permisos para exportar rankings." };
  return { ok: true, status: 200, message: "" };
}

export async function GET(request: Request) {
  try {
    const session = await validateRequestSession(request);
    if (!session.ok) return NextResponse.json({ ok: false, message: session.message }, { status: session.status });

    const { searchParams } = new URL(request.url);
    const limit = [5, 10, 15, 20].includes(Number(searchParams.get("limit"))) ? Number(searchParams.get("limit")) : 5;

    const { data, error } = await supabase
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

    if (error) {
      return NextResponse.json({ ok: false, message: "No se pudo exportar el ranking." }, { status: 500 });
    }

    const rows = (data || [])
      .filter((row: any) => row.students && row.students.activo !== false)
      .map((row: any) => ({
        rut_base: row.students?.rut_base || "",
        rut_completo: row.students?.rut_completo || "",
        alumno: formatDisplayName(`${row.students?.nombres || ""} ${row.students?.apellidos || ""}`.trim()),
        curso: row.students?.curso || "",
        telefon: row.students?.telefon || "",
        email: row.students?.email || "",
        atrasos_vigentes: row.current_month_count || 0,
        atrasos_historicos: row.total_historic_count || 0,
      }))
      .filter((row) => row.atrasos_vigentes > 0 || row.atrasos_historicos > 0)
      .sort((a, b) =>
        b.atrasos_vigentes - a.atrasos_vigentes ||
        b.atrasos_historicos - a.atrasos_historicos ||
        a.alumno.localeCompare(b.alumno, "es")
      )
      .slice(0, limit)
      .map((row, index) => ({ posicion: index + 1, ...row }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ranking");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="ranking_atrasos_top_${limit}.xlsx"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al exportar ranking";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
