import { TOPIC_PAYMENT_CREATED } from "@rakelabs/dpayments-sdk";
import { zeroPadValue } from "ethers";
import type {
  EvmLog,
  PaymentCreatedEvent,
  PaymentEvents,
} from "@rakelabs/dpayments-sdk";

export function findPaymentCreatedEvent(input: {
  logs: readonly EvmLog[];
  factoryAddress: string;
  paymentId: string;
  creator: string;
  payee: string;
  decoder: Pick<PaymentEvents, "tryDecodePaymentCreated">;
}): PaymentCreatedEvent | undefined {
  const expectedTopic = TOPIC_PAYMENT_CREATED.toLowerCase();
  const expectedFactory = input.factoryAddress.toLowerCase();
  const expectedPaymentId = input.paymentId.toLowerCase();
  const expectedCreator = zeroPadValue(input.creator, 32).toLowerCase();
  const expectedPayee = zeroPadValue(input.payee, 32).toLowerCase();

  for (const log of input.logs) {
    if (log.address === undefined || log.topics === undefined) {
      const decoded = input.decoder.tryDecodePaymentCreated(log);

      if (decoded !== undefined) {
        return decoded;
      }

      continue;
    }

    if (log.address.toLowerCase() !== expectedFactory) {
      continue;
    }

    if (log.topics.length < 4) {
      continue;
    }

    if (log.topics[0]?.toLowerCase() !== expectedTopic) {
      continue;
    }

    if (log.topics[1]?.toLowerCase() !== expectedPaymentId) {
      continue;
    }

    if (log.topics[2]?.toLowerCase() !== expectedCreator) {
      continue;
    }

    if (log.topics[3]?.toLowerCase() !== expectedPayee) {
      continue;
    }

    const decoded = input.decoder.tryDecodePaymentCreated(log);

    if (decoded !== undefined) {
      return decoded;
    }
  }

  return undefined;
}
