import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const token = String(body.token || "").trim();
    const password = String(body.password || "").trim();
    const confirmPassword = String(body.confirmPassword || "").trim();

    if (!token) {
      return NextResponse.json(
        { ok: false, message: "Token inválido o ausente." },
        { status: 400 }
      );
    }

    if (!password || password.length < 4) {
      return NextResponse.json(
        { ok: false, message: "La nueva contraseña debe tener al menos 4 caracteres." },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { ok: false, message: "Las contraseñas no coinciden." },
        { status: 400 }
      );
    }

    const tokenHash = hashToken(token);

    const { data: resetToken, error: tokenError } = await supabase
      .from("password_reset_tokens")
      .select("id, user_id, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (tokenError || !resetToken) {
      return NextResponse.json(
        { ok: false, message: "El enlace de recuperación no es válido." },
        { status: 400 }
      );
    }

    if (resetToken.used_at) {
      return NextResponse.json(
        { ok: false, message: "Este enlace ya fue utilizado." },
        { status: 400 }
      );
    }

    const expiresAt = new Date(resetToken.expires_at);
    if (expiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        { ok: false, message: "El enlace de recuperación ya venció." },
        { status: 400 }
      );
    }

    const newPasswordHash = await bcrypt.hash(password, 10);

    const { error: updateUserError } = await supabase
      .from("users")
      .update({
        password_hash: newPasswordHash,
      })
      .eq("id", resetToken.user_id);

    if (updateUserError) {
      return NextResponse.json(
        { ok: false, message: "No se pudo actualizar la contraseña." },
        { status: 500 }
      );
    }

    const { error: markUsedError } = await supabase
      .from("password_reset_tokens")
      .update({
        used_at: new Date().toISOString(),
      })
      .eq("id", resetToken.id);

    if (markUsedError) {
      return NextResponse.json(
        { ok: false, message: "La contraseña cambió, pero no se pudo cerrar el token." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Tu contraseña fue actualizada correctamente.",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido al restablecer contraseña";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}