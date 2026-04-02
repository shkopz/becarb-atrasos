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
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(map.year), month: Number(map.month) };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function fixMojibake(value: unknown) {
  let text = String(value ?? "");
  if (!text) return "";
  const suspicious = /Ã.|Â|Ð|¤|�/u.test(text);
  if (suspicious) {
    try {
      const bytes = Uint8Array.from(Array.from(text, (ch) => ch.charCodeAt(0) & 0xff));
      const decoded = new TextDecoder("utf-8").decode(bytes);
      if (decoded && decoded !== text && !decoded.includes("�")) {
        text = decoded;
      }
    } catch {
      // ignore
    }
  }
  return text.normalize("NFC");
}

function cleanText(value: unknown) {
  return fixMojibake(value).replace(/\s+/g, " ").trim();
}

async function validateRequestSession(request: Request) {
  const sessionUrl = new URL("/api/session", request.url);
  const response = await fetch(sessionUrl.toString(), {
    method: "GET",
    headers: { cookie: request.headers.get("cookie") || "" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  const authenticated = Boolean(payload?.authenticated ?? payload?.isAuthenticated ?? payload?.logged_in ?? payload?.loggedIn ?? payload?.user ?? payload?.session);
  if (!response.ok || !authenticated) {
    return { ok: false, status: 401, message: "Tu sesión expiró o ya no está activa." };
  }
  return { ok: true, status: 200, message: "" };
}

export async function GET(request: Request) {
  try {
    const session = await validateRequestSession(request);
    if (!session.ok) return NextResponse.json({ ok: false, message: session.message }, { status: session.status });

    const { searchParams } = new URL(request.url);
    const now = getChileNow();
    const year = Number(searchParams.get("year") || now.year);
    const month = Number(searchParams.get("month") || now.month);

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ ok: false, message: "Parámetros de año o mes inválidos." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("student_counters")
      .select(`
        current_month_count,
        total_historic_count,
        students (
          rut_base,
          rut_completo,
          nombres,
          apellidos,
          curso,
          email,
          telefon,
          activo
        )
      `)
      .gte("current_month_count", 3);

    if (error) {
      return NextResponse.json({ ok: false, message: "No se pudo generar el informe mensual." }, { status: 500 });
    }

    const uniqueByRut = new Map<string, {
      rut_base: string;
      rut_completo: string;
      alumno: string;
      curso: string;
      telefon: string;
      email: string;
      atrasos_vigentes: number;
      atrasos_historicos: number;
      periodo: string;
    }>();

    (data || []).forEach((row: any) => {
      const student = row.students;
      if (!student || student.activo === false) return;
      const rutBase = String(student.rut_base || "").replace(/\D/g, "");
      if (!rutBase) return;

      const candidate = {
        rut_base: rutBase,
        rut_completo: cleanText(student.rut_completo || rutBase),
        alumno: cleanText(`${student.nombres || ""} ${student.apellidos || ""}`.trim()),
        curso: cleanText(student.curso || ""),
        telefon: cleanText(student.telefon || ""),
        email: cleanText(String(student.email || "").trim().toLowerCase()),
        atrasos_vigentes: Number(row.current_month_count || 0),
        atrasos_historicos: Number(row.total_historic_count || 0),
        periodo: `${year}-${pad(month)}`,
      };

      const existing = uniqueByRut.get(rutBase);
      if (!existing) {
        uniqueByRut.set(rutBase, candidate);
        return;
      }

      const candidateScore = candidate.atrasos_vigentes * 100000 + candidate.atrasos_historicos;
      const existingScore = existing.atrasos_vigentes * 100000 + existing.atrasos_historicos;
      if (candidateScore > existingScore) {
        uniqueByRut.set(rutBase, candidate);
      }
    });

    const rows = [...uniqueByRut.values()]
      .sort((a, b) =>
        b.atrasos_vigentes - a.atrasos_vigentes ||
        b.atrasos_historicos - a.atrasos_historicos ||
        a.alumno.localeCompare(b.alumno, "es")
      );

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: [
        "rut_base",
        "rut_completo",
        "alumno",
        "curso",
        "telefon",
        "email",
        "atrasos_vigentes",
        "atrasos_historicos",
        "periodo",
      ],
    });

    XLSX.utils.sheet_add_aoa(worksheet, [[
      "RUT base",
      "RUT completo",
      "Alumno",
      "Curso",
      "Teléfono",
      "Correo",
      "Atrasos vigentes",
      "Atrasos históricos",
      "Período",
    ]], { origin: "A1" });

    worksheet["!cols"] = [
      { wch: 14 },
      { wch: 16 },
      { wch: 34 },
      { wch: 18 },
      { wch: 18 },
      { wch: 34 },
      { wch: 18 },
      { wch: 20 },
      { wch: 12 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Alumnos 3+");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="informe_atrasos_alerta_${year}_${pad(month)}.xlsx"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al exportar Excel";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
