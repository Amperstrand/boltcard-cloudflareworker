export interface CheckCounterPayload {
  counterValue: number;
}

export interface RecordTapPayload {
  counterValue: number;
  bolt11: string;
  amountMsat: number;
  userAgent: string;
  requestUrl: string;
}

export interface RecordReadPayload {
  counterValue: number;
  userAgent: string;
  requestUrl: string;
}

export interface ClaimTapPayload {
  counter: number;
  status: string;
  bolt11: string;
  amountMsat: number;
}

export interface ClaimTapNoBolt11Payload {
  counter: number;
  bolt11: string;
  amountMsat: number;
}

export interface DeliverKeysPayload {
  active_version: number;
}

export interface SetK2Payload {
  K2: string;
}

export interface CreditPayload {
  amount: number;
  note: string;
}

export interface DebitPayload {
  counter: number;
  amount: number;
  note: string;
}

export interface SetProvenancePayload {
  key_provenance: string;
  key_fingerprint: string;
  key_label: string;
}

export interface DiscoverPayload {
  key_provenance: string;
  key_fingerprint: string;
  key_label: string;
  active_version: number;
}

export interface DoCardStateRow {
  state?: string;
  latest_issued_version?: number;
  active_version?: number | null;
  activated_at?: number | null;
  terminated_at?: number | null;
  keys_delivered_at?: number | null;
  wipe_keys_fetched_at?: number | null;
  key_provenance?: string | null;
  key_fingerprint?: string | null;
  key_label?: string | null;
  first_seen_at?: number | null;
  balance?: number;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
