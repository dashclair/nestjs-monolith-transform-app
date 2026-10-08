import sharp from 'sharp';

import { TransformationError } from '../../../core/transformation-error';
import { assertSafeSvg } from '../svg-safety';

const NS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const svg = (content: string, attrs = '') =>
  `<svg ${NS} width="10" height="10" ${attrs}>${content}</svg>`;
const BOM = String.fromCharCode(0xfeff);

const MAX_EMBEDDED_PIXELS = 10_000;

function codeOf(source: string | Buffer): string | null {
  try {
    assertSafeSvg(Buffer.isBuffer(source) ? source : Buffer.from(source), {
      maxEmbeddedPixels: MAX_EMBEDDED_PIXELS,
    });
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(TransformationError);
    expect((error as TransformationError).getStatus()).toBe(400);
    return (error as TransformationError).code;
  }
}

const dataUri = (type: 'png' | 'jpeg', data: Buffer) =>
  `data:image/${type};base64,${data.toString('base64')}`;

async function raster(type: 'png' | 'jpeg', width: number, height: number) {
  const image = sharp({
    create: { width, height, channels: 3, background: '#f00' },
  });
  return (type === 'png' ? image.png() : image.jpeg()).toBuffer();
}

// Only a valid header: IHDR claiming width × height, no image data.
function pngHeader(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
  ]);
}

