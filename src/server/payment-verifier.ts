import {
  FACTORY_ADDRESS,
  PaymentEvents,
  PaymentReader,
  PaymentState,
  ZERO_ADDRESS,
} from "@rakelabs/dpayments-sdk";
import type { AbstractProvider } from "ethers";
import type { EvmLog, PaymentCreatedEvent, PaymentInfo } from "@rakelabs/dpayments-sdk";
import type { MulticallConfig } from "@rakelabs/dpayments-sdk";
import type { D402PaymentProof, D402PaymentRequest } from "../core/index.js";
import type {
  PaymentState as D402PaymentState,
  PaymentVerificationResult,
  PaymentVerifier,
  VerifiedPayment,
} from "./types.js";
import { getConnectedChainId } from "../runtime/chain.js";
import { D402_DEFAULT_CONFIRMATIONS } from "../runtime/defaults.js";
import { getDPaymentsMulticallConfig } from "../runtime/multicall.js";

export interface VerifyPaymentInput<Req = Request> {
  request: Req;
  paymentRequest: D402PaymentRequest;
  proof: D402PaymentProof;
  verifier: PaymentVerifier<Req>;
}

export async function verifyPayment<Req>(
  input: VerifyPaymentInput<Req>,
): Promise<PaymentVerificationResult> {
  const localResult = verifyProofMatchesRequest(input.paymentRequest, input.proof);
  if (!localResult.ok) {
    return localResult;
  }

  return input.verifier({
    request: input.request,
    paymentRequest: input.paymentRequest,
    proof: input.proof,
  });
}

export interface DPaymentsVerifierOptions {
  provider: AbstractProvider;
  minConfirmations?: number;
  /** Trusted private-network or test-chain Multicall3 deployment. */
  multicall?: MulticallConfig;
}

export function createDPaymentsVerifier(
  options: DPaymentsVerifierOptions,
): PaymentVerifier {
  const events = new PaymentEvents();
  const minConfirmations =
    options.minConfirmations ?? D402_DEFAULT_CONFIRMATIONS;
  let connectedChainId: Promise<number> | undefined;
  let reader: Promise<PaymentReader> | undefined;

  function getVerifierChainId(): Promise<number> {
    connectedChainId ??= getConnectedChainId(options.provider);
    return connectedChainId;
  }

  function getVerifierReader(): Promise<PaymentReader> {
    reader ??= getVerifierChainId().then((chainId) =>
      new PaymentReader(
        options.provider,
        options.multicall ?? getDPaymentsMulticallConfig(chainId),
      ),
    );
    return reader;
  }

  return async function verifyDPaymentsPayment({
    paymentRequest,
    proof,
  }): Promise<PaymentVerificationResult> {
    const receiptPromise = readTransactionReceipt(
      options.provider,
      proof.txHash,
    );

    const chainResult = await verifyChain(
      paymentRequest,
      getVerifierChainId(),
    );
    if (!chainResult.ok) {
      return chainResult;
    }

    const paymentInfoPromise = getVerifierReader().then((reader) =>
      readPaymentInfo(reader, proof.paymentAddress),
    );

    const createdEventResult = await verifyPaymentCreatedEvent({
      paymentRequest,
      proof,
      receiptPromise,
      provider: options.provider,
      events,
      minConfirmations,
    });
    if (!createdEventResult.ok) {
      return createdEventResult;
    }

    const paymentInfoResult = await paymentInfoPromise;
    if (!paymentInfoResult.ok) {
      return paymentInfoResult;
    }

    return verifyPaymentInfo(
      paymentRequest,
      proof,
      paymentInfoResult.paymentInfo,
      createdEventResult.confirmations,
    );
  };
}

function verifyProofMatchesRequest(
  paymentRequest: D402PaymentRequest,
  proof: D402PaymentProof,
): PaymentVerificationResult {
  if (proof.paymentId !== paymentRequest.paymentId) {
    return { ok: false, reason: "payment-id-mismatch" };
  }

  return { ok: true };
}

