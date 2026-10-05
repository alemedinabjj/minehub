---
name: minecraft-ui-design
description: Use whenever creating, changing or reviewing any HubMine user interface. That includes the landing page and marketing sections, the dashboard, server list and server detail pages, the server creation flow, console/log views, settings, forms, tables, modals and empty/loading/error states; choosing colors, typography, spacing, icons, pixel art, textures or 3D for a screen; and deciding whether a Minecraft-themed visual effect belongs on a page. Animation and 3D implementation and performance are in frontend-animation-performance.
---

# Minecraft UI Design

## Purpose

This skill defines HubMine's visual identity and UX rules. The principle is:

> **Minecraft on the outside, professional SaaS on the inside.**

The interface should feel like Minecraft (building, adventure, servers, community, fun) and still read as a serious, trustworthy hosting product. The user is paying to run a server. Clarity, speed and confidence come first; the theme is seasoning, not the meal.

Dependencies:
- `frontend-animation-performance`: how to implement motion and 3D, budgets, fallbacks, reduced motion. This skill decides *what* and *where*; that skill decides *how*.
- `minecraft-server-orchestration`: the server status enum and lifecycle the UI must show truthfully.
- `nestjs-backend-standards`: API shapes (202 Accepted operations, errors) the UI consumes.
- `testing-and-quality-gates`: lint, type check, tests and accessibility checks a UI change must pass.
- `conventional-commits`: commit messages (`feat(web): ...`, `style(web): ...`).

## When to use

- Building or redesigning any page, section or component.
- Adding a Minecraft-themed element: pixel art, block textures, sprites, particles, 3D.
- Designing loading, empty, error or success states.
- Picking colors, fonts, icons, radius or shadows for something new.
- Reviewing a UI change for consistency, accessibility or "is this too much?".

## Project status

Greenfield: **no frontend exists yet** (no `package.json`, no app, no components). Everything below is the recommended design. Before writing UI code:

1. Look for the frontend app (for example `apps/web`, `web`, `frontend`) and read its `package.json`.
2. Record what is actually there: framework and version (Next.js App Router expected), React version, Tailwind version (v4 uses `@theme` in CSS; v3 uses `tailwind.config`), UI library (shadcn/ui, Radix…), icon set, animation and 3D libraries.
3. Reuse what exists. If a needed library is missing, propose it to the user with its reason and cost. **Never install dependencies on your own.** Use Context7 for the current docs of whatever library you touch.

Recommended stack when the frontend is created (a proposal, not a fact): Next.js App Router + TypeScript, Tailwind CSS with design tokens as CSS variables, shadcn/ui on Radix primitives (accessible, owned code, no heavy runtime), `lucide-react` for UI icons plus a small set of HubMine-owned pixel icons, `next/font` for fonts.

## Core principles

1. **Usability beats theme.** Before adding any effect ask: *does this improve the experience?* If the answer is "it looks cool" only, it goes to the landing page or nowhere.
2. **Theme intensity depends on the surface.** Marketing = high. Dashboard chrome = low. Data and forms = almost zero.
3. **One visual language.** Every screen uses the same tokens and components. A new variant needs a reason that the existing ones cannot cover.
4. **The UI tells the truth.** Status, progress and errors come from real backend state, never from timers or optimistic guesses that can lie.
5. **Original, not copied.** Inspired by Minecraft, never a copy of Mojang's UI, textures, fonts, logos or sounds.

## Theme intensity by surface

| Surface | Intensity | Allowed | Not allowed |
|---|---|---|---|
| Landing hero, marketing sections | High | Stylized world (terrain, sky, blocks), parallax, floating blocks, particles, lighting and depth, 3D scene, entrance animations, character silhouettes | Blocking the CTA, unreadable text over busy art, autoplay sound |
| Auth pages, onboarding | Medium | Illustrated side panel, subtle block pattern, pixel logo | Pixel font in inputs or body text |
| Dashboard shell (sidebar, header) | Low | Pixel logo, block-style icons for main entities, a discreet texture in the sidebar or page header | Textured backgrounds behind content, pixelated navigation text |
| Server cards, status, empty states, creation flow | Low-medium | Server "block" icon per type (Paper, Fabric…), status badges, small illustrations, creation progress animation, optional 3D in empty state or creation | Animated textures behind numbers |
| Tables, forms, settings, logs, charts, billing, admin | Minimal | Clean SaaS components, Minecraft wording in labels ("World", "Seed", "MOTD") | Pixel fonts, textures, 3D, decorative motion |

