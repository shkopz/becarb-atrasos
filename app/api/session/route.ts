import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const isProduction = process.env.NODE_ENV === "production";

export async function GET() {
  const cookieStore = await cookies();

  const username = cookieStore.get("becarb_user")?.value || "";
  const role = cookieStore.get("becarb_role")?.value || "";

  if (!username || !role) {
    return NextResponse.json(
      { ok: false, authenticated: false },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    authenticated: true,
    user: {
      username,
      role,
    },
  });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set("becarb_user", "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  response.cookies.set("becarb_role", "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}