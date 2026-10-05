export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
/** "mock" runs the demo backend in the browser (no API, no auth). Never the default. */
export const API_MODE: "http" | "mock" = process.env.NEXT_PUBLIC_API_MODE === "mock" ? "mock" : "http";
