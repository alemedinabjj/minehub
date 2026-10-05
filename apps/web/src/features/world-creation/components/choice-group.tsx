"use client";

import { Check } from "lucide-react";
import * as m from "motion/react-m";
import { createContext, useContext, useId } from "react";

/**
 * Accessible single-choice group built on native radio inputs:
 * arrow keys, Tab, labels and screen readers work without custom ARIA.
 * Selection is shown by border, check icon and text, never by motion or color alone.
 */
interface GroupContext {
  name: string;
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const Ctx = createContext<GroupContext | null>(null);

export function ChoiceGroup<T extends string>({
  label,
  value,
  onChange,
  children,
  className = "",
  describedBy,
}: {
  label: string;
  value: T | null;
  onChange: (value: T) => void;
  children: React.ReactNode;
  className?: string;
  describedBy?: string;
}) {
  const name = useId();
  return (
    <Ctx.Provider value={{ name, value, onChange: onChange as (v: string) => void }}>
      <fieldset className={className} aria-describedby={describedBy}>
        <legend className="sr-only">{label}</legend>
        {children}
      </fieldset>
    </Ctx.Provider>
  );
}

export function ChoiceCard({
  value,
  title,
  description,
  icon,
  badge,
  disabled = false,
  disabledReason,
  compact = false,
  children,
}: {
  value: string;
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: string;
  disabled?: boolean;
  disabledReason?: string;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ChoiceCard must be used inside ChoiceGroup");
  const selected = ctx.value === value;
  const id = useId();

  return (
    <m.label
      htmlFor={id}
      layout="position"
      whileTap={disabled ? undefined : { scale: 0.985 }}
      className={[
        "group relative flex cursor-pointer gap-3 rounded-md border bg-surface/80 text-left backdrop-blur-sm transition-colors duration-150",
        compact ? "items-center p-3" : "items-start p-4",
        selected ? "border-primary bg-primary/10 shadow-[inset_0_0_0_1px_var(--primary)]" : "border-border hover:border-muted",
        disabled ? "cursor-not-allowed opacity-50" : "",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
      ].join(" ")}
    >
      <input
        id={id}
        type="radio"
        name={ctx.name}
        value={value}
        checked={selected}
        disabled={disabled}
        onChange={() => ctx.onChange(value)}
        className="sr-only"
        aria-describedby={disabledReason ? `${id}-reason` : undefined}
      />
      {icon ? (
        <span
          aria-hidden
          className={`grid shrink-0 place-items-center rounded-sm border transition-colors ${compact ? "size-9" : "size-11"} ${
            selected ? "border-primary/60 bg-primary/20 text-primary" : "border-border bg-surface-raised text-muted group-hover:text-foreground"
          }`}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{title}</span>
          {badge ? (
            <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
              {badge}
            </span>
          ) : null}
        </span>
        {description ? <span className="mt-1 block text-sm text-muted">{description}</span> : null}
        {disabledReason ? (
          <span id={`${id}-reason`} className="mt-1 block text-xs text-warning">
            {disabledReason}
          </span>
        ) : null}
        {children}
      </span>
      <span
        aria-hidden
        className={`grid size-5 shrink-0 place-items-center rounded-full border transition-all duration-150 ${
          selected ? "scale-100 border-primary bg-primary text-primary-foreground" : "scale-90 border-border text-transparent"
        }`}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      {selected ? <span className="sr-only">(selecionado)</span> : null}
    </m.label>
  );
}
