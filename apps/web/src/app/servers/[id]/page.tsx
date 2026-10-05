import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/features/auth/components/require-auth";
import { PanelLayout } from "@/features/servers/components/panel/panel-layout";
import { ServerWorkspace } from "@/features/servers/components/panel/server-workspace";
import { ServerReady } from "@/features/world-creation/components/server-ready";
import { API_MODE } from "@/lib/api/config";

export const metadata: Metadata = { title: "Painel do servidor · HubMine" };

export default async function ServerPage({ params, searchParams }: PageProps<"/servers/[id]">) {
  const { id } = await params;
  const { created } = await searchParams;
  return (
    <Suspense>
      <RequireAuth>
        {/* Demo mode (NEXT_PUBLIC_API_MODE=mock) only simulates creation; the panel needs the real API. */}
        {API_MODE === "mock" ? (
          <ServerReady serverId={id} justCreated={created === "1"} />
        ) : (
          <PanelLayout selectedId={id}>
            <ServerWorkspace key={id} serverId={id} justCreated={created === "1"} />
          </PanelLayout>
        )}
      </RequireAuth>
    </Suspense>
  );
}
