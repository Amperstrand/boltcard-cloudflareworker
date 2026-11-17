import { env } from "cloudflare:workers";
import { makeReplayNamespace } from "../replayNamespace.js";
import { CONTRACT_CASES, normalizeVerdict } from "./mockConformanceCases.js";
import type { ContractCase } from "./mockConformanceCases.js";

type DoFetch = (request: Request) => Promise<Response>;

interface Verdict {
  status: number;
  body: unknown;
}

async function runCase(fetchFn: DoFetch, contractCase: ContractCase): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  const ctx: unknown[] = [];
  for (const step of contractCase.steps) {
    const req = step(ctx);
    const init: RequestInit = { method: req.method };
    if (req.method === "POST") {
      init.headers = { "Content-Type": "application/json" };
      init.body = req.rawBody !== undefined ? req.rawBody : JSON.stringify(req.body ?? {});
    }
    const res = await fetchFn(new Request(`http://do${req.path}`, init));
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    ctx.push(parsed);
    verdicts.push({ status: res.status, body: normalizeVerdict(parsed) });
  }
  return verdicts;
}

describe("mock conformance: mock vs real DO verdict parity", () => {
  CONTRACT_CASES.forEach((contractCase, index) => {
    it(contractCase.name, async () => {
      const ns = (env as Env & { CARD_REPLAY: DurableObjectNamespace }).CARD_REPLAY;
      const realStub = ns.get(ns.idFromName(`mockconf-real-${index}`));
      const mockStub = makeReplayNamespace().getByName(`mockconf-mock-${index}`);
      const mockVerdicts = await runCase((request) => mockStub.fetch(request), contractCase);

      if (contractCase.platformDivergence) {
        // PARKED: the real-DO leg rejects at the workerd stub RPC boundary
        // (uncatchable jsg SyntaxError) — assert the mock against the
        // dispatcher's documented oracle instead. See mockConformanceCases.ts.
        expect(mockVerdicts).toEqual(contractCase.platformDivergence.expected);
        return;
      }

      const realVerdicts = await runCase((request) => realStub.fetch(request), contractCase);
      expect(mockVerdicts).toEqual(realVerdicts);
    });
  });
});
