import { HttpWorldCreationApi } from "./http";
import { MockWorldCreationApi } from "./mock";
import type { WorldCreationApi } from "./types";

let instance: WorldCreationApi | null = null;

/**
 * Selects the adapter from public env:
 *   NEXT_PUBLIC_API_MODE=mock   → in-memory demo backend (never the default)
 *   NEXT_PUBLIC_API_URL         → base URL of the NestJS API (default /api)
 */
export function getWorldCreationApi(): WorldCreationApi {
  if (instance) return instance;
  if (process.env.NEXT_PUBLIC_API_MODE === "mock") {
    const speed = Number(process.env.NEXT_PUBLIC_MOCK_SPEED ?? "1");
    instance = new MockWorldCreationApi(Number.isFinite(speed) && speed > 0 ? speed : 1);
  } else {
    instance = new HttpWorldCreationApi(process.env.NEXT_PUBLIC_API_URL ?? "/api");
  }
  return instance;
}

export { ApiRequestError } from "./types";
export type { WorldCreationApi } from "./types";
