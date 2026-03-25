import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getChileDateInfo() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  const today = `${map.year}-${map.month}-${map.day}`;
  const monthStart = `${map.year}-${map.month}-01`;

  return {
    today,
    monthStart,
  };
}

export async function GET() {
  try {
    const { today, monthStart } = getChileDateInfo();

    const { data: todayRecords, error: todayError } = await supabase
      .from("tardy_records")
      .select("id, categoria")
      .eq("fecha", today)
      .eq("cancelled", false);

    if (todayError) {
      return NextResponse.json(
        { ok: false, message: "No se pudieron leer los ingresos de hoy." },
        { status: 500 }
      );
    }

    const { data: monthRecords, error: monthError } = await supabase
      .from("tardy_records")
      .select(`
        id,
        fecha,
        hora,
        categoria,
        created_by,
        rut_base,
        student_id,
        students (
          nombres,
          apellidos,
          curso,
          rut_completo
        )
      `)
      .gte("fecha", monthStart)
      .lte("fecha", today)
      .eq("cancelled", false)
      .order("fecha", { ascending: false })
      .order("hora", { ascending: false });

    if (monthError) {
      return NextResponse.json(
        { ok: false, message: "No se pudieron leer los atrasos del mes." },
        { status: 500 }
      );
    }

    const { data: counters, error: countersError } = await supabase
      .from("student_counters")
      .select("student_id, current_month_count");

    if (countersError) {
      return NextResponse.json(
        { ok: false, message: "No se pudieron leer los contadores." },
        { status: 500 }
      );
    }

    const categoryA = monthRecords.filter((r: any) => r.categoria === "A").length;
    const categoryB = monthRecords.filter((r: any) => r.categoria === "B").length;
    const categoryC = monthRecords.filter((r: any) => r.categoria === "C").length;

    const studentsOver3 = counters.filter(
      (item: any) => (item.current_month_count || 0) >= 3
    ).length;

    const recentAccesses = monthRecords.slice(0, 20).map((record: any) => ({
      id: record.id,
      fecha: record.fecha,
      hora: record.hora,
      categoria: record.categoria,
      rut_base: record.rut_base,
      created_by: record.created_by,
      nombre: `${record.students?.nombres || ""} ${record.students?.apellidos || ""}`.trim(),
      curso: record.students?.curso || "",
      rut_completo: record.students?.rut_completo || "",
    }));

    return NextResponse.json({
      ok: true,
      summary: {
        ingresos_hoy: todayRecords.length,
        atrasos_mes: monthRecords.length,
        categoria_a: categoryA,
        categoria_b: categoryB,
        categoria_c: categoryC,
        alumnos_sobre_3: studentsOver3,
      },
      recent_accesses: recentAccesses,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al leer dashboard";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}