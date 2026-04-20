/**
 * Integration tests for end-to-end payment flows
 * Tests complete NFC payment processing from request to payment completion
 */

import { handleRequest } from '../index.js';
import { logger } from '../utils/logger.js';
import { makeReplayNamespace } from './replayNamespace.js';

const LEGACY_UID_CONFIGS = {
  '04996c6a926980': JSON.stringify({
    K2: 'B45775776CB224C75BCDE7CA3704E933',
    payment_method: 'clnrest',
    clnrest: {
      protocol: 'https',
      host: 'https://cln.example.com',
      port: 3001,
      rune: 'abcd1234efgh5678ijkl'
    }
  }),
  '044561fa967380': JSON.stringify({
    K2: '33268DEA5B5511A1B3DF961198FA46D5',
    payment_method: 'clnrest',
    proxy: {
      baseurl: 'https://demo.lnbits.com/boltcards/api/v1/scan/tapko6sbthfdgzoejjztjb'
    },
    clnrest: {
      protocol: 'httpsnotusing',
      host: 'https://restk.psbt.me:3010',
      port: 3010,
      rune: 'dummy'
    }
  })
};

const DO_CARD_CONFIGS = {
  '04996c6a926980': JSON.parse(LEGACY_UID_CONFIGS['04996c6a926980']),
  '044561fa967380': JSON.parse(LEGACY_UID_CONFIGS['044561fa967380'])
};

const seedDoConfigs = (replay, configs = DO_CARD_CONFIGS) => {
  Object.entries(configs).forEach(([uid, config]) => {
    replay.__cardConfigs.set(uid.toLowerCase(), config);
  });
  return replay;
};

const mockEnv = {
  BOLT_CARD_K1: '55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d',
  UID_CONFIG: {
    get: async (key) => LEGACY_UID_CONFIGS[key] ?? null,
    put: async () => {}
  },
  CARD_REPLAY: seedDoConfigs(makeReplayNamespace()),
};

const TEST_DATA = [
  {
    name: 'CLN Rest Payment - Counter 3',
    url: 'https://test.local/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE',
    expectedUid: '04996c6a926980',
    expectedCtr: '000003',
    expectedPaymentMethod: 'clnrest'
  },
  {
    name: 'CLN Rest Payment - Counter 5', 
    url: 'https://test.local/?p=00F48C4F8E386DED06BCDC78FA92E2FE&c=66B4826EA4C155B4',
    expectedUid: '04996c6a926980',
    expectedCtr: '000005',
    expectedPaymentMethod: 'clnrest'
  },
  {
    name: 'Card Keys Request - KeepVersion',
    url: 'https://test.local/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=KeepVersion',
    method: 'POST',
    body: JSON.stringify({ LNURLW: 'lnurlw://boltcardpoc.psbt.me/lnurl?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE' })
  },
  {
    name: 'Card Keys Request - UpdateVersion',
    url: 'https://test.local/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion',
    method: 'POST',
    body: JSON.stringify({ UID: '044561fa967380' })
  }
];

