import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const INSPECTORIA_EMAIL = "inspectoria@becarb.cl";

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
    auth: { user, pass },
    tls: { rejectUnauthorized: isProduction },
  });
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
  };
}

function classifyTardy(hhmm: string) {
  if (hhmm >= "08:05" && hhmm <= "08:15") return "A";
  if (hhmm >= "08:16" && hhmm <= "08:30") return "B";
  if (hhmm >= "08:31") return "C";
  return null;
}

async function ensureCounterForStudent(studentId: number) {
  const { data: counterRow, error: counterError } = await supabase
    .from("student_counters")
    .select("id, current_month_count, total_historic_count")
    .eq("student_id", studentId)
    .maybeSingle();

  if (counterError) {
    throw new Error("No se pudo leer el contador del estudiante.");
  }

  if (counterRow) return counterRow;

  const { data: insertedCounter, error: insertCounterError } = await supabase
    .from("student_counters")
    .insert({
      student_id: studentId,
      current_month_count: 0,
      total_historic_count: 0,
    })
    .select("id, current_month_count, total_historic_count")
    .single();

  if (insertCounterError || !insertedCounter) {
    throw new Error("No se pudo crear el contador del estudiante.");
  }

  return insertedCounter;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const rutBase = String(formData.get("rut_base") || "").replace(/\D/g, "");
    const horaIngreso = String(formData.get("hora_ingreso") || "").slice(0, 5);
    const observacion = String(formData.get("observacion") || "").trim();
    const createdBy = String(formData.get("created_by") || "desconocido").trim().toLowerCase();
    const evidencia = formData.get("evidencia");

    if (!/^\d{8,9}$/.test(rutBase)) {
      return NextResponse.json(
        { ok: false, message: "RUT inválido. Debe tener 8 o 9 dígitos." },
        { status: 400 }
      );
    }

    if (!/^\d{2}:\d{2}$/.test(horaIngreso)) {
      return NextResponse.json(
        { ok: false, message: "Debes indicar una hora de ingreso válida." },
        { status: 400 }
      );
    }

    const categoria = classifyTardy(horaIngreso);
    if (!categoria) {
      return NextResponse.json(
        { ok: false, message: "La hora indicada no corresponde a un atraso registrable." },
        { status: 400 }
      );
    }

    const { date } = getChileNow();

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id, rut_base, rut_completo, nombres, apellidos, curso, email, activo")
      .eq("rut_base", rutBase)
      .maybeSingle();

    if (studentError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo consultar el estudiante." },
        { status: 500 }
      );
    }

    if (!student || student.activo === false) {
      return NextResponse.json(
        { ok: false, message: "RUT NO ENCONTRADO" },
        { status: 404 }
      );
    }

    const { data: duplicateRecord, error: duplicateError } = await supabase
      .from("tardy_records")
      .select("id")
      .eq("rut_base", rutBase)
      .eq("fecha", date)
      .eq("cancelled", false)
      .maybeSingle();

    if (duplicateError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo validar si el alumno ya fue registrado hoy." },
        { status: 500 }
      );
    }

    if (duplicateRecord) {
      return NextResponse.json(
        { ok: false, message: "ALUMNO YA REGISTRADO" },
        { status: 409 }
      );
    }

    const counterRow = await ensureCounterForStudent(student.id);
    const nextCurrentMonthCount = Number(counterRow.current_month_count || 0) + 1;
    const nextTotalHistoricCount = Number(counterRow.total_historic_count || 0) + 1;

    const { data: insertedTardy, error: insertTardyError } = await supabase
      .from("tardy_records")
      .insert({
        rut_base: rutBase,
        fecha: date,
        hora: `${horaIngreso}:00`,
        categoria,
        source: "manual",
        created_by: createdBy,
        cancelled: false,
      })
      .select("id, fecha, hora, categoria")
      .single();

    if (insertTardyError || !insertedTardy) {
      return NextResponse.json(
        { ok: false, message: "No se pudo guardar el ingreso manual." },
        { status: 500 }
      );
    }

    const { error: updateCounterError } = await supabase
      .from("student_counters")
      .update({
        current_month_count: nextCurrentMonthCount,
        total_historic_count: nextTotalHistoricCount,
      })
      .eq("student_id", student.id);

    if (updateCounterError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo actualizar el contador del estudiante." },
        { status: 500 }
      );
    }

    const transporter = buildTransporter();
    const toEmail = student.email || INSPECTORIA_EMAIL;
    const ccEmail = student.email ? INSPECTORIA_EMAIL : undefined;
    const fullName = `${student.nombres || ""} ${student.apellidos || ""}`.trim();
    const prettyObservation = observacion || "Sin observación adicional.";

    const attachments = [] as nodemailer.SendMailOptions["attachments"];
    if (evidencia instanceof File && evidencia.size > 0) {
      const buffer = Buffer.from(await evidencia.arrayBuffer());
      attachments?.push({
        filename: evidencia.name || "respaldo-atraso.jpg",
        content: buffer,
        contentType: evidencia.type || "image/jpeg",
      });
    }

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: toEmail,
      cc: ccEmail,
      subject: `Ingreso manual registrado · ${student.curso || "Alumno"}`,
      text:
        `Estimado/a ${student.nombres}:\n\n` +
        `Se ha registrado un ingreso manual en el sistema de control de atrasos.\n\n` +
        `Detalle del ingreso:\n` +
        `Alumno: ${fullName}\n` +
        `RUT: ${student.rut_completo || student.rut_base}\n` +
        `Curso: ${student.curso || "Sin curso"}\n` +
        `Fecha: ${date}\n` +
        `Hora de ingreso: ${horaIngreso}\n` +
        `Categoría: ${categoria}\n\n` +
        `Observación:\n${prettyObservation}\n\n` +
        `Este correo se envía también a inspectoría como respaldo del ingreso manual.\n\n` +
        `Saludos cordiales,\nInspectoría\nColegio Becarb`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1d2430;">
          <h2 style="margin-bottom: 10px;">Ingreso manual registrado</h2>
          <p>Estimado/a <strong>${student.nombres}</strong>:</p>
          <p>Se ha registrado un ingreso manual en el sistema de control de atrasos.</p>
          <p>
            <strong>Detalle del ingreso</strong><br>
            Alumno: ${fullName}<br>
            RUT: ${student.rut_completo || student.rut_base}<br>
            Curso: ${student.curso || "Sin curso"}<br>
            Fecha: ${date}<br>
            Hora de ingreso: ${horaIngreso}<br>
            Categoría: ${categoria}
          </p>
          <p><strong>Observación</strong><br>${prettyObservation.replace(/\n/g, "<br>")}</p>
          <p>Este correo se envía también a <strong>${INSPECTORIA_EMAIL}</strong> como respaldo del ingreso manual.</p>
          <p>Saludos cordiales,<br>Inspectoría<br>Colegio Becarb</p>
        </div>
      `,
      attachments,
    });

    return NextResponse.json({
      ok: true,
      student: {
        id: student.id,
        rut_base: student.rut_base,
        rut_completo: student.rut_completo,
        nombres: student.nombres,
        apellidos: student.apellidos,
        curso: student.curso,
        email: student.email,
      },
      tardy: {
        id: insertedTardy.id,
        fecha: insertedTardy.fecha,
        hora: insertedTardy.hora,
        categoria: insertedTardy.categoria,
        current_month_count: nextCurrentMonthCount,
        total_historic_count: nextTotalHistoricCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo procesar el ingreso manual.",
      },
      { status: 500 }
    );
  }
}
