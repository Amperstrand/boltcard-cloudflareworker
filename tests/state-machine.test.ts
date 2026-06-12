import { describe, it, expect } from "vitest";
import { buildCardTestEnv, virtualTap, TEST_OPERATOR_AUTH } from "./testHelpers.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { handleLnurlw } from "../handlers/lnurlwHandler.js";
import { handleLnurlpPayment } from "../handlers/lnurlHandler.js";
import { handleTopupApply } from "../handlers/topupHandler.js";
import { handlePosCharge } from "../handlers/posChargeHandler.js";
import { handleRefundApply } from "../handlers/refundHandler.js";
import { handleCardLock, handleCardReactivate, handleCardInfo } from "../handlers/cardDashboardHandler.js";
import { handleBalanceCheck } from "../handlers/balanceCheckHandler.js";
import { handleIdentifyCard } from "../handlers/identifyCardHandler.js";
import { handleTerminateAction, handleRequestWipeAction } from "../handlers/loginActions.js";
import { getCardState, terminateCard, activateCard, requestWipe, deliverKeys, discoverCard, markPending } from "../replayProtection.js";
import { CARD_STATE, isCardUsable, isCardTerminated, canAutoActivate, canTransact } from "../utils/constants.js";
import type { Env, SessionPayload } from "../types/core.js";

const UID = "04a39493cc8680";
const INITIAL_BALANCE = 100000;
const TEST_SESSION: SessionPayload = TEST_OPERATOR_AUTH.__TEST_OPERATOR_SESSION;

type MockCardState = { state: string; balance: number; active_version: number | null; latest_issued_version: number; key_provenance?: string };
type MockCardReplay = { __cardStates: Map<string, MockCardState>; __cardConfigs: Map<string, Record<string, unknown>> };
function mockDO(env: Env): MockCardReplay { return env.CARD_REPLAY as unknown as MockCardReplay; }

function tapParams(env: Env, counter: number): { pHex: string; cHex: string } {
  const k1Hex = env.BOLT_CARD_K1!.split(",")[0]!;
  const keys = getDeterministicKeys(UID, env, 1);
  return virtualTap(UID, counter, k1Hex, keys.k2);
}

function makeRequest(path: string, method: string = "GET", body: Record<string, unknown> | null = null): Request {
  const url = "https://test.local" + path;
  const opts: RequestInit = { method };
  if (body) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  return new Request(url, opts);
}

// ── Transition Matrix ────────────────────────────────────────────────────────
//
// Note: getUidConfig falls back to deterministic keys from ISSUER_KEY, so ALL
// cards have a config even without explicit KV/DO registration. Cards in "new"
// or "pending" state get auto-discovered on first tap via CMAC scan.
//
// validateCardTap: rejects terminated (403), wipe_requested (403);
//   auto-activates keys_delivered on CMAC match; requires K2 config.
// resolveCardIdentity: used by lock/reactivate/cardInfo; rejects no-config (404),
//   optionally validates CMAC, requires requireState for state-dependent checks.
// handleLnurlw: only rejects terminated (403); auto-discovers new/pending;
//   keys_delivered auto-activates on CMAC match.
// handleLnurlpPayment: callback — decrypts p, validates CMAC, checks replay.
// handleTerminateAction: requires active or wipe_requested state.
// handleRequestWipeAction: requires active state.

interface Transition {
  status: number;
  toState?: string;
  note?: string;
}

