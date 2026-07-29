import {
  decodeDPaymentError,
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
import {
  hexlify,
  NonceManager,
  randomBytes,
} from "ethers";

import {
  D402_CANONICAL_SALT,
  derivePaymentId,
} from "../core/index.js";
import type {
  Address,
  D402PaymentRequest,
  Hex32,
} from "../core/index.js";
import {
  D402ConfigurationError,
  D402PaymentExecutionError,
} from "./errors.js";
import { D402_DEFAULT_CONFIRMATIONS } from "../runtime/defaults.js";
import { createPinnedDPayments } from "../runtime/dpayments.js";
import { emitLog, NoopLogger } from "../runtime/logger.js";
import { findPaymentCreatedEvent } from "../runtime/payment-events.js";
import type { D402Logger } from "../runtime/logger.js";
import type {
  D402CreatedPayment,
  D402PaymentActionResult,
  D402PaymentExecutor,
} from "./types.js";

export interface CreateDPaymentsExecutorOptions {
  signer: Signer;
  provider: AbstractProvider;
  confirmations?: number;
  logger?: D402Logger;
}

export function createDPaymentsExecutor(
  options: CreateDPaymentsExecutorOptions,
): D402PaymentExecutor {
  const signer = new NonceManager(options.signer);
  const queuedOptions = {
    ...options,
    signer,
    logger: options.logger ?? NoopLogger,
  };
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
    const payerAddress =
      await options.signer.getAddress() as Address;
    const paymentSalt = paymentRequest.paymentSalt ?? createPaymentSalt();
    const paymentId = derivePaymentId(
      paymentRequest,
      payerAddress,
      paymentSalt,
    );
    const preparedPayment = await preparePayment(
      options,
      paymentRequest,
      paymentId,
    );
    if (
      preparedPayment.payerAddress.toLowerCase() !==
      payerAddress.toLowerCase()
    ) {
      throw new D402PaymentExecutionError(
        "Signer address changed during dPayment preparation.",
      );
    }
    const confirmations = options.confirmations ??
      D402_DEFAULT_CONFIRMATIONS;

    if ("approvalTx" in preparedPayment) {
      const approvalResponse = await broadcastInQueue(() =>
        sendPreparedTx(
          options.provider,
          options.signer,
          preparedPayment.approvalTx,
        ),
      );
      await waitForSuccessfulReceipt(approvalResponse, confirmations);
    }

    const createResponse = await broadcastInQueue(() =>
      sendPreparedTx(
        options.provider,
        options.signer,
        preparedPayment.creationTx,
      ),
    );
    const receipt = await waitForSuccessfulReceipt(
      createResponse,
      confirmations,
    );
    const paymentAddress = extractPaymentAddressFromReceipt(
      receipt,
      paymentRequest,
      preparedPayment.creationTx.to,
      payerAddress,
      paymentId,
    );

    return {
      paymentId,
      paymentAddress,
      txHash: receipt.hash as Hex32,
      paymentSalt,
      payerAddress,
    };
  } catch (cause) {
    throw paymentExecutionError("Could not create dPayment.", cause);
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
  paymentId: Hex32,
): Promise<PreparedDpayment> {
  const payerAddress = await options.signer.getAddress();
  const dpayments = await createPinnedDPayments({
    provider: options.provider,
    walletAddress: payerAddress,
  });
  const prepared = paymentRequest.tokenAddress === null
    ? await dpayments.factory.prepareCreateEthPayment({
        paymentId,
        netAmount: BigInt(paymentRequest.netAmount),
        payeeAddress: paymentRequest.payeeAddress,
        settlementTimeUnixSec: BigInt(paymentRequest.settlementTimeUnixSec),
      })
    : await dpayments.factory.prepareCreateErc20Payment({
        paymentId,
        tokenAddress: paymentRequest.tokenAddress,
        netAmount: BigInt(paymentRequest.netAmount),
        payeeAddress: paymentRequest.payeeAddress,
        settlementTimeUnixSec: BigInt(paymentRequest.settlementTimeUnixSec),
      });

  if (
    prepared.paymentId.toLowerCase() !==
    paymentId.toLowerCase()
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

function createPaymentSalt(): Hex32 {
  let paymentSalt: Hex32;
  do {
    paymentSalt = hexlify(randomBytes(32)) as Hex32;
  } while (paymentSalt === D402_CANONICAL_SALT);
  return paymentSalt;
}

async function sendPaymentAction(
  options: CreateDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  action: "settle",
  broadcastInQueue: BroadcastInQueue,
): Promise<D402PaymentActionResult> {
  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart(
      options.logger ?? NoopLogger,
      action,
      payment,
      walletAddress,
    );
    const dpayments = await createPinnedDPayments({
      provider: options.provider,
      walletAddress,
    });
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const tx = action === "settle"
      ? dPayment.settle(walletAddress)
      : unreachable(action);
    const response = await broadcastInQueue(() =>
      sendPreparedTx(options.provider, options.signer, tx),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );
    emitLog(options.logger ?? NoopLogger, {
      level: "info",
      event: "payment.action.confirmed",
      message: "Payment action confirmed.",
      context: {
        action,
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        walletAddress,
        txHash: receipt.hash,
      },
    });

    return { txHash: receipt.hash as Hex32 };
  } catch (cause) {
    const decoded = decodeDPaymentError(cause);
    logPaymentActionFailure(
      options.logger ?? NoopLogger,
      action,
      payment,
      cause,
      decoded,
    );
    throw paymentExecutionError("Could not settle dPayment.", cause, decoded);
  }
}

async function raisePaymentDispute(
  options: CreateDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  broadcastInQueue: BroadcastInQueue,
): Promise<D402PaymentActionResult> {
  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart(options.logger ?? NoopLogger, "dispute", payment, walletAddress);
    const dpayments = await createPinnedDPayments({
      provider: options.provider,
      walletAddress,
    });
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const current = await dPayment.read();
    emitLog(options.logger ?? NoopLogger, {
      level: "debug",
      event: "payment.dispute.precheck",
      message: "Payment dispute precheck completed.",
      context: {
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        walletAddress,
        state: current.state,
      },
    });
    const prepared = await dPayment.prepareRaiseDispute(walletAddress);
    emitLog(options.logger ?? NoopLogger, {
      level: "debug",
      event: "payment.dispute.prepared",
      message: "Payment dispute transaction prepared.",
      context: {
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        walletAddress,
      },
    });
    const response = await broadcastInQueue(() =>
      sendPreparedTx(options.provider, options.signer, prepared.tx),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );
    emitLog(options.logger ?? NoopLogger, {
      level: "info",
      event: "payment.dispute.confirmed",
      message: "Payment dispute confirmed.",
      context: {
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        walletAddress,
        txHash: receipt.hash,
      },
    });

    return { txHash: receipt.hash as Hex32 };
  } catch (cause) {
    const decoded = decodeDPaymentError(cause);
    logPaymentActionFailure(
      options.logger ?? NoopLogger,
      "dispute",
      payment,
      cause,
      decoded,
    );
    throw paymentExecutionError(
      "Could not raise dPayment dispute.",
      cause,
      decoded,
    );
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
    logPaymentActionStart(
      options.logger ?? NoopLogger,
      "submit-evidence",
      payment,
      walletAddress,
    );
    const dpayments = await createPinnedDPayments({
      provider: options.provider,
      walletAddress,
    });
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const tx = dPayment.submitEvidence(evidenceUri, walletAddress);
    const response = await broadcastInQueue(() =>
      sendPreparedTx(options.provider, options.signer, tx),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );

    emitLog(options.logger ?? NoopLogger, {
      level: "info",
      event: "payment.evidence.confirmed",
      message: "Payment evidence submission confirmed.",
      context: {
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        walletAddress,
        txHash: receipt.hash,
      },
    });

    return { txHash: receipt.hash as Hex32 };
  } catch (cause) {
    const decoded = decodeDPaymentError(cause);
    logPaymentActionFailure(
      options.logger ?? NoopLogger,
      "submit-evidence",
      payment,
      cause,
      decoded,
    );
    throw paymentExecutionError(
      "Could not submit dPayment evidence.",
      cause,
      decoded,
    );
  }
}

function paymentExecutionError(
  message: string,
  cause: unknown,
  decoded = decodeDPaymentError(cause),
): D402PaymentExecutionError {
  if (cause instanceof D402PaymentExecutionError) {
    return cause;
  }

  const decodedMessage = decoded !== null && "error" in decoded
    ? `${message} dPayments reverted with ${decoded.error}.`
    : message;

  return new D402PaymentExecutionError(decodedMessage, { cause });
}

async function sendPreparedTx(
  provider: AbstractProvider,
  signer: Signer,
  tx: PreparedTx,
): Promise<TransactionResponse> {
  const request = toTransactionRequest(tx);
  const from = await signer.getAddress();
  const gasLimit = await provider.estimateGas({
    ...request,
    from,
  });

  return signer.sendTransaction({
    ...request,
    gasLimit,
  });
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
  paymentId: Hex32,
): Address {
  const events = new PaymentEvents();
  const createdEvent = findPaymentCreatedEvent({
    logs: receipt.logs,
    factoryAddress,
    paymentId,
    creator: payerAddress,
    payee: paymentRequest.payeeAddress,
    decoder: events,
  });

  if (createdEvent === undefined) {
    throw new D402PaymentExecutionError(
      "DPayments create transaction did not emit PaymentCreated.",
    );
  }

  if (createdEvent.paymentId.toLowerCase() !== paymentId.toLowerCase()) {
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
  logger: D402Logger,
  action: "settle" | "dispute" | "submit-evidence",
  payment: D402CreatedPayment,
  walletAddress: string,
): void {
  emitLog(logger, {
    level: "debug",
    event: "payment.action.started",
    message: "Payment action started.",
    context: {
      action,
      paymentId: payment.paymentId,
      paymentAddress: payment.paymentAddress,
      walletAddress,
    },
  });
}

function logPaymentActionFailure(
  logger: D402Logger,
  action: "settle" | "dispute" | "submit-evidence",
  payment: D402CreatedPayment,
  cause: unknown,
  decoded: ReturnType<typeof decodeDPaymentError>,
): void {
  emitLog(logger, {
    level: "error",
    event: "payment.action.failed",
    message: "Payment action failed.",
    context: {
      action,
      paymentId: payment.paymentId,
      paymentAddress: payment.paymentAddress,
      ...safeErrorContext(cause),
      ...(decoded !== null && "error" in decoded
        ? { dpaymentsError: decoded.error }
        : {}),
    },
  });
}

function safeErrorContext(error: unknown): Readonly<Record<string, unknown>> {
  if (error === null || typeof error !== "object") return {};

  const known = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
  };

  return {
    ...(typeof known.name === "string" ? { errorName: known.name } : {}),
    ...(typeof known.message === "string"
      ? { errorMessage: known.message }
      : {}),
    ...(typeof known.code === "string" || typeof known.code === "number"
      ? { errorCode: known.code }
      : {}),
  };
}
