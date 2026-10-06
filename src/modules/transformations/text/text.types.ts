export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface StructureLimits {
  maxDepth: number;
  maxNodes: number;
}