async function verifyChain(
  paymentRequest: D402PaymentRequest,
  connectedChainId: Promise<number>,
): Promise<PaymentVerificationResult> {
  let chainId: number;
  try {
    chainId = await connectedChainId;
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }

  if (chainId !== paymentRequest.chainId) {
    return { ok: false, reason: "wrong-chain" };
  }

  return { ok: true };
}

type TransactionReceipt = NonNullable<
  Awaited<ReturnType<AbstractProvider["getTransactionReceipt"]>>
>;

type TransactionReceiptResult =
  | { ok: true; receipt: TransactionReceipt }
  | {
      ok: false;
      reason: "onchain-payment-not-found" | "provider-error";
      cause?: unknown;
    };

async function readTransactionReceipt(
  provider: AbstractProvider,
  txHash: string,
): Promise<TransactionReceiptResult> {
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt === null) {
      return { ok: false, reason: "onchain-payment-not-found" };
    }

    return { ok: true, receipt };
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }
}

async function verifyPaymentCreatedEvent(input: {
  paymentRequest: D402PaymentRequest;
  proof: D402PaymentProof;
  receiptPromise: Promise<TransactionReceiptResult>;
  provider: AbstractProvider;
  events: PaymentEvents;
  minConfirmations: number;
}): Promise<
  | { ok: true; confirmations?: number }
  | Extract<PaymentVerificationResult, { ok: false }>
> {
  const receiptResult = await input.receiptPromise;
  if (!receiptResult.ok) {
    return receiptResult;
  }

  const { receipt } = receiptResult;

  if (receipt.status !== 1) {
    return { ok: false, reason: "failed-transaction" };
  }

  let confirmations: number | undefined;
  if (input.minConfirmations === 1) {
    // A non-null receipt proves inclusion, which is one confirmation under
    // this verifier's convention. No block-head lookup is needed.
    confirmations = 1;
  } else if (input.minConfirmations > 1) {
    let blockNumber: number;
    try {
      blockNumber = await input.provider.getBlockNumber();
    } catch (cause) {
      return { ok: false, reason: "provider-error", cause };
    }

    confirmations = blockNumber - receipt.blockNumber + 1;
    if (confirmations < input.minConfirmations) {
      return { ok: false, reason: "insufficient-confirmations" };
    }
  }

  const createdEvent = receipt.logs
    .map((log) => input.events.tryDecodePaymentCreated(log as EvmLog))
    .find((event): event is PaymentCreatedEvent => event !== undefined);

  if (createdEvent === undefined) {
    return { ok: false, reason: "missing-created-event" };
  }

  const eventResult = verifyCreatedEvent(
    input.paymentRequest,
    input.proof,
    createdEvent,
  );
  if (!eventResult.ok) {
    return eventResult;
  }

  return {
    ok: true,
    ...(confirmations !== undefined ? { confirmations } : {}),
  };
}

function verifyCreatedEvent(
  paymentRequest: D402PaymentRequest,
  proof: D402PaymentProof,
  event: PaymentCreatedEvent,
): PaymentVerificationResult {
  if (!sameHex(event.paymentId, paymentRequest.paymentId)) {
    return { ok: false, reason: "payment-id-mismatch" };
  }

  if (!sameAddress(event.logAddress, FACTORY_ADDRESS)) {
    return { ok: false, reason: "wrong-factory" };
  }

  if (!sameAddress(event.paymentAddress, proof.paymentAddress)) {
    return { ok: false, reason: "wrong-payment-address" };
  }

  if (!sameAddress(event.payee, paymentRequest.payeeAddress)) {
    return { ok: false, reason: "wrong-payee" };
  }

  if (!sameAddress(event.token, tokenAddressForChain(paymentRequest.tokenAddress))) {
    return { ok: false, reason: "wrong-token" };
  }

  if (event.amount < BigInt(paymentRequest.netAmount)) {
    return { ok: false, reason: "wrong-amount" };
  }

  if (event.settlementTime !== BigInt(paymentRequest.settlementTimeUnixSec)) {
    return { ok: false, reason: "wrong-settlement-time" };
  }

  if (
    proof.payerAddress !== undefined &&
    !sameAddress(event.creator, proof.payerAddress)
  ) {
    return { ok: false, reason: "wrong-payer" };
  }

  return { ok: true };
}

