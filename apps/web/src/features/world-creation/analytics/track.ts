/**
 * Funnel analytics. No provider is wired yet; `setAnalyticsAdapter` plugs one in later
 * (PostHog, GA, internal endpoint). Never send names, emails or free text — ids and enums only.
 */
export type WorldCreationEvent =
  | "world_creation_started"
  | "world_type_selected"
  | "minecraft_version_selected"
  | "software_selected"
  | "world_name_entered"
  | "player_count_selected"
  | "modpack_selected"
  | "world_creation_step_viewed"
  | "world_creation_submitted"
  | "world_provisioning_started"
  | "world_provisioning_failed"
  | "world_provisioning_retried"
  | "world_created";

type Props = Record<string, string | number | boolean | null>;
type Adapter = (event: WorldCreationEvent, props: Props) => void;

let adapter: Adapter = (event, props) => {
  if (process.env.NODE_ENV === "development") console.debug("[analytics]", event, props);
};

export function setAnalyticsAdapter(next: Adapter) {
  adapter = next;
}

export function track(event: WorldCreationEvent, props: Props = {}) {
  try {
    adapter(event, { flow: "journey", ...props });
  } catch {
    // Analytics must never break the experience.
  }
}
