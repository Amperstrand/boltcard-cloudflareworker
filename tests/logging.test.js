import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";

const LEGACY_UID_CONFIGS = {
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

const DO_CARD_CONFIGS = {
  "04996c6a926980": JSON.parse(LEGACY_UID_CONFIGS["04996c6a926980"]),
};

const seedDoConfigs = (replay, configs = DO_CARD_CONFIGS) => {
  Object.entries(configs).forEach(([uid, config]) => {
    replay.__cardConfigs.set(uid.toLowerCase(), config);
  });
  return replay;
};

const makeEnv = () => ({
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  UID_CONFIG: {
    get: async (key) => LEGACY_UID_CONFIGS[key] ?? null,
    put: async () => {},
  },
  CARD_REPLAY: seedDoConfigs(makeReplayNamespace()),
});

const makeRequest = (path, method = "GET", body = null, requestEnv) => {
  const url = "https://test.local" + path;
  const options = { method };
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
      env.CARD_REPLAY.__cardConfigs.set("04996c6a926980", DO_CARD_CONFIGS["04996c6a926980"]);

      const response = await makeRequest(
        "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
        "GET",
        null,
        env
      );

      expect(response.status).toBe(200);
      expect(env.CARD_REPLAY.__counters.get("04996c6a926980")).toBe(3);
    });
  });

  describe("withdrawHandler logging", () => {
    it("should log on successful withdraw response construction", async () => {
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(" "));

      try {
        const env = makeEnv();
        env.CARD_REPLAY.__cardConfigs.set("04996c6a926980", DO_CARD_CONFIGS["04996c6a926980"]);

        const response = await makeRequest(
          "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
          "GET",
          null,
          env
        );

        expect(response.status).toBe(200);

        const withdrawLog = logs.find(l => l.includes("Withdraw response constructed"));
        expect(withdrawLog).toBeDefined();
        expect(withdrawLog).toContain("04996c6a926980");
      } finally {
        console.log = originalLog;
      }
    });

    it("should log warn on CMAC validation failure in withdraw", async () => {
      const warns = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warns.push(args.join(" "));

      try {
        const env = makeEnv();
        env.CARD_REPLAY.__cardConfigs.set("04996c6a926980", {
          payment_method: "clnrest",
        });
        env.UID_CONFIG = {
          get: async (uid) => uid === "04996c6a926980"
            ? JSON.stringify({ payment_method: "clnrest" })
            : null,
          put: async () => {},
        };

        const response = await makeRequest(
          "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
          "GET",
          null,
          env
        );

        expect(response.status).toBe(400);

        const cmacLog = warns.find(l => l.includes("CMAC"));
        expect(cmacLog).toBeDefined();
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("handleLnurlw info-level logging", () => {
    it("should log LNURLW decrypted at info level with uidHex and counterValue", async () => {
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(" "));

      try {
        const env = makeEnv();
        env.CARD_REPLAY.__cardConfigs.set("04996c6a926980", DO_CARD_CONFIGS["04996c6a926980"]);

        await makeRequest(
          "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
          "GET",
          null,
          env
        );

        const decryptLog = logs.find(l => l.includes("LNURLW decrypted"));
        expect(decryptLog).toBeDefined();
        expect(decryptLog).toContain("04996c6a926980");
      } finally {
        console.log = originalLog;
      }
    });

    it("should log card config loaded at info level", async () => {
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(" "));

      try {
        const env = makeEnv();
        env.CARD_REPLAY.__cardConfigs.set("04996c6a926980", DO_CARD_CONFIGS["04996c6a926980"]);

        await makeRequest(
          "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
          "GET",
          null,
          env
        );

        const configLog = logs.find(l => l.includes("Card config loaded"));
        expect(configLog).toBeDefined();
        expect(configLog).toContain("clnrest");
      } finally {
        console.log = originalLog;
      }
    });

    it("should log LNURLW request accepted at info level", async () => {
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(" "));

      try {
        const env = makeEnv();
        env.CARD_REPLAY.__cardConfigs.set("04996c6a926980", DO_CARD_CONFIGS["04996c6a926980"]);

        await makeRequest(
          "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE",
          "GET",
          null,
          env
        );

        const acceptedLog = logs.find(l => l.includes("LNURLW request accepted"));
        expect(acceptedLog).toBeDefined();
        expect(acceptedLog).toContain("04996c6a926980");
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("catch-all route log level", () => {
    it("should log unknown routes at warn level (not error)", async () => {
      const warns = [];
      const errors = [];
      const originalWarn = console.warn;
      const originalError = console.error;
      console.warn = (...args) => warns.push(args.join(" "));
      console.error = (...args) => errors.push(args.join(" "));

      try {
        await makeRequest("/some-unknown-path", "GET", null, makeEnv());

        const routeWarn = warns.find(l => l.includes("Route not found"));
        const routeError = errors.find(l => l.includes("Route not found"));

        expect(routeWarn).toBeDefined();
        expect(routeError).toBeUndefined();
      } finally {
        console.warn = originalWarn;
        console.error = originalError;
      }
    });
  });
});
