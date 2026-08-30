import type { PreparedTx } from "@rakelabs/dpayments-sdk";
import type {
  D402Signer,
  SignedTx,
} from "d402/core";
import type {
  Signer,
  TransactionRequest,
} from "ethers";

export interface EthersSignerOptions {
  signer: Signer;
}

export function createEthersSigner(
  options: EthersSignerOptions,
): D402Signer {
  return {
    async getAddress() {
      return options.signer.getAddress() as Promise<`0x${string}`>;
    },

    async signTx(
      transaction: PreparedTx,
    ): Promise<SignedTx> {
      const request = toEthersTransaction(transaction);
      const populated = await options.signer.populateTransaction({
        ...request,
        from: await options.signer.getAddress(),
      });

      const signedTx = await options.signer.signTransaction(populated);
      return signedTx as SignedTx;
    },
  };
}

function toEthersTransaction(
  transaction: PreparedTx,
): TransactionRequest {
  return {
    to: transaction.to,
    data: transaction.data,
    value: BigInt(transaction.value),
    chainId: transaction.chainId,
  };
}
