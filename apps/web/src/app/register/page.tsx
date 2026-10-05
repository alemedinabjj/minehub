import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm, AuthSwitchLink } from "@/features/auth/components/auth-form";
import { AuthShell } from "@/features/auth/components/auth-shell";

export const metadata: Metadata = { title: "Criar conta · HubMine" };

export default function RegisterPage() {
  return (
    <Suspense>
      <AuthShell
        title="Crie sua conta"
        subtitle="Leva menos de um minuto. Depois é só criar seu mundo."
        footer={
          <>
            Já tem conta? <AuthSwitchLink to="login" />
          </>
        }
      >
        <AuthForm mode="register" />
      </AuthShell>
    </Suspense>
  );
}
