import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

async function getStudentsFromSheet() {
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
      rut_completo: String(row[1] || ""),
      nombres: String(row[2] || ""),
      apellidos: String(row[3] || ""),
      curso: String(row[4] || ""),
      email: String(row[5] || ""),
      activo: String(row[6] || "").trim().toLowerCase() === "si",
    }));
}

function getChileNow() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}:${map.second}`,
    hhmm: `${map.hour}:${map.minute}`,
  };
}

function classifyTardy(hhmm: string) {
  if (hhmm >= "08:10" && hhmm <= "08:20") return "A";
  if (hhmm >= "08:21" && hhmm <= "08:30") return "B";
  if (hhmm >= "08:31") return "C";
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rutBase = String(body.rut_base || "").replace(/\D/g, "");
    const source = body.source === "qr" ? "qr" : "manual";
    const createdBy = String(body.created_by || "desconocido").trim().toLowerCase();
    const forceHhmm =
      process.env.NODE_ENV !== "production" &&
      /^\d{2}:\d{2}$/.test(String(body.force_hhmm || ""))
        ? String(body.force_hhmm)
        : null;

    if (!/^\d{8,9}$/.test(rutBase)) {
      return NextResponse.json(
        { ok: false, message: "RUT inválido. Debe tener 8 o 9 dígitos." },
        { status: 400 }
      );
    }

    const students = await getStudentsFromSheet();
    const studentFromSheet = students.find(
      (student) => student.rut_base === rutBase && student.activo
    );

    if (!studentFromSheet) {
      return NextResponse.json(
        { ok: false, message: "RUT NO ENCONTRADO" },
        { status: 404 }
      );
    }

    const { data: existingStudent, error: studentError } = await supabase
      .from("students")
      .select("id, rut_base")
      .eq("rut_base", rutBase)
      .maybeSingle();

    if (studentError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo consultar el estudiante en Supabase." },
        { status: 500 }
      );
    }

    let studentId = existingStudent?.id;

    if (!studentId) {
      const { data: insertedStudent, error: insertStudentError } = await supabase
        .from("students")
        .insert({
          rut_base: studentFromSheet.rut_base,
          rut_completo: studentFromSheet.rut_completo,
          nombres: studentFromSheet.nombres,
          apellidos: studentFromSheet.apellidos,
          curso: studentFromSheet.curso,
          email: studentFromSheet.email,
          activo: studentFromSheet.activo,
        })
        .select("id")
        .single();

      if (insertStudentError || !insertedStudent) {
        return NextResponse.json(
          { ok: false, message: "No se pudo crear el estudiante en Supabase." },
          { status: 500 }
        );
      }

      studentId = insertedStudent.id;

      await supabase.from("student_counters").insert({
        student_id: studentId,
        current_month_count: 0,
        total_historic_count: 0,
      });
    } else {
      await supabase
        .from("students")
        .update({
          rut_completo: studentFromSheet.rut_completo,
          nombres: studentFromSheet.nombres,
          apellidos: studentFromSheet.apellidos,
          curso: studentFromSheet.curso,
          email: studentFromSheet.email,
          activo: studentFromSheet.activo,
          updated_at: new Date().toISOString(),
        })
        .eq("id", studentId);
    }

    const chileNow = getChileNow();
    const hhmmToUse = forceHhmm || chileNow.hhmm;
    const timeToUse = forceHhmm ? `${forceHhmm}:00` : chileNow.time;
    const categoria = classifyTardy(hhmmToUse);

    if (!categoria) {
      return NextResponse.json(
        { ok: false, message: "El registro no corresponde a un atraso." },
        { status: 400 }
      );
    }

    const { data: duplicate } = await supabase
      .from("tardy_records")
      .select("id")
      .eq("student_id", studentId)
      .eq("fecha", chileNow.date)
      .eq("cancelled", false)
      .limit(1);

    if (duplicate && duplicate.length > 0) {
      return NextResponse.json(
        { ok: false, message: "ALUMNO YA REGISTRADO" },
        { status: 409 }
      );
    }

    const { error: insertTardyError } = await supabase.from("tardy_records").insert({
      student_id: studentId,
      rut_base: studentFromSheet.rut_base,
      fecha: chileNow.date,
      hora: timeToUse,
      categoria,
      source,
      created_by: createdBy,
      cancelled: false,
    });

    if (insertTardyError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo guardar el atraso." },
        { status: 500 }
      );
    }

    const { data: counterRow, error: counterError } = await supabase
      .from("student_counters")
      .select("id, current_month_count, total_historic_count")
      .eq("student_id", studentId)
      .single();

    if (counterError || !counterRow) {
      return NextResponse.json(
        { ok: false, message: "No se pudo leer el contador del estudiante." },
        { status: 500 }
      );
    }

    const nextCurrent = (counterRow.current_month_count || 0) + 1;
    const nextHistoric = (counterRow.total_historic_count || 0) + 1;

    const { error: updateCounterError } = await supabase
      .from("student_counters")
      .update({
        current_month_count: nextCurrent,
        total_historic_count: nextHistoric,
        updated_at: new Date().toISOString(),
      })
      .eq("id", counterRow.id);

    if (updateCounterError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo actualizar el contador." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      student: {
        rut_base: studentFromSheet.rut_base,
        rut_completo: studentFromSheet.rut_completo,
        nombres: studentFromSheet.nombres,
        apellidos: studentFromSheet.apellidos,
        curso: studentFromSheet.curso,
        email: studentFromSheet.email,
      },
      tardy: {
        fecha: chileNow.date,
        hora: timeToUse,
        categoria,
        current_month_count: nextCurrent,
        total_historic_count: nextHistoric,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al registrar atraso";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}