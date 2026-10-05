"use client";

import { WORLD_NAME, slugifyWorldName, validateWorldName } from "@hubmine/shared";
import { Sparkles } from "lucide-react";
import { useId, useRef, useState } from "react";
import { track } from "../../analytics/track";
import { STEP_ERROR_COPY } from "../../copy";
import { useWorldCreationStore } from "../../state/store";
import type { StepProps } from "./types";

const SUGGESTIONS = ["Vale Esmeralda", "Ilha do Norte", "Reino de Pedra", "Nova Aurora", "Terra dos Amigos", "Pico Celeste"];

export function NameStep({ onFeedback, showErrors }: StepProps & { showErrors: boolean }) {
  const name = useWorldCreationStore((s) => s.draft.name);
  const setName = useWorldCreationStore((s) => s.setName);
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const suggestionIndex = useRef(0);

  const error = validateWorldName(name);
  const visibleError = (touched || showErrors) && error ? STEP_ERROR_COPY[error] : null;
  const slug = slugifyWorldName(name);

  const suggest = () => {
    const next = SUGGESTIONS[suggestionIndex.current % SUGGESTIONS.length]!;
    suggestionIndex.current += 1;
    setName(next);
    onFeedback("Que tal esse?");
  };

  return (
    <div className="space-y-3">
      <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
        Nome do mundo
      </label>
      <input
        id={inputId}
        type="text"
        value={name}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        maxLength={WORLD_NAME.max + 8}
        placeholder="Digite o nome do seu mundo"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          setTouched(true);
          if (!error) track("world_name_entered", { length: name.trim().length });
        }}
        aria-invalid={Boolean(visibleError)}
        aria-describedby={`${inputId}-help ${inputId}-error`}
        className="h-14 w-full rounded-sm border border-border bg-surface-raised px-4 font-display text-2xl tracking-wide text-foreground placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-muted focus:border-accent aria-[invalid=true]:border-danger"
      />
      <div className="flex items-start justify-between gap-3 text-sm">
        <p id={`${inputId}-help`} className="text-muted">
          {slug && !error ? (
            <>
              Identificador: <span className="font-mono text-foreground">{slug}</span>
            </>
          ) : (
            `De ${WORLD_NAME.min} a ${WORLD_NAME.max} caracteres: letras, números, espaço, - e _.`
          )}
        </p>
        <span className={`shrink-0 tabular-nums ${name.trim().length > WORLD_NAME.max ? "text-danger" : "text-muted"}`} aria-hidden>
          {name.trim().length}/{WORLD_NAME.max}
        </span>
      </div>
      <p id={`${inputId}-error`} role={visibleError ? "alert" : undefined} className="min-h-5 text-sm text-danger">
        {visibleError}
      </p>
      <button type="button" onClick={suggest} className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-accent hover:underline">
        <Sparkles className="size-4" aria-hidden /> Sem ideias? Sugerir um nome
      </button>
    </div>
  );
}
