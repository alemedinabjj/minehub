import { describe, expect, it } from 'vitest';
import { jobOptionsFor, queueForJob, serverJobPayloadSchema } from './index.js';

describe('queue contracts', () => {
  it('routes create to provisioning and everything else to lifecycle', () => {
    expect(queueForJob('CREATE')).toBe('server-provisioning');
    expect(queueForJob('STOP')).toBe('server-lifecycle');
  });

  it('uses the operation id as job id and retries stop/delete longer', () => {
    const id = '7d3c1c4e-9a43-4a39-9d52-1b2b9f0d1a11';
    expect(jobOptionsFor('START', id)).toMatchObject({ jobId: id, attempts: 3 });
    expect(jobOptionsFor('DELETE', id).attempts).toBe(5);
    expect(jobOptionsFor('START', id).jobId).not.toContain(':');
  });

  it('rejects payloads carrying anything but ids', () => {
    expect(serverJobPayloadSchema.safeParse({ serverId: 'x', operationId: 'y' }).success).toBe(false);
  });
});
