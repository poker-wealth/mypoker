/** Join truthy class fragments — the tiny className helper every component uses. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
