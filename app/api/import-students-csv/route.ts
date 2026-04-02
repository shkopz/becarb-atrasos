import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type SessionValidation = {
  ok: boolean;
  status: number;
  message: string;
  role: string;
};

type CsvStudentRow = {
  rut_base: string;
  rut_completo: string;
  nombres: string;
  apellidos: string;
  curso: string;
  email: string;
  telefon: string | null;
  activo: boolean;
};

type ExistingStudentRow = {
  id: number;
  rut_base: string;
  rut_completo: string | null;
  nombres: string | null;
  apellidos: string | null;
  curso: string | null;
  email: string | null;
  telefon: string | null;
  activo: boolean | null;
};

function normalizeRole(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function countSuspiciousCharacters(value: string) {
  return (value.match(/[ÃÂ�]/g) || []).length;
}

function repairMojibake(value: string) {
  const cleaned = String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  let normalized = cleaned.normalize("NFC");

  if (/[ÃÂ�]/.test(normalized)) {
    try {
      const repaired = Buffer.from(normalized, "latin1").toString("utf8");
      if (countSuspiciousCharacters(repaired) < countSuspiciousCharacters(normalized)) {
        normalized = repaired.normalize("NFC");
      }
    } catch {
      // Si falla la reparación, se conserva el valor original.
    }
  }

  return normalized;
}

function normalizeText(value: unknown) {
  return repairMojibake(String(value ?? ""));
}

function normalizeRutBase(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 9);
}

function normalizeRutCompleto(value: unknown) {
  return repairMojibake(String(value ?? "")).toUpperCase();
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePhone(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeRole(String(value ?? ""));
  if (!normalized) return false;
  return ["true", "1", "si", "sí", "activo", "activa", "yes"].includes(normalized);
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function validateRequestSession(request: Request): Promise<SessionValidation> {
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
      message: "No tienes permisos para actualizar la base de datos.",
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

function getHeaderIndexMap(headerRow: unknown[]) {
  const map = new Map<string, number>();

  headerRow.forEach((cell, index) => {
    const key = normalizeRole(String(cell ?? "").replace(/^\uFEFF/, ""));
    if (key) {
      map.set(key, index);
    }
  });

  return map;
}

function decodeCsvBuffer(buffer: Buffer) {
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return repairMojibake(utf8);
  } catch {
    const latin1 = new TextDecoder("latin1").decode(buffer);
    return repairMojibake(latin1);
  }
}

function findHeaderIndex(headerMap: Map<string, number>, aliases: string[]) {
  for (const alias of aliases) {
    const index = headerMap.get(normalizeRole(alias));
    if (typeof index === "number") return index;
  }
  return -1;
}

function parseCsvRowsFromWorkbook(buffer: Buffer) {
  const csvText = decodeCsvBuffer(buffer);
  const workbook = XLSX.read(csvText, { type: "string", raw: false });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("El archivo CSV no contiene hojas o datos legibles.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  if (!rows.length) {
    throw new Error("El archivo CSV está vacío.");
  }

  const headerMap = getHeaderIndexMap(rows[0]);

  const indexes = {
    rut_base: findHeaderIndex(headerMap, ["rut_base", "rut base"]),
    rut_completo: findHeaderIndex(headerMap, ["rut_completo", "rut completo"]),
    nombres: findHeaderIndex(headerMap, ["nombres", "nombre", "name"]),
    apellidos: findHeaderIndex(headerMap, ["apellidos", "apellido", "last_name"]),
    curso: findHeaderIndex(headerMap, ["curso", "course"]),
    email: findHeaderIndex(headerMap, ["email", "correo", "correo_electronico", "correo electronico"]),
    activo: findHeaderIndex(headerMap, ["activo", "activa", "habilitado", "enabled"]),
    telefon: findHeaderIndex(headerMap, [
      "telefon",
      "telefono",
      "teléfono",
      "telefono alumno",
      "teléfono alumno",
      "fono",
      "fono alumno",
      "celular",
      "telefono estudiante",
      "teléfono estudiante",
      "phone",
    ]),
  };

  const requiredHeaders = [
    "rut_base",
    "rut_completo",
    "nombres",
    "apellidos",
    "curso",
    "email",
    "activo",
  ] as const;

  const missingHeaders = requiredHeaders.filter((header) => indexes[header] < 0);
  const hasTelefonColumn = indexes.telefon >= 0;

  if (missingHeaders.length) {
    throw new Error(
      `Faltan columnas obligatorias en el CSV: ${missingHeaders.join(", ")}.`
    );
  }

  const warnings: string[] = [];
  const rowsByRut = new Map<string, CsvStudentRow>();
  let invalidRows = 0;

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;

    const rutBase = normalizeRutBase(row[indexes.rut_base]);
    if (!rutBase) {
      invalidRows += 1;
      warnings.push(`Fila ${rowNumber}: rut_base vacío o inválido. Se omitió.`);
      return;
    }

    const parsedRow: CsvStudentRow = {
      rut_base: rutBase,
      rut_completo: normalizeRutCompleto(row[indexes.rut_completo]),
      nombres: normalizeText(row[indexes.nombres]),
      apellidos: normalizeText(row[indexes.apellidos]),
      curso: normalizeText(row[indexes.curso]),
      email: normalizeEmail(row[indexes.email]),
      telefon: hasTelefonColumn ? normalizePhone(row[indexes.telefon]) : null,
      activo: parseBoolean(row[indexes.activo]),
    };

    if (rowsByRut.has(rutBase)) {
      warnings.push(
        `Fila ${rowNumber}: rut_base ${rutBase} repetido en el CSV. Se usó la última aparición.`
      );
    }

    rowsByRut.set(rutBase, parsedRow);
  });

  return {
    rows: [...rowsByRut.values()],
    warnings,
    invalidRows,
    hasTelefonColumn,
  };
}

