"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "../session-store";

/** On public pages: someone already signed in goes straight to their servers. */
export function SignedInRedirect({ to = "/servers" }: { to?: string }) {
  const status = useSession((s) => s.status);
  const router = useRouter();
  useEffect(() => {
    if (status === "authenticated") router.replace(to);
  }, [status, router, to]);
  return null;
}
