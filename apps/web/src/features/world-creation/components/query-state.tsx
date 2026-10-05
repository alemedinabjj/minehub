import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SkeletonCards({ count = 4, className = "grid gap-3 sm:grid-cols-2" }: { count?: number; className?: string }) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-[76px] animate-pulse rounded-md border border-border bg-surface motion-reduce:animate-none" />
      ))}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-danger/40 bg-danger/10 p-4">
      <p className="flex items-center gap-2 text-sm text-foreground">
        <CircleAlert className="size-4 text-danger" aria-hidden />
        {message}
      </p>
      <Button variant="secondary" onClick={onRetry}>
        <RotateCcw className="size-4" aria-hidden /> Tentar de novo
      </Button>
    </div>
  );
}
