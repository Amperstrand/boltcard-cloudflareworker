export const constructWithdrawResponse = (uidHex, pHex, cHex, ctr, cmac_validated) => {
  if (!cmac_validated) {
    return {
      status: "ERROR",
      reason: "CMAC validation failed or was not performed.",
    };
  }

  const counterValue = parseInt(ctr, 16);
  
  // Introduce a random error only if counter is >= 100
  if (counterValue >= 300 && Math.random() < 0.5) {
    return {
      status: "ERROR",
      reason: `random error - UID: ${uidHex}, Counter: ${counterValue}, pHex: ${pHex}, cHex: ${cHex}`,
    };
  }

  // Verifiable Credentials List (W3C standard format)
  const verifiableCredentials = [
    {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://example.org/concert-ticket-schema-v1"
      ],
      "type": ["VerifiableCredential", "ConcertTicket"],
      "issuer": "https://boltcardpoc.psbt.me",
      "issuanceDate": new Date().toISOString(),
      "credentialSubject": {
        "id": `urn:uuid:${uidHex}`,
        "ticketId": `TICKET-${uidHex.substring(0, 8)}`,
        "event": "Lightning Music Fest",
        "venue": "Bitcoin Arena, El Salvador",
        "date": "2025-07-20T20:00:00Z",
        "seat": `Section ${Math.floor(Math.random() * 10) + 1}, Row ${String.fromCharCode(65 + Math.floor(Math.random() * 6))}, Seat ${Math.floor(Math.random() * 20) + 1}`
      },
      "proof": {
        "type": "Ed25519Signature2018",
        "created": new Date().toISOString(),
        "proofPurpose": "assertionMethod",
        "verificationMethod": "https://boltcardpoc.psbt.me/keys/issuer-key",
        "jws": "eyJhbGciOiJFZERTQSJ9...signature"
      }
    },
    {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://example.org/photo-verification-schema-v1"
      ],
      "type": ["VerifiableCredential", "OwnerPhoto"],
      "issuer": "https://boltcardpoc.psbt.me",
      "issuanceDate": new Date().toISOString(),
      "credentialSubject": {
        "id": `urn:uuid:${uidHex}`,
        "photoUrl": `https://boltcardpoc.psbt.me/photos/${uidHex}.jpg`
      },
      "proof": {
        "type": "Ed25519Signature2018",
        "created": new Date().toISOString(),
        "proofPurpose": "assertionMethod",
        "verificationMethod": "https://boltcardpoc.psbt.me/keys/issuer-key",
        "jws": "eyJhbGciOiJFZERTQSJ9...signature"
      }
    }
  ];

  return {
    tag: "withdrawRequest",
    callback: `https://boltcardpoc.psbt.me/boltcards/api/v1/lnurl/cb/${pHex}`,
    k1: cHex,
    minWithdrawable: 1000,
    maxWithdrawable: 1000,
    defaultDescription: `Boltcard payment from UID ${uidHex}, counter ${counterValue}`,
    payLink: `lnurlp://boltcardpoc.psbt.me/boltcards/api/v1/lnurlp_not_implemented_yet/${uidHex}/${pHex}/${cHex}`,
    verifiableCredentials,
  };
};
