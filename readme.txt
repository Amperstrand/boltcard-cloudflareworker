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

```

## Test
export DEBUG=true
npm test


## Deploy

export DEBUG=false
wrangler deploy


