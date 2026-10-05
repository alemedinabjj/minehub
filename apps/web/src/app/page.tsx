import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-display text-5xl text-foreground">
        Hub<span className="text-primary">Mine</span>
      </p>
      <h1 className="max-w-xl text-balance text-2xl font-semibold text-foreground">Crie seu mundo. O HubMine cuida do resto.</h1>
      <Link
        href="/servers/new"
        className="inline-flex h-12 items-center rounded-sm bg-primary px-6 font-medium text-primary-foreground shadow-[0_2px_0_0_rgb(0_0_0/0.35)] hover:brightness-110"
      >
        Criar servidor
      </Link>
    </main>
  );
}
