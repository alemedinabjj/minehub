"use client";

import { loginRequestSchema, PASSWORD, registerRequestSchema } from "@hubmine/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api/http";
import { authApi } from "../auth-api";
import { AUTH_ERROR_COPY, GENERIC_AUTH_ERROR } from "../copy";
import { safeNext } from "../safe-next";
import { useSession } from "../session-store";
import { TextField } from "./text-field";

type Mode = "login" | "register";
type FieldErrors = Partial<Record<"name" | "email" | "password", string>>;

const copyFor = (code: string) => AUTH_ERROR_COPY[code] ?? GENERIC_AUTH_ERROR;

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const status = useSession((s) => s.status);
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in (e.g. restored from the refresh cookie): skip the form.
  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  const set = (field: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = mode === "register" ? registerRequestSchema.safeParse(values) : loginRequestSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        fieldErrors[field] ??= copyFor(issue.message);
      }
      setErrors(fieldErrors);
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "register") await authApi.register(registerRequestSchema.parse(values));
      else await authApi.login(loginRequestSchema.parse(values));
      router.replace(next);
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : "UNKNOWN";
      if (code === "VALIDATION_FAILED" && err instanceof ApiRequestError && err.details) {
        const fieldErrors: FieldErrors = {};
        for (const d of err.details as Array<{ field: string; code: string }>) fieldErrors[d.field as keyof FieldErrors] ??= copyFor(d.code);
        setErrors(fieldErrors);
      } else if (code === "EMAIL_IN_USE") {
        setErrors({ email: copyFor(code) });
      } else {
        setFormError(copyFor(code));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      {mode === "register" ? (
        <TextField label="Como podemos te chamar?" name="name" autoComplete="name" value={values.name} onChange={set("name")} error={errors.name} required />
      ) : null}
      <TextField label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" value={values.email} onChange={set("email")} error={errors.email} required />
      <TextField
        label="Senha"
        name="password"
        type="password"
        autoComplete={mode === "register" ? "new-password" : "current-password"}
        value={values.password}
        onChange={set("password")}
        error={errors.password}
        hint={mode === "register" ? `Pelo menos ${PASSWORD.min} caracteres. Uma frase é ótima.` : undefined}
        required
      />
      {formError ? (
        <p role="alert" className="rounded-sm border border-danger/40 bg-danger/10 p-3 text-sm text-foreground">
          {formError}
        </p>
      ) : null}
      <Button type="submit" size="lg" loading={submitting} className="mt-2 w-full">
        {mode === "register" ? "Criar minha conta" : "Entrar"}
      </Button>
      {mode === "login" ? null : (
        <p className="pt-2 text-xs text-muted">
          Ao criar a conta você concorda com os termos de uso. O HubMine não é afiliado à Mojang ou à Microsoft.
        </p>
      )}
    </form>
  );
}

export function AuthSwitchLink({ to }: { to: Mode }) {
  const params = useSearchParams();
  const next = params.get("next");
  const href = `/${to}${next ? `?next=${encodeURIComponent(safeNext(next))}` : ""}`;
  return (
    <Link href={href} className="font-medium text-accent hover:underline">
      {to === "login" ? "Entrar" : "Criar conta"}
    </Link>
  );
}
