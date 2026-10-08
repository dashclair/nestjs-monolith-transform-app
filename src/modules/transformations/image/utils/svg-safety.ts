import { HttpStatus } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { TransformationError } from '../../core/transformation-error';

// Rejection, not sanitization: silently cutting out a <script> and returning
// "almost the same" picture is worse than an honest 400. Runs on the full body
// before sharp/librsvg sees it, so nothing relies on librsvg declining to
// follow a link.

// Active content, or content that embeds another document.
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'handler', // SVG Tiny event handler
  'listener',
  'include', // XInclude — librsvg can read local files through it
]);

// SMIL elements that can rewrite an attribute (e.g. href) at render time.
const ANIMATION_ELEMENTS = new Set(['set', 'animate']);

// Resources librsvg loads: only same-document fragments and inline raster
// images; svg+xml would nest a document that this check never sees.
const SAFE_HREF = /^(#|data:image\/(png|jpeg);base64,[a-z0-9+/=\s]*$)/i;
const EMBEDDED_IMAGE = /^data:image\/(?:png|jpeg);base64,/i;
// <a> is a link, never fetched, and a raster output has no links at all —
// only script-ish schemes are refused there.
const SAFE_LINK = /^(#|https?:|mailto:)/i;

const URL_FUNCTION = /url\s*\(\s*(['"]?)\s*([^'")\s]*)/gi;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
// \hex (1–6 digits, one optional whitespace), \newline (a line
// continuation inside strings) or \any-other-char.
const CSS_ESCAPE =
  /\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|(\r\n|[\n\r\f])|([\s\S]))/gi;

// XML tokens whose content is not markup. Matched left to right in one pass,
// like an XML tokenizer does, so `<!--` inside a CDATA section (or the other
// way round) cannot swallow real markup that follows it.
const OPAQUE_TOKEN = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;
const XML_DECLARATION = /^<\?xml[\s?]/;

const PARSER = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  htmlEntities: false,
});

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

type XmlNode = Record<string, unknown>;

export interface SvgSafetyOptions {
  // Total width × height of all embedded PNG/JPEG. librsvg decodes those
  // itself, outside sharp's limitInputPixels.
  maxEmbeddedPixels: number;
}

interface WalkState extends SvgSafetyOptions {
  embeddedPixels: number;
}

export function assertSafeSvg(body: Buffer, options: SvgSafetyOptions): void {
  const text = decodeUtf8(body);

  assertSafeProlog(text);

  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    // The validator's message may quote the file — keep only the position.
    const { line, col } = validation.err;
    throw parseError(`Invalid SVG (line ${line} column ${col})`);
  }

  let nodes: XmlNode[];

  try {
    nodes = PARSER.parse(text) as XmlNode[];
  } catch {
    // e.g. fast-xml-parser's nesting limit (maxNestedTags).
    throw parseError('Invalid SVG');
  }

  walk(nodes, { ...options, embeddedPixels: 0 });
}

// Checked on the raw text, before any parser could act on a DOCTYPE.
function assertSafeProlog(text: string): void {
  let markup = '';
  let last = 0;

  for (const token of text.matchAll(OPAQUE_TOKEN)) {
    const [value] = token;

    // Any processing instruction but the XML declaration, e.g.
    // <?xml-stylesheet href="http://…"?>, which librsvg would load.
    if (value.startsWith('<?') && !XML_DECLARATION.test(value)) {
      throw unsafe('Processing instructions are not allowed');
    }

    markup += text.slice(last, token.index);
    last = token.index + value.length;
  }

  markup += text.slice(last);

  // DOCTYPE/ENTITY: XXE and entity-expansion bombs — for librsvg and for the
  // parser below. A `<?` left over is an unterminated instruction.
  if (/<!(DOCTYPE|ENTITY)|<\?/i.test(markup)) {
    throw unsafe(
      'DOCTYPE, entity declarations and processing instructions are not allowed',
    );
  }
}

function walk(nodes: XmlNode[], state: WalkState): void {
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text') {
        continue;
      }

      const name = localName(key);
      const attributes = (node[':@'] ?? {}) as Record<string, string>;
      const children = value as XmlNode[];

      checkElement(name, attributes, state);

      if (name === 'style') {
        for (const child of children) {
          if (typeof child['#text'] === 'string') {
            checkStylesheet(decodeReferences(child['#text']));
          }
        }
      }

      walk(children, state);
    }
  }
}

function checkElement(
  name: string,
  attributes: Record<string, string>,
  state: WalkState,
): void {
  if (FORBIDDEN_ELEMENTS.has(name)) {
    throw unsafe(`<${name}> is not allowed`);
  }

  for (const [rawName, rawValue] of Object.entries(attributes)) {
    const attribute = localName(rawName);
    // librsvg decodes character references (&#106; → j); fast-xml-parser
    // leaves numeric ones as is, so decode before matching.
    const value = decodeReferences(rawValue);

    if (attribute.startsWith('on')) {
      throw unsafe('Event handler attributes are not allowed');
    }

    if (attribute === 'href') {
      checkHref(name, value.trim(), state);
    }

    if (
      ANIMATION_ELEMENTS.has(name) &&
      attribute === 'attributename' &&
      localName(value.trim()) === 'href'
    ) {
      throw unsafe('Animating href is not allowed');
    }

    if (attribute === 'style') {
      checkStylesheet(value);
    } else {
      // Presentation attributes are CSS too: fill="url(…)", filter, mask…
      checkUrls(plainCss(value));
    }
  }
}

