import type { ServerStatus } from "@hubmine/shared";
import { AlertTriangle, Moon } from "lucide-react";
import { STATUS_META, type StatusTone } from "../status";

const TONE: Record<StatusTone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  neutral: "bg-surface-raised text-muted",
  info: "bg-info/15 text-info",
  danger: "bg-danger/15 text-danger",
};

/** The one status indicator: color + text + shape, never color alone. */
export function ServerStatusBadge({ status }: { status: ServerStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-sm px-2.5 py-1 text-sm font-medium ${TONE[meta.tone]}`}>
      <StatusGlyph status={status} />
      {meta.label}
    </span>
  );
}

function StatusGlyph({ status }: { status: ServerStatus }) {
  const meta = STATUS_META[status];
  if (meta.busy)
    return <span className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden />;
  if (status === "SUSPENDED") return <Moon className="size-3.5" aria-hidden />;
  if (meta.tone === "danger") return <AlertTriangle className="size-3.5" aria-hidden />;
  if (status === "STOPPED") return <span className="size-2 rounded-full border-2 border-current" aria-hidden />;
  return <span className="size-2 rounded-full bg-current" aria-hidden />;
}
