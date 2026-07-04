import "dotenv/config";

import { JsonRpcProvider, Wallet } from "ethers";

import { createD402Client } from "d402/client";

const port = Number(process.env.PORT ?? "3000");
const chainId = Number(requireEnv("CHAIN_ID"));
const payeeAddress = requireEnv("PAYEE_ADDRESS") as `0x${string}`;
const provider = new JsonRpcProvider(requireEnv("RPC_URL"));
const signer = new Wallet(requireEnv("PAYER_PRIVATE_KEY"), provider);
const targetUrl = `http://localhost:${port}/downloads/123`;

const client = await createD402Client({
  provider,
  signer,
  paymentConfirmations: 1,
  policy: {
    allowedChains: [chainId],
    allowedPayees: [payeeAddress],
    allowedTokens: [null],
    allowedResources: [/^http:\/\/localhost:\d+\/downloads\/\w+$/],
    maxAmount: "1000000000000000",
    maxExpiryWindowSec: 300,
    maxSettlementWindowSec: 3600,
    requireAgreementHash: true,
  },
});

const response = await client.fetch(targetUrl);
console.log(response.status);
console.log(JSON.stringify(await response.json(), null, 2));

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }

  return value;
}
