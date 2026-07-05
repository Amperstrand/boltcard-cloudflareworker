/**
 * Minimal Node.js global declarations for test files.
 * The Worker source code doesn't use Node.js APIs, but test files do.
 * This avoids needing @types/node as a dependency.
 */

declare var process: {
  env: Record<string, string | undefined>;
  platform: string;
  argv: string[];
};

declare function require(id: string): unknown;

declare module "node:child_process" {
  export function execSync(command: string): string;
  export function execFileSync(command: string, args?: string[]): string;
  export function spawn(
    command: string,
    args?: string[]
  ): { stdout: string; stderr: string; on(event: string, cb: () => void): void };
}

declare module "node:assert/strict" {
  export function equal(actual: unknown, expected: unknown): void;
  export function strictEqual(actual: unknown, expected: unknown): void;
  export function deepEqual(actual: unknown, expected: unknown): void;
  export function ok(value: unknown): void;
  export function fail(message: string): never;
  const _default: { equal: typeof equal; strictEqual: typeof strictEqual; deepEqual: typeof deepEqual; ok: typeof ok; fail: typeof fail };
  export default _default;
}
