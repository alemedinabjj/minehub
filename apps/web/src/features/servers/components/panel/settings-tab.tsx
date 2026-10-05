"use client";

import { DIFFICULTIES, GAMEMODES, RESOURCE_LIMITS, validateWorldName, type ServerDetails, type UpdateServerRequest, type WorldSettings } from "@hubmine/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api/http";
import { serversApi } from "../../servers-api";
import { canRun, unavailableReason } from "../../status";
import { DeleteServerDialog } from "../delete-server-dialog";
import { useServerAction } from "./server-workspace";

const GAMEMODE_LABEL: Record<(typeof GAMEMODES)[number], string> = { survival: "Sobrevivência", creative: "Criativo", adventure: "Aventura" };
const DIFFICULTY_LABEL: Record<(typeof DIFFICULTIES)[number], string> = { peaceful: "Pacífico", easy: "Fácil", normal: "Normal", hard: "Difícil" };
const NAME_ERROR: Record<string, string> = {
  NAME_TOO_SHORT: "Use pelo menos 3 caracteres.",
  NAME_TOO_LONG: "Use no máximo 32 caracteres.",
  NAME_INVALID_CHARS: "Use letras, números, espaço, - e _.",
};
const HEAP_OPTIONS = Array.from({ length: (16384 - RESOURCE_LIMITS.heapMb.min) / RESOURCE_LIMITS.heapMb.step + 1 }, (_, i) => RESOURCE_LIMITS.heapMb.min + i * RESOURCE_LIMITS.heapMb.step);

