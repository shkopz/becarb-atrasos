import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import crypto from "crypto";

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

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return NextResponse.json(
        {
          ok: false,
          message: "Debes ingresar un correo válido.",
        },
        { status: 400 }
      );
    }

    const safeResponse = {
      ok: true,
      message:
        "Si el correo está registrado, te enviaremos instrucciones para cambiar tu contraseña.",
    };

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, username, email, active")
      .eq("email", email)
      .maybeSingle();

    if (userError || !user || !user.active) {
      return NextResponse.json(safeResponse);
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await supabase
      .from("password_reset_tokens")
      .delete()
      .eq("user_id", user.id)
      .is("used_at", null);

    const { error: insertError } = await supabase
      .from("password_reset_tokens")
      .insert({
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      });

    if (insertError) {
      return NextResponse.json(
        {
          ok: false,
          message: "No se pudo generar el token de recuperación.",
        },
        { status: 500 }
      );
    }

    const baseUrl = "https://atrasos.becarb.cl";
    const resetLink = `${baseUrl}/reset-password?token=${rawToken}`;

    const transporter = buildTransporter();

    await transporter.sendMail({
      from: process.env.SMTP_USER || "inspectoria@becarb.cl",
      to: email,
      subject: "Recuperación de contraseña · Control de Atrasos Becarb",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1d2430;">
          <h2 style="margin-bottom: 8px;">Recuperación de contraseña</h2>
          <p>Hola ${user.username},</p>
          <p>
            Recibimos una solicitud para cambiar tu contraseña del sistema
            <strong>Control de Atrasos Becarb</strong>.
          </p>
          <p>Haz click en el siguiente enlace para definir una nueva contraseña:</p>
          <p>
            <a href="${resetLink}" style="color: #1d74b7; font-weight: bold;">
              Cambiar contraseña
            </a>
          </p>
          <p>Este enlace vencerá en 1 hora.</p>
          <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
        </div>
      `,
      text: `Hola ${user.username}. Usa este enlace para cambiar tu contraseña: ${resetLink}. El enlace vence en 1 hora.`,
    });

    return NextResponse.json(safeResponse);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido al solicitar recuperación";

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 }
    );
  }
}