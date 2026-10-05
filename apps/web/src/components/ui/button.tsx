import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:brightness-110 active:brightness-95 shadow-[0_2px_0_0_rgb(0_0_0/0.35)] active:translate-y-px",
  secondary: "bg-surface-raised text-foreground border border-border hover:border-muted",
  ghost: "text-muted hover:text-foreground hover:bg-surface-raised",
  // Dark text on redstone: white would be ~3.9:1, below AA.
  destructive: "bg-danger text-background hover:brightness-110 active:brightness-95",
};

const SIZES: Record<Size, string> = {
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className = "", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-w-11 select-none items-center justify-center gap-2 rounded-sm font-medium transition-[filter,background-color,border-color,color,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden />
      ) : null}
      {children}
    </button>
  );
});
