import { Suspense } from "react";
import PerfilPage from "@/components/profile/PerfilPage";

export default function Perfil() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          Cargando perfil...
        </div>
      }
    >
      <PerfilPage />
    </Suspense>
  );
}