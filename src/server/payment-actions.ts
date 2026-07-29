import type { PreparedTx } from "@rakelabs/dpayments-sdk";
import type {
  AbstractProvider,
  Signer,
  TransactionReceipt,
  TransactionRequest,
} from "ethers";

import type { Hex32, PaymentAddress } from "../core/index.js";
import { D402_DEFAULT_CONFIRMATIONS } from "../runtime/defaults.js";
import { createPinnedDPayments } from "../runtime/dpayments.js";
import { emitLog, NoopLogger } from "../runtime/logger.js";
import type {
  PaymentActionResult,
  PaymentAppealResult,
  PaymentActions,
  PaymentConfig,
} from "./types.js";
import type { D402Logger } from "../runtime/logger.js";

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

  return {
    settlePayment(payment) {
      return sendPaymentAction(actionConfig, payment, "settle");
    },
    refundPayment(payment) {
      return sendPaymentAction(actionConfig, payment, "refund");
    },
    consumePayment(payment) {
      return sendPaymentAction(actionConfig, payment, "consume");
    },
    submitEvidence(payment, evidenceUri) {
      return sendEvidenceAction(actionConfig, payment, evidenceUri);
    },
    appealPayment(payment) {
      return sendAppealAction(actionConfig, payment);
    },
  };
}

async function sendPaymentAction(
  config: PaymentConfig & { signer: Signer; logger: D402Logger },
  paymentAddress: PaymentAddress,
  action: "settle" | "refund" | "consume",
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
    config.provider,
    config.signer,
    tx,
    config.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
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
  config: PaymentConfig & { signer: Signer; logger: D402Logger },
  paymentAddress: PaymentAddress,
  evidenceUri: string,
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
    config.provider,
    config.signer,
    tx,
    config.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
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
  config: PaymentConfig & { signer: Signer; logger: D402Logger },
  paymentAddress: PaymentAddress,
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
    config.provider,
    config.signer,
    prepared.tx,
    config.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
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
  provider: AbstractProvider,
  signer: Signer,
  tx: PreparedTx,
  confirmations: number,
): Promise<TransactionReceipt> {
  const request = toTransactionRequest(tx);
  const from = await signer.getAddress();
  const gasLimit = await provider.estimateGas({
    ...request,
    from,
  });
  // Leave nonce selection to the signer. Ethers providers predating broadcast
  // cache invalidation can briefly reuse a stale pending nonce or gas estimate
  // after a fast transaction; upgrade ethers if this read-after-write race occurs.
  const response = await signer.sendTransaction({
    ...request,
    gasLimit,
  });
  const receipt = await response.wait(confirmations);

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
