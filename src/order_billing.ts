import { z } from "zod";

// A game backend order mixes three very different things, and only one of them
// is unconditionally billable.
export const PlayerAsset = z.object({
  kind: z.literal("player_asset"),
  sku: z.string().min(1),
  title: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  // Player-generated content is sold only after a human clears it, so the
  // moderation verdict decides whether the line reaches the invoice.
  moderation: z.enum(["approved", "queued", "rejected"]),
});

export const LiveEventPass = z.object({
  kind: z.literal("live_event"),
  sku: z.string().min(1),
  title: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  startsAt: z.string().min(1),
});

export const OrderLine = z.discriminatedUnion("kind", [PlayerAsset, LiveEventPass]);

export const Order = z.object({
  orderId: z.string().min(1),
  player: z.object({ id: z.string().min(1), displayName: z.string().min(1) }),
  currency: z.enum(["USD", "EUR"]),
  placedAt: z.string().min(1),
  lines: z.array(OrderLine).min(1),
});

export type Order = z.infer<typeof Order>;
export type OrderLine = z.infer<typeof OrderLine>;

export type Invoice = {
  orderId: string;
  billed: OrderLine[];
  held: OrderLine[];
  totalCents: number;
};

// The business decision, in one place: a queued or rejected asset is held back,
// an approved asset and every live-event pass is billed.
export function buildInvoice(order: Order): Invoice {
  const billed: OrderLine[] = [];
  const held: OrderLine[] = [];

  for (const line of order.lines) {
    if (line.kind === "player_asset" && line.moderation !== "approved") {
      held.push(line);
    } else {
      billed.push(line);
    }
  }

  return {
    orderId: order.orderId,
    billed,
    held,
    totalCents: billed.reduce((sum, line) => sum + line.priceCents, 0),
  };
}

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€" };

export function money(cents: number, currency: string): string {
  return `${SYMBOL[currency] ?? ""}${(cents / 100).toFixed(2)}`;
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function invoiceHtml(order: Order, invoice: Invoice): string {
  const rows = invoice.billed
    .map(
      (line) => `<tr><td>${escape(line.title)}</td><td>${escape(line.sku)}</td>` +
        `<td class="r">${money(line.priceCents, order.currency)}</td></tr>`,
    )
    .join("\n");

  const heldNote = invoice.held.length
    ? `<p class="held">${invoice.held.length} item(s) stay in the moderation queue and are invoiced once cleared.</p>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
body { font-family: Helvetica, Arial, sans-serif; color: #1b1b1b; margin: 40px; }
table { width: 100%; border-collapse: collapse; margin-top: 24px; }
th, td { border-bottom: 1px solid #ddd; padding: 8px 4px; text-align: left; }
.r { text-align: right; }
.total { font-size: 18px; font-weight: bold; margin-top: 16px; text-align: right; }
.held { color: #666; font-size: 13px; }
</style></head><body>
<h1>Invoice ${escape(order.orderId)}</h1>
<p>${escape(order.player.displayName)} (${escape(order.player.id)}) &middot; placed ${escape(order.placedAt)}</p>
<table><thead><tr><th>Item</th><th>SKU</th><th class="r">Amount</th></tr></thead>
<tbody>
${rows}
</tbody></table>
<p class="total">Total ${money(invoice.totalCents, order.currency)}</p>
${heldNote}
</body></html>`;
}
