export const uidConfig = {
  "044561fa967380": {
    payment_method: "clnrest",
    proxy: {
      externalId: "tapko6sbthfdgzoejjztjb",  // The external ID used for proxying
      proxyDomain: "https://demo.lnbits.com"  // The LNBits instance to proxy to
    },
    clnrest: {
      protocol: "http",
      host: "another-cln.instance",
      port: 3002,
      rune: "mnop5678qrst1234uvwx"
    }
  },

  // Additional UIDs can be added here for different proxy settings
  "A1B2C3D4E5": {
    payment_method: "proxy",
    proxy: {
      externalId: "anotherExternalId123",
      proxyDomain: "https://other.lnbits.instance"
    }
  },

  // Sample entry for a card using CLN REST
  "04996c6a926980": {
    payment_method: "clnrest",
    clnrest: {
      protocol: "https",
      host: "cln.example.com",
      port: 3001,
      rune: "abcd1234efgh5678ijkl"  // Unique rune for authentication
    }
  },

  // Another sample UID using CLN REST
  "987654321ABC": {
    payment_method: "clnrest",
    clnrest: {
      protocol: "http",
      host: "another-cln.instance",
      port: 3002,
      rune: "mnop5678qrst1234uvwx"
    }
  }
};
