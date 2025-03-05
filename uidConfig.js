export const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d"
export const UID_PRIVACY = false
export const uidConfig = {
  "044561fa967380": {
    K2 : "33268DEA5B5511A1B3DF961198FA46D5",
    payment_method: "clnrest",
    proxy: {
      baseurl: "https://demo.lnbits.com/boltcards/api/v1/scan/tapko6sbthfdgzoejjztjb"  // The full base URL for proxying
    },
    clnrest: {
      protocol: "httpsnotusing",
      host: "https://restk.psbt.me:3010",
      port: 3010,
      rune: "dummy"
    }
  },

  // Additional UIDs can be added here for different proxy settings
  "A1B2C3D4E5": {
    payment_method: "proxy",
    proxy: {
      baseurl: "https://other.lnbits.instance/boltcards/api/v1/scan/anotherExternalId123"
    }
  },

  // Sample entry for a card using CLN REST
  "04996c6a926980": {
    K2 : "B45775776CB224C75BCDE7CA3704E933",
    payment_method: "clnrest",
    clnrest: {
      protocol: "https",
      host: "cln.example.com",
      port: 3001,
      rune: "abcd1234efgh5678ijkl"  // Unique rune for authentication
    }
  },

  // Another sample UID using a dummy fake wallet
  "04a071fa967380": {
    K2 : "EFCF2DD0528E57FF2E674E76DFC6B3B1",
    payment_method: "fakewallet",
  }
};
