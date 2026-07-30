import { JsonRpcProvider } from "ethers";

import { payable } from "d402/server";

const provider = new JsonRpcProvider(requireEnv("RPC_URL"));
const chainId = Number(requireEnv("CHAIN_ID"));
const payeeAddress = requireEnv("PAYEE_ADDRESS") as `0x${string}`;

const protectReport = payable({
  paymentConfig: {
    provider,
    confirmations: 1,
    settlementWindow: 3600,
  },
  terms: (request) => {
    const url = new URL(request.url);

    return {
      resource: (resourceRequest) => resourceRequest.url,
      chainId,
      payeeAddress,
      tokenAddress: null,
      netAmount: "1000000000000000",
      agreement: {
        id: `next-report:${url.pathname}:v1`,
        hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
    };
  },
  handler: async (request, context) => {
    const url = new URL(request.url);
    const id = url.pathname.split("/").at(-1);

    return Response.json({
      ok: true,
      report: { id, title: `Report ${id}` },
      paymentId: context.payment.paymentId,
    });
  },
});

export async function GET(request: Request): Promise<Response> {
  return protectReport(request);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }

  return value;
}
