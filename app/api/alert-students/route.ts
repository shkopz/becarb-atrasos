import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("student_counters")
      .select(`
        current_month_count,
        total_historic_count,
        updated_at,
        students (
          rut_base,
          rut_completo,
          nombres,
          apellidos,
          curso,
          email,
          activo
        )
      `)
      .gte("current_month_count", 3)
      .order("current_month_count", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, message: "No se pudo leer la lista de alumnos con alerta." },
        { status: 500 }
      );
    }

    const students = (data || [])
      .filter((row: any) => row.students && row.students.activo !== false)
      .map((row: any) => ({
        rut_base: row.students.rut_base || "",
        rut_completo: row.students.rut_completo || "",
        nombres: row.students.nombres || "",
        apellidos: row.students.apellidos || "",
        curso: row.students.curso || "",
        email: row.students.email || "",
        current_month_count: row.current_month_count || 0,
        total_historic_count: row.total_historic_count || 0,
        updated_at: row.updated_at || null,
      }));

    return NextResponse.json({
      ok: true,
      total: students.length,
      students,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al leer alert-students";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}