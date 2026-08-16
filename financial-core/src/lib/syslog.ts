import dgram from 'node:dgram';

/**
 * Best-effort remote-syslog mirror (RFC 5424 over UDP) for the append-only security_log
 * (spec §11.2 — the security record must survive even if the database itself is tampered with, so a
 * copy leaves the box the moment it is written). Enabled only when SYSLOG_HOST is set; SYSLOG_PORT
 * defaults to 514.
 *
 * Fire-and-forget by design: a mirror that cannot send must NEVER disturb the primary Mongo write or
 * the breaker that triggered it, so every error is swallowed to stderr. UDP means we do not even wait
 * for delivery — the point is that the record left this process, not that a collector acked it.
 */

const FACILITY = 10; // security/authorization messages
const SEVERITY = 5; // notice
const PRI = FACILITY * 8 + SEVERITY;

export function syslogEnabled(): boolean {
  return Boolean(process.env.SYSLOG_HOST?.trim());
}

export function mirrorToSyslog(event: string, detail: Record<string, unknown>, at: Date): void {
  const host = process.env.SYSLOG_HOST?.trim();
  if (!host) return;
  const port = Number(process.env.SYSLOG_PORT ?? 514) || 514;
  const hostname = process.env.HOSTNAME?.trim() || 'financial-core';

  // RFC 5424: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
  const line = `<${PRI}>1 ${at.toISOString()} ${hostname} fc-security ${process.pid} ${event} - ${event} ${safeJson(detail)}`;

  try {
    const socket = dgram.createSocket('udp4');
    socket.send(Buffer.from(line), port, host, (err) => {
      if (err) console.error('[syslog] security_log mirror failed:', err.message);
      socket.close();
    });
  } catch (err) {
    console.error('[syslog] security_log mirror threw:', err);
  }
}

function safeJson(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return '"<unserializable detail>"';
  }
}
