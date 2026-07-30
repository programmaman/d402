import type { PreparedTx } from "@rakelabs/dpayments-sdk";
import type {
  Signer,
  TransactionReceipt,
  TransactionRequest,
  TransactionResponse,
} from "ethers";
import { isError } from "ethers";

import type { Hex32, PaymentAddress } from "../core/index.js";
import { D402_DEFAULT_CONFIRMATIONS } from "../runtime/defaults.js";
import { createPinnedDPayments } from "../runtime/dpayments.js";
import { emitLog, NoopLogger } from "../runtime/logger.js";
import {
  normalizePaymentExecutionError,
} from "../runtime/payment-execution-error.js";
import type {
  D402PaymentOperation,
} from "../runtime/payment-execution-error.js";
import type {
  PaymentActionResult,
  PaymentAppealResult,
  PaymentActions,
  PaymentConfig,
} from "./types.js";
import type { D402Logger } from "../runtime/logger.js";

type ResolvedPaymentConfig = PaymentConfig & {
  signer: Signer;
  logger: D402Logger;
};

type BroadcastInQueue = <Result>(
  operation: () => Promise<Result>,
) => Promise<Result>;

export function paymentActions(config: PaymentConfig): PaymentActions {
  if (config.signer === undefined) {
    throw new Error(
      "paymentConfig.signer is required for payment actions so the server can broadcast settlement, refund, consumption, evidence, or appeal transactions.",
    );
  }
  const actionConfig: PaymentConfig & {
    signer: Signer;
    logger: D402Logger;
  } = {
    ...config,
    signer: config.signer,
    logger: config.logger ?? NoopLogger,
  };
  let broadcastQueue: Promise<unknown> = Promise.resolve();

  async function broadcastInQueue<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = broadcastQueue;
    const current = (async () => {
      await previous.catch(() => {});
      return operation();
    })();

    broadcastQueue = current;
    return current;
  }

  return {
    settlePayment(payment) {
      return executePaymentOperation(
        actionConfig,
        "settle",
        payment,
        () => sendPaymentAction(
          actionConfig,
          payment,
          "settle",
          broadcastInQueue,
        ),
      );
    },
    refundPayment(payment) {
      return executePaymentOperation(
        actionConfig,
        "refund",
        payment,
        () => sendPaymentAction(
          actionConfig,
          payment,
          "refund",
          broadcastInQueue,
        ),
      );
    },
    consumePayment(payment) {
      return executePaymentOperation(
        actionConfig,
        "consume",
        payment,
        () => sendPaymentAction(
          actionConfig,
          payment,
          "consume",
          broadcastInQueue,
        ),
      );
    },
    submitEvidence(payment, evidenceUri) {
      return executePaymentOperation(
        actionConfig,
        "submit-evidence",
        payment,
        () => sendEvidenceAction(
          actionConfig,
          payment,
          evidenceUri,
          broadcastInQueue,
        ),
      );
    },
    appealPayment(payment) {
      return executePaymentOperation(
        actionConfig,
        "appeal",
        payment,
        () => sendAppealAction(
          actionConfig,
          payment,
          broadcastInQueue,
        ),
      );
    },
  };
}

async function executePaymentOperation<Result>(
  config: ResolvedPaymentConfig,
  operation: D402PaymentOperation,
  paymentAddress: PaymentAddress,
  execute: () => Promise<Result>,
): Promise<Result> {
  try {
    return await execute();
  } catch (cause) {
    const error = normalizePaymentExecutionError({
      operation,
      paymentAddress,
      cause,
    });
    emitLog(config.logger, {
      level: "error",
      event: "payment.execution.failed",
      message: "Payment execution failed.",
      context: {
        operation: error.operation,
        paymentAddress: error.paymentAddress,
        errorName: error.name,
        errorCode: error.code,
        ...(error.dpaymentsError !== undefined
          ? { dpaymentsError: error.dpaymentsError }
          : {}),
        ...(error.transactionError !== undefined
          ? { transactionError: error.transactionError }
          : {}),
      },
    });
    throw error;
  }
}

async function sendPaymentAction(
  config: ResolvedPaymentConfig,
  paymentAddress: PaymentAddress,
  action: "settle" | "refund" | "consume",
  broadcastInQueue: BroadcastInQueue,
): Promise<PaymentActionResult> {
  const walletAddress = await config.signer.getAddress();
  emitLog(config.logger, {
    level: "debug",
    event: "payment.action.started",
    message: "Payment action started.",
    context: {
      action,
      paymentAddress,
      walletAddress,
    },
  });
  const dpayments = await createQuickDPayments(config.provider, walletAddress);
  const dPayment = dpayments.dPayment(paymentAddress);
  const tx = action === "settle"
    ? dPayment.settle(walletAddress)
    : action === "refund"
      ? dPayment.voluntaryRefund(walletAddress)
      : dPayment.consume(walletAddress);
  const receipt = await sendPreparedTx(
    config,
    tx,
    action,
    paymentAddress,
    broadcastInQueue,
  );
  emitLog(config.logger, {
    level: "info",
    event: "payment.action.confirmed",
    message: "Payment action confirmed.",
    context: {
      action,
      paymentAddress,
      walletAddress,
      txHash: receipt.hash,
    },
  });

  return { txHash: receipt.hash as Hex32 };
}

