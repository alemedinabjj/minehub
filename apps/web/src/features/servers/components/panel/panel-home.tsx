"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { serversApi } from "../../servers-api";

/** `/servers` with nothing selected: open the first server, or invite to create one. */
export function PanelHome() {
  const router = useRouter();
  const list = useQuery({ queryKey: ["servers"], queryFn: ({ signal }) => serversApi.list(signal), staleTime: 0 });
  const first = list.data?.data[0];

  useEffect(() => {
    if (first) router.replace(`/servers/${first.id}`);
  }, [first, router]);

  if (list.isError) {
    return (
      <div role="alert" className="space-y-3 p-6">
        <p className="text-foreground">Não conseguimos carregar seus servidores.</p>
        <Button variant="secondary" onClick={() => list.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  if (list.isPending || first) return <div className="h-full" aria-busy="true" />;

  return (
    <div className="grid h-full place-items-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="grid size-16 place-items-center rounded-sm bg-[var(--ground)] shadow-[inset_0_-14px_0_0_var(--dirt)]" aria-hidden />
        <h1 className="text-2xl font-semibold text-foreground">Você ainda não tem nenhum mundo.</h1>
        <p className="text-muted">Escolha o tipo de mundo e a versão. O HubMine prepara o servidor e você gerencia tudo por aqui.</p>
        <Link
          href="/servers/new"
          className="inline-flex h-12 items-center gap-2 rounded-sm bg-primary px-6 font-medium text-primary-foreground shadow-[0_2px_0_0_rgb(0_0_0/0.35)] hover:brightness-110"
        >
          <Plus className="size-4" aria-hidden /> Criar meu primeiro servidor
        </Link>
      </div>
    </div>
  );
}
