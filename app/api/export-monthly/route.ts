import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getChileNow() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    today: `${map.year}-${map.month}-${map.day}`,
  };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const now = getChileNow();

    const year = Number(searchParams.get("year") || now.year);
    const month = Number(searchParams.get("month") || now.month);

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { ok: false, message: "Parámetros de año o mes inválidos." },
        { status: 400 }
      );
    }

    const startDate = `${year}-${pad(month)}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextMonthYear = month === 12 ? year + 1 : year;
    const endExclusive = `${nextMonthYear}-${pad(nextMonth)}-01`;

    // 1) Buscar alumnos con 3 o más atrasos vigentes
    const { data: alertCounters, error: countersError } = await supabase
      .from("student_counters")
      .select("student_id, current_month_count")
      .gte("current_month_count", 3);

    if (countersError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo leer la lista de alumnos con alerta." },
        { status: 500 }
      );
    }

    const alertStudentIds = (alertCounters || []).map((row) => row.student_id);

    // 2) Si no hay alumnos sobre el umbral, exportamos archivo vacío con headers
    if (!alertStudentIds.length) {
      const worksheet = XLSX.utils.json_to_sheet([]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Atrasos");

      const buffer = XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
      });

      const fileName = `informe_atrasos_alerta_${year}_${pad(month)}.xlsx`;

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    // 3) Traer solo los marcajes de esos alumnos dentro del mes consultado
    const { data, error } = await supabase
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
        student_id,
        students (
          rut_completo,
          nombres,
          apellidos,
          curso,
          email
        )
      `)
      .in("student_id", alertStudentIds)
      .gte("fecha", startDate)
      .lt("fecha", endExclusive)
      .eq("cancelled", false)
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, message: "No se pudo generar el informe mensual filtrado." },
        { status: 500 }
      );
    }

    const countersMap = new Map<number, number>();
    (alertCounters || []).forEach((row) => {
      countersMap.set(row.student_id, row.current_month_count || 0);
    });

    const rows = (data || []).map((record: any) => ({
      fecha: record.fecha,
      hora: record.hora,
      categoria: record.categoria,
      rut_base: record.rut_base,
      rut_completo: record.students?.rut_completo || "",
      nombres: record.students?.nombres || "",
      apellidos: record.students?.apellidos || "",
      curso: record.students?.curso || "",
      email: record.students?.email || "",
      origen: record.source,
      registrado_por: record.created_by,
      atrasos_vigentes: countersMap.get(record.student_id) || 0,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Atrasos");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    const fileName = `informe_atrasos_alerta_${year}_${pad(month)}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al exportar Excel";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}