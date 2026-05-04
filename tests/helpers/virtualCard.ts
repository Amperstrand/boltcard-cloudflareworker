// @ts-nocheck
import { handleRequest } from "../../index.js";
import { getDeterministicKeys } from "../../keygenerator.js";
import { makeReplayNamespace } from "../replayNamespace.js";
import { virtualTap, TEST_OPERATOR_AUTH } from "../testHelpers.js";

const DEFAULT_BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const DEFAULT_ISSUER_KEY = "00000000000000000000000000000001";
const PROG_ENDPOINT = "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion";

interface VirtualCardOptions {
  uid?: string;
  issuerKey?: string;
  boltCardK1?: string;
  balance?: number;
  paymentMethod?: string;
  cardType?: string;
  lightningAddress?: string;
}

interface CardKeys {
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
}

interface ProvisionResult {
  json: any;
  keys: CardKeys;
  version: number;
}

export class VirtualCard {
  uid: string;
  counter: number;
  keys!: CardKeys;
  version: number;
  issuerKey: string;
  k1Hex: string;
  env: Record<string, any>;

  private constructor(options: VirtualCardOptions) {
    this.uid = options.uid || `04${randomHex(6)}`;
    this.counter = 0;
    this.version = 0;
    this.issuerKey = options.issuerKey || DEFAULT_ISSUER_KEY;
    this.k1Hex = options.boltCardK1
      ? options.boltCardK1.split(",")[0]
      : DEFAULT_BOLT_CARD_K1.split(",")[0];

    const replay = makeReplayNamespace();
    const kvStore: Record<string, string> = {};
    this.env = {
      BOLT_CARD_K1: options.boltCardK1 || DEFAULT_BOLT_CARD_K1,
      ISSUER_KEY: this.issuerKey,
      CARD_REPLAY: replay,
      UID_CONFIG: {
        get: async (key: string) => kvStore[key] ?? null,
        put: async (key: string, val: string) => {
          kvStore[key] = val;
        },
      },
      ...TEST_OPERATOR_AUTH,
    };
  }

  static async createProvisioned(options: VirtualCardOptions = {}): Promise<VirtualCard> {
    const card = new VirtualCard(options);
    const result = await card.provision(
      options.cardType,
      options.lightningAddress
    );
    card.keys = result.keys;
    card.version = result.version;
    // Provision delivers keys; auto-activate for testing
    await card.activateViaDO(result.version);
    return card;
  }

  static async createDiscovered(options: VirtualCardOptions = {}): Promise<VirtualCard> {
    const card = new VirtualCard(options);
    const keys = getDeterministicKeys(card.uid, { ISSUER_KEY: card.issuerKey }, 1);
    card.keys = keys;
    card.version = 1;
    return card;
  }

  static createRaw(options: VirtualCardOptions = {}): VirtualCard {
    return new VirtualCard(options);
  }

  async provision(cardType?: string, lightningAddress?: string): Promise<ProvisionResult> {
    let extra = "";
    if (cardType === "pos" && lightningAddress) {
      extra = `&card_type=pos&lightning_address=${lightningAddress}&min_sendable=1000&max_sendable=100000000`;
    }
    const resp = await this.request(PROG_ENDPOINT + extra, "POST", { UID: this.uid });
    if (resp.status !== 200) {
      const text = await resp.text();
      throw new Error(`Provision failed (${resp.status}): ${text}`);
    }
    const json = await resp.json();
    const version = json.Version || 1;
    const keys = getDeterministicKeys(this.uid, this.env, version);
    this.keys = keys;
    this.version = version;
    return { json, keys, version };
  }

