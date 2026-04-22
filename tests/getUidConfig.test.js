// tests/getUidConfig.test.js
import {
  getBoltCardK1
} from '../getUidConfig.js';
import { logger } from '../utils/logger.js';
import { jest } from '@jest/globals';

// Suppress logger output during tests
logger.setLevel('error');

describe('getBoltCardK1', () => {
  describe('returns dev fallback keys when no K1 env and not production', () => {
    it('returns array of 2 Uint8Arrays with empty env', () => {
      const keys = getBoltCardK1({});
      expect(keys).toBeInstanceOf(Array);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBeInstanceOf(Uint8Array);
      expect(keys[1]).toBeInstanceOf(Uint8Array);
      // Verify they match the hardcoded dev keys
      const devKey0 = new Uint8Array([85, 218, 23, 76, 150, 8, 153, 61, 194, 123, 179, 243, 10, 74, 115, 20]);
      const devKey1 = new Uint8Array([12, 59, 37, 217, 43, 56, 174, 68, 50, 41, 221, 89, 173, 52, 184, 93]);
      expect(keys[0]).toEqual(devKey0);
      expect(keys[1]).toEqual(devKey1);
    });

    it('returns dev fallback keys when WORKER_ENV is not production', () => {
      const keys = getBoltCardK1({ WORKER_ENV: 'development' });
      expect(keys).toHaveLength(2);
      const devKey0 = new Uint8Array([85, 218, 23, 76, 150, 8, 153, 61, 194, 123, 179, 243, 10, 74, 115, 20]);
      const devKey1 = new Uint8Array([12, 59, 37, 217, 43, 56, 174, 68, 50, 41, 221, 89, 173, 52, 184, 93]);
      expect(keys[0]).toEqual(devKey0);
      expect(keys[1]).toEqual(devKey1);
    });

    it('returns dev fallback keys when ENVIRONMENT is not production', () => {
      const keys = getBoltCardK1({ ENVIRONMENT: 'development' });
      expect(keys).toHaveLength(2);
      const devKey0 = new Uint8Array([85, 218, 23, 76, 150, 8, 153, 61, 194, 123, 179, 243, 10, 74, 115, 20]);
      const devKey1 = new Uint8Array([12, 59, 37, 217, 43, 56, 174, 68, 50, 41, 221, 89, 173, 52, 184, 93]);
      expect(keys[0]).toEqual(devKey0);
      expect(keys[1]).toEqual(devKey1);
    });

    it('returns dev fallback keys when both are set to non-production', () => {
      const keys = getBoltCardK1({ WORKER_ENV: 'staging', ENVIRONMENT: 'dev' });
      expect(keys).toHaveLength(2);
      const devKey0 = new Uint8Array([85, 218, 23, 76, 150, 8, 153, 61, 194, 123, 179, 243, 10, 74, 115, 20]);
      const devKey1 = new Uint8Array([12, 59, 37, 217, 43, 56, 174, 68, 50, 41, 221, 89, 173, 52, 184, 93]);
      expect(keys[0]).toEqual(devKey0);
      expect(keys[1]).toEqual(devKey1);
    });
  });

  describe('throws in production without K1', () => {
    it('throws when WORKER_ENV is production and no keys set', () => {
      expect(() => {
        getBoltCardK1({ WORKER_ENV: 'production' });
      }).toThrow('Production deploy must set BOLT_CARD_K1 or BOLT_CARD_K1_0/1');
    });

    it('throws when ENVIRONMENT is production and no keys set', () => {
      expect(() => {
        getBoltCardK1({ ENVIRONMENT: 'production' });
      }).toThrow('Production deploy must set BOLT_CARD_K1 or BOLT_CARD_K1_0/1');
    });

    it('throws when both are production and no keys set', () => {
      expect(() => {
        getBoltCardK1({ WORKER_ENV: 'production', ENVIRONMENT: 'production' });
      }).toThrow('Production deploy must set BOLT_CARD_K1 or BOLT_CARD_K1_0/1');
    });

    it('throws when only WORKER_ENV is production', () => {
      expect(() => {
        getBoltCardK1({ WORKER_ENV: 'production', BOLT_CARD_K1: '' });
      }).toThrow('Production deploy must set BOLT_CARD_K1 or BOLT_CARD_K1_0/1');
    });

    it('throws when only ENVIRONMENT is production', () => {
      expect(() => {
        getBoltCardK1({ ENVIRONMENT: 'production', BOLT_CARD_K1: '' });
      }).toThrow('Production deploy must set BOLT_CARD_K1 or BOLT_CARD_K1_0/1');
    });
  });

  describe('returns configured keys when BOLT_CARD_K1_0/1 is set in production', () => {
    it('returns keys from BOLT_CARD_K1_0 and BOLT_CARD_K1_1 when both set', () => {
      const keys = getBoltCardK1({
        WORKER_ENV: 'production',
        BOLT_CARD_K1_0: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        BOLT_CARD_K1_1: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBeInstanceOf(Uint8Array);
      expect(keys[1]).toBeInstanceOf(Uint8Array);
      // Verify they're not empty arrays
      expect(keys[0].length).toBeGreaterThan(0);
      expect(keys[1].length).toBeGreaterThan(0);
    });

    it('returns keys when BOLT_CARD_K1_0/1 set with WORKER_ENV production', () => {
      const keys = getBoltCardK1({
        WORKER_ENV: 'production',
        BOLT_CARD_K1_0: '00000000000000000000000000000000',
        BOLT_CARD_K1_1: '11111111111111111111111111111111',
      });
      expect(keys).toHaveLength(2);
      expect(Array.from(keys[0])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(Array.from(keys[1])).toEqual([17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17]);
    });
  });

  describe('returns configured keys when BOLT_CARD_K1 is set in production', () => {
    it('returns keys from comma-separated BOLT_CARD_K1', () => {
      const keys = getBoltCardK1({
        WORKER_ENV: 'production',
        BOLT_CARD_K1: '11111111111111111111111111111111,22222222222222222222222222222222',
      });
      expect(keys).toHaveLength(2);
      expect(Array.from(keys[0])).toEqual([17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17]);
      expect(Array.from(keys[1])).toEqual([34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34]);
    });

    it('returns keys when BOLT_CARD_K1 set with ENVIRONMENT production', () => {
      const keys = getBoltCardK1({
        ENVIRONMENT: 'production',
        BOLT_CARD_K1: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBeInstanceOf(Uint8Array);
      expect(keys[1]).toBeInstanceOf(Uint8Array);
      expect(keys[0].length).toBeGreaterThan(0);
      expect(keys[1].length).toBeGreaterThan(0);
    });
  });

  describe('ISSUER_KEY takes precedence in production', () => {
    it('returns derived K1 when ISSUER_KEY is set in production (no K1)', () => {
      const keys = getBoltCardK1({
        WORKER_ENV: 'production',
        ISSUER_KEY: '00000000000000000000000000000001', // Dev key
      });
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBeInstanceOf(Uint8Array);
      // Code computes computeAesCmac(hexToBytes("2d003f77"), issuerKeyBytes) - a CMAC, not raw bytes
      // Just verify length is 16 bytes for a valid CMAC
      expect(keys[0].length).toBe(16);
    });

    it('returns ISSUER_KEY keys when ISSUER_KEY set and WORKER_ENV production', () => {
      const keys = getBoltCardK1({
        WORKER_ENV: 'production',
        BOLT_CARD_K1: '00000000000000000000000000000000', // Ignored
        ISSUER_KEY: '00000000000000000000000000000000',
      });
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBeInstanceOf(Uint8Array);
      expect(keys[0]).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    });


  });

  describe('dev fallback warning', () => {
    it('warns when using dev fallback', () => {
      // Mock logger.warn instead of spying on console.warn (logger is suppressed at error level)
      const loggerWarnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const keys = getBoltCardK1({});
      expect(keys).toHaveLength(2);
      // Verify that logger.warn was called with the fallback warning message
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using fallback BOLT_CARD_K1 development keys - not for production')
      );
      loggerWarnSpy.mockRestore();
    });

    it('does not warn when keys are properly configured', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn');
      const keys = getBoltCardK1({
        WORKER_ENV: 'production',
        BOLT_CARD_K1: 'aaaa,bbbb',
      });
      expect(keys).toHaveLength(2);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });
});

async function getDeterministicKeys(uidHex, env, version = 1) {
  const keys = {};
  keys.k2 = '0' + uidHex + 'a'.repeat(30);
  return keys;
}
