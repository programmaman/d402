import { describe, expect, it, vi } from "vitest";
import type { PreparedTx } from "@rakelabs/dpayments-sdk";
import {
  TransactionReceiptNotFoundError,
  NonceTooLowError,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";

import {
  createViemAdapter,
  createViemTxSender,
} from "../src/index.js";
import { createViemRpcClient } from "../src/rpc-client.js";

const decodeViemError = vi.hoisted(() => vi.fn());
vi.mock("@rakelabs/viem-adapter", async (importOriginal) => ({
  ...(await importOriginal()),
  decodeViemError,
}));

const publicClient = {
  call: vi.fn().mockResolvedValue({ data: "0x" }),
  estimateGas: vi.fn().mockResolvedValue(21_000n),
  getLogs: vi.fn().mockResolvedValue([]),
  getChainId: vi.fn().mockResolvedValue(1),
  getBlock: vi.fn().mockResolvedValue({
    number: 42n,
    timestamp: 1_700_000_000n,
    hash: "0x0000000000000000000000000000000000000000000000000000000000000009",
  }),
  getTransactionReceipt: vi.fn().mockResolvedValue({
    transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
    status: "success",
    blockNumber: 43n,
    blockHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
    logs: [],
  }),
  waitForTransactionReceipt: vi.fn().mockResolvedValue({
    transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
    status: "success",
    blockNumber: 43n,
    blockHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
    logs: [],
  }),
} as unknown as PublicClient;

const preparedTx: PreparedTx = {
  to: "0x0000000000000000000000000000000000000001",
  data: "0x",
  value: "0",
  chainId: 1,
};

describe("@d402/viem adapter", () => {
  it("creates a read-only adapter from a public client", () => {
    const adapter = createViemAdapter({ publicClient });

    expect(adapter.rpcClient).toBeDefined();
    expect(adapter.codec).toBeDefined();
    expect(adapter.errorDecoder).toBeTypeOf("function");
    expect(adapter.txSender).toBeUndefined();
  });

  it("delegates provider error decoding to the Viem adapter", () => {
    const cause = { cause: { data: "0xdeadbeef" } };
    const decoded = { name: "InvalidState" };
    decodeViemError.mockReturnValueOnce(decoded);
    const adapter = createViemAdapter({ publicClient });

    expect(adapter.errorDecoder(cause)).toEqual(decoded);
    expect(decodeViemError).toHaveBeenCalledWith(cause, adapter.codec);
  });

  it("creates a write adapter from a wallet client", () => {
    const walletClient = {
      account: {
        address: "0x0000000000000000000000000000000000000002",
      },
      chain: undefined,
      sendTransaction: vi.fn().mockResolvedValue(
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ),
    } as unknown as WalletClient;

    const adapter = createViemAdapter({
      publicClient,
      walletClient,
    });

    expect(adapter.txSender).toBeDefined();
  });

  it("requires an account for transaction submission", async () => {
    const walletClient = {
      account: undefined,
      chain: undefined,
    } as unknown as WalletClient;
    const sender = createViemTxSender({
      publicClient,
      walletClient,
    });

    await expect(sender.getAddress()).rejects.toThrow(
      "wallet client must have an account",
    );
  });

  it("normalizes a successful Viem receipt", async () => {
    const walletClient = {
      account: {
        address: "0x0000000000000000000000000000000000000002",
      },
      chain: undefined,
      sendTransaction: vi.fn().mockResolvedValue(
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ),
    } as unknown as WalletClient;
    const sender = createViemTxSender({
      publicClient,
      walletClient,
    });

    const submission = await sender.broadcastTransaction(preparedTx);
    await expect(submission.waitForReceipt()).resolves.toMatchObject({
      status: "success",
      blockNumber: 43,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
    });
  });

  it("looks up a block with its hash through the d402 RPC client", async () => {
    const rpcClient = createViemRpcClient(publicClient);

    await expect(rpcClient.getBlock("latest")).resolves.toEqual({
      number: 42,
      timestamp: 1_700_000_000,
      hash: "0x0000000000000000000000000000000000000000000000000000000000000009",
    });
    expect(publicClient.getBlock).toHaveBeenCalled();
  });

  it("passes a local account through to Viem", async () => {
    const account = {
      address: "0x0000000000000000000000000000000000000002",
      type: "local",
    } as Account;
    const sendTransaction = vi.fn().mockResolvedValue(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    );
    const walletClient = {
      account,
      chain: undefined,
      sendTransaction,
    } as unknown as WalletClient;
    const sender = createViemTxSender({
      publicClient,
      walletClient,
    });

    await sender.broadcastTransaction(preparedTx);

    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ account }),
    );
  });

  it("serializes concurrent broadcasts through one wallet client", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstBroadcastStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sendTransaction = vi.fn()
      .mockImplementationOnce(async () => {
        await firstBroadcastStarted;
        return "0x0000000000000000000000000000000000000000000000000000000000000001";
      })
      .mockResolvedValueOnce(
        "0x0000000000000000000000000000000000000000000000000000000000000002",
      );
    const walletClient = {
      account: {
        address: "0x0000000000000000000000000000000000000002",
      },
      chain: undefined,
      sendTransaction,
    } as unknown as WalletClient;
    const sender = createViemTxSender({
      publicClient,
      walletClient,
    });

    const first = sender.broadcastTransaction(preparedTx);
    await vi.waitFor(() => expect(sendTransaction).toHaveBeenCalledOnce());
    const second = sender.broadcastTransaction(preparedTx);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const callsBeforeFirstRelease = sendTransaction.mock.calls.length;
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(callsBeforeFirstRelease).toBe(1);
  });

  it("re-estimates after a nonce conflict", async () => {
    const sendTransaction = vi.fn()
      .mockRejectedValueOnce(new NonceTooLowError({ nonce: 1 }))
      .mockResolvedValueOnce(
        "0x0000000000000000000000000000000000000000000000000000000000000006",
      );
    const estimateGas = vi.fn().mockResolvedValue(21_000n);
    const walletClient = {
      account: {
        address: "0x0000000000000000000000000000000000000002",
      },
      chain: undefined,
      sendTransaction,
    } as unknown as WalletClient;
    const sender = createViemTxSender({
      publicClient: {
        ...publicClient,
        estimateGas,
      },
      walletClient,
    });

    await expect(sender.broadcastTransaction(preparedTx)).resolves.toMatchObject({
      txHash:
        "0x0000000000000000000000000000000000000000000000000000000000000006",
    });
    expect(estimateGas).toHaveBeenCalledTimes(2);
    expect(sendTransaction).toHaveBeenCalledTimes(2);
  });

  it("reads a fresh block number after the chain advances", async () => {
    const getBlock = vi.fn()
      .mockResolvedValueOnce({
        number: 191n,
        timestamp: 1_700_000_000n,
        hash: "0x0000000000000000000000000000000000000000000000000000000000000011",
      })
      .mockResolvedValueOnce({
        number: 192n,
        timestamp: 1_700_000_001n,
        hash: "0x0000000000000000000000000000000000000000000000000000000000000012",
      });
    const rpcClient = createViemRpcClient({
      ...publicClient,
      getBlock,
    });

    await expect(rpcClient.getBlock("latest")).resolves.toMatchObject({
      number: 191,
    });
    await expect(rpcClient.getBlock("latest")).resolves.toMatchObject({
      number: 192,
    });
    expect(getBlock).toHaveBeenCalledTimes(2);
  });

  it("normalizes a receipt lookup and preserves reverted status", async () => {
    const getTransactionReceipt = vi
      .fn()
      .mockResolvedValueOnce({
        transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000003",
        status: "reverted",
        blockNumber: 44n,
        blockHash: "0x0000000000000000000000000000000000000000000000000000000000000004",
        logs: [],
      });
    const rpcClient = createViemRpcClient({
      ...publicClient,
      getTransactionReceipt,
    });

    await expect(rpcClient.getTransactionReceipt(
      "0x0000000000000000000000000000000000000000000000000000000000000003",
    )).resolves.toEqual({
      txHash: "0x0000000000000000000000000000000000000000000000000000000000000003",
      status: "reverted",
      blockNumber: 44,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000000004",
      logs: [],
    });
  });

  it("maps only receipt-not-found to null", async () => {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000005" as const;
    const rpcClient = createViemRpcClient({
      ...publicClient,
      getTransactionReceipt: vi.fn().mockRejectedValue(
        new TransactionReceiptNotFoundError({ hash }),
      ),
    });

    await expect(rpcClient.getTransactionReceipt(hash)).resolves.toBeNull();
  });
});
