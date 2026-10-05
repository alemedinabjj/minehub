"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

export function TextField({
  label,
  error,
  hint,
  type = "text",
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string }) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === "password";
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && reveal ? "text" : type}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint ${id}-error`}
          className="h-11 w-full rounded-sm border border-border bg-surface-raised px-3 text-foreground placeholder:text-muted focus:border-accent aria-[invalid=true]:border-danger"
          {...input}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={reveal}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-foreground"
          >
            {reveal ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      <p id={`${id}-error`} role={error ? "alert" : undefined} className="mt-1 min-h-4 text-xs text-danger">
        {error}
      </p>
    </div>
  );
}