## Design system

Implement tokens as CSS variables (semantic names), mapped into Tailwind. Components consume semantic tokens (`bg-surface`, `text-muted`), never raw hex. The values below are **starting values**: verify every text/background pair against WCAG AA before shipping.

### Color

Dark-first (most players and server admins prefer it), with a light theme using the same semantic names.

| Token | Role | Dark start value | Inspiration |
|---|---|---|---|
| `--background` | App background | `#0f1115` | Night sky / deepslate |
| `--surface` / `--surface-raised` | Cards, panels / popovers | `#171a21` / `#1f232c` | Stone |
| `--border` | Dividers, inputs | `#2a2f3a` | |
| `--foreground` / `--muted` | Text / secondary text | `#e8eaef` / `#9aa3b2` | |
| `--primary` | Main actions, brand | `#4caf50` range | Grass |
| `--accent` | Highlights, links, focus ring | `#3fd0d4` range | Diamond |
| `--success` | Online, success | green (distinct shade from primary) | Emerald |
| `--warning` | Starting, attention | `#e5b33b` range | Gold |
| `--danger` | Errors, destructive | `#e0483e` range | Redstone |
| `--info` | Suspended, neutral info | `#6c8cff` range | Lapis |

Rules: one primary action color per view; danger only for destructive or failed things; never encode meaning by color alone (always text and/or icon too).

### Typography

- **Body and UI:** a highly legible sans (for example Inter or Geist via `next/font`). Tabular numbers for metrics (`font-variant-numeric: tabular-nums`).
- **Display (optional):** an openly licensed pixel font (for example Pixelify Sans or Press Start 2P, both OFL; check the license of any other choice) only for the logo, hero headline, large section titles and big numbers in marketing. Never for body text, labels, inputs, tables, buttons in the dashboard, or anything under ~20px.
- **Mono:** a monospace font for console, logs, IPs, ports, seeds.
- Do not use Mojang's Minecraft font or files extracted from the game.

### Spacing, radius, shadow

- 4px base scale (Tailwind default). Pixel art sits on a multiple-of-4 grid so it stays crisp.
- Radius: small and consistent, `--radius: 6px` (inputs, buttons), `10px` (cards, modals). A "blocky" variant (`radius 2px` + 2px solid border + offset shadow) is reserved for marketing CTAs and server-type tiles; do not mix both styles in the same component group.
- Shadows: two levels (raised, overlay). Dark theme relies on borders and surface steps more than shadows. No stacked glows.

### Components

Build on the project's primitive library (shadcn/Radix recommended) so focus, keyboard and ARIA behavior come for free. One component per concept:

| Component | Rule |
|---|---|
| Button | Variants: `primary`, `secondary`, `ghost`, `destructive`, `link`; sizes `sm`/`md`/`lg`. Loading state = spinner + disabled + same width. Icon-only buttons need `aria-label`. |
| Card | Surface + border + `10px` radius. Server cards add type icon, status badge, address with copy button. |
| Badge | Neutral, success, warning, danger, info. Text label always present. |
| Input / Select / Textarea | Visible label (not placeholder-only), helper text, inline error under the field with `aria-describedby`. |
| Modal / Dialog | Focus trapped, `Esc` closes, title required. Destructive confirms name the object and the consequence. |
| Dropdown / Tooltip | Radix-based. Tooltips never hold essential information (not reachable on touch). |
| Tabs | For server detail sections (Overview, Console, Files, Settings, Backups). URL reflects the active tab. |
| Navigation | Sidebar on desktop, sheet/drawer on mobile. Active item has a non-color indicator. |
| Toast | Results of async actions. Errors that need action stay until dismissed. |
| Skeleton | Matches the final layout to avoid layout shift. |

### Server status indicator

The UI shows the `ServerStatus` from `minecraft-server-orchestration` exactly; it never invents states.

