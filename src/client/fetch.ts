import type { AbstractProvider } from "ethers";

import { D402_PAYMENT_PROOF_HEADER } from "../server/constants.js";
import {
  D402ConfigurationError,
  D402PaymentError,
} from "./errors.js";
import { createDPaymentsExecutor } from "./payment-executor.js";
import { buildDPaymentProof, encodeD402PaymentProof } from "./payment-proof.js";
import {
  validatePaymentPolicy,
  validatePolicyConfiguration,
} from "./policy.js";
import {
  assertNoExistingProof,
  parsePaymentRequiredResponse,
  prepareReusableRequest,
  resolveClientResource,
  validatePaymentRequestBinding,
  validatePaymentRequestFreshness,
  withPaymentProofHeader,
} from "./request.js";
import { resolvePaymentAfterAcceptance } from "./resolution.js";
import { getConnectedChainId } from "../runtime/chain.js";
import type {
  CreateD402ClientOptions,
  D402Client,
  D402FetchResponse,
  D402PaymentAttempt,
  D402ResponseValidator,
} from "./types.js";
import type { D402PaymentProof } from "../core/index.js";
import { defaultPaymentActions, defaultResponseValidator } from "./defaults.js";

export function createD402Client(
  options: CreateD402ClientOptions,
): Promise<D402Client> {
  if (options.policy !== undefined) {
    validatePolicyConfiguration(options.policy);
  }

  const fetchImpl = resolveFetch(options.fetch);
  const proofHeaderName = options.proofHeaderName ?? D402_PAYMENT_PROOF_HEADER;
  const provider = (
    options.provider ?? options.signer?.provider ?? undefined
  ) as AbstractProvider | undefined;
  const policyProvider = options.policy === undefined
    ? undefined
    : requireProvider(provider, "policy validation");
  const connectedChainIdPromise = options.policy !== undefined
    ? getConnectedChainId(policyProvider!)
    : null;
  const executor = options.executor ?? createDefaultExecutor(options, provider);
  const onResponse = resolveResponseValidator(options.onResponse);
  const onAccepted = options.onAccepted ?? defaultPaymentActions.OnAccepted;
  const onRejected = options.onRejected ?? defaultPaymentActions.OnRejected;

  async function sendPaidRequest(
    payment: D402PaymentAttempt,
    request: Request,
  ): Promise<D402FetchResponse> {
    let response: Response | undefined;

    try {
      const paidRequest = withPaymentProofHeader(
        request,
        proofHeaderName,
        encodeD402PaymentProof(payment.proof),
      );
      response = await fetchImpl(paidRequest);
      return { response, payment };
    } catch (cause) {
      throw new D402PaymentError({ payment, response, cause });
    }
  }

  async function d402Fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<D402FetchResponse> {
      const prepared = prepareReusableRequest(input, init);
      assertNoExistingProof(prepared.initial, proofHeaderName);

      const unpaidResponse = await fetchImpl(prepared.initial);
      if (unpaidResponse.status !== 402) {
        return { response: unpaidResponse };
      }

      const challenge = await parsePaymentRequiredResponse(unpaidResponse);
      const paymentRequest = challenge.paymentRequest;
      const expectedResource = await resolveClientResource(
        prepared.retry,
        options.resource,
      );
      validatePaymentRequestBinding({
        paymentRequest,
        request: prepared.retry,
        expectedResource,
      });
      validatePaymentRequestFreshness(paymentRequest);

      if (options.policy !== undefined) {
        const connectedChainId = await (
          connectedChainIdPromise ?? getConnectedChainId(policyProvider!)
        );
        validatePaymentPolicy({
          paymentRequest,
          connectedChainId,
          policy: options.policy,
        });
      }

      const payment = await executor.createPayment(paymentRequest);
      const dPaymentProof = buildDPaymentProof({
        paymentAddress: payment.paymentAddress,
        txHash: payment.txHash,
        paymentSalt: payment.paymentSalt,
      });
      const proof: D402PaymentProof = {
        dPaymentProof,
          ...(challenge.settlementReference !== undefined
            ? { settlementReference: challenge.settlementReference }
            : {}),
      };
      const paymentAttempt: D402PaymentAttempt = {
        paymentRequest,
        payment,
        proof,
      };

      return sendPaidRequest(paymentAttempt, prepared.retry);
  }

  async function retry(
    payment: D402PaymentAttempt,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<D402FetchResponse> {
    const prepared = prepareReusableRequest(input, init);
    assertNoExistingProof(prepared.initial, proofHeaderName);
    const expectedResource = await resolveClientResource(
      prepared.retry,
      options.resource,
    );
    validatePaymentRequestBinding({
      paymentRequest: payment.paymentRequest,
      request: prepared.retry,
      expectedResource,
    });
    validatePaymentRequestFreshness(payment.paymentRequest);

    return sendPaidRequest(payment, prepared.retry);
  }

  return Promise.resolve({
    executor,
    async fetch(input, init) {
      const result = await d402Fetch(input, init);
      if (result.payment === undefined) {
        return result.response;
      }

      try {
        const responseDecision = await onResponse.validate({
          paymentRequest: result.payment.paymentRequest,
          payment: result.payment.payment,
          response: result.response.clone(),
        });

        await resolvePaymentAfterAcceptance({
          payment: result.payment.payment,
          responseDecision,
          executor,
          onAccepted,
          onRejected,
        });
      } catch (cause) {
        throw new D402PaymentError({
          payment: result.payment,
          response: result.response,
          cause,
        });
      }

      return result.response;
    },
    d402Fetch,
    retry,
  });
}

function resolveFetch(
  fetchImpl?: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const resolved = fetchImpl ?? globalThis.fetch;

  if (resolved === undefined) {
    throw new D402ConfigurationError(
      "createD402Client requires a fetch implementation. Pass fetch explicitly when global fetch is unavailable.",
    );
  }

  return resolved.bind(globalThis);
}

function resolveResponseValidator(
  validator?: D402ResponseValidator,
): D402ResponseValidator {
  return validator ?? defaultResponseValidator;
}

function requireProvider(
  provider: AbstractProvider | null | undefined,
  purpose: string,
): AbstractProvider {
  if (provider === null || provider === undefined) {
    throw new D402ConfigurationError(
      `createD402Client requires a provider or signer.provider for ${purpose}.`,
    );
  }

  return provider;
}

function createDefaultExecutor(
  options: CreateD402ClientOptions,
  provider: AbstractProvider | null | undefined,
) {
  if (options.signer === undefined) {
    throw new D402ConfigurationError(
      "createD402Client requires signer when executor is not provided and the client needs to create payments.",
    );
  }

  const executorOptions = {
    signer: options.signer,
    provider: requireProvider(provider, "the default payment executor"),
    ...(options.confirmations !== undefined
      ? { confirmations: options.confirmations }
      : {}),
    ...(options.logger !== undefined
      ? { logger: options.logger }
      : {}),
  };

  return createDPaymentsExecutor(executorOptions);
}
