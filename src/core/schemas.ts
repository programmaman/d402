import { getAddress, isHexString } from "ethers";
import { z } from "zod";

import {
  D402_CANONICAL_SALT,
  D402_VERSION,
} from "./constants.js";
import type {
  Address,
  D402Agreement,
  D402PaymentChallenge,
  D402PaymentProof,
  D402PaymentRequest,
  D402RefundRequest,
  D402RefundRoute,
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

export const paymentRequestSchema = z
  .object({
    version: z.literal(D402_VERSION),
    resource: z.string().trim().min(1, { message: "must not be blank" }),
    method: z
      .string()
      .trim()
      .min(1, { message: "must not be blank" })
      .transform((value) => value.toUpperCase())
      .optional(),
    chainId: z.number().int().positive().safe(),
    payeeAddress: addressSchema,
    tokenAddress: z.union([addressSchema, z.null()]),
    netAmount: positiveDecimalStringSchema,
    settlementTimeUnixSec: positiveDecimalStringSchema,
    agreement: agreementSchema,
    expiresAtUnixSec: z.number().int().positive().safe(),
    paymentSalt: z.literal(D402_CANONICAL_SALT).optional(),
  })
  .strict()
  .transform((parsed): D402PaymentRequest => {
    const {
      method,
      paymentSalt,
      ...request
    } = parsed;

    return {
      ...request,
      ...(method !== undefined ? { method } : {}),
      ...(paymentSalt !== undefined ? { paymentSalt } : {}),
    };
  });

export const blockReferenceSchema = z
  .object({
    blockNumber: z.number().int().nonnegative().safe(),
    blockHash: hex32Schema,
    blockTimestampUnixSec: decimalStringSchema,
  })
  .strict();

export const paymentRequiredReasonSchema = z
  .object({
    code: z.literal("missing-proof"),
    category: z.enum(["proof", "request", "chain", "policy"]),
    retryable: z.boolean(),
    message: z.string().optional(),
  })
  .strict();

export const refundsSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, { message: "must not be blank" }),
  })
  .strict()
  .transform((parsed): D402RefundRoute => ({ url: parsed.url }));

export const paymentChallengeSchema = z
  .object({
    paymentRequest: paymentRequestSchema,
    settlementReference: blockReferenceSchema.optional(),
    reason: paymentRequiredReasonSchema,
    refunds: refundsSchema.optional(),
  })
  .strict() as z.ZodType<D402PaymentChallenge>;

export const dPaymentProofSchema = z
  .object({
    version: z.literal(D402_VERSION),
    paymentAddress: addressSchema,
    txHash: hex32Schema,
    paymentSalt: hex32Schema,
  })
  .strict();

export const d402PaymentProofSchema = z
  .object({
    dPaymentProof: dPaymentProofSchema,
    settlementReference: blockReferenceSchema.optional(),
  })
  .strict() as z.ZodType<D402PaymentProof>;

export const refundRequestSchema = z
  .object({
    paymentRequest: paymentRequestSchema,
    paymentProof: d402PaymentProofSchema,
    reason: z.string().trim().min(1, { message: "must not be blank" }).optional(),
  })
  .strict() as z.ZodType<D402RefundRequest>;

export const paymentActionResultSchema = z
  .object({
    txHash: hex32Schema,
  })
  .strict();
