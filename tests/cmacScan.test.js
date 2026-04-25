import { cmacScanVersions } from "../utils/cmacScan.js";
import { hexToBytes } from "../cryptoutils.js";

const TV = {
  uid: hexToBytes("04996c6a926980"),
  ctr: hexToBytes("000003"),
  c: "E19CCB1FED8892CE",
  k2: hexToBytes("b45775776cb224c75bcde7ca3704e933"),
};

const wrongK2 = hexToBytes("00000000000000000000000000000000");

describe("cmacScanVersions", () => {
  test("returns matchedVersion when K2 matches", async () => {
    const { matchedVersion } = await cmacScanVersions(TV.uid, TV.ctr, TV.c, {
      k2ForVersion: () => TV.k2,
      highVersion: 3,
      lowVersion: 1,
    });
    expect(matchedVersion).toBe(3);
  });

  test("scans downward and finds match at lower version", async () => {
    const { matchedVersion } = await cmacScanVersions(TV.uid, TV.ctr, TV.c, {
      k2ForVersion: (v) => v === 1 ? TV.k2 : wrongK2,
      highVersion: 5,
      lowVersion: 1,
    });
    expect(matchedVersion).toBe(1);
  });

  test("returns null when no version matches", async () => {
    const { matchedVersion, attempts } = await cmacScanVersions(TV.uid, TV.ctr, TV.c, {
      k2ForVersion: () => wrongK2,
      highVersion: 5,
      lowVersion: 1,
    });
    expect(matchedVersion).toBeNull();
    expect(attempts).toHaveLength(5);
    expect(attempts.every(a => a.cmac_validated === false)).toBe(true);
  });

  test("stopOnFirst=false scans all versions and collects all matches", async () => {
    const { matchedVersion, attempts } = await cmacScanVersions(TV.uid, TV.ctr, TV.c, {
      k2ForVersion: (v) => (v === 2 || v === 5) ? TV.k2 : wrongK2,
      highVersion: 5,
      lowVersion: 1,
      stopOnFirst: false,
    });
    expect(matchedVersion).toBe(5);
    expect(attempts).toHaveLength(5);
    const matches = attempts.filter(a => a.cmac_validated);
    expect(matches).toHaveLength(2);
    expect(matches.map(m => m.version)).toEqual([5, 2]);
  });

  test("scans upward when highVersion < lowVersion", async () => {
    const { matchedVersion, attempts } = await cmacScanVersions(TV.uid, TV.ctr, TV.c, {
      k2ForVersion: (v) => v === 4 ? TV.k2 : wrongK2,
      highVersion: 0,
      lowVersion: 5,
      stopOnFirst: false,
    });
    expect(matchedVersion).toBe(4);
    expect(attempts).toHaveLength(6);
    expect(attempts[0].version).toBe(0);
    expect(attempts[5].version).toBe(5);
  });

  test("single version range works", async () => {
    const { matchedVersion, attempts } = await cmacScanVersions(TV.uid, TV.ctr, TV.c, {
      k2ForVersion: () => TV.k2,
      highVersion: 3,
      lowVersion: 3,
    });
    expect(matchedVersion).toBe(3);
    expect(attempts).toHaveLength(1);
  });

  test("attempts are ordered from highVersion to lowVersion", async () => {
    const { attempts } = await cmacScanVersions(TV.uid, TV.ctr, TV.c, {
      k2ForVersion: () => wrongK2,
      highVersion: 5,
      lowVersion: 2,
    });
    expect(attempts.map(a => a.version)).toEqual([5, 4, 3, 2]);
  });
});
