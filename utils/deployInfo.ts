import { BUILD_REVISION, JS_FINGERPRINT } from "./buildInfo.js";

let _initialized = false;
let _deployRevision = BUILD_REVISION;
let _jsFingerprint = JS_FINGERPRINT;

export function getDeployRevision(): string {
  return _deployRevision;
}

export function getJsFingerprint(): string {
  return _jsFingerprint;
}

export function initDeployInfo(revision: string, jsHashes: string[]): void {
  _deployRevision = revision;
  _jsFingerprint = jsHashes.slice().sort().join(",");
  _initialized = true;
}

export function isDeployInfoInitialized(): boolean {
  return _initialized;
}

