import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { logger } from "../utils/logger.js";
import type { Env, CardConfig } from "../types/core.js";

const LoggerClass = logger.constructor as any;

const LEGACY_UID_CONFIGS: Record<string, string> = {
  "04996c6a926980": JSON.stringify({
    K2: "B45775776CB224C75BCDE7CA3704E933",
    payment_method: "clnrest",
    clnrest: {
      protocol: "https",
      host: "https://cln.example.com",
      port: 3001,
      rune: "abcd1234efgh5678ijkl",
    },
  }),
};

const DO_CARD_CONFIGS: Record<string, Record<string, unknown>> = {
  "04996c6a926980": JSON.parse(LEGACY_UID_CONFIGS["04996c6a926980"]!),
};

const seedDoConfigs = (replay: ReturnType<typeof makeReplayNamespace>, configs = DO_CARD_CONFIGS) => {
  Object.entries(configs).forEach(([uid, config]) => {
    replay.__cardConfigs.set(uid.toLowerCase(), config as unknown as CardConfig);
  });
  return replay;
};

const makeEnv = (): Env => ({
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  UID_CONFIG: {
    get: async (key: string) => LEGACY_UID_CONFIGS[key] ?? null,
    put: async () => {},
  },
  CARD_REPLAY: seedDoConfigs(makeReplayNamespace()),
} as unknown as Env);

const makeRequest = (path: string, method: string = "GET", body: Record<string, unknown> | null = null, requestEnv: Env) => {
  const url = "https://test.local" + path;
  const options: RequestInit = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv);
};

