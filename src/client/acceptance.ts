import { D402DefaultResponseValidator } from "./types.js";
import type { D402ResponseValidator } from "./types.js";

export function acceptSuccessfulResponse(): D402ResponseValidator {
  return D402DefaultResponseValidator;
}
