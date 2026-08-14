import { createSocket } from 'node:dgram';
import { hostname } from 'node:os';

/**
 * Ship security events to a remote syslog (SAMUEL.md task 4).
 *
 * The point is not redundancy, it is REACH. A security log that lives only in
 * the database it is protecting can be deleted by whoever owns that database —
 * and the events recorded here are exactly the ones someone with that access
 * would want gone. Once a line has left the machine, deleting the local copy no
 * longer deletes the evidence.
 *
 * RFC 5424 over UDP, which is the format every collector already understands
 * (rsyslog, syslog-ng, Papertrail, Datadog, CloudWatch). No dependency: the
 * frame is a header and a JSON payload.
 *
 * UDP is deliberate, and its weakness is the reason. TCP would block a money
 * path when the collector is slow or gone, and a circuit breaker that cannot
 * fire because its log shipper is down is worse than one whose log line was
 * dropped. Delivery here is best-effort by design; the database write is the
 * durable record and happens first.
 *
 * NOT the same thing as the spec's requirement. §11.2 asks for MongoDB's own
 * audit log to reach syslog so a DBA cannot erase evidence of their own
 * queries — that is MongoDB Enterprise auditing plus RBAC, configured on the
 * cluster, not application code. This ships the APPLICATION's security events.
 * Both are wanted; only one of them is written in TypeScript.
 */

/** RFC 5424 severities. Everything here is a security event, so: warning or alert. */
const SEVERITY = { alert: 1, warning: 4 } as const;

/** local0 — the conventional facility for application security logs. */
const FACILITY = 16;

const priority = (severity: number): number => FACILITY * 8 + severity;

export interface SyslogConfig {
  host: string;
  port: number;
  /** Shown as the APP-NAME field, so one collector can carry several services. */
  appName: string;
}

export function syslogConfig(env: NodeJS.ProcessEnv = process.env): SyslogConfig | null {
  const host = env.SYSLOG_HOST;
  if (!host) return null;
  // `|| 514`, not `?? 514`: a .env with `SYSLOG_PORT=` and no value yields an
  // EMPTY STRING, which is not nullish — Number('') is 0, and `??` would let
  // that 0 fail the check below and silently disable shipping with the HOST
  // still set. A blank value means "the default", the same as no value.
  const port = Number(env.SYSLOG_PORT || 514);
  if (!Number.isInteger(port) || port <= 0) return null;
  return { host, port, appName: env.SYSLOG_APP_NAME ?? 'financial-core' };
}

/**
 * One RFC 5424 line.
 *
 * Exported for tests: the format is the contract with the collector, and a
 * malformed header is silently dropped by most of them — a failure that looks
 * exactly like no events happening.
 */
export function formatSyslog(
  cfg: SyslogConfig,
  event: { event: string; detail: Record<string, unknown>; at: Date; id: string },
  severity: number,
): string {
  const structured = JSON.stringify({ id: event.id, event: event.event, detail: event.detail });
  // <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
  return [
    `<${priority(severity)}>1`,
    event.at.toISOString(),
    hostname(),
    cfg.appName,
    String(process.pid),
    event.event,
    '-', // no structured-data element; the payload is the message
    structured,
  ].join(' ');
}

/**
 * Which events are loud.
 *
 * CB6 and its inline enforcement are `alert`; everything else is `warning`.
 * Same reasoning as the admin panel's severity: the spec singles out
 * non-whitelisted fund flow as "MOST IMPORTANT", and grading everything at the
 * top means a pager that is ignored by the second week.
 */
const ALERT_EVENTS = new Set(['ILLEGAL_FUND_FLOW', 'CIRCUIT_BREAKER_CB6']);

let socket: ReturnType<typeof createSocket> | null = null;

/** Send one event. Never throws, never blocks the caller. */
export function shipToSyslog(
  event: { event: string; detail: Record<string, unknown>; at: Date; id: string },
  cfg: SyslogConfig | null = syslogConfig(),
): void {
  if (!cfg) return; // Not configured is the dev default, not an error.

  try {
    if (!socket) {
      socket = createSocket('udp4');
      // Without a listener, a socket-level 'error' (EACCES on the implicit
      // bind, for one) is an unhandled EventEmitter error — which crashes the
      // process. From a fire-and-forget logging path, that would be the tail
      // wagging the dog hard enough to kill it.
      socket.on('error', (err) => console.error('[syslog] socket error:', err.message));
    }
    const severity = ALERT_EVENTS.has(event.event) ? SEVERITY.alert : SEVERITY.warning;
    const line = Buffer.from(formatSyslog(cfg, event, severity));
    socket.send(line, cfg.port, cfg.host, (err) => {
      // Logged, not thrown. The caller is usually inside a money path and the
      // database write has already succeeded.
      if (err) console.error('[syslog] send failed:', err.message);
    });
  } catch (err) {
    console.error('[syslog] unavailable:', err instanceof Error ? err.message : err);
  }
}

/** Release the socket — for tests, and for a clean shutdown. */
export function closeSyslog(): void {
  socket?.close();
  socket = null;
}
