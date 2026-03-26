import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeRole(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function formatDisplayName(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || "true") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const isProduction = process.env.NODE_ENV === "production";

  if (!host || !user || !pass) {
    throw new Error("Faltan variables SMTP en el entorno.");
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

async function validateRequestSession(request: Request) {
  const sessionUrl = new URL("/api/session", request.url);

  const response = await fetch(sessionUrl.toString(), {
    method: "GET",
    headers: {
      cookie: request.headers.get("cookie") || "",
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));

  const role = normalizeRole(
    payload?.user?.role ||
      payload?.role ||
      payload?.user?.tipo ||
      payload?.tipo ||
      ""
  );

  const authenticated = Boolean(
    payload?.authenticated ??
      payload?.isAuthenticated ??
      payload?.logged_in ??
      payload?.loggedIn ??
      payload?.user ??
      payload?.session
  );

  if (!response.ok || !authenticated) {
    return {
      ok: false,
      status: 401,
      message: "Tu sesión expiró o ya no está activa.",
      role,
    };
  }

  if (!["admin", "administrador", "superadmin"].includes(role)) {
    return {
      ok: false,
      status: 403,
      message: "No tienes permisos para enviar correos desde Gestión de Datos.",
      role,
    };
  }

  return {
    ok: true,
    status: 200,
    message: "",
    role,
  };
}

function getChileMonthBounds() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  const year = Number(map.year);
  const month = Number(map.month);

  const start = `${year}-${String(month).padStart(2, "0")}-01`;

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

  return {
    start,
    end,
  };
}

export async function POST(request: Request) {
  try {
    const session = await validateRequestSession(request);

    if (!session.ok) {
      return NextResponse.json(
        { ok: false, message: session.message },
        { status: session.status }
      );
    }

    const body = await request.json().catch(() => ({}));
    const rutBase = String(body?.rut_base || "").trim();
    const comentarioUsuario = String(body?.comentario || "").trim();

    if (!rutBase) {
      return NextResponse.json(
        { ok: false, message: "Debes indicar el RUT base del estudiante." },
        { status: 400 }
      );
    }

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("rut_base, rut_completo, nombres, apellidos, curso, email, activo")
      .eq("rut_base", rutBase)
      .maybeSingle();

    if (studentError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo leer la información del estudiante." },
        { status: 500 }
      );
    }

    if (!student) {
      return NextResponse.json(
        { ok: false, message: "No se encontró el estudiante indicado." },
        { status: 404 }
      );
    }

    const email = String(student.email || "").trim();
    if (!email) {
      return NextResponse.json(
        { ok: false, message: "El estudiante no tiene correo registrado." },
        { status: 400 }
      );
    }

    const { start, end } = getChileMonthBounds();

    const { count, error: countError } = await supabase
      .from("tardy_records")
      .select("*", { count: "exact", head: true })
      .eq("rut_base", rutBase)
      .eq("cancelled", false)
      .gte("fecha", start)
      .lt("fecha", end);

    if (countError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo calcular la cantidad de atrasos vigentes." },
        { status: 500 }
      );
    }

    const atrasosVigentes = Number(count || 0);
    const nombre = formatDisplayName(
      `${student.nombres || ""} ${student.apellidos || ""}`.trim()
    );
    const comentarios =
      comentarioUsuario || "Sin comentarios adicionales.";

    const subject = "Registro de atraso";

    const text = [
      `Estimado/a ${nombre}:`,
      "",
      `Informamos que cuentas con ${atrasosVigentes} atraso(s) vigente(s) registrado(s) este mes en el sistema de control de atrasos del establecimiento.`,
      "",
      "Comentarios:",
      comentarios,
      "",
      "Saludos cordiales,",
      "Inspectoría",
      "Colegio Becarb II",
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;color:#1d2430;line-height:1.6;">
        <p>Estimado/a <strong>${escapeHtml(nombre)}</strong>:</p>
        <p>
          Informamos que cuentas con
          <strong>${atrasosVigentes} atraso(s) vigente(s)</strong>
          registrado(s) este mes en el sistema de control de atrasos del establecimiento.
        </p>
        <p><strong>Comentarios:</strong><br>${escapeHtml(comentarios).replace(/\n/g, "<br>")}</p>
        <p style="margin-top:24px;">
          Saludos cordiales,<br>
          Inspectoría<br>
          Colegio Becarb II
        </p>
      </div>
    `;

    const transporter = buildTransporter();

    await transporter.sendMail({
      from: `"Colegio Becarb II" <${process.env.SMTP_USER}>`,
      to: email,
      subject,
      text,
      html,
    });

    return NextResponse.json({
      ok: true,
      message: "Correo enviado correctamente.",
      student: {
        rut_base: student.rut_base,
        rut_completo: student.rut_completo || "",
        nombre,
        curso: student.curso || "",
        email,
      },
      current_month_count: atrasosVigentes,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido al enviar el correo.";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}
