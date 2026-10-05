import { SERVER_STATUSES } from '@hubmine/shared';
import { describe, expect, it } from 'vitest';
import { allowedFrom, canTransition } from './state-machine.js';

// Independent copy of the orchestration skill's table. Never derive it from ALLOWED_TRANSITIONS,
// or the test could not catch drift between the code and the documented rules.
const EXPECTED_ALLOWED = new Set([
  'CREATING>STOPPED', 'CREATING>STARTING', 'CREATING>ERROR', 'CREATING>DELETING',
  'STARTING>ONLINE', 'STARTING>ERROR', 'STARTING>STOPPING', 'STARTING>DELETING',
  'ONLINE>STOPPING', 'ONLINE>CRASHED', 'ONLINE>DELETING',
  'CRASHED>STARTING', 'CRASHED>ERROR', 'CRASHED>STOPPED', 'CRASHED>DELETING',
  'STOPPING>STOPPED', 'STOPPING>SUSPENDED', 'STOPPING>ERROR', 'STOPPING>DELETING',
  'STOPPED>STARTING', 'STOPPED>DELETING',
  'SUSPENDED>STARTING', 'SUSPENDED>DELETING',
  'ERROR>STARTING', 'ERROR>STOPPED', 'ERROR>DELETING',
  'DELETING>DELETED', 'DELETING>ERROR',
]);

describe('server state machine', () => {
  it.each(SERVER_STATUSES.flatMap((from) => SERVER_STATUSES.map((to) => [from, to] as const)))('%s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(EXPECTED_ALLOWED.has(`${from}>${to}`));
  });

  it('DELETED is terminal', () => {
    expect(SERVER_STATUSES.some((to) => canTransition('DELETED', to))).toBe(false);
  });

  it('derives the conditional-update source states', () => {
    expect(allowedFrom('ONLINE')).toEqual(['STARTING']);
    expect(allowedFrom('STARTING').sort()).toEqual(['CRASHED', 'CREATING', 'ERROR', 'STOPPED', 'SUSPENDED']);
  });
});
