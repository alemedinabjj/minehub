"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Destructive confirm: names the server, says what is lost, and requires typing the name.
 * Native <dialog> + showModal(): focus trap, Esc to close and inert background for free.
 */
export function DeleteServerDialog({
  open,
  serverName,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  serverName: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const titleId = useId();
  const hintId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setTyped("");
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  const matches = typed.trim() === serverName;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-md border border-border bg-surface-raised p-0 text-foreground shadow-overlay backdrop:bg-black/60"
    >
      <form
        method="dialog"
        className="space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && !pending) onConfirm();
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Excluir {serverName}?
        </h2>
        <p className="text-sm text-muted">
          O servidor será desligado e o mundo, com todas as construções e configurações, será apagado. Essa ação não pode ser desfeita.
        </p>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">
            Digite <span className="font-mono text-foreground">{serverName}</span> para confirmar
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-describedby={hintId}
            autoComplete="off"
            spellCheck={false}
            className="h-11 w-full rounded-sm border border-border bg-background px-3 font-mono text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span id={hintId} className="sr-only">
            O botão de excluir é liberado quando o nome digitado for igual ao do servidor.
          </span>
        </label>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="destructive" disabled={!matches} loading={pending}>
            Excluir para sempre
          </Button>
        </div>
      </form>
    </dialog>
  );
}
