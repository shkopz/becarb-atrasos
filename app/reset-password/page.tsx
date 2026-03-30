import { Suspense } from "react";
import ResetPasswordClient from "./ResetPasswordClient";

function LoadingResetPassword() {
  return <div>Cargando recuperación de contraseña...</div>;
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<LoadingResetPassword />}>
      <ResetPasswordClient />
    </Suspense>
  );
}