import type { Page } from "@playwright/test";

export interface TapResult {
  p: string;
  c: string;
}

export interface CardInfo {
  uid: string;
  k1: string;
  k2: string;
  version: number;
}

export interface BurnParams {
  urlTemplate: string;
  keys: [string, string, string, string, string];
  keyVersion: number;
  currentKey: string;
}

export interface InspectResult {
  uid: string;
  ndefUrl: string | null;
  keyVersions: number[];
  hasSdm: boolean;
}

export interface CardProvider {
  name: string;
  setup(page: Page): Promise<void>;
  tap(page: Page): Promise<TapResult>;
  getCardInfo(page: Page): Promise<CardInfo>;
  burn(params: BurnParams): Promise<{ uid: string }>;
  wipe(keys: [string, string, string, string, string]): Promise<{ uid: string }>;
  inspect(): Promise<InspectResult>;
  getUid(): Promise<string>;
  ensureReady?(): Promise<void>;
}
