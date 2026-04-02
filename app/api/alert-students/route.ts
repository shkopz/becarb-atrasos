import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function validateRequestSession(request: Request) {
  const sessionUrl = new URL("/api/session", request.url);
  const response = await fetch(sessionUrl.toString(), {
    method: "GET",
    headers: { cookie: request.headers.get("cookie") || "" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  const authenticated = Boolean(payload?.authenticated ?? payload?.isAuthenticated ?? payload?.logged_in ?? payload?.loggedIn ?? payload?.user ?? payload?.session);
  if (!response.ok || !authenticated) {
    return { ok: false, status: 401, message: "Tu sesión expiró o ya no está activa." };
  }
  return { ok: true, status: 200, message: "" };
}

export async function GET(request: Request) {
  try {
    const session = await validateRequestSession(request);
    if (!session.ok) {
      return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
    }

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
      `)
      .gte("current_month_count", 3);

    if (error) {
      return NextResponse.json({ ok: false, message: "No se pudo leer la lista de alumnos con alerta." }, { status: 500 });
    }

    const students = (data || [])
      .filter((row: any) => row.students && row.students.activo !== false)
      .map((row: any) => ({
        rut_base: row.students?.rut_base || "",
        rut_completo: row.students?.rut_completo || "",
        nombres: row.students?.nombres || "",
        apellidos: row.students?.apellidos || "",
        curso: row.students?.curso || "",
        email: row.students?.email || "",
        telefon: row.students?.telefon || "",
        current_month_count: row.current_month_count || 0,
        total_historic_count: row.total_historic_count || 0,
      }))
      .sort((a, b) =>
        b.current_month_count - a.current_month_count ||
        b.total_historic_count - a.total_historic_count ||
        `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`, "es")
      );

    return NextResponse.json(
      { ok: true, students },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al leer alertas";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
