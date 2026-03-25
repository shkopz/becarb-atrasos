import { NextResponse } from "next/server";

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

  const year = map.year;
  const month = map.month;
  const day = map.day;
  const hour = map.hour;
  const minute = map.minute;
  const second = map.second;

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),

    // formato visible chileno
    date: `${day}/${month}/${year}`,

    // formato técnico por si lo necesitas después
    date_key: `${year}-${month}-${day}`,

    time: `${hour}:${minute}:${second}`,
    hhmm: `${hour}:${minute}`,
    iso_local: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
    timezone: "America/Santiago",
  };
}

export async function GET() {
  const chileNow = getChileNow();

  return NextResponse.json({
    ok: true,
    now: chileNow,
  });
}