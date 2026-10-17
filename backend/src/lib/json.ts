/** JSON replacer: BigInt amounts are sent as strings so no precision is lost in transit. */
export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