describe("Logging and Observability", () => {
  describe("favicon.ico returns 204", () => {
    it("should return 204 No Content for /favicon.ico", async () => {
      const response = await makeRequest("/favicon.ico", "GET", null, makeEnv());
      expect(response.status).toBe(204);
    });
  });

  describe("LNURLW records counter atomically on first tap", () => {
    it("should advance counter on initial GET for clnrest payment method", async () => {
      const env = makeEnv();
      (env.CARD_REPLAY as any).__cardConfigs.set("04996c6a926980", DO_CARD_CONFIGS["04996c6a926980"]);

      const response = await makeRequest(
        "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
        "GET",
        null,
        env
      );

      expect(response.status).toBe(200);
      expect((env.CARD_REPLAY as any).__counters.get("04996c6a926980")).toBe(3);
    });
  });

  describe("withdrawHandler logging", () => {
    it("should log on successful withdraw response construction", async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        const env = makeEnv();
        (env.CARD_REPLAY as any).__cardConfigs.set("04996c6a926980", DO_CARD_CONFIGS["04996c6a926980"]);

        const response = await makeRequest(
          "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
          "GET",
          null,
          env
        );

        expect(response.status).toBe(200);

        const withdrawLog = logs.find((l: string) => l.includes("Withdraw response constructed"));
        expect(withdrawLog).toBeDefined();
        expect(withdrawLog).toContain("04996c6a926980");
      } finally {
        console.log = originalLog;
      }
    });

    it("should log warn on CMAC validation failure in withdraw", async () => {
      const warns: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warns.push(args.join(" "));

      try {
        const env = makeEnv();
        (env.CARD_REPLAY as any).__cardConfigs.set("04996c6a926980", {
          payment_method: "clnrest",
        });
        env.UID_CONFIG = {
          get: async (uid: string) => uid === "04996c6a926980"
            ? JSON.stringify({ payment_method: "clnrest" })
            : null,
          put: async () => {},
        } as any;

        const response = await makeRequest(
          "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
          "GET",
          null,
          env
        );

        expect(response.status).toBe(403);

        const cmacLog = warns.find((l: string) => l.includes("CMAC"));
        expect(cmacLog).toBeDefined();
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("handleLnurlw info-level logging", () => {
    it("should log LNURLW decrypted at info level with uidHex and counterValue", async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        const env = makeEnv();
        (env.CARD_REPLAY as any).__cardConfigs.set("04996c6a926980", DO_CARD_CONFIGS["04996c6a926980"]);

        await makeRequest(
          "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
          "GET",
          null,
          env
        );

        const decryptLog = logs.find((l: string) => l.includes("LNURLW decrypted"));
        expect(decryptLog).toBeDefined();
        expect(decryptLog).toContain("04996c6a926980");
      } finally {
        console.log = originalLog;
      }
    });

    it("should log card config loaded at info level", async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        const env = makeEnv();
        (env.CARD_REPLAY as any).__cardConfigs.set("04996c6a926980", DO_CARD_CONFIGS["04996c6a926980"]);

        await makeRequest(
          "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
          "GET",
          null,
          env
        );

        const configLog = logs.find((l: string) => l.includes("Card config loaded"));
        expect(configLog).toBeDefined();
        expect(configLog).toContain("clnrest");
      } finally {
        console.log = originalLog;
      }
    });

    it("should log LNURLW request accepted at info level", async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        const env = makeEnv();
        (env.CARD_REPLAY as any).__cardConfigs.set("04996c6a926980", DO_CARD_CONFIGS["04996c6a926980"]);

        await makeRequest(
          "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
          "GET",
          null,
          env
        );

        const acceptedLog = logs.find((l: string) => l.includes("LNURLW request accepted"));
        expect(acceptedLog).toBeDefined();
        expect(acceptedLog).toContain("04996c6a926980");
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("catch-all route log level", () => {
    it("should log unknown page routes at info level", async () => {
      const infos: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => infos.push(args.join(" "));

      try {
        await makeRequest("/some-unknown-path", "GET", null, makeEnv());

        const redirectLog = infos.find((l: string) => l.includes("Unknown page redirect"));
        expect(redirectLog).toBeDefined();
      } finally {
        console.log = originalLog;
      }
    });

    it("should log unknown API routes at warn level", async () => {
      const warns: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warns.push(args.join(" "));

      try {
        await makeRequest("/api/nonexistent", "GET", null, makeEnv());

        const apiWarn = warns.find((l: string) => l.includes("API route not found"));
        expect(apiWarn).toBeDefined();
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("Logger level gating", () => {
    afterEach(() => {
      logger.setLevel("info");
    });

    it("should emit debug messages when level is debug", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        logger.setLevel("debug");
        logger.debug("test debug message", { key: "value" });

        const debugLog = logs.find((l: string) => l.includes("test debug message"));
        expect(debugLog).toBeDefined();
        expect(debugLog).toContain("DEBUG");
      } finally {
        console.log = originalLog;
      }
    });

    it("should suppress debug messages at info level", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        logger.setLevel("info");
        logger.debug("should not appear");

        const debugLog = logs.find((l: string) => l.includes("should not appear"));
        expect(debugLog).toBeUndefined();
      } finally {
        console.log = originalLog;
      }
    });

    it("should emit trace messages when level is trace", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        logger.setLevel("trace");
        logger.trace("test trace message", { key: "value" });

        const traceLog = logs.find((l: string) => l.includes("test trace message"));
        expect(traceLog).toBeDefined();
        expect(traceLog).toContain("TRACE");
      } finally {
        console.log = originalLog;
      }
    });

    it("should suppress trace messages at debug level", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        logger.setLevel("debug");
        logger.trace("should not appear");

        const traceLog = logs.find((l: string) => l.includes("should not appear"));
        expect(traceLog).toBeUndefined();
      } finally {
        console.log = originalLog;
      }
    });

    it("should not change level for invalid level name", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        logger.setLevel("invalid" as any);
        logger.debug("should not appear since level stays info");
        const debugLog = logs.find((l: string) => l.includes("should not appear"));
        expect(debugLog).toBeUndefined();
      } finally {
        console.log = originalLog;
      }
    });

    it("should format message without context", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        logger.setLevel("info");
        logger.info("no context");
        const logEntry = logs.find((l: string) => l.includes("no context"));
        expect(logEntry).toBeDefined();
        expect(logEntry).not.toContain("{");
      } finally {
        console.log = originalLog;
      }
    });

    it("should suppress info messages at warn level", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        logger.setLevel("warn");
        logger.info("should not appear");
        const infoLog = logs.find((l: string) => l.includes("should not appear"));
        expect(infoLog).toBeUndefined();
      } finally {
        console.log = originalLog;
      }
    });

    it("should suppress warn messages at error level", () => {
      const warns: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warns.push(args.join(" "));

      try {
        logger.setLevel("error");
        logger.warn("should not appear");
        const warnLog = warns.find((l: string) => l.includes("should not appear"));
        expect(warnLog).toBeUndefined();
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("Logger constructor", () => {
    it("falls back to info level for unknown level string", () => {
      const testLogger = new LoggerClass("nonexistent");
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));
      try {
        testLogger.info("visible");
        testLogger.debug("hidden");
        expect(logs.find((l: string) => l.includes("visible"))).toBeDefined();
        expect(logs.find((l: string) => l.includes("hidden"))).toBeUndefined();
      } finally {
        console.log = origLog;
      }
    });
  });
});
