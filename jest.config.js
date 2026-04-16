export default {
  testEnvironment: "node",
  transform: {},
  moduleNameMapper: {
    "^cloudflare:workers$": "<rootDir>/tests/cloudflare-workers-shim.js",
  },
};