| Status | Label (pt-BR) | Color | Icon / motion |
|---|---|---|---|
| `RUNNING` | Online | success | solid dot |
| `STARTING` | Iniciando | warning | spinner or pulsing dot |
| `CREATING` | Criando | warning | progress steps |
| `STOPPING` | Parando | warning | spinner |
| `STOPPED` | Parado | neutral | hollow dot |
| `SUSPENDED` | Hibernando | info | moon/sleep icon |
| `ERROR` | Erro | danger | alert icon + sanitized reason + action (retry, view logs) |
| `DELETING` | Excluindo | danger (muted) | spinner, actions disabled |

Use one `<ServerStatusBadge status=...>` component everywhere. Actions that are invalid in the current status are disabled with a tooltip/explanation, not hidden silently.

## Minecraft aesthetic: how to use it

| Element | Use | Rules |
|---|---|---|
| Pixel art / sprites | Logo, server-type icons, empty-state illustrations, marketing | Original or properly licensed. Render with `image-rendering: pixelated`, scale by integers. Prefer SVG or small spritesheets. |
| Block textures | Hero terrain, section dividers, sidebar header | Low contrast behind any text; overlay a gradient so text stays AA. Never behind tables, forms or logs. |
| Particles | Hero, success moment (server online), marketing | Few, slow, decorative only. Off with reduced motion. |
| Lighting / depth / shadows | Hero and 3D scenes | Faked with gradients where possible. |
| 3D | See next section | Strategic only. |
| Wording | "Mundo", "Seed", "MOTD", "Plugins", "Mods", "Whitelist" | Use real Minecraft terms where the user expects them; avoid jokes in error messages. |

Avoid: walls of pixel art, textures everywhere, heavy shadows, tiny pixel fonts, childish cartoon look, effects that make navigation slower or text harder to read.

## 3D: where it belongs

Implementation, lazy loading, fallbacks and budgets: `frontend-animation-performance`. This section only decides placement.

| Appropriate | Not appropriate |
|---|---|
| Landing hero (stylized island/terrain with a server block) | CRUD screens |
| Server creation animation (blocks assembling as steps complete) | Forms and settings |
| Server status visualization on the server overview (optional) | Tables, lists, billing |
| Empty state ("no servers yet") | Console and logs |
| Marketing sections (features, pricing hero) | Admin and support screens |

Every 3D placement must have a non-3D fallback that looks intentional on mobile, weak devices and with reduced motion. A 3D scene that only works on desktop is not done.

## Landing page

Goal: in about 5 seconds the visitor understands **"Crie seu servidor Minecraft em poucos minutos."**

Recommended structure:
1. **Hero:** headline + one-line subtitle + primary CTA ("Criar servidor") + secondary CTA ("Ver planos"). Background: stylized world (sky gradient, terrain silhouette, floating blocks), with a 3D scene loaded after the HTML hero is visible. Text and CTA are real HTML, never part of the canvas or an image.
2. **How it works:** 3 steps (choose type/version → pick plan → play), each with a pixel icon.
3. **Server types:** tiles for Vanilla, Paper, Purpur, Fabric, Forge, NeoForge, modpacks.
4. **Features:** performance, backups, console, mods/plugins, protection.
5. **Pricing**, **FAQ**, **final CTA**, footer.

Entrance animations are short and staggered; parallax is subtle and disabled with reduced motion.

## Dashboard

A professional SaaS product first. Layout: sidebar (Servers, Billing, Account, Support) + header (org/user, notifications) + content. Server list as cards (grid) or table (toggle) with status badge, type icon, version, players, address with copy. Server detail with tabs. Charts (CPU, RAM, players) use plain clean charts with the semantic palette. The console uses the mono font on a dark surface, virtualized, with auto-scroll that pauses when the user scrolls up.

## UX requirements

Every data view and action must define:

