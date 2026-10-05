import type { Metadata } from "next";
import { ServerReady } from "@/features/world-creation/components/server-ready";

export const metadata: Metadata = { title: "Seu mundo · HubMine" };

export default async function ServerPage({ params, searchParams }: PageProps<"/servers/[id]">) {
  const { id } = await params;
  const { created } = await searchParams;
  return <ServerReady serverId={id} justCreated={created === "1"} />;
}
