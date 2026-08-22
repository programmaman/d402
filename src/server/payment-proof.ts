import {
  D402_PAYMENT_PROOF_HEADER,
  parseD402PaymentProof,
} from "../core/index.js";
import type { D402PaymentProof } from "../core/types.js";

export function decodeD402PaymentProof(value: string): D402PaymentProof {
  if (!value.trim()) {
    throw new Error("encoded d402 payment proof must not be blank");
  }

  const json = new TextDecoder().decode(decodeBase64Url(value));
  return parseD402PaymentProof(JSON.parse(json) as unknown);
}

export function readD402PaymentProofFromRequest(
  request: Request,
  headerName = D402_PAYMENT_PROOF_HEADER,
): D402PaymentProof | undefined {
  const value = request.headers.get(headerName);
  if (value === null) {
    return undefined;
  }

  return decodeD402PaymentProof(value);
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const remainder = base64.length % 4;
  if (remainder === 1) {
    throw new Error("encoded d402 payment proof has invalid base64url length");
  }

  const binary = globalThis.atob(
    base64 + "=".repeat((4 - remainder) % 4),
  );
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
