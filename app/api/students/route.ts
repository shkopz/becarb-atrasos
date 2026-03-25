import { NextResponse } from "next/server";
import { google } from "googleapis";

function parseServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON en .env.local");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no tiene un JSON válido");
  }
}

export async function GET() {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    if (!spreadsheetId) {
      return NextResponse.json(
        { ok: false, message: "Falta GOOGLE_SHEETS_SPREADSHEET_ID" },
        { status: 500 }
      );
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

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        students: [],
      });
    }

    const [header, ...dataRows] = rows;

    const students = dataRows
      .filter((row) => row.length > 0)
      .map((row) => ({
        rut_base: row[0] || "",
        rut_completo: row[1] || "",
        nombres: row[2] || "",
        apellidos: row[3] || "",
        curso: row[4] || "",
        email: row[5] || "",
        activo: (row[6] || "").toString().trim().toLowerCase() === "si",
      }));

    return NextResponse.json({
      ok: true,
      header,
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