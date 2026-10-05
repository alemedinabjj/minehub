/**
 * Container output is untrusted input: strip ANSI escapes, Minecraft § formatting and control
 * characters (except tab), cap each line, and never interpret it. The web renders it as text.
 */
// oxlint-disable-next-line no-control-regex -- ANSI escapes start with ESC
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const SECTION_CODES = /§[0-9a-fk-orx]/gi;
// oxlint-disable-next-line no-control-regex -- removing control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
export const MAX_LINE = 4096;

export function sanitizeLine(line: string): string {
  return line.replace(ANSI, '').replace(SECTION_CODES, '').replace(CONTROL, '').slice(0, MAX_LINE);
}

export function sanitizeOutput(text: string, maxChars: number): string {
  return text
    .split(/\r?\n/)
    .map(sanitizeLine)
    .join('\n')
    .trimEnd()
    .slice(0, maxChars);
}

/**
 * Docker multiplexes stdout/stderr for non-TTY containers: frames of [type, 0, 0, 0, size(BE32)]
 * followed by `size` bytes. Returns the concatenated payload as UTF-8.
 */
export function demuxDockerStream(buf: Buffer): string {
  const parts: Buffer[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const type = buf[i];
    const size = buf.readUInt32BE(i + 4);
    if ((type !== 1 && type !== 2) || i + 8 + size > buf.length) {
      parts.push(buf.subarray(i)); // not multiplexed (or truncated): keep the rest as-is
      break;
    }
    parts.push(buf.subarray(i + 8, i + 8 + size));
    i += 8 + size;
  }
  return Buffer.concat(parts).toString('utf8');
}
