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
      .eq("activo", true);

    if (error) {
      return NextResponse.json(
        { ok: false, message: "No se pudo cargar la nómina desde Supabase." },
        { status: 500 }
      );
    }

    const students = (data || [])
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

    return NextResponse.json({
      ok: true,
      source: "supabase",
      students,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al leer alumnos";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}
