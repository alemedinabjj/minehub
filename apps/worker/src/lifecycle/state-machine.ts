import type { ServerStatus } from '@hubmine/shared';

/**
 * Single source of truth for lifecycle transitions; must match the table in
 * .claude/skills/minecraft-server-orchestration (a test checks it against an independent copy).
 * ERROR → STOPPED and CRASHED → STOPPED are used only by the reconciler.
 */
export const ALLOWED_TRANSITIONS: Record<ServerStatus, readonly ServerStatus[]> = {
  CREATING: ['STOPPED', 'STARTING', 'ERROR', 'DELETING'],
  STARTING: ['ONLINE', 'ERROR', 'STOPPING', 'DELETING'],
  ONLINE: ['STOPPING', 'CRASHED', 'DELETING'],
  CRASHED: ['STARTING', 'ERROR', 'STOPPED', 'DELETING'],
  STOPPING: ['STOPPED', 'SUSPENDED', 'ERROR', 'DELETING'],
  STOPPED: ['STARTING', 'DELETING'],
  SUSPENDED: ['STARTING', 'DELETING'],
  ERROR: ['STARTING', 'STOPPED', 'DELETING'],
  DELETING: ['DELETED', 'ERROR'],
  DELETED: [],
};

export const canTransition = (from: ServerStatus, to: ServerStatus): boolean => ALLOWED_TRANSITIONS[from].includes(to);

/** Every status from which `to` is reachable: the `WHERE status IN (...)` of a conditional update. */
export const allowedFrom = (to: ServerStatus): ServerStatus[] =>
  (Object.keys(ALLOWED_TRANSITIONS) as ServerStatus[]).filter((s) => ALLOWED_TRANSITIONS[s].includes(to));
