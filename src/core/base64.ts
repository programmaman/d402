export function encodeBase64Url(
  bytes: Uint8Array,
): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return globalThis.btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeBase64Url(
  value: string,
): Uint8Array {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/");

  const remainder = base64.length % 4;

  if (remainder === 1) {
    throw new Error(
      "encoded d402 value has invalid base64url length",
    );
  }

  const binary = globalThis.atob(
    base64 + "=".repeat(
      (4 - remainder) % 4,
    ),
  );

  const bytes = new Uint8Array(
    binary.length,
  );

  for (
    let index = 0;
    index < binary.length;
    index += 1
  ) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
