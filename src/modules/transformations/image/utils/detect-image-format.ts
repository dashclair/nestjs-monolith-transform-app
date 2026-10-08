import type { ImageFormat } from '../../core/types';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// Root element `svg`, optionally namespace-prefixed (`<svg:svg`), followed by
// whitespace, `>`, `/>` or the end of the head.
const SVG_ROOT = /^<(?:[A-Za-z_][\w.-]*:)?svg(?:[\s/>]|$)/;

// Content only: raster formats have reliable signatures, and SVG is
// recognised by its root element. Only answers "which format is this" —
// validity and safety are checked on the full body later (PARSE_ERROR /
// UNSAFE_CONTENT), so nothing here throws.
export function detectImageFormat(head: Buffer): ImageFormat | null {
  if (startsWith(head, PNG_SIGNATURE)) {
    return 'png';
  }

  if (startsWith(head, JPEG_SIGNATURE)) {
    return 'jpeg';
  }

  if (isSvg(head)) {
    return 'svg';
  }

  return null;
}

function startsWith(head: Buffer, signature: Buffer): boolean {
  return (
    head.length >= signature.length &&
    head.subarray(0, signature.length).equals(signature)
  );
}

function isSvg(head: Buffer): boolean {
  if (head.includes(0x00)) {
    return false;
  }

  const bytes = startsWith(head, UTF8_BOM) ? head.subarray(3) : head;

  let text: string;

  try {
    // stream: true buffers a multi-byte character cut off at the end of the
    // head instead of failing on it; any other invalid byte still throws.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, {
      stream: true,
    });
  } catch {
    return false;
  }

  const root = skipProlog(text);

  return root !== null && SVG_ROOT.test(root);
}

// Strips whitespace, the XML declaration (and other processing instructions),
// comments and DOCTYPE in front of the root element. Returns null if one of
// them is not closed within the head.
//
// DOCTYPE is skipped rather than rejected here so such a file is detected as
// SVG and then refused by the safety check as 400 UNSAFE_CONTENT, not 415.
function skipProlog(text: string): string | null {
  let rest = text;

  for (;;) {
    rest = rest.trimStart();

    if (rest.startsWith('<?')) {
      const end = rest.indexOf('?>');
      if (end === -1) return null;
      rest = rest.slice(end + 2);
      continue;
    }

    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->', 4);
      if (end === -1) return null;
      rest = rest.slice(end + 3);
      continue;
    }

    if (rest.startsWith('<!DOCTYPE')) {
      // An internal subset (`[ <!ENTITY …> ]`) contains `>` of its own.
      const subsetStart = rest.indexOf('[');
      const firstClose = rest.indexOf('>');
      const searchFrom =
        subsetStart !== -1 && subsetStart < firstClose
          ? rest.indexOf(']', subsetStart)
          : 0;
      const end = searchFrom === -1 ? -1 : rest.indexOf('>', searchFrom);
      if (end === -1) return null;
      rest = rest.slice(end + 1);
      continue;
    }

    return rest;
  }
}
