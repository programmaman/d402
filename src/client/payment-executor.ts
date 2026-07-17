import {
  PaymentEvents,
  ZERO_ADDRESS,
} from "@rakelabs/dpayments-sdk";
import type {
  DPayments,
  PrepareCreateErc20Result,
} from "@rakelabs/dpayments-sdk";
import type {
  PreparedTx,
} from "@rakelabs/dpayments-sdk";
import type {
  AbstractProvider,
  Signer,
  TransactionReceipt,
  TransactionRequest,
  TransactionResponse,
} from "ethers";
import { NonceManager } from "ethers";

import type { Address, D402PaymentRequest, Hex32 } from "../core/index.js";
import {
  D402ConfigurationError,
  D402PaymentExecutionError,
} from "./errors.js";
import { D402_DEFAULT_CONFIRMATIONS } from "../runtime/defaults.js";
import { createPinnedDPayments } from "../runtime/dpayments.js";
import { findPaymentCreatedEvent } from "../runtime/payment-events.js";
import type {
  D402CreatedPayment,
  D402PaymentActionResult,
  D402PaymentExecutor,
} from "./types.js";

export interface CreateDPaymentsExecutorOptions {
  signer: Signer;
  provider: AbstractProvider;
  paymentConfirmations?: number;
  resolutionConfirmations?: number;
}

export function createDPaymentsExecutor(
  options: CreateDPaymentsExecutorOptions,
): D402PaymentExecutor {
  const signer = new NonceManager(options.signer);
  const queuedOptions = { ...options, signer };
  let broadcastQueue: Promise<unknown> = Promise.resolve();

  async function broadcastInQueue<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = broadcastQueue;
    const current = (async () => {
      await previous.catch(() => {});

      try {
        return await operation();
      } catch (error) {
        signer.reset();
        throw error;
      }
    })();

    broadcastQueue = current;
    return current;
  }

  return {
    async createPayment(paymentRequest) {
      return createDPaymentsPayment(
        queuedOptions,
        paymentRequest,
        broadcastInQueue,
      );
    },
    async settlePayment(payment) {
      return sendPaymentAction(
        queuedOptions,
        payment,
        "settle",
        broadcastInQueue,
      );
    },
    async disputePayment(payment) {
      return raisePaymentDispute(
        queuedOptions,
        payment,
        broadcastInQueue,
      );
    },
    async submitEvidence(payment, evidenceUri) {
      return submitPaymentEvidence(
        queuedOptions,
        payment,
        evidenceUri,
        broadcastInQueue,
      );
    },
  };
}

type BroadcastInQueue = <T>(
  operation: () => Promise<T>,
) => Promise<T>;

type PreparedDpaymentSdkResult =
  | Awaited<ReturnType<DPayments["factory"]["prepareCreateEthPayment"]>>
  | Awaited<ReturnType<DPayments["factory"]["prepareCreateErc20Payment"]>>;

type PreparedNativeDpayment = {
  paymentRequest: D402PaymentRequest;
  payerAddress: string;
  creationTx: PreparedTx;
};

type PreparedErc20Dpayment = {
  paymentRequest: D402PaymentRequest;
  payerAddress: string;
  approvalTx: PreparedTx;
  creationTx: PreparedTx;
};

type PreparedDpayment =
  | PreparedNativeDpayment
  | PreparedErc20Dpayment;

async function createDPaymentsPayment(
  options: CreateDPaymentsExecutorOptions,
  paymentRequest: D402PaymentRequest,
  broadcastInQueue: BroadcastInQueue,
): Promise<D402CreatedPayment> {
  try {
    const preparedPayment = await preparePayment(options, paymentRequest);
    const confirmations = options.paymentConfirmations ??
      D402_DEFAULT_CONFIRMATIONS;

    if ("approvalTx" in preparedPayment) {
      const approvalResponse = await broadcastInQueue(() =>
        sendPreparedTx(options.signer, preparedPayment.approvalTx),
      );
      await waitForSuccessfulReceipt(approvalResponse, confirmations);
    }

    const createResponse = await broadcastInQueue(() =>
      sendPreparedTx(options.signer, preparedPayment.creationTx),
    );
    const receipt = await waitForSuccessfulReceipt(
      createResponse,
      confirmations,
    );
    const paymentAddress = extractPaymentAddressFromReceipt(
      receipt,
      paymentRequest,
      preparedPayment.creationTx.to,
      preparedPayment.payerAddress,
    );

    return {
      paymentId: paymentRequest.paymentId,
      paymentAddress,
      txHash: receipt.hash as Hex32,
      payerAddress: preparedPayment.payerAddress as Address,
    };
  } catch (cause) {
    if (cause instanceof D402PaymentExecutionError) {
      throw cause;
    }

    throw new D402PaymentExecutionError("Could not create dPayment.", {
      cause,
    });
  }
}