  async credit(amount: number): Promise<void> {
    const id = this.env.CARD_REPLAY.idFromName(this.uid);
    const stub = this.env.CARD_REPLAY.get(id);
    await stub.fetch(
      new Request("https://card-replay.internal/credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      })
    );
  }

  nextCounter(): number {
    return ++this.counter;
  }

  tap(counter?: number): { pHex: string; cHex: string } {
    const ctr = counter ?? this.counter + 1;
    if (ctr > this.counter) this.counter = ctr;
    return virtualTap(this.uid, ctr, this.k1Hex, this.keys.k2);
  }

  async tapRequest(counter?: number): Promise<{ response: Response; json: any; pHex: string; cHex: string }> {
    const { pHex, cHex } = this.tap(counter);
    const response = await this.request(`/?p=${pHex}&c=${cHex}`);
    const json = await response.json();
    return { response, json, pHex, cHex };
  }

  async callback(pHex: string, cHex: string, invoice: string, amount?: string): Promise<Response> {
    let path = `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=${invoice}`;
    if (amount) path += `&amount=${amount}`;
    return this.request(path);
  }

  async fullPayment(amountMsat: number): Promise<{ tapResp: Response; cbResp: Response; tapJson: any }> {
    const { response: tapResp, json: tapJson, pHex, cHex } = await this.tapRequest();
    const invoice = `lnbc${amountMsat}n1test${Date.now()}`;
    const cbResp = await this.callback(pHex, cHex, invoice, String(amountMsat));
    return { tapResp, cbResp, tapJson };
  }

  async lnurlPayCallback(pHex: string, cHex: string, amountMsat: number): Promise<Response> {
    return this.request(`/lnurlp/cb?p=${pHex}&c=${cHex}&amount=${amountMsat}`);
  }

  async wipe(): Promise<Response> {
    this.ensureActive();
    return this.request(`/wipe?uid=${this.uid}`);
  }

  async terminate(): Promise<Response> {
    return this.request("/login", "POST", {
      p: "terminate",
      uid: this.uid,
      action: "terminate",
    });
  }

  async topup(amount: number): Promise<Response> {
    return this.request("/login", "POST", {
      p: "topup",
      uid: this.uid,
      action: "topup",
      amount,
    });
  }

  async getBalance(): Promise<number> {
    const id = this.env.CARD_REPLAY.idFromName(this.uid);
    const stub = this.env.CARD_REPLAY.get(id);
    const resp = await stub.fetch(new Request("https://card-replay.internal/balance"));
    const json = (await resp.json()) as { balance: number };
    return json.balance;
  }

  async getCardState(): Promise<string> {
    const id = this.env.CARD_REPLAY.idFromName(this.uid);
    const stub = this.env.CARD_REPLAY.get(id);
    const resp = await stub.fetch(new Request("https://card-replay.internal/card-state"));
    const json = (await resp.json()) as { state: string };
    return json.state;
  }

  async getTapHistory(): Promise<any[]> {
    const id = this.env.CARD_REPLAY.idFromName(this.uid);
    const stub = this.env.CARD_REPLAY.get(id);
    const resp = await stub.fetch(new Request("https://card-replay.internal/list-taps"));
    const json = (await resp.json()) as { taps: any[] };
    return json.taps;
  }

  async activateViaDO(version?: number): Promise<void> {
    const v = version ?? this.version;
    const id = this.env.CARD_REPLAY.idFromName(this.uid);
    const stub = this.env.CARD_REPLAY.get(id);
    await stub.fetch(
      new Request("https://card-replay.internal/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_version: v }),
      })
    );
  }

  setCardState(state: string): void {
    const stateObj = this.env.CARD_REPLAY.__cardStates.get(this.uid.toLowerCase());
    if (stateObj) {
      stateObj.state = state;
    }
  }

  async request(path: string, method: string = "GET", body?: any): Promise<Response> {
    const url = "https://test.local" + path;
    const opts: RequestInit = { method };
    if (body) {
      opts.body = JSON.stringify(body);
      opts.headers = { "Content-Type": "application/json" };
    }
    return handleRequest(new Request(url, opts), this.env);
  }

  private ensureActive(): void {
    const state = this.env.CARD_REPLAY.__cardStates.get(this.uid.toLowerCase());
    if (state) {
      state.state = "active";
      state.active_version = this.version;
    }
  }
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}