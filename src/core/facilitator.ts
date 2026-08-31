import type {
  D402PaymentProof,
  D402PaymentRequest,
} from "./types.js";

export type D402FacilitatorAdvertisement = Readonly<
  Record<string, unknown>
>;

export type D402FacilitatorAdvertisements = Readonly<
  Record<string, D402FacilitatorAdvertisement>
>;

export interface D402Facilitator<PaymentAuthorization> {
  advertise(
    payment: D402PaymentRequest,
  ): D402FacilitatorAdvertisement;

  facilitate(
    payment: D402PaymentRequest,
    authorization: PaymentAuthorization,
  ): Promise<D402PaymentProof>;
}
