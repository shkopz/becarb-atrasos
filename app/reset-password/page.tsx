"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "error" | "success">("idle");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setMessage("");
    setStatus("idle");

    if (!token) {
      setStatus("error");
      setMessage("El enlace no contiene un token válido.");
      return;
    }

    if (!password || password.length < 4) {
      setStatus("error");
      setMessage("La nueva contraseña debe tener al menos 4 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("Las contraseñas no coinciden.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          confirmPassword,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        setStatus("error");
        setMessage(result.message || "No se pudo actualizar la contraseña.");
        return;
      }

      setStatus("success");
      setMessage(result.message || "Tu contraseña fue actualizada correctamente.");
      setPassword("");
      setConfirmPassword("");
    } catch {
      setStatus("error");
      setMessage("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "linear-gradient(180deg, #f8fbfd 0%, #eef6fb 100%)",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "480px",
          background: "#ffffff",
          borderRadius: "24px",
          padding: "32px",
          boxShadow: "0 18px 40px rgba(14, 34, 60, 0.12)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: "28px",
              color: "#1d74b7",
            }}
          >
            Recuperar contraseña
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "15px",
              color: "#5f6570",
              lineHeight: 1.5,
            }}
          >
            Define una nueva contraseña para ingresar al sistema de Control de Atrasos.
          </p>
        </div>

        {!token ? (
          <div
            style={{
              borderRadius: "16px",
              padding: "14px 16px",
              background: "rgba(214, 54, 73, 0.08)",
              color: "#d63649",
              fontSize: "14px",
              lineHeight: 1.5,
            }}
          >
            El enlace no es válido o está incompleto.
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <label style={labelStyle}>
              Nueva contraseña
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ingresa tu nueva contraseña"
                style={inputStyle}
                autoComplete="new-password"
              />
            </label>

            <label style={labelStyle}>
              Confirmar nueva contraseña
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite tu nueva contraseña"
                style={inputStyle}
                autoComplete="new-password"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              style={{
                border: "none",
                borderRadius: "16px",
                padding: "14px 18px",
                background: "#1d74b7",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 700,
                cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Guardando..." : "Actualizar contraseña"}
            </button>

            {message ? (
              <div
                style={{
                  borderRadius: "14px",
                  padding: "12px 14px",
                  fontSize: "14px",
                  lineHeight: 1.5,
                  background:
                    status === "success"
                      ? "rgba(11, 159, 107, 0.10)"
                      : "rgba(214, 54, 73, 0.08)",
                  color: status === "success" ? "#0b9f6b" : "#d63649",
                }}
              >
                {message}
              </div>
            ) : null}

            {status === "success" ? (
              <a
                href="/"
                style={{
                  textAlign: "center",
                  fontSize: "14px",
                  color: "#1d74b7",
                  textDecoration: "none",
                  marginTop: "4px",
                }}
              >
                Volver al login
              </a>
            ) : null}
          </form>
        )}
      </section>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  fontSize: "14px",
  color: "#1d2430",
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(29, 116, 183, 0.18)",
  borderRadius: "14px",
  padding: "14px 14px",
  fontSize: "15px",
  color: "#1d2430",
  outline: "none",
  boxSizing: "border-box",
};