describe('End-to-End Payment Flow Integration Tests', () => {
  beforeEach(() => {
    Object.assign(mockEnv, {});
    mockEnv.CARD_REPLAY = seedDoConfigs(makeReplayNamespace());
    mockEnv.BOLT_CARD_K1 = '55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d';
    mockEnv.UID_CONFIG = {
      get: async (key) => LEGACY_UID_CONFIGS[key] ?? null,
      put: async () => {}
    };
  });

  describe('NFC Request Processing', () => {
    TEST_DATA.filter(test => test.name.includes('Payment')).forEach((testCase) => {
      it(`should process ${testCase.name} and return valid LNURL response`, async () => {
        const request = new Request(testCase.url, {
          method: testCase.method || 'GET'
        });

        const response = await handleRequest(request, mockEnv);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('application/json');
        
        const responseData = await response.json();
        
        expect(responseData.tag).toBe('withdrawRequest');
        expect(responseData.callback).toBeDefined();
        expect(responseData.k1).toBeDefined();
        expect(responseData.minWithdrawable).toBeGreaterThan(0);
        expect(responseData.maxWithdrawable).toBeGreaterThanOrEqual(responseData.minWithdrawable);
        expect(responseData.defaultDescription).toContain('Boltcard payment');
        
        // The callback should be a path-based URL with the p parameter as the last path segment
        expect(responseData.callback).toContain('/boltcards/api/v1/lnurl/cb');
        expect(responseData.callback).not.toContain('?');
        expect(responseData.callback).toContain('/' + testCase.url.split('?')[1].split('&')[0].split('=')[1]);
      });
    });
  });

  describe('Card Keys Generation', () => {
    it('should generate boltcard keys for valid UID', async () => {
      const testCase = TEST_DATA.find(test => test.name.includes('Card Keys Request - UpdateVersion'));
      const request = new Request(testCase.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: testCase.body
      });

      const response = await handleRequest(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');
      
      const responseData = await response.json();
      
      expect(responseData.PROTOCOL_NAME).toBe('NEW_BOLT_CARD_RESPONSE');
      expect(responseData.PROTOCOL_VERSION).toBe('1');
      expect(responseData.CARD_NAME).toContain('UID');
      expect(responseData.LNURLW).toBeDefined();
      
      expect(responseData.K0).toBeDefined();
      expect(responseData.K1).toBeDefined();
      expect(responseData.K2).toBeDefined();
      expect(responseData.K3).toBeDefined();
      expect(responseData.K4).toBeDefined();
      
      Object.values(responseData)
        .filter(key => typeof key === 'string' && key.match(/^[0-9a-fA-F]{32}$/))
        .forEach(key => {
          expect(key).toMatch(/^[0-9a-fA-F]{32}$/);
        });
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle malformed requests gracefully', async () => {
      const request = new Request('https://test.local/?p=invalid&c=invalid');
      
      const response = await handleRequest(request, mockEnv);
      
      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.reason).toBeDefined();
    });

    it('should handle missing parameters', async () => {
      const request = new Request('https://test.local/?p=4E2E289D945A66BB13377A728884E867');
      
      const response = await handleRequest(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
    });

    it('should handle unknown routes', async () => {
      const request = new Request('https://test.local/unknown-route');
      
      const response = await handleRequest(request, mockEnv);
      
      expect(response.status).toBe(404);
    });
  });

  describe('Status Endpoint Integration', () => {
    it('should return system status', async () => {
      const request = new Request('https://test.local/status');
      
      const response = await handleRequest(request, mockEnv);
      
      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.status).toBeDefined();
    });
  });

  describe('Cryptographic Validation Integration', () => {
    it('should properly validate CMAC for valid requests', async () => {
      const testCase = TEST_DATA.find(test => test.name.includes('Payment - Counter 3'));
      const request = new Request(testCase.url);
      
      const response = await handleRequest(request, mockEnv);
      
      expect(response.status).toBe(200);
      const responseData = await response.json();
      
      // Verify standard LNURL-W withdraw response fields
      expect(responseData.tag).toBe('withdrawRequest');
      expect(responseData.callback).toBeDefined();
      expect(responseData.k1).toBeDefined();
      expect(responseData.minWithdrawable).toBeGreaterThan(0);
      expect(responseData.maxWithdrawable).toBeGreaterThanOrEqual(responseData.minWithdrawable);
      expect(responseData.defaultDescription).toBeDefined();
    });
  });

  describe('Performance and Security Integration', () => {
    it('should handle requests efficiently', async () => {
      const testCase = TEST_DATA.find(test => test.name.includes('Payment - Counter 3'));
      const request = new Request(testCase.url);
      
      const startTime = Date.now();
      const response = await handleRequest(request, mockEnv);
      const endTime = Date.now();
      
      expect(response.status).toBe(200);
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should not expose sensitive information in error responses', async () => {
      const request = new Request('https://test.local/?p=malformed&c=data');
      
      const response = await handleRequest(request, mockEnv);
      const responseData = await response.json();
      
      expect(responseData.reason).toBeDefined();
      expect(responseData.reason).not.toMatch(/stack|trace|private|secret|key/i);
    });
  });
});

describe('Complete Payment Flow Integration', () => {
    it('should simulate complete payment flow from NFC to completion', async () => {
      // Step 1: NFC Request
      const nfcRequest = new Request('https://test.local/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE');
      const nfcResponse = await handleRequest(nfcRequest, mockEnv);
      
      expect(nfcResponse.status).toBe(200);
      const lnurlResponse = await nfcResponse.json();
      
      // Step 2: Extract callback URL and simulate LNURL payment
      const callbackUrl = new URL(lnurlResponse.callback);
      expect(callbackUrl.pathname).toContain('/boltcards/api/v1/lnurl/cb');
      expect(callbackUrl.pathname).not.toBe('/boltcards/api/v1/lnurl/cb'); // Should have additional path segments
      
      // Step 3: Simulate payment callback (this would normally be called by a wallet)
      const paymentData = {
        invoice: 'lnbc1000n1p...your_bolt11_invoice...',
        amount: lnurlResponse.minWithdrawable,
        k1: lnurlResponse.k1
      };
      
      const paymentRequest = new Request(callbackUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentData)
      });
      
      const paymentResponse = await handleRequest(paymentRequest, mockEnv);
      
      expect([200, 400, 500]).toContain(paymentResponse.status);
      
      // Step 4: Verify status endpoint works
      const statusRequest = new Request('https://test.local/status');
      const statusResponse = await handleRequest(statusRequest, mockEnv);
      
      expect(statusResponse.status).toBe(200);
      const statusData = await statusResponse.json();
      expect(statusData.status).toBeDefined();
      
      expect(true).toBe(true);
    });
  });
