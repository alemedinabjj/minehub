"use client";

import { DIFFICULTIES, GAMEMODES, RESOURCE_LIMITS, WORLD_PRESETS, type WorldSettings } from "@hubmine/shared";
import { ChevronDown, Cpu, Globe, MemoryStick, Package, Settings2, Signpost, Trees, Users } from "lucide-react";
import { useId, useState } from "react";
import { EXPERIENCE_COPY, PLAYER_COPY, SOFTWARE_COPY, STEP_ERROR_COPY, WORLD_TYPE_COPY } from "../../copy";
import { recommendationFor } from "../../flow/request";
import type { StepId } from "../../flow/types";
import { useWorldCreationStore } from "../../state/store";
import { formatCpu, formatGb } from "./players-step";

const GAMEMODE_LABEL: Record<(typeof GAMEMODES)[number], string> = { survival: "Sobrevivência", creative: "Criativo", adventure: "Aventura" };
const DIFFICULTY_LABEL: Record<(typeof DIFFICULTIES)[number], string> = { peaceful: "Pacífico", easy: "Fácil", normal: "Normal", hard: "Difícil" };

export function SummaryStep({ onEdit, showErrors }: { onEdit: (step: StepId) => void; showErrors: boolean }) {
  const draft = useWorldCreationStore((s) => s.draft);
  const updateSettings = useWorldCreationStore((s) => s.updateSettings);
  const setHeapOverride = useWorldCreationStore((s) => s.setHeapOverride);
  const setEulaAccepted = useWorldCreationStore((s) => s.setEulaAccepted);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const ids = useId();

  const recommendation = recommendationFor(draft);
  const settings: WorldSettings = draft.settings ?? WORLD_PRESETS[draft.worldType ?? "SURVIVAL"].settings;
  const heap = draft.heapMbOverride ?? recommendation?.heapMb ?? RESOURCE_LIMITS.heapMb.min;

  const rows: Array<{ icon: React.ReactNode; label: string; value: string; step: StepId }> = [
    { icon: <Trees className="size-4" />, label: "Tipo", value: draft.worldType ? WORLD_TYPE_COPY[draft.worldType].title : "—", step: "world-type" },
    { icon: <Globe className="size-4" />, label: "Minecraft", value: draft.minecraftVersion ?? "—", step: "version" },
    {
      icon: <Settings2 className="size-4" />,
      label: "Servidor",
      value: draft.software ? `${SOFTWARE_COPY[draft.software].title}${draft.experience ? ` · ${EXPERIENCE_COPY[draft.experience].title}` : ""}` : "—",
      step: "experience",
    },
    ...(draft.modpack ? [{ icon: <Package className="size-4" />, label: "Modpack", value: draft.modpack.name, step: "modpack" as StepId }] : []),
    { icon: <Users className="size-4" />, label: "Jogadores", value: draft.players ? PLAYER_COPY[draft.players].title : "—", step: "players" },
  ];

  return (
    <div className="space-y-5">
      <section aria-label="Ficha do mundo" className="overflow-hidden rounded-md border border-border bg-surface/80">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-raised px-4 py-3">
          <p className="flex min-w-0 items-center gap-2">
            <Signpost className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate font-display text-xl text-foreground">{draft.name.trim().toUpperCase()}</span>
          </p>
          <button type="button" onClick={() => onEdit("name")} className="text-sm text-accent hover:underline">
            Editar <span className="sr-only">nome</span>
          </button>
        </div>
        <dl className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <dt className="flex w-28 shrink-0 items-center gap-2 text-muted">
                <span aria-hidden>{row.icon}</span>
                {row.label}
              </dt>
              <dd className="min-w-0 flex-1 truncate text-foreground">{row.value}</dd>
              <button type="button" onClick={() => onEdit(row.step)} className="shrink-0 text-accent hover:underline">
                Editar <span className="sr-only">{row.label.toLowerCase()}</span>
              </button>
            </div>
          ))}
          {recommendation ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5 text-sm">
              <dt className="sr-only">Recursos</dt>
              <dd className="inline-flex items-center gap-2 text-foreground">
                <MemoryStick className="size-4 text-accent" aria-hidden /> {formatGb(heap)} de RAM
                {draft.heapMbOverride ? <span className="text-xs text-muted">(ajustado)</span> : <span className="text-xs text-muted">(recomendado)</span>}
              </dd>
              <dd className="inline-flex items-center gap-2 text-foreground">
                <Cpu className="size-4 text-accent" aria-hidden /> {formatCpu(recommendation.cpuMillis)}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby={`${ids}-rules`} className="space-y-3">
        <h3 id={`${ids}-rules`} className="text-sm font-semibold text-foreground">
          Regras do mundo <span className="font-normal text-muted">— já ajustadas para {draft.worldType ? WORLD_TYPE_COPY[draft.worldType].title : "seu mundo"}</span>
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Modo de jogo"
            value={settings.gamemode}
            options={GAMEMODES.map((g) => [g, GAMEMODE_LABEL[g]])}
            onChange={(gamemode) => updateSettings({ gamemode })}
          />
          <SelectField
            label="Dificuldade"
            value={settings.difficulty}
            options={DIFFICULTIES.map((d) => [d, DIFFICULTY_LABEL[d]])}
            onChange={(difficulty) => updateSettings({ difficulty })}
            disabled={settings.hardcore}
            hint={settings.hardcore ? "Hardcore usa sempre o modo difícil." : undefined}
          />
          <SwitchField label="PvP" description="Jogadores podem atacar uns aos outros" checked={settings.pvp} onChange={(pvp) => updateSettings({ pvp })} />
          <SwitchField
            label="Whitelist"
            description="Só quem você autorizar entra"
            checked={settings.whitelist}
            onChange={(whitelist) => updateSettings({ whitelist })}
          />
          <SwitchField
            label="Aceitar contas não originais"
            description="Libera quem joga pelo TLauncher ou outro launcher sem conta Microsoft"
            checked={!settings.onlineMode}
            onChange={(allow) => updateSettings({ onlineMode: !allow })}
          />
        </div>
        {!settings.onlineMode ? (
          <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
            Sem a verificação da Microsoft, qualquer pessoa pode entrar usando qualquer nome, inclusive o seu. Só compartilhe o endereço com quem
            você conhece e não dê poderes de operador por nome. A whitelist ajuda, mas não impede alguém de usar o nome de um jogador autorizado.
          </p>
        ) : null}
      </section>

      <section>
        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-controls={`${ids}-advanced`}
          onClick={() => setAdvancedOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted hover:text-foreground"
        >
          <ChevronDown className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} aria-hidden />
          Configurações avançadas
        </button>
        {advancedOpen ? (
          <div id={`${ids}-advanced`} className="mt-3 grid gap-3 rounded-md border border-border bg-surface/60 p-4 sm:grid-cols-2">
            <TextField label="Seed" value={settings.seed ?? ""} placeholder="Aleatória" onChange={(seed) => updateSettings({ seed: seed || undefined })} />
            <NumberField label="Máx. de jogadores" value={settings.maxPlayers} min={1} max={500} onChange={(maxPlayers) => updateSettings({ maxPlayers })} />
            <NumberField label="Distância de visão" value={settings.viewDistance} min={3} max={32} onChange={(viewDistance) => updateSettings({ viewDistance })} />
            <NumberField
              label="Distância de simulação"
              value={settings.simulationDistance}
              min={3}
              max={32}
              onChange={(simulationDistance) => updateSettings({ simulationDistance })}
            />
            <SwitchField label="Hardcore" description="Morreu, acabou" checked={settings.hardcore} onChange={(hardcore) => updateSettings({ hardcore, ...(hardcore ? { difficulty: "hard" } : {}) })} />
            <NumberField
              label="Memória (MB)"
              value={heap}
              min={RESOURCE_LIMITS.heapMb.min}
              max={RESOURCE_LIMITS.heapMb.max}
              step={RESOURCE_LIMITS.heapMb.step}
              hint="O limite final depende do seu plano."
              onChange={(value) => setHeapOverride(value === recommendation?.heapMb ? null : value)}
            />
          </div>
        ) : null}
      </section>

      <div className="rounded-md border border-border bg-surface/60 p-3">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={draft.eulaAccepted}
            onChange={(e) => setEulaAccepted(e.target.checked)}
            aria-invalid={showErrors && !draft.eulaAccepted}
            aria-describedby={`${ids}-eula-error`}
            className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
          />
          <span className="text-muted">
            Li e aceito o{" "}
            <a href="https://www.minecraft.net/eula" target="_blank" rel="noopener noreferrer" className="text-accent underline">
              EULA do Minecraft
            </a>
            . O HubMine não é afiliado à Mojang ou à Microsoft.
          </span>
        </label>
        <p id={`${ids}-eula-error`} role={showErrors && !draft.eulaAccepted ? "alert" : undefined} className="mt-1 min-h-5 text-sm text-danger">
          {showErrors && !draft.eulaAccepted ? STEP_ERROR_COPY.EULA_REQUIRED : null}
        </p>
      </div>
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-foreground">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-10 w-full rounded-sm border border-border bg-surface-raised px-3 disabled:opacity-60"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function SwitchField({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-sm border border-border bg-surface-raised px-3 py-2 text-sm">
      <span>
        <span className="block font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted">{description}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-[var(--primary)]" />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-foreground">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="h-10 w-full rounded-sm border border-border bg-surface-raised px-3 tabular-nums"
      />
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-foreground">{label}</span>
      <input
        type="text"
        value={value}
        maxLength={32}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^-0-9A-Za-z_]/g, ""))}
        className="h-10 w-full rounded-sm border border-border bg-surface-raised px-3 font-mono"
      />
    </label>
  );
}
