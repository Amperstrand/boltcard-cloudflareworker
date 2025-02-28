// testVectors.js
export const TEST_VECTORS = [
  {
    p: "4E2E289D945A66BB13377A728884E867",
    c: "E19CCB1FED8892CE",
    expectedUID: "04996c6a926980",
    expectedCounter: "000003",
    expectedSv2: [60, 195, 0, 1, 0, 128, 4, 153, 108, 106, 146, 105, 128, 3, 0, 0],
    expectedKs: [242, 92, 75, 92, 230, 171, 63, 244, 5, 242, 135, 175, 172, 78, 77, 26],
    expectedCm: [118, 225, 233, 156, 238, 203, 64, 31, 163, 237, 110, 136, 112, 146, 124, 206],
    expectedCt: [225, 156, 203, 31, 237, 136, 146, 206]
  },
  {
    p: "00F48C4F8E386DED06BCDC78FA92E2FE",
    c: "66B4826EA4C155B4",
    expectedUID: "04996c6a926980",
    expectedCounter: "000005",
    expectedSv2: [60, 195, 0, 1, 0, 128, 4, 153, 108, 106, 146, 105, 128, 5, 0, 0],
    expectedKs: [73, 70, 39, 105, 116, 24, 126, 152, 96, 101, 139, 189, 130, 16, 200, 190],
    expectedCm: [94, 102, 243, 180, 93, 130, 2, 110, 198, 164, 241, 193, 67, 85, 112, 180],
    expectedCt: [102, 180, 130, 110, 164, 193, 85, 180]
  },
  {
    p: "0DBF3C59B59B0638D60B5842A997D4D1",
    c: "CC61660C020B4D96",
    expectedUID: "04996c6a926980",
    expectedCounter: "000007",
    expectedSv2: [60, 195, 0, 1, 0, 128, 4, 153, 108, 106, 146, 105, 128, 7, 0, 0],
    expectedKs: [97, 189, 177, 81, 15, 79, 217, 5, 102, 95, 162, 58, 192, 199, 38, 97],
    expectedCm: [40, 204, 202, 97, 87, 102, 6, 12, 101, 2, 250, 11, 199, 77, 73, 150],
    expectedCt: [204, 97, 102, 12, 2, 11, 77, 150]
  }
];

export function assertEqual(name, actual, expected) {
  if (actual !== expected) {
    console.error(`❌ ${name} Mismatch! Expected: ${expected}, Got: ${actual}`);
  } else {
    console.log(`✅ ${name} OK! (${actual})`);
  }
}

export function assertArrayEqual(name, actual, expected) {
  if (!actual.every((val, idx) => val === expected[idx])) {
    console.error(`❌ ${name} Mismatch! Expected: ${expected}, Got: ${Array.from(actual)}`);
  } else {
    console.log(`✅ ${name} OK!`);
  }
}
