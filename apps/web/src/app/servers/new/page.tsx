import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/features/auth/components/require-auth";
import { WorldCreationWizard } from "@/features/world-creation/components/world-creation-wizard";

export const metadata: Metadata = { title: "Criar mundo · HubMine" };

export default function NewServerPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}>
      <RequireAuth>
        <WorldCreationWizard />
      </RequireAuth>
    </Suspense>
  );
}
