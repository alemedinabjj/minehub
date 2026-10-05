import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for secret columns (e.g. RCON passwords).
 * Layout: version(1) | iv(12) | authTag(16) | ciphertext. The version byte allows key rotation.
 */
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('SecretBox key must be 32 bytes');
    this.key = key;
  }

  encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const out = Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
    return new Uint8Array(out);
  }

  decrypt(payload: Uint8Array): string {
    const buf = Buffer.from(payload);
    if (buf.length < 1 + IV_BYTES + TAG_BYTES || buf[0] !== VERSION) throw new Error('Unsupported secret payload');
    const iv = buf.subarray(1, 1 + IV_BYTES);
    const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  }
}

/** URL-safe random secret, e.g. for RCON passwords. */
export const randomSecret = (bytes = 24) => randomBytes(bytes).toString('base64url');