describe('assertSafeSvg', () => {
  let png: string;
  let jpeg: string;

  beforeAll(async () => {
    png = dataUri('png', await raster('png', 10, 10));
    jpeg = dataUri('jpeg', await raster('jpeg', 20, 10));
  });

  describe('accepts', () => {
    it.each([
      ['a plain drawing', svg('<rect width="5" height="5" fill="#f00"/>')],
      [
        'an XML declaration and comments',
        `<?xml version="1.0"?><!-- x -->${svg('')}`,
      ],
      ['a fragment href', svg('<use href="#a"/><use xlink:href="#b"/>')],
      [
        'url(#id) in attributes and style',
        svg('<rect fill="url(#g)" style="mask: url( \'#m\' )"/>'),
      ],
      [
        'a <style> with local refs',
        svg('<style>.a { fill: url(#g) } /* url(http://x) */</style>'),
      ],
      [
        'an animation of a non-href attribute',
        svg('<animate attributeName="opacity" to="0"/>'),
      ],
      ['text mentioning onload', svg('<text>onload=alert(1)</text>')],
      ['a UTF-8 BOM', BOM + svg('')],
      // The false positives the first version had:
      ['an http link', svg('<a href="https://example.com"><rect/></a>')],
      ['a mailto link', svg('<a xlink:href="mailto:a@b.c"><rect/></a>')],
      [
        'a backslash outside CSS',
        svg('<text aria-label="C:\\temp\\file">x</text>'),
      ],
      [
        'a harmless CSS escape',
        svg('<style>.a::before { content: "\\201C" }</style>'),
      ],
      [
        '<!DOCTYPE inside a comment',
        `<!-- based on <!DOCTYPE svg …> -->${svg('')}`,
      ],
      [
        '<!DOCTYPE inside CDATA',
        svg('<style><![CDATA[ /* <!DOCTYPE x> <?php ?> */ ]]></style>'),
      ],
    ])('%s', (_name, source) => {
      expect(codeOf(source)).toBeNull();
    });

    it('inline PNG and JPEG images within the pixel budget', () => {
      expect(
        codeOf(svg(`<image href="${png}"/><image xlink:href="${jpeg}"/>`)),
      ).toBeNull();
    });
  });

  describe('rejects as UNSAFE_CONTENT', () => {
    it.each([
      ['<script>', svg('<script>alert(1)</script>')],
      [
        'a namespaced script',
        svg(
          '<svg:script xmlns:svg="http://www.w3.org/2000/svg">1</svg:script>',
        ),
      ],
      ['<foreignObject>', svg('<foreignObject><div/></foreignObject>')],
      ['<iframe>', svg('<iframe/>')],
      ['<embed>', svg('<embed/>')],
      ['<object>', svg('<object/>')],
      [
        'XInclude',
        svg(
          '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="#x"/>',
        ),
      ],
      ['onload on the root', svg('', 'onload="alert(1)"')],
      ['an upper-case handler', svg('<rect ONCLICK="x"/>')],
      ['an http href', svg('<image xlink:href="http://example.com/a.png"/>')],
      ['a file href', svg('<image href="file:///etc/passwd"/>')],
      ['a relative href', svg('<image href="a.png"/>')],
      ['an http <use>', svg('<use href="https://x/sprite.svg#icon"/>')],
      ['a javascript link', svg('<a href="javascript:alert(1)"><rect/></a>')],
      [
        'an entity-encoded javascript link',
        svg('<a href="&#106;avascript:alert(1)"/>'),
      ],
      [
        'a nested SVG data URI',
        svg('<image href="data:image/svg+xml;base64,PHN2Zy8+"/>'),
      ],
      [
        'url(http) in style',
        svg('<rect style="fill: url(http://x/a.svg#g)"/>'),
      ],
      [
        'url(http) in a presentation attribute',
        svg('<rect filter="url(\'https://x/f.svg#f\')"/>'),
      ],
      [
        'an entity-encoded url() in an attribute',
        svg('<rect fill="&#117;rl(http://x)"/>'),
      ],
      [
        'a CSS-escaped url() in an attribute',
        svg('<rect fill="\\75 rl(//x)"/>'),
      ],
      [
        'url(http) in <style>',
        svg('<style>.a { fill: url(http://x) }</style>'),
      ],
      [
        'url(http) in a CDATA <style>',
        svg('<style><![CDATA[ .a { fill: url(//x) } ]]></style>'),
      ],
      ['@import', svg('<style>@import "http://x/a.css";</style>')],
      ['a CSS-escaped @import', svg('<style>\\@import "//x/a.css";</style>')],
      [
        'a CSS-escaped url() in <style>',
        svg('<style>.a { fill: \\75 rl(http://x) }</style>'),
      ],
      [
        'animating href',
        svg('<set attributeName="xlink:href" to="http://x"/>'),
      ],
      [
        'DOCTYPE',
        `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">${svg('')}`,
      ],
      [
        'an entity declaration',
        `<!DOCTYPE svg [<!ENTITY a "b">]>${svg('&a;')}`,
      ],
      [
        'DOCTYPE right after a comment',
        `<!-- x --><!DOCTYPE svg [<!ENTITY a "b">]>${svg('')}`,
      ],
      [
        'xml-stylesheet',
        `<?xml version="1.0"?><?xml-stylesheet href="http://x/a.css"?>${svg('')}`,
      ],
      [
        'a processing instruction after a comment',
        `<!-- <?xml-stylesheet ?> --><?xml-stylesheet href="//x"?>${svg('')}`,
      ],
    ])('%s', (_name, source) => {
      expect(codeOf(source)).toBe('UNSAFE_CONTENT');
    });
  });

  describe('embedded image pixel budget', () => {
    it('rejects a small PNG whose header claims a huge size', () => {
      const bomb = dataUri('png', pngHeader(20_000, 20_000));

      expect(codeOf(svg(`<image href="${bomb}"/>`))).toBe(
        'DIMENSIONS_EXCEEDED',
      );
    });

    it('counts the total of all embedded images', async () => {
      // 60×60 = 3600 each: two fit into 10000, three do not.
      const tile = dataUri('png', await raster('png', 60, 60));
      const images = (n: number) =>
        svg(
          Array.from({ length: n }, () => `<image href="${tile}"/>`).join(''),
        );

      expect(codeOf(images(2))).toBeNull();
      expect(codeOf(images(3))).toBe('DIMENSIONS_EXCEEDED');
    });

    it('reads the JPEG frame header', async () => {
      const large = dataUri('jpeg', await raster('jpeg', 200, 100));

      expect(codeOf(svg(`<image href="${large}"/>`))).toBe(
        'DIMENSIONS_EXCEEDED',
      );
    });

    it.each([
      ['a bare PNG signature', 'data:image/png;base64,iVBORw0KGgo='],
      ['a truncated JPEG', 'data:image/jpeg;base64,/9j/4AAQ'],
      ['not an image', 'data:image/png;base64,aGVsbG8gd29ybGQ='],
    ])('rejects %s it cannot measure as PARSE_ERROR', (_name, uri) => {
      expect(codeOf(svg(`<image href="${uri}"/>`))).toBe('PARSE_ERROR');
    });
  });

  it.each([
    ['unclosed tags', `<svg ${NS}><rect`],
    ['mismatched tags', `<svg ${NS}><g></svg>`],
    [
      'invalid UTF-8',
      Buffer.concat([Buffer.from(svg('')), Buffer.from([0xc3, 0x28])]),
    ],
  ])('rejects %s as PARSE_ERROR', (_name, source) => {
    expect(codeOf(source)).toBe('PARSE_ERROR');
  });
});
