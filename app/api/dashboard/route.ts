import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function getChileParts() {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const timeParts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const dateMap = Object.fromEntries(dateParts.map((p) => [p.type, p.value]));
  const timeMap = Object.fromEntries(timeParts.map((p) => [p.type, p.value]));
  return {
    today: `${dateMap.year}-${dateMap.month}-${dateMap.day}`,
    monthKey: `${dateMap.year}-${dateMap.month}`,
    nowTime: `${timeMap.hour}:${timeMap.minute}:${timeMap.second}`,
  };
}

function detectLevel(course: string) {
  const normalized = normalizeText(course);
  if (normalized.includes("kinder") || normalized.includes("prek") || normalized.includes("parv")) return "prebasica";
  if (normalized.includes("basico")) return "basica";
  if (normalized.includes("medio")) return "media";
  return "otro";
}

function topCourse(rows: any[], level: "prebasica" | "basica" | "media" | "all") {
  const counters = new Map<string, number>();

  rows.forEach((row) => {
    const course = row.students?.curso || "";
    if (!course) return;
    const itemLevel = detectLevel(course);
    if (level !== "all" && itemLevel !== level) return;
    counters.set(course, (counters.get(course) || 0) + 1);
  });

  const ordered = [...counters.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"));
  const first = ordered[0];
  return {
    course: first?.[0] || "Sin datos",
    count: first?.[1] || 0,
  };
}

async function validateRequestSession(request: Request) {
  const sessionUrl = new URL("/api/session", request.url);
  const response = await fetch(sessionUrl.toString(), {
    method: "GET",
    headers: { cookie: request.headers.get("cookie") || "" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  const authenticated = Boolean(payload?.authenticated ?? payload?.isAuthenticated ?? payload?.logged_in ?? payload?.loggedIn ?? payload?.user ?? payload?.session);
  if (!response.ok || !authenticated) return { ok: false, status: 401, message: "Tu sesión expiró o ya no está activa." };
  return { ok: true, status: 200, message: "" };
}

export async function GET(request: Request) {
  try {
    const session = await validateRequestSession(request);
    if (!session.ok) return NextResponse.json({ ok: false, message: session.message }, { status: session.status });

    const chile = getChileParts();

    const [todayResult, monthResult, countersResult] = await Promise.all([
      supabase
        .from("tardy_records")
        .select(`
          id,
          fecha,
          hora,
          categoria,
          source,
          created_by,
          rut_base,
          students (
            rut_completo,
            nombres,
            apellidos,
            curso,
            email
          )
        `)
        .eq("cancelled", false)
        .eq("fecha", chile.today)
        .order("hora", { ascending: false }),
      supabase
        .from("tardy_records")
        .select("categoria", { count: "exact", head: false })
        .eq("cancelled", false)
        .gte("fecha", `${chile.monthKey}-01`)
        .lt("fecha", `${Number(chile.monthKey.slice(0,4)) + (chile.monthKey.slice(5) === "12" ? 1 : 0)}-${String(chile.monthKey.slice(5) === "12" ? 1 : Number(chile.monthKey.slice(5)) + 1).padStart(2,"0")}-01`),
      supabase
        .from("student_counters")
        .select("student_id", { count: "exact", head: false })
        .gte("current_month_count", 3),
    ]);

    if (todayResult.error || monthResult.error || countersResult.error) {
      return NextResponse.json({ ok: false, message: "No se pudo cargar el dashboard." }, { status: 500 });
    }

    const todayRows = todayResult.data || [];
    const monthRows = monthResult.data || [];
    const recentAccesses = todayRows.map((row: any) => ({
      hora: row.hora,
      rut_base: row.rut_base,
      rut_completo: row.students?.rut_completo || "",
      nombre: `${row.students?.nombres || ""} ${row.students?.apellidos || ""}`.trim(),
      curso: row.students?.curso || "",
      categoria: row.categoria,
      created_by: row.created_by,
      email: row.students?.email || "",
    }));

    const topOverall = topCourse(todayRows, "all");
    const topBasica = topCourse(todayRows, "basica");
    const topMedia = topCourse(todayRows, "media");
    const topPrebasica = topCourse(todayRows, "prebasica");

    return NextResponse.json(
      {
        ok: true,
        summary: {
          ingresos_hoy: todayRows.length,
          atrasos_mes: monthRows.length,
          categoria_a: monthRows.filter((row: any) => row.categoria === "A").length,
          categoria_b: monthRows.filter((row: any) => row.categoria === "B").length,
          categoria_c: monthRows.filter((row: any) => row.categoria === "C").length,
          alumnos_sobre_3: countersResult.count || 0,
          top_course_overall: topOverall,
          top_course_basica: topBasica,
          top_course_media: topMedia,
          top_course_prebasica: topPrebasica,
        },
        recent_accesses: recentAccesses,
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al cargar dashboard";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
