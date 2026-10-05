/** Only same-origin relative paths are allowed as post-login redirects (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/servers"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  try {
    const url = new URL(next, "http://hubmine.local");
    return url.origin === "http://hubmine.local" ? `${url.pathname}${url.search}` : fallback;
  } catch {
    return fallback;
  }
}
