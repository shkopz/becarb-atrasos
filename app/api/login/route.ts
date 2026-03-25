import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const isProduction = process.env.NODE_ENV === "production";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "").trim();

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, message: "Credenciales incompletas." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("users")
      .select("username, role, password_hash, active, email")
      .eq("username", username)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, message: "Usuario o clave incorrectos." },
        { status: 401 }
      );
    }

    if (!data.active) {
      return NextResponse.json(
        { ok: false, message: "El usuario está inactivo." },
        { status: 403 }
      );
    }

    const passwordOk = await bcrypt.compare(password, data.password_hash || "");

    if (!passwordOk) {
      return NextResponse.json(
        { ok: false, message: "Usuario o clave incorrectos." },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      ok: true,
      user: {
        username: data.username,
        role: data.role,
        email: data.email || "",
      },
    });

    response.cookies.set("becarb_user", data.username, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });

    response.cookies.set("becarb_role", data.role, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });

    return response;
  } catch {
    return NextResponse.json(
      { ok: false, message: "No se pudo iniciar sesión." },
      { status: 500 }
    );
  }
}