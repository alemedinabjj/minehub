import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm, AuthSwitchLink } from "@/features/auth/components/auth-form";
import { AuthShell } from "@/features/auth/components/auth-shell";

export const metadata: Metadata = { title: "Entrar · HubMine" };

export default function LoginPage() {
  return (
    <Suspense>
      <AuthShell
        title="Bem-vindo de volta"
        subtitle="Entre para gerenciar seus mundos."
        footer={
          <>
            Ainda não tem conta? <AuthSwitchLink to="register" />
          </>
        }
      >
        <AuthForm mode="login" />
      </AuthShell>
    </Suspense>
  );
}