function checkHref(element: string, href: string, state: WalkState): void {
  if (element === 'a') {
    if (!SAFE_LINK.test(href)) {
      throw unsafe('Only http(s), mailto and fragment links are allowed');
    }
    return;
  }

  if (!SAFE_HREF.test(href)) {
    throw unsafe('External references are not allowed');
  }

  if (EMBEDDED_IMAGE.test(href)) {
    const data = Buffer.from(href.slice(href.indexOf(',') + 1), 'base64');
    const { width, height } = embeddedImageSize(data);

    state.embeddedPixels += width * height;

    if (state.embeddedPixels > state.maxEmbeddedPixels) {
      throw new TransformationError(
        'DIMENSIONS_EXCEEDED',
        HttpStatus.BAD_REQUEST,
        'Embedded images exceed the allowed pixel count',
      );
    }
  }
}

// style="…" and <style>: everything a presentation attribute can hold, plus
// at-rules.
function checkStylesheet(css: string): void {
  const plain = plainCss(css);

  if (/@import/i.test(plain)) {
    throw unsafe('@import is not allowed');
  }

  checkUrls(plain);
}

// Takes plainCss() output.
function checkUrls(plain: string): void {
  for (const [, , target] of plain.matchAll(URL_FUNCTION)) {
    if (!target.startsWith('#')) {
      throw unsafe('External references are not allowed');
    }
  }
}

// A CSS escape (`\75 rl(` is `url(`) means the same to librsvg's CSS parser
// as the plain text, so patterns are matched on the unescaped, comment-free
// form — instead of refusing every backslash.
function plainCss(css: string): string {
  return unescapeCss(css).replace(CSS_COMMENT, '');
}

function unescapeCss(css: string): string {
  return css.replace(
    CSS_ESCAPE,
    (_match, hex: string | undefined, newline: string | undefined, char) => {
      if (hex !== undefined) {
        const code = parseInt(hex, 16);
        const valid =
          code !== 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
        return valid ? String.fromCodePoint(code) : '�';
      }

      return newline !== undefined ? '' : (char as string);
    },
  );
}

// Width × height from the header alone — nothing is decoded. Same idea as
// sharp's limitInputPixels: a tiny base64 PNG claiming 20000×20000 is caught
// here. Detected by signature, not by the declared data: URI type.
function embeddedImageSize(data: Buffer): { width: number; height: number } {
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(PNG_SIGNATURE) &&
    data.toString('latin1', 12, 16) === 'IHDR'
  ) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }

  if (data[0] === 0xff && data[1] === 0xd8) {
    const size = jpegSize(data);
    if (size) {
      return size;
    }
  }

  // Unmeasurable means unbounded — refuse rather than let librsvg decode it.
  throw parseError('Invalid embedded image');
}

// Walks the JPEG segments up to the first SOFn (frame header).
function jpegSize(data: Buffer): { width: number; height: number } | null {
  let offset = 2;

  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) {
      return null;
    }

    const marker = data[offset + 1];

    // Fill bytes, and markers without a length (TEM, RSTn).
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    // Start of scan before any frame header: not a valid JPEG.
    if (marker === 0xda || marker === 0xd9) {
      return null;
    }

    const length = data.readUInt16BE(offset + 2);
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG extension
      marker !== 0xcc; // DAC

    if (isFrame) {
      if (offset + 9 > data.length) {
        return null;
      }
      return {
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return null;
}

// `svg:script` and `script` are the same element for librsvg; HTML-ish
// casing (`foreignObject`, `ONLOAD`) is normalized too.
function localName(qualified: string): string {
  return qualified.slice(qualified.indexOf(':') + 1).toLowerCase();
}

const NAMED_REFERENCES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function decodeReferences(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/gi,
    (match, hex: string, dec: string, named: string) => {
      if (named) {
        return NAMED_REFERENCES[named.toLowerCase()];
      }

      const code = hex ? parseInt(hex, 16) : Number(dec);
      // An invalid code point would make fromCodePoint throw; keeping the
      // reference as text is still caught by the allow-lists.
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}

function decodeUtf8(body: Buffer): string {
  const bytes =
    body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf
      ? body.subarray(3)
      : body;

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw parseError('SVG must be valid UTF-8');
  }
}

function unsafe(message: string): TransformationError {
  return new TransformationError(
    'UNSAFE_CONTENT',
    HttpStatus.BAD_REQUEST,
    `Unsafe SVG: ${message}`,
  );
}

function parseError(message: string): TransformationError {
  return new TransformationError(
    'PARSE_ERROR',
    HttpStatus.BAD_REQUEST,
    message,
  );
}
