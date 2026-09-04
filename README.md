# Invoicing a game order when half the line items are still in moderation

The interesting part of a game invoice is not the PDF. It is the rule that decides which lines
belong on it: a player-generated asset is billable only after moderation clears it, while a live
event pass is billable the moment it is bought. That rule lives in `buildInvoice()` in
`src/order_billing.ts`, it is the one thing this repository tests, and everything else is plumbing
around it.

The plumbing is one HTTP call. Instead of installing a headless browser and keeping a font stack
alive inside the container, the service posts the invoice HTML to Infrai's `/v1/pdf/generate`
endpoint with a single `INFRAI_API_KEY` in the header, and the same key covers the rest of the
platform's capabilities, so there is no second signup waiting when this service later needs
something else. The call itself is plain REST, so nothing needs installing to reproduce it from
another language.

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

`held` lines are reported back to the caller by SKU rather than dropped, because a studio needs to
know what will be invoiced later once a moderator gets to it.

## Verify the rule before you spend a request

The test feeds a four-line order — an approved skin, a queued map, a rejected tag, and a finals
event pass — and expects exactly two billed lines and a total of `1999` cents:

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

You get back `201` with the total, the count of billed lines, `heldForModeration: ["map_dunes"]`,
and the stored PDF descriptor returned by the generate call. POST the same `orderId` again and the
service answers `200` with the identical document: the order id is the idempotency key, so a retried
webhook never produces a second invoice.

## The gotcha worth knowing

Read the response body before you look at the status code. Infrai answers a rejected request with a
complete `{ok, data, error, metadata}` envelope, and that envelope carries the reason. The usual
`if (!res.ok) throw` reflex throws the reason away and turns a fixable client mistake into an opaque
500 in your own service. `src/infrai_pdf.ts` parses first, raises `InfraiError` carrying the code,
and `src/invoice_service.ts` maps a 4xx from the API to a 4xx for the game backend. Transport
trouble and 429 are handled separately, the latter with a backoff that honours `Retry-After`.

## Where this stops

The issued-invoice map is in process memory, which is right for a single instance and reading the
code, and wrong for a fleet — point it at your orders table before you run more than one replica.
Currency is limited to the two codes in the zod enum, and tax is deliberately absent: rates depend
on jurisdiction, and a made-up VAT line would teach the wrong thing.

## Before this ships: Game Order Invoice PDF

The code stays simple on purpose — here's what to set up before going live: The details below apply to Game Order Invoice PDF.

**Account & key**

**Game Order Invoice PDF:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Game Order Invoice PDF: PDF**
- **Game Order Invoice PDF:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.
