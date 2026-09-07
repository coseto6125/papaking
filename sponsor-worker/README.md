# sponsor-worker

Cloudflare Worker that receives ECPay 直播主收款「付款完成通知」, stores each sponsorship in D1, and pushes a LINE message to the owner.

```
ECPay ──POST JSON──▶ Worker ──▶ D1 `sponsors` (dedup by MerchantTradeNo)
                        └────▶ LINE Messaging API push (to LINE_TO)
                        ◀── 1|OK
```

## Deploy

```bash
cd sponsor-worker
npm install
npm test
npx wrangler d1 create papaking-sponsor      # paste database_id into wrangler.jsonc
npm run schema                               # create the table
npx wrangler secret put ECPAY_MERCHANT_ID    # 綠界後台 > 廠商資料 > 特店編號
npx wrangler secret put ECPAY_HASH_KEY       # 綠界後台 > 系統開發管理 > 系統介接設定 > HashKey (16 chars)
npx wrangler secret put ECPAY_HASH_IV        # same page, HashIV (16 chars)
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN   # any Messaging API channel, papaking's works
npx wrangler secret put LINE_TO              # your own LINE userId (U...), see below
npm run deploy                               # prints https://papaking-sponsor.<subdomain>.workers.dev
```

Paste the printed URL into 綠界後台 > 收款工具 > 實況主收款 > 付款完成通知回傳網址.

### Finding your LINE userId

Send any message to the papaking bot, then read the webhook event's `source.userId` from the Apps Script execution log. Alternatively, LINE Developers Console > channel > Basic settings > "Your user ID".

## What ECPay sends

`POST` JSON: `MerchantID`, `RpHeader.Timestamp`, `TransCode`, `TransMsg`, `Data` (AES-128-CBC, base64), `CheckMacValue`.
`Data` decrypts to: `RtnCode`, `RtnMsg`, `PatronName`, `PatronNote`, `DonateURL`, `LivestreamURL`, `SimulatePaid`, `OrderInfo{MerchantTradeNo, TradeNo, TradeAmt, TradeDate, PaymentType, PaymentDate, TradeStatus, ChargeFee}`.

The worker replies exactly `1|OK`. Any other body makes ECPay retry every 5–15 min, up to 4 times a day; the worker uses that on purpose when the LINE push fails.

## Local run

```bash
cp .dev.vars.example .dev.vars   # fill secrets
npx wrangler dev                 # http://localhost:8787
```
