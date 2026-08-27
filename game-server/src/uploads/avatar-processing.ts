import sharp from 'sharp';

/**
 * Turns an arbitrary uploaded byte string into a small, safe, metadata-free
 * square JPEG — or refuses it with a reason.
 *
 * This is the dangerous part of the avatar-upload feature: everything here
 * exists because a file from the internet is not trustworthy. Order matters —
 * the format is read from the actual bytes before sharp ever touches them
 * (docs/TRAPS.md §1: a JPEG named `.png` already shipped and broke an Android
 * build because nothing checked past the extension/Content-Type), and the
 * pixel bound is handed to sharp itself so a small file claiming enormous
 * dimensions — a decompression bomb — is refused from its header rather than
 * fully decoded first.
 */

/** Output is always exactly this — a client never has to branch on shape. */
export const AVATAR_OUTPUT_SIZE = 256;
/** Fixed at the source. Never derived from what was uploaded. */
export const AVATAR_OUTPUT_CONTENT_TYPE = 'image/jpeg';

export type AcceptedFormat = 'jpeg' | 'png' | 'webp';

/**
 * Magic-byte signatures for the three formats this endpoint accepts.
 * Content-Type and filename are never consulted — both are attacker-supplied
 * and neither one is checked by anything downstream that would fail loudly.
 */
const SIGNATURES: Array<{ format: AcceptedFormat; test: (b: Buffer) => boolean }> = [
  // FF D8 FF
  { format: 'jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  // 89 50 4E 47 0D 0A 1A 0A
  {
    format: 'png',
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  // 'RIFF'....'WEBP'
  {
    format: 'webp',
    test: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

/** The real format of `buf`, from its bytes — or null if it is none of the three accepted. */
export function sniffImageFormat(buf: Buffer): AcceptedFormat | null {
  return SIGNATURES.find((s) => s.test(buf))?.format ?? null;
}

/**
 * A ceiling on decoded width/height — a decompression-bomb guard, not a
 * quality choice. Comfortably above any real phone photo, comfortably below
 * what it would take to hurt the process.
 */
export const MAX_INPUT_DIMENSION = 6000;
export const MAX_INPUT_PIXELS = MAX_INPUT_DIMENSION * MAX_INPUT_DIMENSION;

export type AvatarRejectionCode = 'bad_format' | 'too_large_dimensions' | 'decode_failed';

export class AvatarRejected extends Error {
  constructor(
    public readonly code: AvatarRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = 'AvatarRejected';
  }
}

export interface ProcessedAvatar {
  data: Buffer;
  contentType: typeof AVATAR_OUTPUT_CONTENT_TYPE;
}

/**
 * Validate and re-encode an uploaded avatar. Throws `AvatarRejected` for
 * anything that is not a genuine JPEG/PNG/WebP within the size bound, or that
 * sharp otherwise refuses to decode.
 *
 * The output is ALWAYS a freshly re-encoded 256x256 JPEG. Re-encoding, not
 * merely resizing, is what matters: sharp does not carry EXIF, ICC or XMP
 * forward unless `.withMetadata()` is called, and it never is here. That is
 * the whole defence against a phone photo's embedded GPS coordinates, and
 * against any payload smuggled in metadata or a polyglot file — nothing
 * about the input bytes survives into the output beyond the pixels
 * themselves.
 */
export async function processAvatarUpload(input: Buffer): Promise<ProcessedAvatar> {
  const format = sniffImageFormat(input);
  if (!format) {
    throw new AvatarRejected(
      'bad_format',
      'file is not a recognized JPEG, PNG or WebP image',
    );
  }

  try {
    const image = sharp(input, {
      // Checked against the header-declared dimensions before the pixel data
      // is decoded — a crafted file claiming a huge canvas is refused here,
      // not after allocating gigabytes for it.
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
    });

    const data = await image
      // Bake in EXIF orientation before the EXIF block itself is dropped —
      // otherwise a photo taken in portrait re-encodes sideways.
      .rotate()
      .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: 'cover' })
      // No .withMetadata() call: this is what strips EXIF/ICC/XMP. Do not add
      // one without re-reading the class comment above.
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    return { data, contentType: AVATAR_OUTPUT_CONTENT_TYPE };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/exceeds pixel limit|input image exceeds/i.test(message)) {
      throw new AvatarRejected('too_large_dimensions', 'image dimensions are too large');
    }
    // A file that passed the magic-byte sniff but is truncated, corrupt, or a
    // hostile payload sharp itself refuses. Same answer either way: no.
    throw new AvatarRejected('decode_failed', 'image could not be processed');
  }
}
