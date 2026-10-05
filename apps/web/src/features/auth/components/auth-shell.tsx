import Link from "next/link";
import { Scene2D } from "@/features/world-creation/scene/scene-2d";
import type { SceneDescriptor } from "@/features/world-creation/scene/derive-scene";

const SCENE: SceneDescriptor = {
  biome: "village",
  progress: 1,
  infrastructure: "energy",
  portal: false,
  nameplate: null,
  population: 3,
  mood: "calm",
  phase: "building",
};

/** Auth pages: medium theme intensity (illustrated side, clean form). */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(440px,560px)]">
      <div className="relative hidden lg:block" aria-hidden>
        <Scene2D scene={SCENE} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent p-10">
          <p className="max-w-md text-balance text-2xl font-semibold text-foreground">Crie seu mundo. O HubMine cuida do resto.</p>
        </div>
      </div>
      <main className="flex flex-col px-6 py-8 sm:px-10">
        <Link href="/" className="font-display text-2xl text-foreground" aria-label="HubMine — início">
          Hub<span className="text-primary">Mine</span>
        </Link>
        <div className="my-auto w-full max-w-sm py-10">
          <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
          <p className="mt-2 text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-6 text-sm text-muted">{footer}</p>
        </div>
      </main>
    </div>
  );
}
