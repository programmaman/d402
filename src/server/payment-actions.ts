import type { PreparedTx } from "@rakelabs/dpayments-sdk";
import type {
  AbstractProvider,
  Signer,
  TransactionRequest,
  TransactionResponse,
} from "ethers";
import { NonceManager } from "ethers";

import type { Address, Hex32, PaymentAddress } from "../core/index.js";
import { D402_DEFAULT_CONFIRMATIONS } from "../runtime/defaults.js";
import { createPinnedDPayments } from "../runtime/dpayments.js";
import type {
  PaymentActionResult,
  PaymentAppealResult,
  PaymentConfig,
} from "./types.js";

class PaymentActions {
  private static instance: PaymentActions | undefined;

  private readonly provider: AbstractProvider;
  private readonly originalSigner: Signer;
  private readonly signer: NonceManager;
  private readonly confirmations: number;
  private readonly walletAddress: Promise<Address>;
  private broadcastQueue: Promise<unknown> = Promise.resolve();

  private constructor(config: PaymentConfig & { signer: Signer }) {
    this.provider = config.provider;
    this.originalSigner = config.signer;
    this.signer = new NonceManager(config.signer);
    this.confirmations = config.confirmations ?? D402_DEFAULT_CONFIRMATIONS;
    this.walletAddress = this.signer.getAddress().then(
      (address) => address as Address,
    );
  }

  static getInstance(config: PaymentConfig): PaymentActions {
    if (config.signer === undefined) {
      throw new Error(
        "paymentConfig.signer is required for payment actions so the server can broadcast settlement, refund, consumption, evidence, or appeal transactions.",
      );
    }

    if (PaymentActions.instance === undefined) {
      PaymentActions.instance = new PaymentActions({
        ...config,
        signer: config.signer,
      });
    } else {
      PaymentActions.instance.assertCompatible(config);
    }

    return PaymentActions.instance;
  }

  settlePayment(
    paymentAddress: PaymentAddress,
  ): Promise<PaymentActionResult> {
    return this.sendPaymentAction(paymentAddress, "settle");
  }

  refundPayment(
    paymentAddress: PaymentAddress,
  ): Promise<PaymentActionResult> {
    return this.sendPaymentAction(paymentAddress, "refund");
  }

  consumePayment(
    paymentAddress: PaymentAddress,
  ): Promise<PaymentActionResult> {
    return this.sendPaymentAction(paymentAddress, "consume");
  }

  async submitEvidence(
    paymentAddress: PaymentAddress,
    evidenceUri: string,
  ): Promise<PaymentActionResult> {
    const { dPayment, walletAddress } = await this.getDPayment(paymentAddress);
    console.log("[server] evidence submission started", {
      paymentAddress,
      walletAddress,
      evidenceUri,
    });
    const tx = dPayment.submitEvidence(evidenceUri, walletAddress);
    const result = await this.executePreparedTx(tx);
    console.log("[server] evidence submission confirmed", {
      paymentAddress,
      walletAddress,
      txHash: result.txHash,
    });

    return result;
  }

  async appealPayment(
    paymentAddress: PaymentAddress,
  ): Promise<PaymentAppealResult> {
    const { dPayment, walletAddress } = await this.getDPayment(paymentAddress);
    console.log("[server] appeal started", {
      paymentAddress,
      walletAddress,
    });
    const prepared = await dPayment.prepareAppeal(
      "0x",
      walletAddress,
    );
    const result = await this.executePreparedTx(prepared.tx);
    console.log("[server] appeal confirmed", {
      paymentAddress,
      walletAddress,
      txHash: result.txHash,
      appealFeeWei: prepared.appealFeeWei,
      appealPeriod: prepared.appealPeriod,
    });

    return {
      txHash: result.txHash,
      appealFeeWei: prepared.appealFeeWei,
      appealPeriod: prepared.appealPeriod,
    };
  }

  private assertCompatible(config: PaymentConfig): void {
    const confirmations = config.confirmations ?? D402_DEFAULT_CONFIRMATIONS;

    if (
      config.provider !== this.provider
      || config.signer !== this.originalSigner
      || confirmations !== this.confirmations
    ) {
      throw new Error(
        "paymentActions has already been initialized with a different configuration.",
      );
    }
  }

  private async sendPaymentAction(
    paymentAddress: PaymentAddress,
    action: "settle" | "refund" | "consume",
  ): Promise<PaymentActionResult> {
    const { dPayment, walletAddress } = await this.getDPayment(paymentAddress);
    console.log("[server] payment action started", {
      action,
      paymentAddress,
      walletAddress,
    });
    const tx = action === "settle"
      ? dPayment.settle(walletAddress)
      : action === "refund"
        ? dPayment.voluntaryRefund(walletAddress)
        : dPayment.consume(walletAddress);
    const result = await this.executePreparedTx(tx);
    console.log("[server] payment action confirmed", {
      action,
      paymentAddress,
      walletAddress,
      txHash: result.txHash,
    });

    return result;
  }

  private async getDPayment(paymentAddress: PaymentAddress) {
    const walletAddress = await this.walletAddress;
    const dpayments = await createPinnedDPayments({
      provider: this.provider,
      walletAddress,
    });

    return {
      dPayment: dpayments.dPayment(paymentAddress),
      walletAddress,
    };
  }

  private async executePreparedTx(
    tx: PreparedTx,
  ): Promise<PaymentActionResult> {
    const response = await this.broadcastPreparedTx(tx);
    const receipt = await response.wait(this.confirmations);

    if (receipt === null || receipt.status !== 1) {
      throw new Error(
        "DPayments action transaction failed after broadcast or was not mined successfully.",
      );
    }

    return { txHash: receipt.hash as Hex32 };
  }

  private broadcastPreparedTx(tx: PreparedTx): Promise<TransactionResponse> {
    return this.broadcastInQueue(async () => {
      const request = toTransactionRequest(tx);
      const from = await this.walletAddress;
      const gasLimit = await this.provider.estimateGas({
        ...request,
        from,
      });

      return this.signer.sendTransaction({
        ...request,
        gasLimit,
      });
    });
  }

  private async broadcastInQueue<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.broadcastQueue;
    const current = (async () => {
      await previous.catch(() => {});

      try {
        return await operation();
      } catch (error) {
        this.signer.reset();
        throw error;
      }
    })();

    this.broadcastQueue = current;
    return current;
  }
}

export function paymentActions(config: PaymentConfig): PaymentActions {
  return PaymentActions.getInstance(config);
}

export type { PaymentActions };

function toTransactionRequest(tx: PreparedTx): TransactionRequest {
  return {
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value),
    chainId: tx.chainId,
  };
}