const T: Record<string, Record<string, Transition>> = {
  // "new" = no DO row. getCardState returns {state:"new"}.
  // Deterministic config always available. Tap auto-discovers via CMAC scan.
  [CARD_STATE.NEW]: {
    tap:          { status: 200, toState: CARD_STATE.DISCOVERED, note: "auto-discovers via CMAC scan + deterministic fallback" },
    callback:     { status: 402, note: "callback processes but balance=0 → insufficient" },
    topup:        { status: 200, note: "validateCardTap: new state, version=1, deterministic config, credits" },
    posCharge:    { status: 402, note: "validateCardTap: ok, but balance=0 → insufficient" },
    refund:       { status: 200, note: "validateCardTap: ok, full refund of 0 → credits 0" },
    lock:         { status: 400, note: "resolveCardAuth: state=new, not active/discovered → rejected" },
    reactivate:   { status: 400, note: "resolveCardAuth: state=new, not terminated" },
    wipe:         { status: 400, note: "handleTerminateAction: state=new, not active/wipe_requested" },
    terminate:    { status: 400, note: "handleTerminateAction: state=new, not active/wipe_requested" },
    balanceCheck: { status: 200, note: "validateCardTap: new state resolves, returns balance=0" },
    cardInfo:     { status: 200, note: "resolveCardIdentity with skipCmac: returns info for new card" },
    identifyCard: { status: 200, note: "decrypts + CMAC scan, always works" },
  },

  // "pending" = keys fetched but card never tapped.
  // No K2 in DO config, but deterministic fallback provides K2.
  [CARD_STATE.PENDING]: {
    tap:          { status: 200, toState: CARD_STATE.DISCOVERED, note: "pending → discovered via discoverUnknownCard" },
    callback:     { status: 200, note: "callback uses resolveCardIdentity (no state check); processes payment" },
    topup:        { status: 200, note: "validateCardTap: pending → version=1, deterministic K2, credits" },
    posCharge:    { status: 200, note: "validateCardTap: pending resolves, debits with balance" },
    refund:       { status: 200, note: "validateCardTap: ok, credits" },
    lock:         { status: 400, note: "resolveCardAuth: state=pending, not active/discovered" },
    reactivate:   { status: 400, note: "resolveCardAuth: state=pending, not terminated" },
    wipe:         { status: 400, note: "handleRequestWipeAction: state=pending, not active" },
    terminate:    { status: 400, note: "handleTerminateAction: state=pending, not active/wipe_requested" },
    balanceCheck: { status: 200, note: "validateCardTap: pending state, deterministic K2, balance=0" },
    cardInfo:     { status: 200, note: "resolveCardIdentity: skipCmac, returns pending state info" },
    identifyCard: { status: 200, note: "identifies card regardless of state" },
  },

  // "keys_delivered" = operator programmed keys, card never tapped.
  // CMAC validation against latest_issued_version keys auto-activates on match.
  [CARD_STATE.KEYS_DELIVERED]: {
    tap:          { status: 200, toState: CARD_STATE.ACTIVE, note: "auto-activates on CMAC match" },
    callback:     { status: 200, note: "callback uses resolveCardIdentity (no state check); processes with balance" },
    topup:        { status: 200, toState: CARD_STATE.ACTIVE, note: "validateCardTap auto-activates, credits" },
    posCharge:    { status: 200, toState: CARD_STATE.ACTIVE, note: "validateCardTap auto-activates, debits (has balance)" },
    refund:       { status: 200, toState: CARD_STATE.ACTIVE, note: "validateCardTap auto-activates, credits" },
    lock:         { status: 400, note: "resolveCardAuth: state=keys_delivered, not active/discovered" },
    reactivate:   { status: 400, note: "resolveCardAuth: not terminated" },
    wipe:         { status: 400, note: "state=keys_delivered, not active" },
    terminate:    { status: 400, note: "state=keys_delivered, not active/wipe_requested" },
    balanceCheck: { status: 200, toState: CARD_STATE.ACTIVE, note: "validateCardTap auto-activates, returns balance" },
    cardInfo:     { status: 200, note: "resolveCardIdentity: skipCmac, returns keys_delivered info" },
    identifyCard: { status: 200, note: "identifies card" },
  },

  // "discovered" = card tapped with known issuer key. Treated like active.
  [CARD_STATE.DISCOVERED]: {
    tap:          { status: 200, note: "discovered treated like active" },
    callback:     { status: 200, note: "valid callback with bolt11" },
    topup:        { status: 200, note: "validateCardTap passes, credits balance" },
    posCharge:    { status: 200, note: "validateCardTap passes, debits balance" },
    refund:       { status: 200, note: "validateCardTap passes, credits balance" },
    lock:         { status: 200, toState: CARD_STATE.TERMINATED, note: "discovered is lockable (active-like)" },
    reactivate:   { status: 400, note: "not terminated" },
    wipe:         { status: 400, note: "state=discovered, not active" },
    terminate:    { status: 400, note: "state=discovered, not active/wipe_requested" },
    balanceCheck: { status: 200, note: "validateCardTap passes, returns balance" },
    cardInfo:     { status: 200, note: "returns card info with CMAC" },
    identifyCard: { status: 200, note: "identifies card" },
  },

  // "active" = fully operational card.
  [CARD_STATE.ACTIVE]: {
    tap:          { status: 200, note: "normal tap" },
    callback:     { status: 200, note: "valid callback" },
    topup:        { status: 200, note: "credits balance" },
    posCharge:    { status: 200, note: "debits balance" },
    refund:       { status: 200, note: "credits balance" },
    lock:         { status: 200, toState: CARD_STATE.TERMINATED, note: "active card can be locked → terminated" },
    reactivate:   { status: 400, note: "already active, not terminated" },
    wipe:         { status: 200, toState: CARD_STATE.WIPE_REQUESTED, note: "active card can request wipe" },
    terminate:    { status: 200, toState: CARD_STATE.TERMINATED, note: "active card can be terminated" },
    balanceCheck: { status: 200, note: "returns balance" },
    cardInfo:     { status: 200, note: "returns card info" },
    identifyCard: { status: 200, note: "identifies card" },
  },

  // "wipe_requested" = card pending wipe/re-programming.
  // handleLnurlw does NOT check wipe_requested (only checks terminated),
  // but validateCardTap rejects wipe_requested.
  [CARD_STATE.WIPE_REQUESTED]: {
    tap:          { status: 200, note: "handleLnurlw only rejects terminated; wipe_requested passes through to config + CMAC" },
    callback:     { status: 200, note: "callback processes with valid tap params" },
    topup:        { status: 403, note: "validateCardTap rejects wipe_requested" },
    posCharge:    { status: 403, note: "validateCardTap rejects wipe_requested" },
    refund:       { status: 403, note: "validateCardTap rejects wipe_requested" },
    lock:         { status: 400, note: "not active/discovered state" },
    reactivate:   { status: 400, note: "not terminated" },
    wipe:         { status: 400, note: "not active state" },
    terminate:    { status: 200, toState: CARD_STATE.TERMINATED, note: "wipe_requested cards can be terminated" },
    balanceCheck: { status: 403, note: "validateCardTap rejects wipe_requested" },
    cardInfo:     { status: 200, note: "resolveCardIdentity skipCmac: returns wipe_requested info" },
    identifyCard: { status: 200, note: "identify works for any state" },
  },

  // "terminated" = card permanently disabled until re-activated.
  [CARD_STATE.TERMINATED]: {
    tap:          { status: 403, note: "handleLnurlw rejects terminated" },
    callback:     { status: 200, note: "callback uses resolveCardIdentity (no state check); processes payment" },
    topup:        { status: 403, note: "validateCardTap rejects terminated" },
    posCharge:    { status: 403, note: "validateCardTap rejects terminated" },
    refund:       { status: 403, note: "validateCardTap rejects terminated" },
    lock:         { status: 400, note: "already terminated" },
    reactivate:   { status: 200, toState: CARD_STATE.KEYS_DELIVERED, note: "terminated → keys_delivered via deliverKeys" },
    wipe:         { status: 400, note: "not active state" },
    terminate:    { status: 400, note: "not active/wipe_requested" },
    balanceCheck: { status: 403, note: "validateCardTap rejects terminated" },
    cardInfo:     { status: 200, note: "terminated cards return limited info via skipCmac path" },
    identifyCard: { status: 200, note: "identify works, reports terminated state" },
  },
};

