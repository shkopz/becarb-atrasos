"use client";

import type { CSSProperties, FormEvent } from "react";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function ResetPasswordClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"error" | "success" | "">("");

  const canSubmit = useMemo(() => {
    return Boolean(token && password && confirmPassword && !submitting);
  }, [token, password, confirmPassword, submitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setTone("");

    if (!token) {
      setTone("error");
      setMessage("El enlace de recuperación no es válido o no incluye token.");
      return;
    }

    if (password.length < 6) {
      setTone("error");
      setMessage("La nueva contraseña debe tener al menos 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setTone("error");
      setMessage("Las contraseñas no coinciden.");
      return;
    }

    try {
      setSubmitting(true);
      const response = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || "No se pudo actualizar la contraseña.");
      }

      setTone("success");
      setMessage("Contraseña actualizada correctamente. Volverás al inicio de sesión.");
      window.setTimeout(() => {
        window.location.href = "/demo-ui/interface-base.html";
      }, 900);
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar la contraseña.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={styles.main}>
      <section style={styles.card}>
        <div style={styles.brandRow}>
          <img
            src="https://becarb.cl/wp-content/uploads/2019/10/logoweb_becarb_trans.png"
            alt="Logo Becarb"
            style={styles.logo}
          />
        </div>

        <span style={styles.kicker}>Recuperación de acceso</span>
        <h1 style={styles.title}>Definir nueva contraseña</h1>
        <p style={styles.lead}>
          Ingresa la nueva clave dos veces para confirmar el cambio. Cuando se guarde correctamente,
          volverás al inicio de sesión del sistema.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.fieldWrap}>
            <label htmlFor="password" style={styles.label}>
              Nueva contraseña
            </label>
            <div style={styles.passwordWrap}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Escribe tu nueva contraseña"
                style={styles.input}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                style={
                  showPassword
                    ? { ...styles.toggleButton, ...styles.toggleButtonActive }
                    : styles.toggleButton
                }
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? "Ocultar" : "Ver"}
              </button>
            </div>
          </div>

          <div style={styles.fieldWrap}>
            <label htmlFor="confirmPassword" style={styles.label}>
              Confirmar contraseña
            </label>
            <div style={styles.passwordWrap}>
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repite la nueva contraseña"
                style={styles.input}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                style={
                  showConfirmPassword
                    ? { ...styles.toggleButton, ...styles.toggleButtonActive }
                    : styles.toggleButton
                }
                aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showConfirmPassword ? "Ocultar" : "Ver"}
              </button>
            </div>
          </div>

          {message ? (
            <div
              style={
                tone === "error"
                  ? { ...styles.message, ...styles.errorMessage }
                  : { ...styles.message, ...styles.successMessage }
              }
            >
              {message}
            </div>
          ) : null}

          <div style={styles.actions}>
            <button
              type="submit"
              disabled={!canSubmit}
              style={
                !canSubmit
                  ? { ...styles.primaryButton, ...styles.disabledButton }
                  : styles.primaryButton
              }
            >
              {submitting ? "Guardando..." : "Guardar nueva contraseña"}
            </button>
            <button
              type="button"
              onClick={() => (window.location.href = "/demo-ui/interface-base.html")}
              style={styles.secondaryButton}
            >
              Volver al login
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background: "linear-gradient(180deg, #f8fbfd 0%, #eef6fb 100%)",
    fontFamily: "Inter, Arial, sans-serif",
  },
  card: {
    width: "min(520px, 100%)",
    background: "rgba(255,255,255,0.96)",
    border: "1px solid rgba(29,116,183,0.12)",
    borderRadius: "28px",
    boxShadow: "0 18px 40px rgba(14, 34, 60, 0.12)",
    padding: "30px 28px",
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    marginBottom: "10px",
  },
  logo: {
    width: "200px",
    height: "auto",
    display: "block",
  },
  kicker: {
    display: "inline-flex",
    padding: "8px 12px",
    borderRadius: "999px",
    background: "rgba(29,116,183,0.08)",
    color: "#1d74b7",
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginBottom: "14px",
  },
  title: {
    margin: 0,
    fontSize: "34px",
    lineHeight: 1.04,
    color: "#1d2430",
  },
  lead: {
    margin: "12px 0 0",
    color: "#667085",
    fontSize: "15px",
    lineHeight: 1.6,
  },
  form: {
    display: "grid",
    gap: "16px",
    marginTop: "24px",
  },
  fieldWrap: {
    display: "grid",
    gap: "8px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 800,
    color: "#5f6570",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  passwordWrap: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  input: {
    width: "100%",
    minHeight: "56px",
    border: "1px solid rgba(29,116,183,0.16)",
    borderRadius: "18px",
    padding: "0 92px 0 18px",
    fontSize: "17px",
    fontWeight: 700,
    color: "#1d2430",
    background: "rgba(255,255,255,0.96)",
    outline: "none",
    boxSizing: "border-box",
  },
  toggleButton: {
    position: "absolute",
    right: "10px",
    top: "50%",
    transform: "translateY(-50%)",
    minWidth: "74px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(29,116,183,0.14)",
    borderRadius: "999px",
    padding: "8px 12px",
    background: "linear-gradient(180deg, #ffffff, #f1f7fc)",
    color: "#1d74b7",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  toggleButtonActive: {
    background: "linear-gradient(135deg, rgba(29,116,183,0.10), rgba(73,182,222,0.18))",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(29,116,183,0.20)",
  },
  message: {
    borderRadius: "16px",
    padding: "14px 16px",
    fontSize: "14px",
    lineHeight: 1.5,
    fontWeight: 700,
  },
  errorMessage: {
    background: "rgba(214,54,73,0.08)",
    color: "#d63649",
  },
  successMessage: {
    background: "rgba(11,159,107,0.08)",
    color: "#0b9f6b",
  },
  actions: {
    display: "grid",
    gap: "10px",
    marginTop: "4px",
  },
  primaryButton: {
    minHeight: "56px",
    border: 0,
    borderRadius: "18px",
    background: "linear-gradient(90deg, #1d74b7, #49b6de)",
    color: "#fff",
    fontSize: "17px",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 12px 24px rgba(29,116,183,0.22)",
  },
  secondaryButton: {
    minHeight: "52px",
    borderRadius: "16px",
    border: "1px solid rgba(29,116,183,0.14)",
    background: "#fff",
    color: "#1d74b7",
    fontSize: "15px",
    fontWeight: 800,
    cursor: "pointer",
  },
  disabledButton: {
    opacity: 0.55,
    cursor: "not-allowed",
    boxShadow: "none",
  },
};
