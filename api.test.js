const axios = require('axios');
const crypto = require('crypto');

// Define the expected hash values for each request
const expectedHashes = {
  'https://boltcardpoc.psbt.me/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE': 'e70b6deb69f31ac11cb64975ed079d01547e8622bff8680321590ce5308dc07f',
  'https://boltcardpoc.psbt.me/?p=00F48C4F8E386DED06BCDC78FA92E2FE&c=66B4826EA4C155B4': '9f9e3e7b6b98f88aeb0312ee6c246e013e0ab8b45cec1132a8dc036dded251c5',
  'https://boltcardpoc.psbt.me/?p=0DBF3C59B59B0638D60B5842A997D4D1&c=CC61660C020B4D96': 'ee80df0a35a09238e795af33ded6176febc641dfb8df14de67e73868421835fb',
};

describe('Test API Responses for Correct SHA256 Hash', () => {
  Object.keys(expectedHashes).forEach(url => {
    test(`SHA256 hash for ${url} is correct`, async () => {
      // Fetch the response data
      const response = await axios.get(url);
      const responseData = response.data;

      // Convert the response to a string if it's an object
      const stringData = JSON.stringify(responseData);

      // Compute the SHA256 hash of the response
      const hash = crypto.createHash('sha256');
      hash.update(stringData);
      const actualHash = hash.digest('hex');

      // Assert that the actual hash matches the expected hash
      expect(actualHash).toBe(expectedHashes[url]);
    });
  });
});