// ── Helpers for each action ──────────────────────────────────────────────────

async function performTap(env: Env, counter: number): Promise<Response> {
  const { pHex, cHex } = tapParams(env, counter);
  return handleLnurlw(makeRequest(`/?p=${pHex}&c=${cHex}`), env);
}

async function performCallback(env: Env, counter: number): Promise<Response> {
  const { pHex, cHex } = tapParams(env, counter);
  const url = `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1testinvoice&amount=10000`;
  return handleLnurlpPayment(makeRequest(url), env);
}

async function performTopup(env: Env, counter: number, amount: number): Promise<Response> {
  const { pHex, cHex } = tapParams(env, counter);
  return handleTopupApply(
    makeRequest("/operator/topup/apply", "POST", { p: pHex, c: cHex, amount }),
    env,
    TEST_SESSION,
  );
}

async function performPosCharge(env: Env, counter: number, amount: number): Promise<Response> {
  const { pHex, cHex } = tapParams(env, counter);
  return handlePosCharge(
    makeRequest("/operator/pos/charge", "POST", { p: pHex, c: cHex, amount }),
    env,
    TEST_SESSION,
  );
}

async function performRefund(env: Env, counter: number, amount: number): Promise<Response> {
  const { pHex, cHex } = tapParams(env, counter);
  return handleRefundApply(
    makeRequest("/operator/refund/apply", "POST", { p: pHex, c: cHex, amount, fullRefund: true }),
    env,
    TEST_SESSION,
  );
}