- **Hierarchy:** one clear primary action per screen; secondary actions visually quieter.
- **Loading:** skeletons matching the layout for initial loads; inline spinners for actions; never a blank screen.
- **Empty:** illustration + one sentence + the next action ("Crie seu primeiro servidor").
- **Error:** what happened in plain language (sanitized), what the user can do, and a retry. Never raw stack traces or Docker errors.
- **Success:** toast or inline confirmation; for big moments (server online) a short celebratory effect is fine.
- **Destructive actions** (delete server, reset world, cancel plan): confirmation dialog naming the server; deleting a server requires typing its name. Explain what is lost (world data, backups).
- **Immediate feedback:** buttons react on press; async operations show "in progress" right away because the API returns 202 and the work happens in the worker.

### Server creation flow

The steps are driven by real progress from the backend (operation status and `ServerEvent`s via polling, SSE or WebSocket), never by a fake timer:

```
Criando servidor  →  Provisionando  →  Baixando imagem  →  Iniciando Minecraft  →  Servidor online
(operation queued)   (CREATING:        (CREATING:           (STARTING: waiting     (RUNNING: healthy)
                      port, data dir)   image pull)          for healthy)
```

- Show completed / current / pending steps with icons and text, plus elapsed time. First starts of modpacks can take many minutes: say so.
- On failure, mark the failed step, show the sanitized reason and offer retry or logs.
- The user can leave the page; the server card keeps showing the live status.
- The visual layer (blocks assembling, a 3D block) is optional decoration on top of the functional step list, never a replacement for it.

## Responsiveness

Design and verify at mobile (~375px), tablet (~768px), laptop (~1280px) and desktop (~1536px+). Sidebar collapses to a drawer; tables become cards or scroll horizontally inside their container (never the whole page); touch targets are at least 44×44px; hero 3D becomes a static or lightly animated illustration on small or weak devices.

## Accessibility

- WCAG 2.1 AA contrast for text (4.5:1, 3:1 for large text and UI boundaries), including text over textures and gradients.
- Every interactive element reachable and usable by keyboard, with a visible focus ring (`--accent`).
- Semantic HTML first; ARIA only where needed (`aria-label` on icon buttons, `aria-live="polite"` for status changes and creation progress).
- Respect `prefers-reduced-motion` (details in `frontend-animation-performance`).
- Never rely on color alone: status = color + text + icon.
- Readable sizes: body ≥ 14px in the dashboard, 16px on marketing; no pixel font for body text.
- Decorative images and canvases are `aria-hidden`; meaningful images have `alt`.

## Anti-patterns

- Turning the whole interface into pixel art or a game menu.
- Animating everything; 3D on every page.
- Sacrificing UX for aesthetics (low contrast over textures, pixel fonts in forms, slow transitions between dashboard pages).
- Giant components that mix layout, data fetching, theme and animation; split them.
- Heavy images (multi-MB PNG backgrounds) where CSS, SVG or a small WebP would do.
- Adding a dependency for a trivial effect that CSS can do.
- Copying Minecraft's official UI, textures, logo, font, sounds or the Mojang/Minecraft brand in a way that suggests affiliation. HubMine is not affiliated with Mojang or Microsoft; say so in the footer.
- One-off variants of buttons, cards or badges that already exist.
- Fake progress bars or statuses that do not reflect the backend.

## Checklist

- [ ] Checked the real frontend `package.json` and reused existing libraries; no new dependency without user approval.
- [ ] Theme intensity matches the surface table.
- [ ] Only semantic tokens and existing components; any new variant is justified.
- [ ] Loading, empty, error and success states exist.
- [ ] Destructive actions are confirmed and explain consequences.
- [ ] Server status uses `ServerStatusBadge` and the real `ServerStatus`.
- [ ] Works at mobile, tablet, laptop and desktop widths.
- [ ] Keyboard navigation, focus ring, contrast, non-color status, reduced motion.
- [ ] All art is original or licensed; nothing from Minecraft's game files.
- [ ] Motion/3D follows `frontend-animation-performance`.

## Definition of Done

A screen is done only when it:
- visibly belongs to HubMine and is consistent with the rest of the product;
- works on mobile;
- has loading, error and empty states;
- stays readable (contrast, sizes, fonts);
- does not hurt performance (see `frontend-animation-performance` budgets);
- is accessible (keyboard, screen reader, reduced motion);
- still feels like a professional SaaS;
- passes the gates in `testing-and-quality-gates`.
