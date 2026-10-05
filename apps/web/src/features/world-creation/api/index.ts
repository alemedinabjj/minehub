import { API_MODE } from "@/lib/api/config";
import { HttpWorldCreationApi } from "./http";
import { MockWorldCreationApi } from "./mock";
import type { WorldCreationApi } from "./types";

let instance: WorldCreationApi | null = null;

/** NEXT_PUBLIC_API_MODE=mock → in-memory demo backend; otherwise the real API (NEXT_PUBLIC_API_URL). */
export function getWorldCreationApi(): WorldCreationApi {
  if (instance) return instance;
  if (API_MODE === "mock") {
    const speed = Number(process.env.NEXT_PUBLIC_MOCK_SPEED ?? "1");
    instance = new MockWorldCreationApi(Number.isFinite(speed) && speed > 0 ? speed : 1);
  } else {
    instance = new HttpWorldCreationApi();
  }
  return instance;
}

export { ApiRequestError } from "./types";
export type { WorldCreationApi } from "./types";
