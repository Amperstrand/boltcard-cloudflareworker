/**
 * Minimal Node.js + browser global declarations for test files.
 * The Worker source code doesn't use Node.js APIs, but test files do.
 * This avoids needing @types/node as a dependency.
 */

declare var process: {
  env: Record<string, string | undefined>;
  platform: string;
  argv: string[];
};

declare function require(id: string): any;

declare const localStorage: Storage;
declare const document: Document;

declare module "node:child_process" {
  export function execSync(command: string, options?: Record<string, unknown>): string;
  export function execFileSync(command: string, args?: string[], options?: Record<string, unknown>): string;
  export function spawn(
    command: string,
    args?: string[],
    options?: Record<string, unknown>
  ): { stdout: string; stderr: string; on(event: string, cb: () => void): void };
}

declare module "node:assert/strict" {
  export function equal(actual: unknown, expected: unknown, message?: string): void;
  export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
  export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
  export function ok(value: unknown, message?: string): void;
  export function fail(message: string): never;
  const _default: { equal: typeof equal; strictEqual: typeof strictEqual; deepEqual: typeof deepEqual; ok: typeof ok; fail: typeof fail };
  export default _default;
}