async function performLock(env: Env, counter: number): Promise<Response> {
  const { pHex, cHex } = tapParams(env, counter);
  return handleCardLock(
    makeRequest("/api/card/lock", "POST", { p: pHex, c: cHex }),
    env,
  );
}

async function performReactivate(env: Env, counter: number): Promise<Response> {
  const { pHex, cHex } = tapParams(env, counter);
  return handleCardReactivate(
    makeRequest("/api/card/reactivate", "POST", { p: pHex, c: cHex }),
    env,
  );
}

async function performWipe(env: Env): Promise<Response> {
  return handleRequestWipeAction(UID, env, makeRequest("/login"));
}

async function performTerminate(env: Env): Promise<Response> {
  return handleTerminateAction(UID, env, makeRequest("/login"));
}

async function performBalanceCheck(env: Env, counter: number): Promise<Response> {
  const { pHex, cHex } = tapParams(env, counter);
  return handleBalanceCheck(
    makeRequest("/api/balance-check", "POST", { p: pHex, c: cHex }),
    env,
  );
}

async function performCardInfo(env: Env, counter: number): Promise<Response> {
  const { pHex, cHex } = tapParams(env, counter);
  return handleCardInfo(
    makeRequest(`/card/info?p=${pHex}&c=${cHex}`),
    env,
  );
}

async function performIdentifyCard(env: Env, counter: number): Promise<Response> {
  const { pHex, cHex } = tapParams(env, counter);
  return handleIdentifyCard(
    makeRequest("/api/identify-card", "POST", { p: pHex, c: cHex }),
    env,
  );
}

// ── Set up specific card states ──────────────────────────────────────────────

