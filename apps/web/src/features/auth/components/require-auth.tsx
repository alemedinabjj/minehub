"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "../session-store";

/**
 * Client-side gate for signed-in pages. Purely UX: the API enforces authorization on every
 * request regardless of what the client renders.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (status === "anonymous") {
      const next = `${pathname}${search.size ? `?${search}` : ""}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [status, pathname, search, router]);

  if (status !== "authenticated") {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <span className="size-5 animate-spin rounded-[3px] border-2 border-accent border-r-transparent motion-reduce:animate-none" aria-hidden />
        <span className="sr-only">Carregando sua sessão…</span>
      </div>
    );
  }
  return <>{children}</>;
}
