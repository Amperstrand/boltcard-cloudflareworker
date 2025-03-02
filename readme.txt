Manually Add DNS in Cloudflare Dashboard
Go to Cloudflare Dashboard → Select your domain psbt.me
Go to DNS Settings
Click “Add Record”
Enter the following:
Type: CNAME
Name: boltcardpoc
Target: workers.dev
TTL: Auto
Proxy Status: Proxied (Orange Cloud)
Click Save

## Test vectors (https://github.com/boltcard/boltcard/blob/main/docs/TEST_VECTORS.md)

```
curl 'https://boltcardpoc.psbt.me/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE'
curl 'https://boltcardpoc.psbt.me/?p=00F48C4F8E386DED06BCDC78FA92E2FE&c=66B4826EA4C155B4'
curl 'https://boltcardpoc.psbt.me/?p=0DBF3C59B59B0638D60B5842A997D4D1&c=CC61660C020B4D96'
curl -X POST "https://boltcardpoc.psbt.me/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion" \
     -H "Content-Type: application/json" \
     -d '{"UID": "04a39493cc8680"}'

curl -X POST "https://boltcardpoc.psbt.me/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion" \
     -H "Content-Type: application/json" \
     -d '{"UID": "044561fa967380"}'


curl -X POST https://boltcardpoc.psbt.me/boltcards/api/v1/lnurl/cb/fABRzT2jv9Mt82exoStuxQ \
     -H "Content-Type: application/json" \
     -d '{
          "invoice": "lnbc1000n1p...your_bolt11_invoice...",
          "amount": 1000,
          "k1": "fABRzT2jv9Mt82exoStuxQ"
        }'

# Example 1: POST to /boltcards/api/v1/lnurl with k1 as "p=x&q=y"
In this method, you POST to /boltcards/api/v1/lnurl/cb and supply k1 as a query-string formatted value that contains both the p and q values. This approach allows the client to send both values together in one field.
curl -X POST https://boltcardpoc.psbt.me/boltcards/api/v1/lnurl/cb \
     -H "Content-Type: application/json" \
     -d '{
          "invoice": "lnbc1000n1p...your_bolt11_invoice...",
          "amount": 1000,
          "k1": "p=3736A84681238418D4B9B7210C13DC39&q=1549E9D901188F77"
        }'

# Example 2: POST to /boltcards/api/v1/lnurl/cb/<p> with k1 as the q value
In this method, you POST to /boltcards/api/v1/lnurl/cb/<p> where the p value is provided in the URL. The JSON body’s k1 field then carries only the q (HMAC) value. Both approaches ultimately result in the same process of decrypting the p value to obtain a UID and counter while verifying the q value as a valid CMAC.

curl -X POST https://boltcardpoc.psbt.me/boltcards/api/v1/lnurl/cb/3736A84681238418D4B9B7210C13DC39 \
     -H "Content-Type: application/json" \
     -d '{
          "invoice": "lnbc1000n1p...your_bolt11_invoice...",
          "amount": 1000,
          "k1": "1549E9D901188F77"
        }'


```

## Test
export DEBUG=true
npm test


## Deploy

export DEBUG=false
wrangler deploy