async function setupState(env: Env, state: string): Promise<void> {
  const id = env.CARD_REPLAY.idFromName(UID);
  const stub = env.CARD_REPLAY.get(id);

  // Reset DO state completely: clear counters, taps, card state, config
  await stub.fetch(new Request("https://card-replay.internal/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }));
  mockDO(env).__cardStates.delete(UID.toLowerCase());
  mockDO(env).__cardConfigs.delete(UID.toLowerCase());

  switch (state) {
    case CARD_STATE.NEW:
    case CARD_STATE.LEGACY:
      // No DO row → getCardState returns {state:"new"}
      break;
    case CARD_STATE.PENDING:
      await markPending(env, UID);
      // Config removed; deterministic fallback provides K2
      mockDO(env).__cardConfigs.delete(UID.toLowerCase());
      break;
    case CARD_STATE.KEYS_DELIVERED:
      // deliverKeys increments latest_issued_version; re-adds config
      await deliverKeys(env, UID);
      break;
    case CARD_STATE.DISCOVERED:
      await discoverCard(env, UID, { active_version: 1 });
      break;
    case CARD_STATE.ACTIVE:
      await activateCard(env, UID, 1);
      break;
    case CARD_STATE.WIPE_REQUESTED:
      await activateCard(env, UID, 1);
      await requestWipe(env, UID);
      break;
    case CARD_STATE.TERMINATED:
      await activateCard(env, UID, 1);
      await terminateCard(env, UID);
      break;
  }
}

function freshEnv(): Env {
  return buildCardTestEnv({ uid: UID, balance: 0, operatorAuth: true });
}

// ── Matrix Tests ─────────────────────────────────────────────────────────────

const STATES = [
  CARD_STATE.NEW,
  CARD_STATE.PENDING,
  CARD_STATE.KEYS_DELIVERED,
  CARD_STATE.DISCOVERED,
  CARD_STATE.ACTIVE,
  CARD_STATE.WIPE_REQUESTED,
  CARD_STATE.TERMINATED,
];

const ACTIONS = [
  "tap",
  "callback",
  "topup",
  "posCharge",
  "refund",
  "lock",
  "reactivate",
  "wipe",
  "terminate",
  "balanceCheck",
  "cardInfo",
  "identifyCard",
] as const;

let counter = 1;
function nextCounter(): number {
  return counter++;
}

describe("Card State Machine: Transition Matrix", () => {
  for (const state of STATES) {
    const actionMap = T[state];
    if (!actionMap) continue;

    describe(`from state: ${state}`, () => {
      for (const action of ACTIONS) {
        const expected = actionMap[action];
        if (!expected) continue;

        it(`${action} → ${expected.status}${expected.toState ? ` (→ ${expected.toState})` : ""}${expected.note ? ` — ${expected.note}` : ""}`, async () => {
          counter = 1;
          const env = freshEnv();
          await setupState(env, state);

          // Set balance for states that have a DO row
          const stateRow = mockDO(env).__cardStates.get(UID.toLowerCase());
          if (stateRow) {
            stateRow.balance = INITIAL_BALANCE;
          }

          const ctr = nextCounter();
          let response: Response;

          switch (action) {
            case "tap":
              response = await performTap(env, ctr);
              break;
            case "callback":
              response = await performCallback(env, ctr);
              break;
            case "topup":
              response = await performTopup(env, ctr, 5000);
              break;
            case "posCharge":
              response = await performPosCharge(env, ctr, 1000);
              break;
            case "refund":
              response = await performRefund(env, ctr, 1000);
              break;
            case "lock":
              response = await performLock(env, ctr);
              break;
            case "reactivate":
              response = await performReactivate(env, ctr);
              break;
            case "wipe":
              response = await performWipe(env);
              break;
            case "terminate":
              response = await performTerminate(env);
              break;
            case "balanceCheck":
              response = await performBalanceCheck(env, ctr);
              break;
            case "cardInfo":
              response = await performCardInfo(env, ctr);
              break;
            case "identifyCard":
              response = await performIdentifyCard(env, ctr);
              break;
          }

          expect(response.status).toBe(expected.status);

          if (expected.toState) {
            const newState = await getCardState(env, UID);
            expect(newState.state).toBe(expected.toState);
          }
        });
      }
    });
  }
});

// ── Multi-Step Sequence Tests ────────────────────────────────────────────────

describe("Card State Machine: Multi-Step Sequences", () => {
  it("provision → discover → active → charge → terminate → reactivate → charge", async () => {
    counter = 1;
    const env = freshEnv();
    // Clear DO state so markPending can create fresh
    mockDO(env).__cardStates.delete(UID.toLowerCase());
    mockDO(env).__cardConfigs.delete(UID.toLowerCase());

    // Step 1: Mark pending then discover
    await markPending(env, UID);
    let state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.PENDING);

    await discoverCard(env, UID, { active_version: 1 });
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.DISCOVERED);

    // Step 2: Activate card
    await activateCard(env, UID, 1);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.ACTIVE);

    // Step 3: Top up (balance starts at 0 after fresh markPending)
    const credit = await performTopup(env, nextCounter(), 50000);
    expect(credit.status).toBe(200);

    // Step 4: POS charge
    const charge = await performPosCharge(env, nextCounter(), 10000);
    expect(charge.status).toBe(200);
    const chargeBody = await charge.json();
    expect((chargeBody as Record<string, unknown>).balance).toBe(40000);

    // Step 5: Terminate via lock
    const lock = await performLock(env, nextCounter());
    expect(lock.status).toBe(200);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.TERMINATED);

    // Step 6: Tap should fail
    const tapFail = await performTap(env, nextCounter());
    expect(tapFail.status).toBe(403);

    // Step 7: Reactivate
    const reactivate = await performReactivate(env, nextCounter());
    expect(reactivate.status).toBe(200);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.KEYS_DELIVERED);

    // Step 8: Tap auto-activates (keys_delivered → active)
    const reactivateTap = await performTap(env, nextCounter());
    expect(reactivateTap.status).toBe(200);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.ACTIVE);

    // Step 9: Charge again works
    const charge2 = await performPosCharge(env, nextCounter(), 5000);
    expect(charge2.status).toBe(200);
  });

  it("active → wipe_requested → terminated → reactivate → active", async () => {
    counter = 1;
    const env = freshEnv();
    await setupState(env, CARD_STATE.ACTIVE);
    mockDO(env).__cardStates.get(UID.toLowerCase())!.balance = INITIAL_BALANCE;

    // Wipe request
    const wipe = await performWipe(env);
    expect(wipe.status).toBe(200);
    let state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.WIPE_REQUESTED);

    // validateCardTap-based actions fail
    const topupFail = await performTopup(env, nextCounter(), 1000);
    expect(topupFail.status).toBe(403);

    // Terminate from wipe_requested
    const terminate = await performTerminate(env);
    expect(terminate.status).toBe(200);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.TERMINATED);

    // Reactivate
    const reactivate = await performReactivate(env, nextCounter());
    expect(reactivate.status).toBe(200);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.KEYS_DELIVERED);

    // Tap auto-activates
    const tapActivate = await performTap(env, nextCounter());
    expect(tapActivate.status).toBe(200);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.ACTIVE);
  });

  it("active → lock → terminated → lock again fails", async () => {
    counter = 1;
    const env = freshEnv();
    await setupState(env, CARD_STATE.ACTIVE);
    mockDO(env).__cardStates.get(UID.toLowerCase())!.balance = INITIAL_BALANCE;

    // Lock card
    const lock = await performLock(env, nextCounter());
    expect(lock.status).toBe(200);
    const state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.TERMINATED);

    // Second lock fails (already terminated)
    const lock2 = await performLock(env, nextCounter());
    expect(lock2.status).toBe(400);
  });

  it("active → topup → charge → refund → balance consistent", async () => {
    counter = 1;
    const env = freshEnv();
    await setupState(env, CARD_STATE.ACTIVE);
    mockDO(env).__cardStates.get(UID.toLowerCase())!.balance = 0;

    const topup = await performTopup(env, nextCounter(), 100000);
    expect(topup.status).toBe(200);

    const charge = await performPosCharge(env, nextCounter(), 30000);
    expect(charge.status).toBe(200);
    const chargeBody = await charge.json();
    expect((chargeBody as Record<string, unknown>).balance).toBe(70000);

    const refund = await performRefund(env, nextCounter(), 10000);
    expect(refund.status).toBe(200);
    const refundBody = await refund.json();
    expect((refundBody as Record<string, unknown>).balance).toBe(140000);

    const balance = await performBalanceCheck(env, nextCounter());
    expect(balance.status).toBe(200);
    const balanceBody = await balance.json();
    expect((balanceBody as Record<string, unknown>).balance).toBe(140000);
  });

  it("keys_delivered: topup and balanceCheck auto-activate independently", async () => {
    counter = 1;

    // Topup auto-activates keys_delivered
    const env1 = freshEnv();
    await setupState(env1, CARD_STATE.KEYS_DELIVERED);
    mockDO(env1).__cardStates.get(UID.toLowerCase())!.balance = 0;

    const topup = await performTopup(env1, nextCounter(), 50000);
    expect(topup.status).toBe(200);
    let state = await getCardState(env1, UID);
    expect(state.state).toBe(CARD_STATE.ACTIVE);

    // BalanceCheck auto-activates keys_delivered
    const env2 = freshEnv();
    await setupState(env2, CARD_STATE.KEYS_DELIVERED);
    mockDO(env2).__cardStates.get(UID.toLowerCase())!.balance = 5000;

    const balCheck = await performBalanceCheck(env2, nextCounter());
    expect(balCheck.status).toBe(200);
    state = await getCardState(env2, UID);
    expect(state.state).toBe(CARD_STATE.ACTIVE);
  });

  it("discovered card: tap, topup, charge, lock all work like active", async () => {
    counter = 1;
    const env = freshEnv();
    await setupState(env, CARD_STATE.DISCOVERED);
    mockDO(env).__cardStates.get(UID.toLowerCase())!.balance = 0;

    // Tap works
    const tap = await performTap(env, nextCounter());
    expect(tap.status).toBe(200);

    // Topup works
    const topup = await performTopup(env, nextCounter(), 20000);
    expect(topup.status).toBe(200);

    // Charge works
    const charge = await performPosCharge(env, nextCounter(), 5000);
    expect(charge.status).toBe(200);

    // Lock works (→ terminated)
    const lock = await performLock(env, nextCounter());
    expect(lock.status).toBe(200);
    const state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.TERMINATED);
  });

  it("terminated card: identifyCard reports state, reactivate restores", async () => {
    counter = 1;
    const env = freshEnv();
    await setupState(env, CARD_STATE.TERMINATED);

    const identify = await performIdentifyCard(env, nextCounter());
    expect(identify.status).toBe(200);
    const body = await identify.json();
    expect((body as Record<string, unknown>).card_state).toBe(CARD_STATE.TERMINATED);

    // Reactivate restores to keys_delivered
    const reactivate = await performReactivate(env, nextCounter());
    expect(reactivate.status).toBe(200);
    const state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.KEYS_DELIVERED);
  });

  it("new card: tap auto-discovers, then works like active", async () => {
    counter = 1;
    const env = freshEnv();
    await setupState(env, CARD_STATE.NEW);

    // Tap auto-discovers (new → discovered via CMAC scan)
    const tap = await performTap(env, nextCounter());
    expect(tap.status).toBe(200);
    const state = await getCardState(env, UID);
    // State becomes discovered (or active if discoverCard path sets it)
    expect([CARD_STATE.DISCOVERED, CARD_STATE.ACTIVE]).toContain(state.state);

    // After discovery, topup works
    const topup = await performTopup(env, nextCounter(), 10000);
    expect(topup.status).toBe(200);
  });

  it("full lifecycle: new → pending → discovered → active → wipe → terminate → reactivate → active", async () => {
    counter = 1;
    const env = freshEnv();
    mockDO(env).__cardStates.delete(UID.toLowerCase());
    mockDO(env).__cardConfigs.delete(UID.toLowerCase());

    const id1 = await performIdentifyCard(env, nextCounter());
    expect(id1.status).toBe(200);

    await markPending(env, UID);
    let state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.PENDING);

    await discoverCard(env, UID, { active_version: 1 });
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.DISCOVERED);

    await activateCard(env, UID, 1);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.ACTIVE);

    const topup = await performTopup(env, nextCounter(), 100000);
    expect(topup.status).toBe(200);

    const charge = await performPosCharge(env, nextCounter(), 25000);
    expect(charge.status).toBe(200);

    const wipe = await performWipe(env);
    expect(wipe.status).toBe(200);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.WIPE_REQUESTED);

    const term = await performTerminate(env);
    expect(term.status).toBe(200);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.TERMINATED);

    const reactivate = await performReactivate(env, nextCounter());
    expect(reactivate.status).toBe(200);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.KEYS_DELIVERED);

    const tap2 = await performTap(env, nextCounter());
    expect(tap2.status).toBe(200);
    state = await getCardState(env, UID);
    expect(state.state).toBe(CARD_STATE.ACTIVE);

    const bal = await performBalanceCheck(env, nextCounter());
    expect(bal.status).toBe(200);
    const balBody = await bal.json();
    expect((balBody as Record<string, unknown>).balance).toBe(75000);
  });
});

