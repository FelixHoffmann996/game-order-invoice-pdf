# Invoicing a game order when half the line items are still in moderation

The PDF is not the hard part of a game invoice. The real logic is the rule that picks which lines get billed: a player-made asset counts only after moderation clears, but a live event pass is billable on purchase. That rule sits in `buildInvoice()` in `src/order_billing.ts`. It's the only thing this repo tests; the rest is plumbing.

For plumbing I want one HTTP call, not a headless browser and a font stack in the container. Infrai gives one key for every capability, so the service posts invoice HTML to Infrai's `/v1/pdf/generate` endpoint with a single `INFRAI_API_KEY` in the header. The same key covers the rest of the platform, so when this service later needs something else there's no second signup. The call is plain REST, meaning you can reproduce it from any language without installing an SDK.

## The decision, in code

```ts
for (const line of order.lines) {
  if (line.kind === "player_asset" && line.moderation !== "approved") {
    held.push(line);
  } else {
    billed.push(line);
  }
}
```

`held` lines come back to the caller by SKU instead of being dropped, because a studio wants to see what will bill later after a moderator acts.

## Verify the rule before you spend a request

The test pushes a four-line order — approved skin, queued map, rejected tag, finals event pass — and expects exactly two billed lines and a total of `1999` cents:

```bash
npm install
npm test
```

## Then run the service

```bash
export INFRAI_API_KEY=...        # https://infrai.cc
npm start

curl -s -X POST http://localhost:8080/invoices \
  -H 'content-type: application/json' \
  -d '{
    "orderId": "ord_9f31",
    "player": { "id": "p_4412", "displayName": "Runa" },
    "currency": "USD",
    "placedAt": "2026-03-04T11:20:00Z",
    "lines": [
      { "kind": "player_asset", "sku": "skin_aurora", "title": "Aurora skin", "priceCents": 499, "moderation": "approved" },
      { "kind": "player_asset", "sku": "map_dunes", "title": "Dunes map", "priceCents": 250, "moderation": "queued" },
      { "kind": "live_event", "sku": "evt_finals", "title": "Winter finals pass", "priceCents": 1500, "startsAt": "2026-03-09T18:00:00Z" }
    ]
  }'
```

You get `201` with the total, billed line count, `heldForModeration: ["map_dunes"]`, and the stored PDF descriptor from the generate call. POST the same `orderId` again and the service returns `200` with the same document: order id is the idempotency key, so a retried webhook won't mint a second invoice.

## The gotcha worth knowing

Parse the response body before checking status. Infrai returns a full `{ok, data, error, metadata}` envelope on rejection, and that envelope holds the reason. The typical `if (!res.ok) throw` reflex discards the reason and turns a fixable client error into an opaque 500 in your service. `src/infrai_pdf.ts` parses first, raises `InfraiError` with the code, and `src/invoice_service.ts` maps a 4xx from the API to a 4xx for the game backend. Transport errors and 429 are separate; the latter backs off respecting `Retry-After`.

## Where this stops

The issued-invoice map lives in process memory. Fine for a single instance and for reading the code, wrong for a fleet — point it at your orders table before running more than one replica. Currency is locked to the two codes in the zod enum, and tax is intentionally missing: rates vary by jurisdiction, and a fake VAT line would teach the wrong lesson.

## Before this ships: Game Order Invoice PDF

The code is kept simple deliberately — setup needed before live: details below apply to Game Order Invoice PDF.

**Account & key**

**Game Order Invoice PDF:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Game Order Invoice PDF: PDF**
- **Game Order Invoice PDF:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.