/** Every editable setting. Saved now, applied by the worker on the next (re)start. */
export function SettingsTab({ server }: { server: ServerDetails }) {
  const queryClient = useQueryClient();
  const ids = useId();
  const [name, setName] = useState(server.name);
  const [heapMb, setHeapMb] = useState(server.heapMb);
  const [settings, setSettings] = useState<WorldSettings>(server.settings);
  const [saved, setSaved] = useState(false);

  const patch = useMemo<UpdateServerRequest>(() => {
    const changed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => server.settings[k as keyof WorldSettings] !== v)) as Partial<WorldSettings>;
    return {
      ...(name.trim() !== server.name ? { name: name.trim() } : {}),
      ...(heapMb !== server.heapMb ? { heapMb } : {}),
      ...(Object.keys(changed).length ? { settings: changed } : {}),
    };
  }, [name, heapMb, settings, server]);
  const dirty = Object.keys(patch).length > 0;
  const nameError = validateWorldName(name);

  const save = useMutation({
    mutationFn: () => serversApi.update(server.id, patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["server", server.id, "details"], next);
      void queryClient.invalidateQueries({ queryKey: ["servers"] });
      setSaved(true);
    },
  });
  const set = <K extends keyof WorldSettings>(key: K, value: WorldSettings[K]) => {
    setSaved(false);
    setSettings((s) => ({ ...s, [key]: value }));
  };
  const reset = () => {
    setName(server.name);
    setHeapMb(server.heapMb);
    setSettings(server.settings);
    setSaved(false);
    save.reset();
  };
  const saveError = save.error instanceof ApiRequestError ? save.error.message : save.error ? "Não foi possível salvar." : null;
  const locked = server.status === "DELETING";

  return (
    <div className="space-y-6 p-4 pb-28 sm:p-6 sm:pb-28">
      <form
        id={`${ids}-form`}
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !nameError) save.mutate();
        }}
        className="grid gap-6 xl:grid-cols-2"
      >
        <Card title="Identidade">
          <Field label="Nome do servidor" hint={nameError ? NAME_ERROR[nameError] : "Também aparece na lista de servidores do Minecraft (MOTD)."} error={Boolean(nameError)}>
            {(p) => <input {...p} value={name} maxLength={32} onChange={(e) => (setSaved(false), setName(e.target.value))} className={inputCls} />}
          </Field>
          <Field label="Seed do mundo" hint="Só vale para mundos novos; mudar aqui não altera o mundo existente.">
            {(p) => <input {...p} value={settings.seed ?? "Aleatória"} readOnly className={`${inputCls} text-muted`} />}
          </Field>
        </Card>

        <Card title="Regras do jogo">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Modo de jogo">
              {(p) => (
                <select {...p} value={settings.gamemode} onChange={(e) => set("gamemode", e.target.value as WorldSettings["gamemode"])} className={inputCls}>
                  {GAMEMODES.map((g) => (
                    <option key={g} value={g}>
                      {GAMEMODE_LABEL[g]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Dificuldade" hint={settings.hardcore ? "Hardcore usa sempre o modo difícil." : undefined}>
              {(p) => (
                <select {...p} value={settings.difficulty} disabled={settings.hardcore} onChange={(e) => set("difficulty", e.target.value as WorldSettings["difficulty"])} className={inputCls}>
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {DIFFICULTY_LABEL[d]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Toggle label="PvP" description="Jogadores podem atacar uns aos outros" checked={settings.pvp} onChange={(v) => set("pvp", v)} />
          <Toggle label="Hardcore" description="Morreu, acabou" checked={settings.hardcore} onChange={(v) => (set("hardcore", v), v && set("difficulty", "hard"))} />
        </Card>

        <Card title="Acesso">
          <Toggle label="Whitelist" description="Só quem você autorizar entra (gerencie na aba Jogadores)" checked={settings.whitelist} onChange={(v) => set("whitelist", v)} />
          <Toggle
            label="Aceitar contas não originais"
            description="Libera quem joga pelo TLauncher ou outro launcher sem conta Microsoft"
            checked={!settings.onlineMode}
            onChange={(allow) => set("onlineMode", !allow)}
          />
          {!settings.onlineMode ? (
            <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
              Sem a verificação da Microsoft, qualquer pessoa pode entrar usando qualquer nome, inclusive o seu. Só compartilhe o endereço com quem você conhece e não dê
              operador por nome.
            </p>
          ) : null}
          <Field label="Máximo de jogadores">
            {(p) => <input {...p} type="number" min={1} max={500} value={settings.maxPlayers} onChange={(e) => set("maxPlayers", clampInt(e.target.value, 1, 500))} className={inputCls} />}
          </Field>
        </Card>

        <Card title="Desempenho">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Distância de visão" hint="3 a 32 chunks">
              {(p) => <input {...p} type="number" min={3} max={32} value={settings.viewDistance} onChange={(e) => set("viewDistance", clampInt(e.target.value, 3, 32))} className={inputCls} />}
            </Field>
            <Field label="Distância de simulação" hint="3 a 32 chunks">
              {(p) => <input {...p} type="number" min={3} max={32} value={settings.simulationDistance} onChange={(e) => set("simulationDistance", clampInt(e.target.value, 3, 32))} className={inputCls} />}
            </Field>
          </div>
          <Field label="Memória (RAM)" hint="Mais memória ajuda com mods e muitos jogadores. Vale após reiniciar.">
            {(p) => (
              <select {...p} value={heapMb} onChange={(e) => (setSaved(false), setHeapMb(Number(e.target.value)))} className={inputCls}>
                {HEAP_OPTIONS.map((mb) => (
                  <option key={mb} value={mb}>
                    {(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB
                  </option>
                ))}
              </select>
            )}
          </Field>
        </Card>
      </form>

      <DangerZone server={server} />

      <div className="fixed inset-x-0 bottom-0 z-[var(--z-panel)] border-t border-border bg-surface/95 backdrop-blur lg:left-72">
        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-6">
          <p role="status" className="mr-auto text-sm text-muted">
            {saveError ? <span className="text-danger">{saveError}</span> : saved ? "Salvo. Reinicie o servidor para aplicar." : dirty ? "Alterações não salvas." : "Tudo salvo."}
          </p>
          <Button type="button" variant="ghost" onClick={reset} disabled={!dirty || save.isPending}>
            Descartar
          </Button>
          <Button type="submit" form={`${ids}-form`} disabled={!dirty || Boolean(nameError) || locked} loading={save.isPending}>
            Salvar alterações
          </Button>
        </div>
      </div>
    </div>
  );
}

function DangerZone({ server }: { server: ServerDetails }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const action = useServerAction(server.id);
  const allowed = canRun("delete", server.status);
  return (
    <section aria-labelledby="danger-title" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 p-4">
      <div>
        <h2 id="danger-title" className="font-semibold text-foreground">
          Zona de perigo
        </h2>
        <p className="text-sm text-muted">Excluir desliga o servidor e apaga o mundo para sempre.</p>
        {action.error instanceof ApiRequestError ? <p className="text-sm text-danger">{action.error.message}</p> : null}
      </div>
      <Button variant="secondary" className="text-danger" onClick={() => setOpen(true)} disabled={!allowed} title={allowed ? undefined : unavailableReason("delete", server.status)}>
        <Trash2 className="size-4" aria-hidden /> Excluir servidor
      </Button>
      <DeleteServerDialog
        open={open}
        serverName={server.name}
        pending={action.isPending}
        onClose={() => setOpen(false)}
        onConfirm={() =>
          action.mutate("delete", {
            onSuccess: () => {
              setOpen(false);
              router.push("/servers");
            },
          })
        }
      />
    </section>
  );
}

const inputCls =
  "h-11 w-full rounded-sm border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60";

const clampInt = (raw: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(raw) || min)));

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-md border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, error = false, children }: { label: string; hint?: string; error?: boolean; children: (p: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5 text-sm">
      <label htmlFor={id} className="block font-medium text-foreground">
        {label}
      </label>
      {children({ id, "aria-describedby": hint ? `${id}-hint` : undefined, "aria-invalid": error || undefined })}
      {hint ? (
        <p id={`${id}-hint`} className={`text-xs ${error ? "text-danger" : "text-muted"}`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-foreground">
          {label}
        </label>
        <p id={`${id}-desc`} className="text-xs text-muted">
          {description}
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-desc`}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors ${checked ? "border-primary bg-primary" : "border-border bg-surface-raised"}`}
      >
        <span className={`absolute left-0 top-0.5 size-4.5 rounded-full bg-foreground transition-transform ${checked ? "translate-x-5.5" : "translate-x-0.5"}`} aria-hidden />
      </button>
    </div>
  );
}
