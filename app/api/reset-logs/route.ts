import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("reset_logs")
      .select(`
        id,
        rut_base,
        nombre_completo,
        curso,
        previous_counter,
        reset_by,
        reset_at
      `)
      .order("reset_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json(
        { ok: false, message: "No se pudieron leer los logs de reseteo." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      logs: data || [],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al leer reset logs";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}