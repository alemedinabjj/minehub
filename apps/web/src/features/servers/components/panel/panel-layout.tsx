"use client";

import { useQuery } from "@tanstack/react-query";
import { LogOut, Menu, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authApi } from "@/features/auth/auth-api";
import { useSession } from "@/features/auth/session-store";
import { serversApi } from "../../servers-api";
import { isTransitional, SOFTWARE_LABEL, STATUS_META, type StatusTone } from "../../status";

const DOT: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  neutral: "border-2 border-muted",
  info: "bg-info",
  danger: "bg-danger",
};

/** Full-screen panel: server list on the left (drawer on mobile), the selected server fills the rest. */
export function PanelLayout({ selectedId, children }: { selectedId: string | null; children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = drawer.current;
    if (!d) return;
    if (drawerOpen && !d.open) d.showModal();
    else if (!drawerOpen && d.open) d.close();
  }, [drawerOpen]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <Sidebar selectedId={selectedId} />
      </aside>

      <dialog
        ref={drawer}
        onClose={() => setDrawerOpen(false)}
        aria-label="Servidores"
        className="m-0 h-dvh max-h-none w-80 max-w-[85vw] border-r border-border bg-surface p-0 text-foreground backdrop:bg-black/60"
      >
        <div className="flex h-full flex-col">
          <div className="flex justify-end p-2">
            <button type="button" onClick={() => setDrawerOpen(false)} className="grid size-11 place-items-center rounded-sm text-muted hover:bg-surface-raised" aria-label="Fechar menu">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <Sidebar selectedId={selectedId} onNavigate={() => setDrawerOpen(false)} />
        </div>
      </dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3 lg:hidden">
          <button type="button" onClick={() => setDrawerOpen(true)} className="grid size-11 place-items-center rounded-sm text-muted hover:bg-surface-raised" aria-label="Abrir lista de servidores">
            <Menu className="size-5" aria-hidden />
          </button>
          <Link href="/servers" className="font-display text-xl text-foreground">
            Hub<span className="text-primary">Mine</span>
          </Link>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function Sidebar({ selectedId, onNavigate }: { selectedId: string | null; onNavigate?: () => void }) {
  const user = useSession((s) => s.user);
  const router = useRouter();
  const list = useQuery({
    queryKey: ["servers"],
    queryFn: ({ signal }) => serversApi.list(signal),
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.data.some((s) => isTransitional(s.status)) ? 2_500 : 10_000),
  });

  const logout = async () => {
    await authApi.logout();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hidden h-14 shrink-0 items-center border-b border-border px-5 lg:flex">
        <Link href="/servers" className="font-display text-2xl text-foreground" aria-label="HubMine — meus servidores">
          Hub<span className="text-primary">Mine</span>
        </Link>
      </div>
      <div className="p-3">
        <Link
          href="/servers/new"
          onClick={onNavigate}
          className="flex h-10 items-center justify-center gap-2 rounded-sm bg-primary text-sm font-medium text-primary-foreground shadow-[0_2px_0_0_rgb(0_0_0/0.35)] hover:brightness-110"
        >
          <Plus className="size-4" aria-hidden /> Novo servidor
        </Link>
      </div>
      <nav aria-label="Seus servidores" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Servidores</p>
        {list.isPending ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-sm bg-surface-raised motion-reduce:animate-none" />
            ))}
          </div>
        ) : list.isError ? (
          <p className="px-2 text-sm text-danger">Não foi possível carregar.</p>
        ) : list.data.data.length === 0 ? (
          <p className="px-2 text-sm text-muted">Nenhum servidor ainda.</p>
        ) : (
          <ul className="space-y-1">
            {list.data.data.map((s) => {
              const meta = STATUS_META[s.status];
              const active = s.id === selectedId;
              return (
                <li key={s.id}>
                  <Link
                    href={`/servers/${s.id}`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-sm border-l-2 px-3 py-2.5 ${active ? "border-primary bg-surface-raised" : "border-transparent hover:bg-surface-raised"}`}
                  >
                    <span className={`size-2.5 shrink-0 rounded-full ${DOT[meta.tone]} ${meta.busy ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{s.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {meta.label} · {SOFTWARE_LABEL[s.software] ?? s.software} {s.minecraftVersion}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      <div className="flex shrink-0 items-center gap-2 border-t border-border p-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-raised text-sm font-semibold text-foreground" aria-hidden>
          {user?.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{user?.name}</span>
        <button type="button" onClick={logout} className="grid size-11 place-items-center rounded-sm text-muted hover:bg-surface-raised hover:text-foreground" aria-label="Sair da conta">
          <LogOut className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
