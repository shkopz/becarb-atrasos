import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function sortByName(a: any, b: any) {
  const aName = `${a.nombres || ""} ${a.apellidos || ""}`.trim().toLowerCase();
  const bName = `${b.nombres || ""} ${b.apellidos || ""}`.trim().toLowerCase();
  return aName.localeCompare(bName, "es");
}

export async function GET() {
  try {
    const pageSize = 1000;
    let from = 0;
    let allRows: any[] = [];

    while (true) {
      const { data, error } = await supabase
        .from("students")
        .select(`
          rut_base,
          rut_completo,
          nombres,
          apellidos,
          curso,
          email,
          activo
        `)
        .eq("activo", true)
        .range(from, from + pageSize - 1);

      if (error) {
        return NextResponse.json(
          { ok: false, message: "No se pudo cargar la nómina desde Supabase." },
          { status: 500 }
        );
      }

      const chunk = data || [];
      allRows = allRows.concat(chunk);

      if (chunk.length < pageSize) {
        break;
      }

      from += pageSize;
    }

    const students = allRows
      .map((row) => ({
        rut_base: String(row.rut_base || "").replace(/\D/g, ""),
        rut_completo: String(row.rut_completo || ""),
        nombres: String(row.nombres || ""),
        apellidos: String(row.apellidos || ""),
        curso: String(row.curso || ""),
        email: String(row.email || "").trim().toLowerCase(),
        activo: Boolean(row.activo),
      }))
      .sort(sortByName);

    return NextResponse.json(
      {
        ok: true,
        source: "supabase",
        total: students.length,
        students,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al leer alumnos";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}