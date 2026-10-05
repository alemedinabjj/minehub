"use client";

import { formatServerAddress, type ServerAddress } from "@hubmine/shared";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Address in mono + copy button. The text stays visible for manual copy if the clipboard is denied. */
export function CopyAddress({ address, size = "md" }: { address: ServerAddress; size?: "sm" | "md" }) {
  const text = formatServerAddress(address);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied */
    }
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className={`truncate font-mono text-foreground ${size === "md" ? "text-lg" : "text-sm"}`}>{text}</span>
      <button
        type="button"
        onClick={copy}
        className="grid size-11 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-raised hover:text-foreground"
        aria-label={copied ? "Endereço copiado" : `Copiar endereço ${text}`}
      >
        {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Endereço copiado" : ""}
      </span>
    </span>
  );
}
