export const TEST_OPERATOR_AUTH = {
  OPERATOR_PIN: "1234",
  OPERATOR_SESSION_SECRET: "test-session-secret-for-jest",
  __TEST_OPERATOR_SESSION: {
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 43200,
    shiftId: "test-shift-00000000-0000-0000-0000-000000000000",
  },
};
