/**
 * Fails if an image asset's extension lies about its real format.
 *
 * Metro bundles by bytes, not by content: it never opens an image to check what it actually is,
 * so a JPEG saved as `.png` sails through `tsc --noEmit` and `npx expo export` without a peep.
 * Android's AAPT is not so relaxed — `mergeReleaseResources` genuinely compiles each drawable as
 * the format its extension claims, and rejects a mislabelled file outright. That is exactly what
 * happened to `mobile/assets/brand/dou_di_zhu.png`: a JPEG copied from `frontend/public/brand/`
 * (where browsers sniff content and never notice), which built fine locally and then failed a
 * five-minute EAS cloud build with "file failed to compile" — the only place anything caught it.
 *
 * This check reads the first 12 bytes of every image under `mobile/assets/` and compares the
 * real format (from its magic number) against what the extension claims. It runs in milliseconds
 * locally, so this exact bug never has to cost another cloud build again.
 *
 * Run: npm run check:assets
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const assetsRoot = join(here, '..', 'assets');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** Real format identified from a file's magic number, or null if unrecognised. */
function identifyFormat(bytes) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/** The format an extension claims, normalized so .jpg and .jpeg are the same format. */
function extensionFormat(ext) {
  const e = ext.toLowerCase();
  if (e === '.png') return 'png';
  if (e === '.jpg' || e === '.jpeg') return 'jpeg';
  if (e === '.gif') return 'gif';
  if (e === '.webp') return 'webp';
  return null;
}

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (IMAGE_EXTENSIONS.has(extname(entry).toLowerCase())) {
      files.push(full);
    }
  }
}

const files = [];
walk(assetsRoot, files);
files.sort();

const problems = [];
for (const file of files) {
  const fd = readFileSync(file);
  const header = fd.subarray(0, 12);
  const ext = extname(file);
  const claimed = extensionFormat(ext);
  const actual = identifyFormat(header);

  if (actual === null) {
    console.log(`check:assets — ${file}: unrecognised format`);
    problems.push(`  ${file} (extension ${ext}) — magic number not recognised as any known image format.`);
    continue;
  }

  if (actual !== claimed) {
    console.log(`check:assets — ${file}: extension says ${ext}, contents are ${actual}`);
    problems.push(`  ${file} — extension is ${ext} but the file is actually ${actual}.`);
  } else {
    console.log(`check:assets — ${file}: ok (${actual})`);
  }
}

if (problems.length > 0) {
  console.error(`\ncheck:assets — ${problems.length} file(s) mislabelled:\n`);
  console.error(problems.join('\n'));
  console.error('\nMetro will bundle these fine; Android AAPT will not. Fix the extension or the file.');
  process.exit(1);
}

console.log(`\nassets ok — ${files.length} files, all extensions match their contents`);
