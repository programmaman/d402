import type { AbstractProvider } from "ethers";

import { D402_PAYMENT_PROOF_HEADER } from "../server/constants.js";
import { D402ConfigurationError } from "./errors.js";
import { createDPaymentsExecutor } from "./payment-executor.js";
import { buildDPaymentProof, encodeD402PaymentProof } from "./payment-proof.js";
import { validatePaymentPolicy } from "./policy.js";
import {
  assertNoExistingProof,
  parsePaymentRequiredResponse,
  prepareReusableRequest,
  validatePaymentRequestBinding,
  withPaymentProofHeader,
} from "./request.js";
import { resolvePaymentAfterAcceptance } from "./resolution.js";
import { getConnectedChainId } from "../runtime/chain.js";
import type {
  CreateD402ClientOptions,
  D402Client,
  D402ResponseValidator,
} from "./types.js";
import {
  D402DefaultPaymentActions,
  D402DefaultResponseValidator,
} from "./types.js";

export function createD402Client(
  options: CreateD402ClientOptions,
): Promise<D402Client> {
  const fetchImpl = resolveFetch(options.fetch);
  const proofHeaderName = options.proofHeaderName ?? D402_PAYMENT_PROOF_HEADER;
  const provider = resolveProvider(options);
  const connectedChainIdPromise = options.policy !== undefined
    ? getConnectedChainId(provider)
    : null;
  const executor = options.executor ?? createDefaultExecutor(options, provider);
  const onResponse = resolveResponseValidator(options.onResponse);
  const onAccepted = options.onAccepted ?? D402DefaultPaymentActions.OnAccepted;
  const onRejected = options.onRejected ?? D402DefaultPaymentActions.OnRejected;

  return Promise.resolve({
    async fetch(input, init) {
      const prepared = prepareReusableRequest(input, init);
      assertNoExistingProof(prepared.initial, proofHeaderName);

      const unpaidResponse = await fetchImpl(prepared.initial);
      if (unpaidResponse.status !== 402) {
        return unpaidResponse;
      }

      const challenge = await parsePaymentRequiredResponse(unpaidResponse);
      const paymentRequest = challenge.paymentRequest;
      validatePaymentRequestBinding({
        paymentRequest,
        request: prepared.retry,
      });

      if (options.policy !== undefined) {
        const connectedChainId = await (
          connectedChainIdPromise ?? getConnectedChainId(provider)
        );
        validatePaymentPolicy({
          paymentRequest,
          connectedChainId,
          policy: options.policy,
        });
      }

      const payment = await executor.createPayment(paymentRequest);
      const dPaymentProof = buildDPaymentProof(payment);
      const paidRequest = withPaymentProofHeader(
        prepared.retry,
        proofHeaderName,
        encodeD402PaymentProof({
          dPaymentProof,
          ...(challenge.settlementReference !== undefined
            ? { settlementReference: challenge.settlementReference }
            : {}),
        }),
      );

      const paidResponse = await fetchImpl(paidRequest);
      const responseDecision = await onResponse.validate({
        paymentRequest,
        payment,
        response: paidResponse.clone(),
      });

      await resolvePaymentAfterAcceptance({
        payment,
        responseDecision,
        executor,
        onAccepted,
        onRejected,
      });

      return paidResponse;
    },
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
  return validator ?? D402DefaultResponseValidator;
}

function resolveProvider(options: CreateD402ClientOptions): AbstractProvider {
  const provider = options.provider ?? options.signer?.provider;

  if (provider === null || provider === undefined) {
    throw new D402ConfigurationError(
      "createD402Client requires a provider or signer.provider when policy validation is enabled.",
    );
  }

  return provider as AbstractProvider;
}

function createDefaultExecutor(
  options: CreateD402ClientOptions,
  provider: AbstractProvider,
) {
  if (options.signer === undefined) {
    throw new D402ConfigurationError(
      "createD402Client requires signer when executor is not provided and the client needs to create payments.",
    );
  }

  const executorOptions = {
    signer: options.signer,
    provider,
    ...(options.paymentConfirmations !== undefined
      ? { paymentConfirmations: options.paymentConfirmations }
      : {}),
    ...(options.actionConfirmations !== undefined
      ? { resolutionConfirmations: options.actionConfirmations }
      : {}),
  };

  return createDPaymentsExecutor(executorOptions);
}