function hasStudentChanges(existing: ExistingStudentRow, incoming: CsvStudentRow) {
  return (
    normalizeRutCompleto(existing.rut_completo) !== incoming.rut_completo ||
    normalizeText(existing.nombres) !== incoming.nombres ||
    normalizeText(existing.apellidos) !== incoming.apellidos ||
    normalizeText(existing.curso) !== incoming.curso ||
    normalizeEmail(existing.email) !== incoming.email ||
    (incoming.telefon !== null && normalizePhone(existing.telefon) !== normalizePhone(incoming.telefon)) ||
    Boolean(existing.activo) !== incoming.activo
  );
}

async function fetchExistingStudents(rutBases: string[]) {
  const rows: ExistingStudentRow[] = [];

  for (const chunk of chunkArray(rutBases, 400)) {
    const { data, error } = await supabase
      .from("students")
      .select("id, rut_base, rut_completo, nombres, apellidos, curso, email, telefon, activo")
      .in("rut_base", chunk);

    if (error) {
      throw new Error("No se pudo leer la tabla students antes de actualizar.");
    }

    rows.push(...((data || []) as ExistingStudentRow[]));
  }

  return rows;
}

async function createMissingCountersForNewStudents(rutBases: string[]) {
  if (!rutBases.length) return 0;

  const insertedStudents: { id: number; rut_base: string }[] = [];

  for (const chunk of chunkArray(rutBases, 400)) {
    const { data, error } = await supabase
      .from("students")
      .select("id, rut_base")
      .in("rut_base", chunk);

    if (error) {
      throw new Error("Los alumnos se actualizaron, pero no se pudieron leer sus IDs.");
    }

    insertedStudents.push(...((data || []) as { id: number; rut_base: string }[]));
  }

  if (!insertedStudents.length) return 0;

  const existingCounterIds = new Set<number>();

  for (const chunk of chunkArray(insertedStudents.map((item) => item.id), 400)) {
    const { data, error } = await supabase
      .from("student_counters")
      .select("student_id")
      .in("student_id", chunk);

    if (error) {
      throw new Error(
        "Los alumnos se actualizaron, pero no se pudieron revisar sus contadores."
      );
    }

    (data || []).forEach((row: any) => {
      if (typeof row.student_id === "number") {
        existingCounterIds.add(row.student_id);
      }
    });
  }

  const countersToInsert = insertedStudents
    .filter((student) => !existingCounterIds.has(student.id))
    .map((student) => ({
      student_id: student.id,
      current_month_count: 0,
      total_historic_count: 0,
    }));

  if (!countersToInsert.length) return 0;

  for (const chunk of chunkArray(countersToInsert, 300)) {
    const { error } = await supabase.from("student_counters").insert(chunk);

    if (error) {
      throw new Error(
        "Los alumnos se actualizaron, pero no se pudieron crear los contadores faltantes."
      );
    }
  }

  return countersToInsert.length;
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

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, message: "Debes adjuntar un archivo CSV." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseCsvRowsFromWorkbook(buffer);

    if (!parsed.rows.length) {
      return NextResponse.json(
        { ok: false, message: "El CSV no contiene filas válidas para procesar." },
        { status: 400 }
      );
    }

    const existingRows = await fetchExistingStudents(parsed.rows.map((row) => row.rut_base));
    const existingMap = new Map(existingRows.map((row) => [row.rut_base, row]));

    const rowsToUpsert: CsvStudentRow[] = [];
    const insertedRutBases: string[] = [];
    let updatedRows = 0;
    let unchangedRows = 0;

    parsed.rows.forEach((row) => {
      const existing = existingMap.get(row.rut_base);

      if (!existing) {
        rowsToUpsert.push({ ...row, telefon: row.telefon ?? null });
        insertedRutBases.push(row.rut_base);
        return;
      }

      const normalizedRow = {
        ...row,
        telefon: parsed.hasTelefonColumn ? row.telefon : normalizePhone(existing.telefon),
      };

      if (hasStudentChanges(existing, normalizedRow)) {
        rowsToUpsert.push(normalizedRow);
        updatedRows += 1;
        return;
      }

      unchangedRows += 1;
    });

    if (rowsToUpsert.length) {
      for (const chunk of chunkArray(rowsToUpsert, 250)) {
        const { error } = await supabase.from("students").upsert(chunk, {
          onConflict: "rut_base",
        });

        if (error) {
          throw new Error(
            `No se pudo sincronizar la tabla students: ${error.message}`
          );
        }
      }
    }

    const countersCreated = await createMissingCountersForNewStudents(insertedRutBases);

    return NextResponse.json(
      {
        ok: true,
        file_name: file.name,
        processed_rows: parsed.rows.length,
        inserted_rows: insertedRutBases.length,
        updated_rows: updatedRows,
        unchanged_rows: unchangedRows,
        invalid_rows: parsed.invalidRows,
        counters_created: countersCreated,
        warnings: parsed.warnings,
        message: "Base de datos actualizada correctamente.",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido al actualizar la base de datos.";

    return NextResponse.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}
