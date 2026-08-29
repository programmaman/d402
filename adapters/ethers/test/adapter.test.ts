import { describe, expect, it, vi } from "vitest";
import type { AbstractProvider, Signer } from "ethers";
import type { PreparedTx } from "@rakelabs/dpayments-sdk";

import {
  createEthersClient,
  createEthersSigner,
  createEthersTxBroadcaster,
} from "../src/index.js";
import { createEthersAdapter } from "../src/adapter.js";
import { normalizeEthersReceipt } from "../src/receipt.js";
import { createEthersRpcClient } from "../src/rpc-client.js";

const decodeEthersError = vi.hoisted(() => vi.fn());
vi.mock("@rakelabs/ethers-adapter", async (importOriginal) => ({
  ...(await importOriginal()),
  decodeEthersError,
}));

const provider = {
  estimateGas: vi.fn().mockResolvedValue(21_000n),
  broadcastTransaction: vi.fn(),
} as unknown as AbstractProvider;

const preparedTx: PreparedTx = {
  to: "0x0000000000000000000000000000000000000001",
  data: "0x",
  value: "0",
  chainId: 1,
};

describe("@d402/ethers adapter", () => {
  it("exports the named Ethers client constructor", () => {
    expect(createEthersClient).toBeTypeOf("function");
  });

  it("creates a read-only adapter from a provider", () => {
    const adapter = createEthersAdapter({ provider });

    expect(adapter.rpcClient).toBeDefined();
    expect(adapter.codec).toBeDefined();
    expect(adapter.errorDecoder).toBeTypeOf("function");
    expect(adapter.signer).toBeUndefined();
    expect(adapter.broadcaster).toBeDefined();
  });

  it("delegates provider error decoding to the Ethers adapter", () => {
    const cause = new Error("execution reverted");
    const decoded = { name: "InvalidState" };
    decodeEthersError.mockReturnValueOnce(decoded);
    const adapter = createEthersAdapter({ provider });

    expect(adapter.errorDecoder(cause)).toEqual(decoded);
    expect(decodeEthersError).toHaveBeenCalledWith(cause, adapter.codec);
  });

  it("derives a d402 signer from an Ethers signer", () => {
    const signer = {
      getAddress: vi.fn().mockResolvedValue(
        "0x0000000000000000000000000000000000000002",
      ),
    } as unknown as Signer;

    const adapter = createEthersAdapter({ provider, signer });

    expect(adapter.signer).toBeDefined();
  });

  it("signs a populated transaction with the Ethers signer", async () => {
    const populateTransaction = vi.fn().mockResolvedValue({
      to: preparedTx.to,
      data: preparedTx.data,
      value: 0n,
      chainId: preparedTx.chainId,
    });
    const signTransaction = vi.fn().mockResolvedValue("0xsigned");
    const signer = {
      getAddress: vi.fn().mockResolvedValue(
        "0x0000000000000000000000000000000000000002",
      ),
      populateTransaction,
      signTransaction,
    } as unknown as Signer;

    const d402Signer = createEthersSigner({ provider, signer });

    await expect(d402Signer.signTx(preparedTx)).resolves.toBe("0xsigned");
    expect(populateTransaction).toHaveBeenCalledWith({
      to: preparedTx.to,
      data: preparedTx.data,
      value: 0n,
      chainId: preparedTx.chainId,
      from: "0x0000000000000000000000000000000000000002",
    });
    expect(signTransaction).toHaveBeenCalled();
  });

  it("broadcasts a signed transaction through the provider", async () => {
    const txHash =
      "0x0000000000000000000000000000000000000000000000000000000000000002";
    const wait = vi.fn().mockResolvedValue({
      hash: txHash,
      status: 1,
      blockNumber: 43,
      blockHash:
        "0x0000000000000000000000000000000000000000000000000000000000000007",
      logs: [],
    });
    const broadcastTransaction = vi.fn().mockResolvedValue({
      hash: txHash,
      wait,
    });
    const broadcaster = createEthersTxBroadcaster({
      provider: {
        ...provider,
        broadcastTransaction,
      } as unknown as AbstractProvider,
    });

    const submission = await broadcaster.broadcastTx("0xsigned");

    expect(broadcastTransaction).toHaveBeenCalledWith("0xsigned");
    await expect(submission.waitForReceipt()).resolves.toMatchObject({
      txHash,
      status: "success",
    });
  });

  it("normalizes a successful receipt", () => {
    const normalized = normalizeEthersReceipt({
      hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
      status: 1,
      blockNumber: 42,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
      logs: [],
    } as never);

    expect(normalized).toEqual({
      txHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
      status: "success",
      blockNumber: 42,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
      logs: [],
    });
  });

  it("normalizes a reverted receipt without decoding a reason", () => {
    const normalized = normalizeEthersReceipt({
      hash: "0x0000000000000000000000000000000000000000000000000000000000000003",
      status: 0,
      blockNumber: 44,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000000004",
      logs: [],
    } as never);

    expect(normalized).toEqual({
      txHash: "0x0000000000000000000000000000000000000000000000000000000000000003",
      status: "reverted",
      blockNumber: 44,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000000004",
      logs: [],
    });
  });

  it("looks up and normalizes a receipt through the d402 RPC client", async () => {
    const getTransactionReceipt = vi.fn().mockResolvedValue({
      hash: "0x0000000000000000000000000000000000000000000000000000000000000005",
      status: 1,
      blockNumber: 45,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000000006",
      logs: [],
    });
    const rpcClient = createEthersRpcClient({
      ...provider,
      getTransactionReceipt,
    } as unknown as AbstractProvider);

    await expect(rpcClient.getTransactionReceipt(
      "0x0000000000000000000000000000000000000000000000000000000000000005",
    )).resolves.toEqual({
      txHash: "0x0000000000000000000000000000000000000000000000000000000000000005",
      status: "success",
      blockNumber: 45,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000000006",
      logs: [],
    });
    expect(getTransactionReceipt).toHaveBeenCalledWith(
      "0x0000000000000000000000000000000000000000000000000000000000000005",
    );
  });

  it("looks up a block with its hash through the d402 RPC client", async () => {
    const getBlock = vi.fn().mockResolvedValue({
      number: 46,
      timestamp: 1_700_000_000,
      hash: "0x0000000000000000000000000000000000000000000000000000000000000008",
    });
    const rpcClient = createEthersRpcClient({
      ...provider,
      getBlock,
    } as unknown as AbstractProvider);

    await expect(rpcClient.getBlock("latest")).resolves.toEqual({
      number: 46,
      timestamp: 1_700_000_000,
      hash: "0x0000000000000000000000000000000000000000000000000000000000000008",
    });
    expect(getBlock).toHaveBeenCalledWith("latest");
  });

});
