import type { PlayerSettings } from './settings';
import { api } from './client';

/**
 * Avatar upload — `POST /me/avatar` on the gateway (see
 * game-server/src/gateway/me-routes.ts). The body is the raw image bytes
 * exactly as picked (JPEG, PNG or WebP); the gateway re-validates the real
 * format from the bytes themselves regardless of what's sent here.
 *
 * The success response is unusual: on the happy path it's the settled
 * `PlayerSettings` spread flat alongside `avatarUrl` (so the settings cache
 * can be replaced outright, same as `patchSettings`'s response). If the image
 * was stored but the settings read-back afterward failed, the server instead
 * returns `{ avatarUrl, settings: null, warning }` — the upload still
 * succeeded, only the confirmation read didn't, so this is not thrown as an
 * error. `uploadAvatar` normalizes both shapes to one return type.
 */

interface AvatarUploadSuccess extends PlayerSettings {
  avatarUrl: string;
}

interface AvatarUploadPartial {
  avatarUrl: string;
  settings: null;
  warning: string;
}

type AvatarUploadResponse = AvatarUploadSuccess | AvatarUploadPartial;

function isPartial(body: AvatarUploadResponse): body is AvatarUploadPartial {
  return (body as AvatarUploadPartial).settings === null;
}

export interface AvatarUploadResult {
  avatarUrl: string;
  /** Null only when the image was stored but the settings read-back failed — see class comment. */
  settings: PlayerSettings | null;
}

export async function uploadAvatar(bytes: Blob, contentType: string): Promise<AvatarUploadResult> {
  const body = await api.upload<AvatarUploadResponse>('/me/avatar', bytes, { contentType });
  if (isPartial(body)) {
    return { avatarUrl: body.avatarUrl, settings: null };
  }
  const { avatarUrl, ...settings } = body;
  return { avatarUrl, settings };
}