function isErc20PreparedPayment(
  prepared: PreparedDpaymentSdkResult,
): prepared is PrepareCreateErc20Result {
  return "approveTx" in prepared;
}

async function preparePayment(
  options: CreateDPaymentsExecutorOptions,
  paymentRequest: D402PaymentRequest,
): Promise<PreparedDpayment> {
  const payerAddress = await options.signer.getAddress();
  const dpayments = await createDPayments(options, payerAddress);
  const prepared = paymentRequest.tokenAddress === null
    ? await dpayments.factory.prepareCreateEthPayment({
        paymentId: paymentRequest.paymentId,
        netAmount: BigInt(paymentRequest.netAmount),
        payeeAddress: paymentRequest.payeeAddress,
        settlementTimeUnixSec: BigInt(paymentRequest.settlementTimeUnixSec),
      })
    : await dpayments.factory.prepareCreateErc20Payment({
        paymentId: paymentRequest.paymentId,
        tokenAddress: paymentRequest.tokenAddress,
        netAmount: BigInt(paymentRequest.netAmount),
        payeeAddress: paymentRequest.payeeAddress,
        settlementTimeUnixSec: BigInt(paymentRequest.settlementTimeUnixSec),
      });

  if (
    prepared.paymentId.toLowerCase() !==
    paymentRequest.paymentId.toLowerCase()
  ) {
    throw new D402PaymentExecutionError(
      "dPayment ID does not match d402 payment ID.",
    );
  }

  if (isErc20PreparedPayment(prepared)) {
    return {
      paymentRequest,
      payerAddress,
      approvalTx: prepared.approveTx,
      creationTx: prepared.createTx,
    };
  }

  return {
    paymentRequest,
    payerAddress,
    creationTx: prepared.tx,
  };
}

async function sendPaymentAction(
  options: CreateDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  action: "settle",
  broadcastInQueue: BroadcastInQueue,
): Promise<D402PaymentActionResult> {
  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart(action, payment, walletAddress);
    const dpayments = await createDPayments(options, walletAddress);
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const tx = action === "settle"
      ? dPayment.settle(walletAddress)
      : unreachable(action);
    const response = await broadcastInQueue(() =>
      sendPreparedTx(options.signer, tx),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.resolutionConfirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );
    console.log("[client] payment action confirmed", {
      action,
      paymentId: payment.paymentId,
      paymentAddress: payment.paymentAddress,
      walletAddress,
      txHash: receipt.hash,
    });

    return { txHash: receipt.hash as Hex32 };
  } catch (cause) {
    logPaymentActionFailure(action, payment, cause);
    throw new D402PaymentExecutionError("Could not send payment action.", {
      cause,
    });
  }
}

async function raisePaymentDispute(
  options: CreateDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  broadcastInQueue: BroadcastInQueue,
): Promise<D402PaymentActionResult> {
  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart("dispute", payment, walletAddress);
    const dpayments = await createDPayments(options, walletAddress);
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const current = await dPayment.read();
    console.log("[client] dispute precheck", {
      paymentId: payment.paymentId,
      paymentAddress: payment.paymentAddress,
      walletAddress,
      state: current.state,
    });
    const prepared = await dPayment.prepareRaiseDispute(walletAddress);
    console.log("[client] dispute transaction prepared", {
      paymentId: payment.paymentId,
      paymentAddress: payment.paymentAddress,
      walletAddress,
      txTo: prepared.tx.to,
      txValue: prepared.tx.value,
      chainId: prepared.tx.chainId,
    });
    const response = await broadcastInQueue(() =>
      sendPreparedTx(options.signer, prepared.tx),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.resolutionConfirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );
    console.log("[client] payment dispute confirmed", {
      paymentId: payment.paymentId,
      paymentAddress: payment.paymentAddress,
      walletAddress,
      txHash: receipt.hash,
    });

    return { txHash: receipt.hash as Hex32 };
  } catch (cause) {
    logPaymentActionFailure("dispute", payment, cause);
    throw new D402PaymentExecutionError("Could not raise payment dispute.", {
      cause,
    });
  }
}

async function submitPaymentEvidence(
  options: CreateDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  evidenceUri: string,
  broadcastInQueue: BroadcastInQueue,
): Promise<D402PaymentActionResult> {
  if (evidenceUri.trim().length === 0) {
    throw new D402PaymentExecutionError("Evidence URI must not be empty.");
  }

  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart("submit-evidence", payment, walletAddress);
    const dpayments = await createDPayments(options, walletAddress);
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const tx = dPayment.submitEvidence(evidenceUri, walletAddress);
    const response = await broadcastInQueue(() =>
      sendPreparedTx(options.signer, tx),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.resolutionConfirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );

    console.log("[client] payment evidence submission confirmed", {
      paymentId: payment.paymentId,
      paymentAddress: payment.paymentAddress,
      walletAddress,
      evidenceUri,
      txHash: receipt.hash,
    });

    return { txHash: receipt.hash as Hex32 };
  } catch (cause) {
    logPaymentActionFailure("submit-evidence", payment, cause);
    if (cause instanceof D402PaymentExecutionError) {
      throw cause;
    }

    throw new D402PaymentExecutionError(
      "Could not submit payment evidence.",
      { cause },
    );
  }
}

