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


curl 'https://boltcardpoc.psbt.me/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE'

wrangler deploy

