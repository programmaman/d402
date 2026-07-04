import { getAddress, isHexString } from "ethers";
import { z } from "zod";

import { D402_VERSION } from "./constants.js";
import type {
  Address,
  D402Agreement,
  DecimalString,
  Hex32,
} from "./types.js";

const hex32Error = "must be a 0x-prefixed 32-byte hex string";
const addressError = "must be an EVM address";

export const hex32Schema = z
  .string()
  .refine((value) => isHexString(value, 32), { message: hex32Error })
  .transform((value) => value.toLowerCase() as Hex32);

export const addressSchema = z.string().transform((value, ctx) => {
  try {
    return getAddress(value).toLowerCase() as Address;
  } catch {
    ctx.addIssue({
      code: "custom",
      message: addressError,
    });
    return z.NEVER;
  }
});

export const decimalStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, {
    message: "must be a non-negative bigint decimal string",
  })
  .transform((value) => BigInt(value).toString() as DecimalString);

export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => BigInt(value) > 0n,
  { message: "must be greater than 0" },
);

export const agreementSchema = z
  .object({
    id: z.string().trim().min(1, { message: "must not be blank" }),
    hash: hex32Schema.optional(),
    uri: z.string().trim().min(1, { message: "must not be blank" }).optional(),
  })
  .strict()
  .transform((parsed): D402Agreement => ({
    id: parsed.id,
    ...(parsed.hash !== undefined ? { hash: parsed.hash } : {}),
    ...(parsed.uri !== undefined ? { uri: parsed.uri } : {}),
  }));

export const termsHashInputSchema = z
  .object({
    version: z.literal(D402_VERSION),
    resource: z.string().trim().min(1, { message: "must not be blank" }),
    method: z
      .string()
      .trim()
      .min(1, { message: "must not be blank" })
      .transform((value) => value.toUpperCase())
      .optional(),
    chainId: z.number().int().positive(),
    payeeAddress: addressSchema,
    tokenAddress: z.union([addressSchema, z.null()]),
    netAmount: positiveDecimalStringSchema,
    settlementTimeUnixSec: positiveDecimalStringSchema,
    agreement: agreementSchema,
    expiresAtUnixSec: z.number().int().positive(),
  })
  .strict();

export const paymentRequestSchema = termsHashInputSchema
  .extend({
    termsHash: hex32Schema,
    paymentId: hex32Schema,
  })
  .strict();

export const paymentProofSchema = z
  .object({
    version: z.literal(D402_VERSION),
    paymentId: hex32Schema,
    paymentAddress: addressSchema,
    txHash: hex32Schema,
    payerAddress: addressSchema.optional(),
  })
  .strict();
