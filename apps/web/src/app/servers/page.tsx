import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/features/auth/components/require-auth";
import { PanelHome } from "@/features/servers/components/panel/panel-home";
import { PanelLayout } from "@/features/servers/components/panel/panel-layout";

export const metadata: Metadata = { title: "Painel · HubMine" };

export default function ServersPage() {
  return (
    <Suspense>
      <RequireAuth>
        <PanelLayout selectedId={null}>
          <PanelHome />
        </PanelLayout>
      </RequireAuth>
    </Suspense>
  );
}
