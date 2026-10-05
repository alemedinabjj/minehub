"use client";

import { ArrowRight, ChevronLeft, Globe, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { durations, easings, stepVariants, transitions } from "@/lib/motion";
import { track } from "../analytics/track";
import { ApiRequestError, getWorldCreationApi } from "../api";
import { API_ERROR_COPY, GENERIC_ERROR, STEP_COPY, STEP_ERROR_COPY } from "../copy";
import { activeSteps, canOpenStep, furthestReachableStep, isStepComplete, nextStep, previousStep, stepError } from "../flow/flow";
import { toCreateServerRequest } from "../flow/request";
import { STEP_IDS, type StepId } from "../flow/types";
import { useProvisioning } from "../provisioning/use-provisioning";
import { deriveScene, type ScenePhase } from "../scene/derive-scene";
import { useWorldCreationStore } from "../state/store";
import { ExperienceStep } from "./steps/experience-step";
import { ModpackStep } from "./steps/modpack-step";
import { NameStep } from "./steps/name-step";
import { PlayersStep } from "./steps/players-step";
import { SummaryStep } from "./steps/summary-step";
import { VersionStep } from "./steps/version-step";
import { WorldTypeStep } from "./steps/world-type-step";
import { WorldCreationError, WorldCreationProgress, WorldCreationSuccess } from "./world-creation-progress";
import { WorldJourney } from "./world-journey";
import { WorldPreview } from "./world-preview";

const isStepId = (v: string | null): v is StepId => v !== null && (STEP_IDS as readonly string[]).includes(v);

/** The store hydrates from sessionStorage on the client only; render after mount to avoid mismatches. */
const useMounted = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

export function WorldCreationWizard() {
  const mounted = useMounted();
  if (!mounted) return <div className="min-h-dvh bg-background" aria-busy="true" />;
  return <Wizard />;
}

function Wizard() {
  const router = useRouter();
  const params = useSearchParams();
  const draft = useWorldCreationStore((s) => s.draft);
  const submission = useWorldCreationStore((s) => s.submission);
  const store = useWorldCreationStore.getState;

  const requested = params.get("step");
  const stepParam: StepId | "intro" = isStepId(requested) ? requested : "intro";
  const steps = useMemo(() => activeSteps(draft), [draft]);

  const [direction, setDirection] = useState<1 | -1>(1);
  const [showErrors, setShowErrors] = useState(false);
  const [feedback, setFeedback] = useState<{ id: number; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const provisioningTarget =
    submission?.serverId && submission.operationId ? { serverId: submission.serverId, operationId: submission.operationId } : null;
  const { snapshot, view, connectionError } = useProvisioning(provisioningTarget);

  // Guard deep links and history navigation: never land past an unfinished step.
  const current: StepId | "intro" =
    stepParam === "intro" ? "intro" : canOpenStep(stepParam, draft) ? stepParam : furthestReachableStep(draft);
  useEffect(() => {
    if (stepParam !== "intro" && current !== stepParam) router.replace(`/servers/new?step=${current}`, { scroll: false });
  }, [current, stepParam, router]);

  useEffect(() => {
    if (current !== "intro") track("world_creation_step_viewed", { step: current });
  }, [current]);

  const goTo = (target: StepId) => {
    const from = current === "intro" ? -1 : steps.indexOf(current);
    setDirection(steps.indexOf(target) >= from ? 1 : -1);
    setShowErrors(false);
    setSubmitError(null);
    router.push(`/servers/new?step=${target}`, { scroll: false });
  };

  const onFeedback = (text: string) => {
    clearTimeout(feedbackTimer.current);
    setFeedback((prev) => ({ id: (prev?.id ?? 0) + 1, text }));
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2600);
  };

  const phase: ScenePhase =
    view.phase === "ready" && provisioningTarget ? "born" : view.phase === "failed" && provisioningTarget ? "failed" : provisioningTarget ? "creating" : "building";
  const completed = steps.filter((id) => isStepComplete(id, draft)).length;
  const scene = useMemo(() => deriveScene(draft, completed, steps.length, phase), [draft, completed, steps.length, phase]);

  useEffect(() => {
    if (view.phase === "ready" && provisioningTarget) track("world_created", { software: draft.software });
    if (view.phase === "failed" && provisioningTarget) track("world_provisioning_failed", { code: view.error?.code ?? null });
  }, [view.phase]); // eslint-disable-line react-hooks/exhaustive-deps -- fire once per phase change

  const submit = async () => {
    const request = toCreateServerRequest(draft);
    if (!request) {
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const { idempotencyKey } = store().beginSubmission(JSON.stringify(request));
    track("world_creation_submitted", { worldType: request.worldType, software: request.software, players: request.players });
    try {
      const { server, operation } = await getWorldCreationApi().createServer(request, idempotencyKey);
      store().confirmSubmission({ serverId: server.id, operationId: operation.id });
      track("world_provisioning_started", {});
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.code : "UNKNOWN";
      setSubmitError(API_ERROR_COPY[code] ?? GENERIC_ERROR);
      if (code === "VERSION_NOT_FOUND") goTo("version");
    } finally {
      setSubmitting(false);
    }
  };

  const retryProvisioning = async () => {
    if (!submission?.serverId) return;
    setRetrying(true);
    track("world_provisioning_retried", { code: view.error?.code ?? null });
    try {
      const { operation } = await getWorldCreationApi().startServer(submission.serverId, crypto.randomUUID());
      store().setOperation(operation.id);
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.code : "UNKNOWN";
      setSubmitError(API_ERROR_COPY[code] ?? GENERIC_ERROR);
    } finally {
      setRetrying(false);
    }
  };

  const onPrimary = () => {
    if (current === "intro") {
      track("world_creation_started", {});
      goTo(steps[0] ?? "world-type");
      return;
    }
    const error = stepError(current, draft);
    if (error) {
      setShowErrors(true);
      return;
    }
    if (current === "summary") {
      void submit();
      return;
    }
    const next = nextStep(current, draft);
    if (next) goTo(next);
  };

  const onBack = () => {
    if (current === "intro") return;
    const prev = previousStep(current, draft);
    setDirection(-1);
    if (prev) goTo(prev);
    else router.push("/servers/new", { scroll: false });
  };

  const startOver = () => {
    store().reset();
    router.push("/servers/new", { scroll: false });
  };

  const currentError = current !== "intro" ? stepError(current, draft) : null;
  const inProvisioning = Boolean(provisioningTarget);

  return (
    <div className="relative grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,1fr)] lg:grid-rows-1">
      {/* World preview: top banner on mobile, persistent left pane on desktop */}
      <div className="relative h-[34dvh] min-h-52 lg:sticky lg:top-0 lg:h-dvh">
        <WorldPreview scene={scene} />
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4" aria-live="polite">
          <AnimatePresence>
            {feedback ? (
              <m.p
                key={feedback.id}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: transitions.soft }}
                exit={{ opacity: 0, y: -4, transition: { duration: durations.fast } }}
                className="rounded-sm border border-white/10 bg-background/80 px-3 py-1.5 text-sm font-medium text-foreground shadow-raised backdrop-blur"
              >
                {feedback.text}
              </m.p>
            ) : null}
          </AnimatePresence>
        </div>
        {getWorldCreationApi().mode === "mock" ? (
          <span className="absolute left-3 top-3 rounded-sm bg-warning/90 px-2 py-0.5 text-xs font-semibold text-black">Modo demonstração</span>
        ) : null}
      </div>

      <main className="relative flex min-h-0 flex-col border-border bg-background lg:h-dvh lg:border-l">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-4 md:flex-nowrap lg:px-8">
          <Link href="/" className="font-display text-xl text-foreground" aria-label="HubMine — início">
            Hub<span className="text-primary">Mine</span>
          </Link>
          {/* Own row on small screens so seven steps never force horizontal scroll */}
          {current !== "intro" && !inProvisioning ? (
            <div className="order-last min-w-0 basis-full md:order-none md:flex-1 md:basis-auto md:pb-5">
              <WorldJourney
                steps={steps}
                current={current}
                isComplete={(id) => isStepComplete(id, draft)}
                canOpen={(id) => canOpenStep(id, draft)}
                onOpen={goTo}
              />
            </div>
          ) : null}
          <Link href="/" className="grid size-10 place-items-center rounded-sm text-muted hover:bg-surface-raised hover:text-foreground" aria-label="Sair da criação">
            <X className="size-5" aria-hidden />
          </Link>
        </header>

        <div className="relative flex-1 overflow-y-auto overflow-x-hidden px-5 py-6 lg:px-8 lg:py-8">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            {inProvisioning ? (
              <m.section key="provisioning" variants={stepVariants} custom={1} initial="enter" animate="center" exit="exit" aria-labelledby="prov-title">
                {view.phase === "ready" && snapshot.server ? (
                  <WorldCreationSuccess server={snapshot.server} onCreateAnother={startOver} />
                ) : connectionError ? (
                  <div role="alert" className="space-y-4">
                    <h1 id="prov-title" className="text-2xl font-semibold text-foreground">Perdemos contato com a criação do seu mundo.</h1>
                    <p className="text-muted">
                      {getWorldCreationApi().mode === "mock"
                        ? "No modo demonstração, o servidor simulado some quando a página é recarregada."
                        : "Verifique sua conexão. Se o mundo já tiver sido criado, ele vai aparecer no seu painel."}
                    </p>
                    <Button onClick={startOver}>Começar de novo</Button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Criando seu mundo</p>
                    <h1 id="prov-title" className="mt-2 text-balance text-3xl font-semibold text-foreground">
                      {view.phase === "failed" ? "Algo deu errado no caminho." : "Seu mundo está tomando forma."}
                    </h1>
                    <div className="mt-6 space-y-5">
                      <WorldCreationProgress view={view} hasModpack={Boolean(draft.modpack)} />
                      {view.phase === "failed" ? (
                        <WorldCreationError
                          error={view.error}
                          retrying={retrying}
                          onRetry={() => void retryProvisioning()}
                          onEditChoices={startOver}
                        />
                      ) : null}
                      {submitError ? <p role="alert" className="text-sm text-danger">{submitError}</p> : null}
                    </div>
                  </>
                )}
              </m.section>
            ) : current === "intro" ? (
              <Intro key="intro" />
            ) : (
              <m.section
                key={current}
                custom={direction}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                aria-labelledby={`step-${current}-title`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{STEP_COPY[current].eyebrow}</p>
                <h1 id={`step-${current}-title`} className="mt-2 text-balance text-3xl font-semibold text-foreground lg:text-4xl">
                  {STEP_COPY[current].title}
                </h1>
                {STEP_COPY[current].subtitle ? <p className="mt-2 text-muted">{STEP_COPY[current].subtitle}</p> : null}
                <div className="mt-6">
                  {current === "world-type" && <WorldTypeStep onFeedback={onFeedback} />}
                  {current === "version" && <VersionStep onFeedback={onFeedback} />}
                  {current === "experience" && <ExperienceStep onFeedback={onFeedback} />}
                  {current === "modpack" && <ModpackStep onFeedback={onFeedback} />}
                  {current === "name" && <NameStep onFeedback={onFeedback} showErrors={showErrors} />}
                  {current === "players" && <PlayersStep onFeedback={onFeedback} />}
                  {current === "summary" && <SummaryStep onEdit={goTo} showErrors={showErrors} />}
                </div>
                {showErrors && currentError && current !== "name" && current !== "summary" ? (
                  <p role="alert" className="mt-4 text-sm text-danger">
                    {STEP_ERROR_COPY[currentError]}
                  </p>
                ) : null}
                {submitError ? (
                  <p role="alert" className="mt-4 text-sm text-danger">
                    {submitError}
                  </p>
                ) : null}
              </m.section>
            )}
          </AnimatePresence>
        </div>

        {!inProvisioning ? (
          <footer className="sticky bottom-0 z-[var(--z-nav)] flex items-center justify-between gap-3 border-t border-border bg-background/95 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:px-8">
            {current !== "intro" ? (
              <Button variant="ghost" onClick={onBack}>
                <ChevronLeft className="size-4" aria-hidden /> Voltar
              </Button>
            ) : (
              <span />
            )}
            <Button size="lg" onClick={onPrimary} loading={submitting} aria-describedby={showErrors && currentError ? undefined : undefined}>
              {current === "intro" ? "Começar" : current === "summary" ? <><Globe className="size-5" aria-hidden /> {STEP_COPY.summary.cta}</> : STEP_COPY[current].cta}
              {current !== "summary" ? <ArrowRight className="size-4" aria-hidden /> : null}
            </Button>
          </footer>
        ) : null}
      </main>
    </div>
  );
}

function Intro() {
  return (
    <m.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: durations.normal } }}
      exit={{ opacity: 0, transition: { duration: durations.fast } }}
      className="flex min-h-[50dvh] flex-col justify-center"
      aria-labelledby="intro-title"
    >
      <m.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: durations.slow, ease: easings.out } }}
        className="font-display text-5xl text-foreground"
      >
        Hub<span className="text-primary">Mine</span>
      </m.p>
      <m.h1
        id="intro-title"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: durations.slow, ease: easings.out, delay: 0.15 } }}
        className="mt-6 text-balance text-3xl font-semibold text-foreground lg:text-4xl"
      >
        Vamos criar seu mundo.
      </m.h1>
      <m.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: durations.slow, ease: easings.out, delay: 0.3 } }}
        className="mt-3 max-w-md text-lg text-muted"
      >
        Primeiro, me conte que tipo de aventura você quer viver. São só algumas perguntas.
      </m.p>
    </m.section>
  );
}
