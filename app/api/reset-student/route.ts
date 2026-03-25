import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rutBase = String(body.rut_base || "").replace(/\D/g, "");
    const resetBy = String(body.reset_by || "desconocido").trim().toLowerCase();

    if (!/^\d{8,9}$/.test(rutBase)) {
      return NextResponse.json(
        { ok: false, message: "RUT inválido. Debe tener 8 o 9 dígitos." },
        { status: 400 }
      );
    }

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id, rut_base, nombres, apellidos, curso")
      .eq("rut_base", rutBase)
      .single();

    if (studentError || !student) {
      return NextResponse.json(
        { ok: false, message: "Estudiante no encontrado." },
        { status: 404 }
      );
    }

    const { data: counter, error: counterError } = await supabase
      .from("student_counters")
      .select("id, current_month_count, total_historic_count")
      .eq("student_id", student.id)
      .single();

    if (counterError || !counter) {
      return NextResponse.json(
        { ok: false, message: "No se encontró contador para el estudiante." },
        { status: 404 }
      );
    }

    const previousCounter = counter.current_month_count || 0;

    const { error: updateError } = await supabase
      .from("student_counters")
      .update({
        current_month_count: 0,
        updated_at: new Date().toISOString(),
        last_reset_at: new Date().toISOString(),
      })
      .eq("id", counter.id);

    if (updateError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo resetear el contador." },
        { status: 500 }
      );
    }

    const { error: logError } = await supabase
      .from("reset_logs")
      .insert({
        student_id: student.id,
        rut_base: student.rut_base,
        nombre_completo: `${student.nombres} ${student.apellidos}`.trim(),
        curso: student.curso,
        previous_counter: previousCounter,
        reset_by: resetBy,
      });

    if (logError) {
      return NextResponse.json(
        { ok: false, message: "El contador se reseteó, pero falló el log del reseteo." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      student: {
        rut_base: student.rut_base,
        nombre_completo: `${student.nombres} ${student.apellidos}`.trim(),
        curso: student.curso,
      },
      reset: {
        previous_counter: previousCounter,
        current_month_count: 0,
        total_historic_count: counter.total_historic_count || 0,
        reset_by: resetBy,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al resetear estudiante";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}