async function readPaymentInfo(
  reader: PaymentReader,
  paymentAddress: string,
): Promise<
  | { ok: true; paymentInfo: PaymentInfo }
  | { ok: false; reason: "provider-error"; cause: unknown }
> {
  try {
    return { ok: true, paymentInfo: await reader.readPayment(paymentAddress) };
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }
}

function verifyPaymentInfo(
  paymentRequest: D402PaymentRequest,
  proof: D402PaymentProof,
  paymentInfo: PaymentInfo,
  confirmations?: number,
): PaymentVerificationResult {
  if (!sameAddress(paymentInfo.paymentAddress, proof.paymentAddress)) {
    return { ok: false, reason: "wrong-payment-address" };
  }

  if (!sameAddress(paymentInfo.payee, paymentRequest.payeeAddress)) {
    return { ok: false, reason: "wrong-payee" };
  }

  if (!sameAddress(paymentInfo.token, tokenAddressForChain(paymentRequest.tokenAddress))) {
    return { ok: false, reason: "wrong-token" };
  }

  if (paymentInfo.amount < BigInt(paymentRequest.netAmount)) {
    return { ok: false, reason: "wrong-amount" };
  }

  if (paymentInfo.settlementTime !== BigInt(paymentRequest.settlementTimeUnixSec)) {
    return { ok: false, reason: "wrong-settlement-time" };
  }

  if (
    proof.payerAddress !== undefined &&
    !sameAddress(paymentInfo.payer, proof.payerAddress)
  ) {
    return { ok: false, reason: "wrong-payer" };
  }

  const state = toD402PaymentState(paymentInfo.state);
  if (!isUsableForAccess(state)) {
    return {
      ok: false,
      reason: state === "disputed" ? "disputed-payment" : "resolved-payment",
    };
  }

  return {
    ok: true,
    payment: buildVerifiedPayment(
      paymentRequest,
      proof,
      paymentInfo,
      state,
      confirmations,
    ),
  };
}

function buildVerifiedPayment(
  paymentRequest: D402PaymentRequest,
  proof: D402PaymentProof,
  paymentInfo: PaymentInfo,
  state: D402PaymentState,
  confirmations?: number,
): VerifiedPayment {
  return {
    paymentId: paymentRequest.paymentId,
    paymentAddress: proof.paymentAddress,
    txHash: proof.txHash,
    ...resolvePayerAddress(proof, paymentInfo),
    state,
    ...(confirmations !== undefined ? { confirmations } : {}),
  };
}

function resolvePayerAddress(
  proof: D402PaymentProof,
  paymentInfo: PaymentInfo,
): Pick<VerifiedPayment, "payerAddress"> | Record<string, never> {
  if (proof.payerAddress !== undefined) {
    return { payerAddress: proof.payerAddress };
  }

  if (!sameAddress(paymentInfo.payer, ZERO_ADDRESS)) {
    return { payerAddress: paymentInfo.payer as VerifiedPayment["payerAddress"] };
  }

  return {};
}

function toD402PaymentState(state: PaymentState): D402PaymentState {
  if (state === PaymentState.PAID) {
    return "funded";
  }

  if (state === PaymentState.SETTLED) {
    return "settled";
  }

  if (state === PaymentState.DISPUTED) {
    return "disputed";
  }

  return "resolved";
}

function isUsableForAccess(state: D402PaymentState): boolean {
  return state === "funded" || state === "settled";
}

function tokenAddressForChain(tokenAddress: string | null): string {
  return tokenAddress ?? ZERO_ADDRESS;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
