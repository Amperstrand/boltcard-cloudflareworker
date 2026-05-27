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

export interface CardProvider {
  name: string;
  setup(page: Page): Promise<void>;
  tap(page: Page): Promise<TapResult>;
  getCardInfo(page: Page): Promise<CardInfo>;
}
