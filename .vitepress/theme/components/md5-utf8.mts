/**
 * Convert a JavaScript string into the binary-string form expected by the
 * existing MD5 implementation: one character per UTF-8 byte.
 */
export function toUtf8BinaryString(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return binary;
}