async function createDPayments(
  options: CreateDPaymentsExecutorOptions,
  walletAddress: string,
): Promise<DPayments> {
  return createPinnedDPayments({
    provider: options.provider,
    walletAddress,
  });
}

async function sendPreparedTx(
  signer: Signer,
  tx: PreparedTx,
): Promise<TransactionResponse> {
  return signer.sendTransaction(toTransactionRequest(tx));
}

async function waitForSuccessfulReceipt(
  response: TransactionResponse,
  confirmations: number,
): Promise<TransactionReceipt> {
  const receipt = await response.wait(confirmations);

  if (receipt === null || receipt.status !== 1) {
    throw new D402PaymentExecutionError("dPayment transaction failed.");
  }

  return receipt;
}

function toTransactionRequest(tx: PreparedTx): TransactionRequest {
  return {
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value),
    chainId: tx.chainId,
  };
}

function extractPaymentAddressFromReceipt(
  receipt: TransactionReceipt,
  paymentRequest: D402PaymentRequest,
  factoryAddress: string,
  payerAddress: string,
): Address {
  const events = new PaymentEvents();
  const createdEvent = findPaymentCreatedEvent({
    logs: receipt.logs,
    factoryAddress,
    paymentId: paymentRequest.paymentId,
    creator: payerAddress,
    payee: paymentRequest.payeeAddress,
    decoder: events,
  });

  if (createdEvent === undefined) {
    throw new D402PaymentExecutionError(
      "DPayments create transaction did not emit PaymentCreated.",
    );
  }

  if (createdEvent.paymentId.toLowerCase() !== paymentRequest.paymentId) {
    throw new D402PaymentExecutionError(
      "PaymentCreated event payment id does not match d402 payment id.",
    );
  }

  if (createdEvent.logAddress.toLowerCase() !== factoryAddress.toLowerCase()) {
    throw new D402PaymentExecutionError(
      "PaymentCreated event factory does not match d402 payment request.",
    );
  }

  if (createdEvent.payee.toLowerCase() !== paymentRequest.payeeAddress) {
    throw new D402PaymentExecutionError(
      "PaymentCreated event payee does not match d402 payment request.",
    );
  }

  if (
    createdEvent.token.toLowerCase() !==
    tokenAddressForChain(paymentRequest.tokenAddress)
  ) {
    throw new D402PaymentExecutionError(
      "PaymentCreated event token does not match d402 payment request.",
    );
  }

  return createdEvent.paymentAddress.toLowerCase() as Address;
}

function tokenAddressForChain(tokenAddress: string | null): string {
  return (tokenAddress ?? ZERO_ADDRESS).toLowerCase();
}

function unreachable(value: never): never {
  void value;
  throw new D402ConfigurationError("Unsupported payment action.");
}

function logPaymentActionStart(
  action: "settle" | "dispute" | "submit-evidence",
  payment: D402CreatedPayment,
  walletAddress: string,
): void {
  console.log("[client] payment action started", {
    action,
    paymentId: payment.paymentId,
    paymentAddress: payment.paymentAddress,
    walletAddress,
  });
}

function logPaymentActionFailure(
  action: "settle" | "dispute" | "submit-evidence",
  payment: D402CreatedPayment,
  cause: unknown,
): void {
  console.error("[client] payment action failed", {
    action,
    paymentId: payment.paymentId,
    paymentAddress: payment.paymentAddress,
    error: describeError(cause),
  });
}

function describeError(error: unknown): Record<string, unknown> {
  if (error === null || typeof error !== "object") {
    return { value: error };
  }

  const result: Record<string, unknown> = {};
  const known = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    reason?: unknown;
    shortMessage?: unknown;
    data?: unknown;
    info?: unknown;
    transaction?: unknown;
    cause?: unknown;
  };

  if (known.name !== undefined) {
    result.name = known.name;
  }
  if (known.message !== undefined) {
    result.message = known.message;
  }
  if (known.code !== undefined) {
    result.code = known.code;
  }
  if (known.reason !== undefined) {
    result.reason = known.reason;
  }
  if (known.shortMessage !== undefined) {
    result.shortMessage = known.shortMessage;
  }
  if (known.data !== undefined) {
    result.data = known.data;
  }
  if (known.transaction !== undefined) {
    result.transaction = known.transaction;
  }
  if (known.info !== undefined) {
    result.info = known.info;
  }
  if (known.cause !== undefined) {
    result.cause = describeError(known.cause);
  }

  return result;
}
