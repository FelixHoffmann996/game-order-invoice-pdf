import { test } from "node:test";
import assert from "node:assert/strict";
import { Order, buildInvoice, money } from "../src/order_billing.ts";

const order = Order.parse({
  orderId: "ord_9f31",
  player: { id: "p_4412", displayName: "Runa" },
  currency: "USD",
  placedAt: "2026-03-04T11:20:00Z",
  lines: [
    { kind: "player_asset", sku: "skin_aurora", title: "Aurora skin", priceCents: 499, moderation: "approved" },
    { kind: "player_asset", sku: "map_dunes", title: "Dunes map", priceCents: 250, moderation: "queued" },
    { kind: "player_asset", sku: "tag_slur", title: "Flagged tag", priceCents: 199, moderation: "rejected" },
    { kind: "live_event", sku: "evt_finals", title: "Winter finals pass", priceCents: 1500, startsAt: "2026-03-09T18:00:00Z" },
  ],
});

test("only cleared player assets and event passes reach the invoice", () => {
  const invoice = buildInvoice(order);

  assert.deepEqual(invoice.billed.map((l) => l.sku), ["skin_aurora", "evt_finals"]);
  assert.deepEqual(invoice.held.map((l) => l.sku), ["map_dunes", "tag_slur"]);
  assert.equal(invoice.totalCents, 1999);
  assert.equal(money(invoice.totalCents, "USD"), "$19.99");
});

test("an order line with an unknown moderation verdict is refused at the boundary", () => {
  assert.throws(() =>
    Order.parse({
      ...order,
      lines: [{ kind: "player_asset", sku: "x", title: "x", priceCents: 100, moderation: "maybe" }],
    }),
  );
});
