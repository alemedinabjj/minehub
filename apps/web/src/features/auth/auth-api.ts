"use client";

import { authSessionSchema, type LoginRequest, type RegisterRequest } from "@hubmine/shared";
import { z } from "zod";
import { apiRequest, refreshSession } from "@/lib/api/http";
import { API_URL } from "@/lib/api/config";
import { useSession } from "./session-store";

async function establish(path: "/auth/login" | "/auth/register", body: LoginRequest | RegisterRequest) {
  const res = await apiRequest(path, authSessionSchema, { method: "POST", body, noAuthRetry: true });
  useSession.getState().setSession(res.data.user, res.data.accessToken);
  return res.data.user;
}

export const authApi = {
  login: (body: LoginRequest) => establish("/auth/login", body),
  register: (body: RegisterRequest) => establish("/auth/register", body),
  /** Restore a session after reload using the httpOnly refresh cookie. */
  restore: () => refreshSession(),
  async logout() {
    try {
      await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      useSession.getState().clear();
    }
  },
  me: () => apiRequest("/auth/me", z.object({ data: z.object({ id: z.string(), email: z.string(), name: z.string() }) })),
};
