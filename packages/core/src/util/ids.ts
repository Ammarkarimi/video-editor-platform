const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Creates a random, URL-safe identifier such as `clp_4fT9xQ2LmN0a`. */
export function createId(prefix: string, length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${prefix}_${out}`;
}

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
