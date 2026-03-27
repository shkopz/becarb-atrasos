import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type SheetStudent = {
  rut_base: string;
  rut_completo: string;
  nombres: string;
  apellidos: string;
  curso: string;
  email: string;
  activo: boolean;
};

function parseServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no tiene un JSON válido");
  }
}

function normalizeBoolean(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["si", "sí", "true", "1", "activo", "activa", "yes"].includes(normalized);
}

async function getStudentsFromSheet(): Promise<SheetStudent[]> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error("Falta GOOGLE_SHEETS_SPREADSHEET_ID");
  }

  const credentials = parseServiceAccount();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "alumnos!A:G",
  });

  const rows = response.data.values || [];
  const [, ...dataRows] = rows;

  return dataRows
    .filter((row) => row.length > 0)
    .map((row) => ({
      rut_base: String(row[0] || "").replace(/\D/g, ""),
      rut_completo: String(row[1] || "").trim(),
      nombres: String(row[2] || "").trim(),
      apellidos: String(row[3] || "").trim(),
      curso: String(row[4] || "").trim(),
      email: String(row[5] || "").trim().toLowerCase(),
      activo: normalizeBoolean(row[6]),
    }))
    .filter((student) => /^\d{8,9}$/.test(student.rut_base));
}

export async function POST() {
  try {
    const studentsFromSheet = await getStudentsFromSheet();

    if (!studentsFromSheet.length) {
      return NextResponse.json({
        ok: true,
        message: "La planilla no contiene alumnos válidos para sincronizar.",
        summary: {
          processed: 0,
          counters_created: 0,
        },
      });
    }

    const payload = studentsFromSheet.map((student) => ({
      rut_base: student.rut_base,
      rut_completo: student.rut_completo,
      nombres: student.nombres,
      apellidos: student.apellidos,
      curso: student.curso,
      email: student.email,
      activo: student.activo,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabase
      .from("students")
      .upsert(payload, { onConflict: "rut_base" });

    if (upsertError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo sincronizar la tabla students." },
        { status: 500 }
      );
    }

    const rutBases = studentsFromSheet.map((student) => student.rut_base);

    const { data: syncedStudents, error: syncedStudentsError } = await supabase
      .from("students")
      .select("id, rut_base")
      .in("rut_base", rutBases);

    if (syncedStudentsError) {
      return NextResponse.json(
        { ok: false, message: "Los alumnos se sincronizaron, pero no se pudieron leer sus IDs." },
        { status: 500 }
      );
    }

    const studentIds = (syncedStudents || []).map((row) => row.id);

    let countersCreated = 0;

    if (studentIds.length > 0) {
      const { data: existingCounters, error: existingCountersError } = await supabase
        .from("student_counters")
        .select("student_id")
        .in("student_id", studentIds);

      if (existingCountersError) {
        return NextResponse.json(
          { ok: false, message: "La tabla students se sincronizó, pero no se pudieron revisar los contadores." },
          { status: 500 }
        );
      }

      const counterSet = new Set((existingCounters || []).map((row) => row.student_id));
      const missingCounterRows = studentIds
        .filter((studentId) => !counterSet.has(studentId))
        .map((studentId) => ({
          student_id: studentId,
          current_month_count: 0,
          total_historic_count: 0,
        }));

      if (missingCounterRows.length > 0) {
        const { error: insertCountersError } = await supabase
          .from("student_counters")
          .insert(missingCounterRows);

        if (insertCountersError) {
          return NextResponse.json(
            { ok: false, message: "La tabla students se sincronizó, pero no se pudieron crear los contadores faltantes." },
            { status: 500 }
          );
        }

        countersCreated = missingCounterRows.length;
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Nómina sincronizada correctamente desde Google Sheets a Supabase.",
      summary: {
        processed: studentsFromSheet.length,
        active: studentsFromSheet.filter((student) => student.activo).length,
        inactive: studentsFromSheet.filter((student) => !student.activo).length,
        counters_created: countersCreated,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al sincronizar alumnos";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}