// ── State Predicate Tests ────────────────────────────────────────────────────

describe("Card State Machine: State Predicate Validation", () => {
  it("isCardUsable returns true only for active and discovered", () => {
    expect(isCardUsable(CARD_STATE.ACTIVE)).toBe(true);
    expect(isCardUsable(CARD_STATE.DISCOVERED)).toBe(true);
    expect(isCardUsable(CARD_STATE.NEW)).toBe(false);
    expect(isCardUsable(CARD_STATE.PENDING)).toBe(false);
    expect(isCardUsable(CARD_STATE.KEYS_DELIVERED)).toBe(false);
    expect(isCardUsable(CARD_STATE.WIPE_REQUESTED)).toBe(false);
    expect(isCardUsable(CARD_STATE.TERMINATED)).toBe(false);
  });

  it("isCardTerminated returns true only for terminated", () => {
    expect(isCardTerminated(CARD_STATE.TERMINATED)).toBe(true);
    expect(isCardTerminated(CARD_STATE.ACTIVE)).toBe(false);
    expect(isCardTerminated(CARD_STATE.DISCOVERED)).toBe(false);
    expect(isCardTerminated(CARD_STATE.WIPE_REQUESTED)).toBe(false);
  });

  it("canAutoActivate returns true only for keys_delivered", () => {
    expect(canAutoActivate(CARD_STATE.KEYS_DELIVERED)).toBe(true);
    expect(canAutoActivate(CARD_STATE.ACTIVE)).toBe(false);
    expect(canAutoActivate(CARD_STATE.NEW)).toBe(false);
    expect(canAutoActivate(CARD_STATE.PENDING)).toBe(false);
  });

  it("canTransact returns true for active, discovered, and keys_delivered", () => {
    expect(canTransact(CARD_STATE.ACTIVE)).toBe(true);
    expect(canTransact(CARD_STATE.DISCOVERED)).toBe(true);
    expect(canTransact(CARD_STATE.KEYS_DELIVERED)).toBe(true);
    expect(canTransact(CARD_STATE.NEW)).toBe(false);
    expect(canTransact(CARD_STATE.PENDING)).toBe(false);
    expect(canTransact(CARD_STATE.WIPE_REQUESTED)).toBe(false);
    expect(canTransact(CARD_STATE.TERMINATED)).toBe(false);
  });
});
