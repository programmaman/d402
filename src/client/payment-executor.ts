import {
  DPayments,
  PaymentEvents,
  ZERO_ADDRESS,
} from "@rakelabs/dpayments-sdk";
import type {
  EvmLog,
  PaymentCreatedEvent,
  PreparedTx,
} from "@rakelabs/dpayments-sdk";
import type {
  AbstractProvider,
  Signer,
  TransactionReceipt,
  TransactionRequest,
} from "ethers";

import type { Address, D402PaymentRequest, Hex32 } from "../core/index.js";
import {
  D402ConfigurationError,
  D402PaymentExecutionError,
} from "./errors.js";
import type {
  D402CreatedPayment,
  D402PaymentActionResult,
  D402PaymentExecutor,
} from "./types.js";

export interface CreateDPaymentsExecutorOptions {
  signer: Signer;
  provider: AbstractProvider;
  factoryAddress?: string;
  paymentConfirmations?: number;
  resolutionConfirmations?: number;
}

export function createDPaymentsExecutor(
  options: CreateDPaymentsExecutorOptions,
): D402PaymentExecutor {
  return {
    async createPayment(paymentRequest) {
      return createDPaymentsPayment(options, paymentRequest);
    },
    async settlePayment(payment) {
      return sendPaymentAction(options, payment, "settle");
    },
    async disputePayment(payment) {
      return raisePaymentDispute(options, payment);
    },
  };
}

async function createDPaymentsPayment(
  options: CreateDPaymentsExecutorOptions,
  paymentRequest: D402PaymentRequest,
): Promise<D402CreatedPayment> {
  try {
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

    if (prepared.paymentId.toLowerCase() !== paymentRequest.paymentId) {
      throw new D402PaymentExecutionError(
        "dPayment ID does not match d402 payment ID.",
      );
    }

    const createTx = "createTx" in prepared ? prepared.createTx : prepared.tx;

    if ("approveTx" in prepared) {
      await sendPreparedTx(
        options.signer,
        prepared.approveTx,
        options.paymentConfirmations ?? 0,
      );
    }

    const receipt = await sendPreparedTx(
      options.signer,
      createTx,
      options.paymentConfirmations ?? 0,
    );
    const paymentAddress = extractPaymentAddressFromReceipt(
      receipt,
      paymentRequest,
      createTx.to,
    );

    return {
      paymentId: paymentRequest.paymentId,
      paymentAddress,
      txHash: receipt.hash as Hex32,
      payerAddress: payerAddress as Address,
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

async function sendPaymentAction(
  options: CreateDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  action: "settle",
): Promise<D402PaymentActionResult> {
  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart(action, payment, walletAddress);
    const dpayments = await createDPayments(options, walletAddress);
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const tx = action === "settle"
      ? dPayment.settle(walletAddress)
      : unreachable(action);
    const receipt = await sendPreparedTx(
      options.signer,
      tx,
      options.resolutionConfirmations ?? 0,
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
    const receipt = await sendPreparedTx(
      options.signer,
      prepared.tx,
      options.resolutionConfirmations ?? 0,
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

async function createDPayments(
  options: CreateDPaymentsExecutorOptions,
  walletAddress: string,
): Promise<DPayments> {
  const network = await options.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (options.factoryAddress !== undefined) {
    return new DPayments({
      chainId,
      factoryAddress: options.factoryAddress,
      provider: options.provider,
      walletAddress,
    });
  }

  return DPayments.fromProvider(options.provider, walletAddress);
}

async function sendPreparedTx(
  signer: Signer,
  tx: PreparedTx,
  confirmations: number,
): Promise<TransactionReceipt> {
  const response = await signer.sendTransaction(toTransactionRequest(tx));
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
): Address {
  const events = new PaymentEvents();
  const createdEvent = receipt.logs
    .map((log) => events.tryDecodePaymentCreated(log as unknown as EvmLog))
    .find((event): event is PaymentCreatedEvent => event !== undefined);

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
  action: "settle" | "dispute",
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
  action: "settle" | "dispute",
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
