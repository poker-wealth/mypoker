import sharp from 'sharp';
import {
  processAvatarUpload,
  sniffImageFormat,
  AvatarRejected,
  AVATAR_OUTPUT_SIZE,
  AVATAR_OUTPUT_CONTENT_TYPE,
  MAX_INPUT_DIMENSION,
} from '../../src/uploads/avatar-processing';

/**
 * The dangerous part of avatar upload, exercised directly against real image
 * bytes — no HTTP, no Mongo, no rate limiter. Every fixture here is built
 * in-memory with sharp itself, so the suite needs no binary test files and
 * runs the same on any machine.
 */

async function makeJpeg(width = 40, height = 40): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 20, b: 20 } } })
    .jpeg()
    .toBuffer();
}

async function makePng(width = 40, height = 40): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 20, g: 200, b: 20, alpha: 1 } } })
    .png()
    .toBuffer();
}

async function makeWebp(width = 40, height = 40): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 20, b: 200 } } })
    .webp()
    .toBuffer();
}

describe('sniffImageFormat', () => {
  it('reads the real format from the bytes for all three accepted types', async () => {
    expect(sniffImageFormat(await makeJpeg())).toBe('jpeg');
    expect(sniffImageFormat(await makePng())).toBe('png');
    expect(sniffImageFormat(await makeWebp())).toBe('webp');
  });

  it('returns null for bytes that are not an image at all', () => {
    expect(sniffImageFormat(Buffer.from('this is definitely not an image'))).toBeNull();
    expect(sniffImageFormat(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for a real image in a format outside the accepted set (TIFF)', async () => {
    // sharp can both write and read TIFF — this is a genuine, decodable
    // image, just not one of the three this endpoint accepts. This is the
    // fixture the mutation test below relies on: unlike garbage bytes, sharp
    // alone would happily accept this, so only the magic-byte allow-list
    // stops it.
    const tiff = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .tiff()
      .toBuffer();
    expect(sniffImageFormat(tiff)).toBeNull();
  });
});

describe('processAvatarUpload', () => {
  it('accepts a valid JPEG and re-encodes it to the fixed output shape', async () => {
    const out = await processAvatarUpload(await makeJpeg());
    expect(out.contentType).toBe(AVATAR_OUTPUT_CONTENT_TYPE);
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(AVATAR_OUTPUT_SIZE);
    expect(meta.height).toBe(AVATAR_OUTPUT_SIZE);
  });

  it('accepts a valid PNG and re-encodes it to a JPEG', async () => {
    const out = await processAvatarUpload(await makePng());
    expect(out.contentType).toBe('image/jpeg');
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(AVATAR_OUTPUT_SIZE);
  });

  it('accepts a valid WebP and re-encodes it to a JPEG', async () => {
    const out = await processAvatarUpload(await makeWebp());
    expect(out.contentType).toBe('image/jpeg');
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(AVATAR_OUTPUT_SIZE);
  });

  it('rejects bytes that are not an image, even with a plausible size', async () => {
    const fake = Buffer.alloc(5000, 0x41); // 5KB of 'A' — not remotely an image
    await expect(processAvatarUpload(fake)).rejects.toMatchObject({
      code: 'bad_format',
    } satisfies Partial<AvatarRejected>);
  });

  it('rejects a real, decodable image outside the accepted formats (TIFF)', async () => {
    const tiff = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .tiff()
      .toBuffer();
    await expect(processAvatarUpload(tiff)).rejects.toThrow(AvatarRejected);
    await expect(processAvatarUpload(tiff)).rejects.toMatchObject({ code: 'bad_format' });
  });

  it('rejects an image whose declared dimensions blow the pixel budget', async () => {
    // A real, valid PNG — just absurdly large. sharp's limitInputPixels
    // refuses this from the header before decoding the (nonexistent, since
    // sharp only synthesizes what is asked) pixel data.
    const huge = await sharp({
      create: {
        width: MAX_INPUT_DIMENSION + 500,
        height: MAX_INPUT_DIMENSION + 500,
        channels: 3,
        background: { r: 1, g: 1, b: 1 },
      },
    })
      .png()
      .toBuffer();

    await expect(processAvatarUpload(huge)).rejects.toMatchObject({
      code: 'too_large_dimensions',
    } satisfies Partial<AvatarRejected>);
  }, 20_000);

  it('strips EXIF from the output — never carried forward by re-encoding', async () => {
    // A phone photo's GPS coordinates live inside the same EXIF APP1 segment
    // as every other tag — sharp's simplified withExif() only exposes the
    // four top-level IFDs (no separate "GPS" key in its type), so this
    // fixture writes a GPS-shaped tag into IFD0 to stand in for it. What
    // matters for this test is the mechanism: re-encoding without
    // .withMetadata() drops the WHOLE EXIF marker, GPS included, not that any
    // one tag name is special-cased.
    const withExif = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .withExif({
        IFD0: {
          Make: 'TestCam',
          GPSLatitude: '51/1 30/1 0/1',
          GPSLongitude: '0/1 7/1 0/1',
        },
      })
      .jpeg()
      .toBuffer();

    // Sanity check the fixture actually carries EXIF before processing.
    const inputMeta = await sharp(withExif).metadata();
    expect(inputMeta.exif).toBeDefined();

    const out = await processAvatarUpload(withExif);
    const outputMeta = await sharp(out.data).metadata();

    expect(outputMeta.exif).toBeUndefined();
    expect(outputMeta.icc).toBeUndefined();
    expect(outputMeta.xmp).toBeUndefined();
  });
});