async function sendEvidenceAction(
  config: ResolvedPaymentConfig,
  paymentAddress: PaymentAddress,
  evidenceUri: string,
  broadcastInQueue: BroadcastInQueue,
): Promise<PaymentActionResult> {
  const walletAddress = await config.signer.getAddress();
  emitLog(config.logger, {
    level: "debug",
    event: "payment.evidence.started",
    message: "Payment evidence submission started.",
    context: {
      paymentAddress,
      walletAddress,
    },
  });
  const dpayments = await createQuickDPayments(config.provider, walletAddress);
  const dPayment = dpayments.dPayment(paymentAddress);
  const tx = dPayment.submitEvidence(evidenceUri, walletAddress);
  const receipt = await sendPreparedTx(
    config,
    tx,
    "submit-evidence",
    paymentAddress,
    broadcastInQueue,
  );
  emitLog(config.logger, {
    level: "info",
    event: "payment.evidence.confirmed",
    message: "Payment evidence submission confirmed.",
    context: {
      paymentAddress,
      walletAddress,
      txHash: receipt.hash,
    },
  });

  return { txHash: receipt.hash as Hex32 };
}

async function sendAppealAction(
  config: ResolvedPaymentConfig,
  paymentAddress: PaymentAddress,
  broadcastInQueue: BroadcastInQueue,
): Promise<PaymentAppealResult> {
  const walletAddress = await config.signer.getAddress();
  emitLog(config.logger, {
    level: "debug",
    event: "payment.appeal.started",
    message: "Payment appeal started.",
    context: {
      paymentAddress,
      walletAddress,
    },
  });
  const dpayments = await createQuickDPayments(config.provider, walletAddress);
  const dPayment = dpayments.dPayment(paymentAddress);
  const prepared = await dPayment.prepareAppeal(
    "0x",
    walletAddress,
  );
  const receipt = await sendPreparedTx(
    config,
    prepared.tx,
    "appeal",
    paymentAddress,
    broadcastInQueue,
  );
  emitLog(config.logger, {
    level: "info",
    event: "payment.appeal.confirmed",
    message: "Payment appeal confirmed.",
    context: {
      paymentAddress,
      walletAddress,
      txHash: receipt.hash,
      appealFeeWei: prepared.appealFeeWei.toString(),
      appealPeriodStart: prepared.appealPeriod.start.toString(),
      appealPeriodEnd: prepared.appealPeriod.end.toString(),
    },
  });

  return {
    txHash: receipt.hash as Hex32,
    appealFeeWei: prepared.appealFeeWei,
    appealPeriod: prepared.appealPeriod,
  };
}

async function sendPreparedTx(
  config: ResolvedPaymentConfig,
  tx: PreparedTx,
  operation: D402PaymentOperation,
  paymentAddress: PaymentAddress,
  broadcastInQueue: BroadcastInQueue,
): Promise<TransactionReceipt> {
  const response = await broadcastInQueue(async () => {
    async function attempt(): Promise<TransactionResponse> {
      const request = toTransactionRequest(tx);
      const from = await config.signer.getAddress();
      const gasLimit = await config.provider.estimateGas({
        ...request,
        from,
      });

      return config.signer.sendTransaction({
        ...request,
        gasLimit,
      });
    }

    try {
      return await attempt();
    } catch (error) {
      if (!isError(error, "NONCE_EXPIRED")) {
        throw error;
      }

      emitLog(config.logger, {
        level: "warn",
        event: "payment.transaction.retry",
        message: "Retrying transaction after an expired nonce.",
        context: {
          operation,
          paymentAddress,
          transactionError: "NONCE_EXPIRED",
        },
      });

      // Let ethers' short-lived provider cache expire before asking the
      // integrator's signer to select a nonce for the one recovery attempt.
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });

      return attempt();
    }
  });
  const receipt = await response.wait(
    config.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
  );

  if (receipt === null || receipt.status !== 1) {
    throw new Error(
      "DPayments action transaction failed after broadcast or was not mined successfully.",
    );
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

async function createQuickDPayments(
  provider: PaymentConfig["provider"],
  walletAddress: string,
): ReturnType<typeof createPinnedDPayments> {
  return createPinnedDPayments({
    provider,
    walletAddress,
  });
}
