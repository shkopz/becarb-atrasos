import { NextRequest, NextResponse } from "next/server";
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
  email: string | null;
  activo: boolean;
};

type StudentRow = {
  id: string;
  rut_base: string;
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

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBoolean(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  return ["si", "sí", "true", "1", "activo", "activa", "yes"].includes(normalized);
}

function normalizeEmail(value: unknown) {
  const email = normalizeText(value).toLowerCase();
  return email || null;
}

function normalizeCourse(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function dedupeStudentsByRut(students: SheetStudent[]) {
  const map = new Map<string, SheetStudent>();

  for (const student of students) {
    map.set(student.rut_base, student);
  }

  return Array.from(map.values());
}

function getAuthToken(request: NextRequest) {
  const bearer = request.headers.get("authorization");
  const syncTokenHeader = request.headers.get("x-sync-token");

  if (syncTokenHeader) {
    return syncTokenHeader;
  }

  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }

  return null;
}

function validateRequest(request: NextRequest) {
  const expectedToken = process.env.SYNC_STUDENTS_TOKEN;

  if (!expectedToken) {
    return null;
  }

  const receivedToken = getAuthToken(request);

  if (receivedToken !== expectedToken) {
    return NextResponse.json(
      {
        ok: false,
        message: "No autorizado para ejecutar la sincronización.",
      },
      { status: 401 }
    );
  }

  return null;
}

async function getStudentsFromSheet(): Promise<SheetStudent[]> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE || "alumnos!A:G";

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
    range,
  });

  const rows = response.data.values || [];
  const [, ...dataRows] = rows;

  return dataRows
    .filter((row) => row.length > 0)
    .map((row) => ({
      rut_base: String(row[0] || "").replace(/\D/g, ""),
      rut_completo: normalizeText(row[1]),
      nombres: normalizeText(row[2]),
      apellidos: normalizeText(row[3]),
      curso: normalizeCourse(row[4]),
      email: normalizeEmail(row[5]),
      activo: normalizeBoolean(row[6]),
    }))
    .filter((student) => /^\d{7,9}$/.test(student.rut_base));
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Usa POST para ejecutar la sincronización de alumnos.",
    route: "/api/sync-students",
  });
}

export async function POST(request: NextRequest) {
  try {
    const invalidRequest = validateRequest(request);

    if (invalidRequest) {
      return invalidRequest;
    }

    const rawStudentsFromSheet = await getStudentsFromSheet();

    if (!rawStudentsFromSheet.length) {
      return NextResponse.json({
        ok: true,
        message: "La planilla no contiene alumnos válidos para sincronizar. No se realizaron cambios.",
        summary: {
          processed_raw: 0,
          processed_unique: 0,
          inserted: 0,
          updated: 0,
          counters_created: 0,
        },
      });
    }

    const studentsFromSheet = dedupeStudentsByRut(rawStudentsFromSheet);
    const rutBases = studentsFromSheet.map((student) => student.rut_base);
    const now = new Date().toISOString();

    const { data: existingStudentsBefore, error: existingStudentsBeforeError } = await supabase
      .from("students")
      .select("id, rut_base")
      .in("rut_base", rutBases);

    if (existingStudentsBeforeError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo revisar el estado previo de los alumnos en Supabase." },
        { status: 500 }
      );
    }

    const existingRutSet = new Set((existingStudentsBefore || []).map((student: StudentRow) => student.rut_base));

    const payload = studentsFromSheet.map((student) => ({
      rut_base: student.rut_base,
      rut_completo: student.rut_completo,
      nombres: student.nombres,
      apellidos: student.apellidos,
      curso: student.curso,
      email: student.email,
      activo: student.activo,
      updated_at: now,
    }));

    const { data: syncedStudents, error: upsertError } = await supabase
      .from("students")
      .upsert(payload, { onConflict: "rut_base" })
      .select("id, rut_base");

    if (upsertError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo sincronizar la tabla students." },
        { status: 500 }
      );
    }

    const insertedCount = studentsFromSheet.filter((student) => !existingRutSet.has(student.rut_base)).length;
    const updatedCount = studentsFromSheet.length - insertedCount;

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
        processed_raw: rawStudentsFromSheet.length,
        processed_unique: studentsFromSheet.length,
        inserted: insertedCount,
        updated: updatedCount,
        active_in_sheet: studentsFromSheet.filter((student) => student.activo).length,
        inactive_in_sheet: studentsFromSheet.filter((student) => !student.activo).length,
        counters_created: countersCreated,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al sincronizar alumnos";

    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
