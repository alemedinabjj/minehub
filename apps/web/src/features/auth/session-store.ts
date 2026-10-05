"use client";

import type { AuthUser } from "@hubmine/shared";
import { create } from "zustand";

/**
 * In-memory session. The access token is never written to storage (XSS-resistant);
 * after a reload the session is restored through the httpOnly refresh cookie.
 */
interface SessionState {
  status: "unknown" | "authenticated" | "anonymous";
  user: AuthUser | null;
  accessToken: string | null;
  setSession: (user: AuthUser, accessToken: string) => void;
  clear: () => void;
}

export const useSession = create<SessionState>()((set) => ({
  status: "unknown",
  user: null,
  accessToken: null,
  setSession: (user, accessToken) => set({ status: "authenticated", user, accessToken }),
  clear: () => set({ status: "anonymous", user: null, accessToken: null }),
}));
