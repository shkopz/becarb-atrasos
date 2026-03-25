import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function GET() {
  try {
    const now = getChileNow();

    const { data, error } = await supabase
      .from("tardy_records")
      .select("fecha")
      .eq("cancelled", false)
      .order("fecha", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, message: "No se pudieron leer los períodos con registros." },
        { status: 500 }
      );
    }

    const keys = new Set<string>();

    // siempre incluye mes en curso
    keys.add(`${now.year}-${pad(now.month)}`);

    (data || []).forEach((row: any) => {
      const fecha = String(row.fecha || "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        keys.add(fecha.slice(0, 7));
      }
    });

    const periods = [...keys]
      .sort((a, b) => (a < b ? 1 : -1))
      .map((key) => {
        const [year, month] = key.split("-").map(Number);
        const isCurrent = year === now.year && month === now.month;

        return {
          key,
          year,
          month,
          label: isCurrent
            ? `${monthNameEs(month)} ${year} · mes en curso`
            : `${monthNameEs(month)} ${year}`,
          is_current: isCurrent,
        };
      });

    return NextResponse.json({
      ok: true,
      periods,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al leer períodos";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}