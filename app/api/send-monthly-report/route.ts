import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function monthNameEs(month: number) {
  return [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ][month - 1];
}

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

function getPreviousPeriod(year: number, month: number) {
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
}

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || "true") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const isProduction = process.env.NODE_ENV === "production";

  if (!host || !user || !pass) {
    throw new Error("Faltan variables SMTP en .env.local");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: isProduction,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const now = getChileNow();

    const baseYear = Number(body.year || now.year);
    const baseMonth = Number(body.month || now.month);

    if (!baseYear || !baseMonth || baseMonth < 1 || baseMonth > 12) {
      return NextResponse.json(
        { ok: false, message: "Parámetros de año o mes inválidos." },
        { status: 400 }
      );
    }

    const { year, month } = getPreviousPeriod(baseYear, baseMonth);

    const startDate = `${year}-${pad(month)}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextMonthYear = month === 12 ? year + 1 : year;
    const endExclusive = `${nextMonthYear}-${pad(nextMonth)}-01`;

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
        students (
          rut_completo,
          nombres,
          apellidos,
          curso,
          email
        )
      `)
      .gte("fecha", startDate)
      .lt("fecha", endExclusive)
      .eq("cancelled", false)
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, message: "No se pudo reunir la información del informe." },
        { status: 500 }
      );
    }

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
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Atrasos");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    const fileName = `informe_atrasos_${year}_${pad(month)}.xlsx`;
    const to = process.env.REPORT_TO || "inspectoria@becarb.cl";
    const from = process.env.SMTP_USER || "inspectoria@becarb.cl";
    const subject = `Informe de atrasos ${monthNameEs(month)} ${year}`;

    const transporter = buildTransporter();

    await transporter.sendMail({
      from,
      to,
      subject,
      text: `Adjunto se envía el informe de atrasos correspondiente a ${monthNameEs(month)} de ${year}.`,
      attachments: [
        {
          filename: fileName,
          content: buffer,
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    });

    await supabase.from("monthly_reports").insert({
      report_year: year,
      report_month: month,
      file_name: fileName,
      file_url: null,
      sent_to: to,
      subject,
      sent_at: new Date().toISOString(),
      status: "sent",
    });

    return NextResponse.json({
      ok: true,
      message: `Informe enviado correctamente a ${to}.`,
      report: {
        year,
        month,
        file_name: fileName,
        rows: rows.length,
        sent_to: to,
        subject,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al enviar informe";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}