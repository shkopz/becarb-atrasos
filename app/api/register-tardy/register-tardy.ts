import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  if (hhmm >= "08:05" && hhmm <= "08:15") return "A";
  if (hhmm >= "08:16" && hhmm <= "08:30") return "B";
  if (hhmm >= "08:31") return "C";
  return null;
}

function buildNotificationContent(params: {
  nombres: string;
  count: number;
  curso: string;
  fecha: string;
  hora: string;
}) {
  const { nombres, count, curso, fecha, hora } = params;

  if (count >= 3) {
    return {
      notificationType: "meeting",
      subject: "Citación por atrasos registrados",
      text:
        `Estimado/a ${nombres}:\n\n` +
        `Se ha registrado un nuevo atraso en tu ingreso al establecimiento.\n` +
        `Actualmente acumulas ${count} atraso(s) vigente(s) en el período actual.\n\n` +
        `Informamos que se espera la presencia de tu apoderado en el establecimiento para entrevista y justificación de los atrasos registrados.\n\n` +
        `Detalle del registro:\n` +
        `Curso: ${curso}\n` +
        `Fecha: ${fecha}\n` +
        `Hora: ${hora}\n\n` +
        `Saludos cordiales,\n` +
        `Inspectoría\n` +
        `Colegio Becarb`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1d2430;">
          <h2 style="margin-bottom: 8px;">Citación por atrasos registrados</h2>
          <p>Estimado/a <strong>${nombres}</strong>:</p>
          <p>Se ha registrado un nuevo atraso en tu ingreso al establecimiento.</p>
          <p>Actualmente acumulas <strong>${count} atraso(s) vigente(s)</strong> en el período actual.</p>
          <p>Informamos que se espera la presencia de tu apoderado en el establecimiento para entrevista y justificación de los atrasos registrados.</p>
          <p>
            <strong>Detalle del registro</strong><br>
            Curso: ${curso}<br>
            Fecha: ${fecha}<br>
            Hora: ${hora}
          </p>
          <p>Saludos cordiales,<br>Inspectoría<br>Colegio Becarb</p>
        </div>
      `,
    };
  }

  return {
    notificationType: "warning",
    subject: "Aviso de atraso registrado",
    text:
      `Estimado/a ${nombres}:\n\n` +
      `Se ha registrado un atraso en tu ingreso al establecimiento.\n` +
      `Actualmente acumulas ${count} atraso(s) vigente(s) en el período actual.\n\n` +
      `Te recordamos que, al cumplir 3 atrasos, tu apoderado deberá presentarse en el colegio para justificar la situación.\n\n` +
      `Detalle del registro:\n` +
      `Curso: ${curso}\n` +
      `Fecha: ${fecha}\n` +
      `Hora: ${hora}\n\n` +
      `Saludos cordiales,\n` +
      `Inspectoría\n` +
      `Colegio Becarb`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1d2430;">
        <h2 style="margin-bottom: 8px;">Aviso de atraso registrado</h2>
        <p>Estimado/a <strong>${nombres}</strong>:</p>
        <p>Se ha registrado un atraso en tu ingreso al establecimiento.</p>
        <p>Actualmente acumulas <strong>${count} atraso(s) vigente(s)</strong> en el período actual.</p>
        <p>Te recordamos que, al cumplir <strong>3 atrasos</strong>, tu apoderado deberá presentarse en el colegio para justificar la situación.</p>
        <p>
          <strong>Detalle del registro</strong><br>
          Curso: ${curso}<br>
          Fecha: ${fecha}<br>
          Hora: ${hora}
        </p>
        <p>Saludos cordiales,<br>Inspectoría<br>Colegio Becarb</p>
      </div>
    `,
  };
}

async function logNotification(params: {
  tardyRecordId: number;
  studentId: number;
  rutBase: string;
  email: string;
  notificationType: string;
  subject: string;
  status: "sent" | "error";
  errorMessage?: string | null;
}) {
  await supabase.from("tardy_notification_logs").insert({
    tardy_record_id: params.tardyRecordId,
    student_id: params.studentId,
    rut_base: params.rutBase,
    email: params.email,
    notification_type: params.notificationType,
    subject: params.subject,
    status: params.status,
    error_message: params.errorMessage || null,
  });
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

  if (counterRow) {
    return counterRow;
  }

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

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select(`
        id,
        rut_base,
        rut_completo,
        nombres,
        apellidos,
        curso,
        email,
        activo
      `)
      .eq("rut_base", rutBase)
      .maybeSingle();

    if (studentError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo consultar el estudiante en Supabase." },
        { status: 500 }
      );
    }

    if (!student || student.activo === false) {
      return NextResponse.json(
        { ok: false, message: "RUT NO ENCONTRADO" },
        { status: 404 }
      );
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

    const { data: duplicate, error: duplicateError } = await supabase
      .from("tardy_records")
      .select("id")
      .eq("student_id", student.id)
      .eq("fecha", chileNow.date)
      .eq("cancelled", false)
      .limit(1);

    if (duplicateError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo validar el duplicado del día." },
        { status: 500 }
      );
    }

    if (duplicate && duplicate.length > 0) {
      return NextResponse.json(
        { ok: false, message: "ALUMNO YA REGISTRADO" },
        { status: 409 }
      );
    }

    const { data: insertedTardy, error: insertTardyError } = await supabase
      .from("tardy_records")
      .insert({
        student_id: student.id,
        rut_base: student.rut_base,
        fecha: chileNow.date,
        hora: timeToUse,
        categoria,
        source,
        created_by: createdBy,
        cancelled: false,
      })
      .select("id")
      .single();

    if (insertTardyError || !insertedTardy) {
      return NextResponse.json(
        { ok: false, message: "No se pudo guardar el atraso." },
        { status: 500 }
      );
    }

    const counterRow = await ensureCounterForStudent(student.id);
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

    let notification: {
      attempted: boolean;
      sent: boolean;
      email: string;
      type: string | null;
      message: string;
    } = {
      attempted: false,
      sent: false,
      email: student.email || "",
      type: null,
      message: "Sin envío de correo.",
    };

    if (student.email) {
      const mail = buildNotificationContent({
        nombres: student.nombres,
        count: nextCurrent,
        curso: student.curso,
        fecha: chileNow.date,
        hora: timeToUse,
      });

      notification = {
        attempted: true,
        sent: false,
        email: student.email,
        type: mail.notificationType,
        message: "Intento de envío realizado.",
      };

      try {
        const transporter = buildTransporter();

        await transporter.sendMail({
          from: process.env.SMTP_USER || "inspectoria@becarb.cl",
          to: student.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });

        await logNotification({
          tardyRecordId: insertedTardy.id,
          studentId: student.id,
          rutBase: student.rut_base,
          email: student.email,
          notificationType: mail.notificationType,
          subject: mail.subject,
          status: "sent",
        });

        notification.sent = true;
        notification.message = "Correo enviado correctamente.";
      } catch (mailError) {
        const errorMessage =
          mailError instanceof Error ? mailError.message : "Error desconocido al enviar correo.";

        await logNotification({
          tardyRecordId: insertedTardy.id,
          studentId: student.id,
          rutBase: student.rut_base,
          email: student.email,
          notificationType: mail.notificationType,
          subject: mail.subject,
          status: "error",
          errorMessage,
        });

        notification.sent = false;
        notification.message = errorMessage;
      }
    }

    return NextResponse.json({
      ok: true,
      source: "supabase",
      student: {
        rut_base: student.rut_base,
        rut_completo: student.rut_completo,
        nombres: student.nombres,
        apellidos: student.apellidos,
        curso: student.curso,
        email: student.email,
      },
      tardy: {
        fecha: chileNow.date,
        hora: timeToUse,
        categoria,
        current_month_count: nextCurrent,
        total_historic_count: nextHistoric,
      },
      notification,
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
