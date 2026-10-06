import { XMLBuilder } from 'fast-xml-parser';
import { TextFormat } from '../../core/types';
import { FormatSerializer } from './format-serializer';
import { JsonValue } from '../text.types';

const ATTRIBUTE_PREFIX = '@_';
const TEXT_NODE = '#text';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  textNodeName: TEXT_NODE,
  format: true,
});

// "First Name" → "First_Name", "1st" → "_1st". Unicode letters are valid in XML names.
const toXmlName = (name: string): string => {
  const replaced = name.replace(/[^\p{L}\p{N}_.:-]/gu, '_');
  return /^[\p{L}_]/u.test(replaced) ? replaced : `_${replaced}`;
};

const sanitizeKeys = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(sanitizeKeys);
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      const name =
        key === TEXT_NODE
          ? key
          : key.startsWith(ATTRIBUTE_PREFIX)
            ? ATTRIBUTE_PREFIX + toXmlName(key.slice(ATTRIBUTE_PREFIX.length))
            : toXmlName(key);
      return [name, sanitizeKeys(inner)];
    }),
  );
};

// A single-key object keeps its key as the root (inverse of XmlParser), unless
// that key holds an array — it would produce several root elements.
const withRoot = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return { root: { item: value } };

  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    const isElement =
      keys.length === 1 &&
      keys[0] !== TEXT_NODE &&
      !keys[0].startsWith(ATTRIBUTE_PREFIX);
    if (isElement && !Array.isArray(value[keys[0]])) return value;
  }

  return { root: value };
};

export class XmlSerializer extends FormatSerializer {
  readonly format: TextFormat = 'xml';
  readonly extension = 'xml';
  readonly mimeType = 'application/xml; charset=utf-8';

  serialize(value: JsonValue): string {
    return DECLARATION + xmlBuilder.build(withRoot(sanitizeKeys(value)));
  }
}
