/**
 * Ops alerting hook. Circuit breakers (CB6/CB7) and anomalies call `alertOps()`.
 *
 * For the MVP this logs to stderr. The Telegram Bot delivery is wired into this same hook in a
 * later milestone — call sites never change, only the handler does.
 */

export interface AlertContext {
  [key: string]: unknown;
}

export type AlertHandler = (message: string, context?: AlertContext) => void | Promise<void>;

const defaultHandler: AlertHandler = (message, context) => {
  console.error(`[OPS-ALERT] ${message}`, context ?? '');
};

let handler: AlertHandler = defaultHandler;

/** Override the alert delivery (Telegram in prod, a spy/no-op in tests). */
export function setAlertHandler(next: AlertHandler): void {
  handler = next;
}

export function resetAlertHandler(): void {
  handler = defaultHandler;
}

export async function alertOps(message: string, context?: AlertContext): Promise<void> {
  await handler(message, context);
}
