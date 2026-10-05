"use client";

import { useEffect } from "react";
import { API_MODE } from "@/lib/api/config";
import { authApi } from "../auth-api";
import { useSession } from "../session-store";

/** Restores the session once per page load. Demo mode signs in a local demo user. */
export function SessionBootstrap() {
  useEffect(() => {
    if (useSession.getState().status !== "unknown") return;
    if (API_MODE === "mock") {
      useSession.getState().setSession({ id: "00000000-0000-4000-8000-000000000000", email: "demo@hubmine.local", name: "Demo" }, "demo");
      return;
    }
    void authApi.restore();
  }, []);
  return null;
}
