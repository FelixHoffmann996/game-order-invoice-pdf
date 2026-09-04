// Runnable entry point: a small HTTP service that turns a game backend order
// into an invoice PDF. Start it with `npm start`, then POST an order to
// http://localhost:8080/invoices (see README for a ready-made curl).

import { createServer } from "node:http";
import { infrai, InfraiError } from "./infrai_pdf.ts";
import { Order, buildInvoice, invoiceHtml, money } from "./order_billing.ts";

// One PDF per order id: a retried POST returns the document produced the first
// time instead of rendering a second copy.
const issued = new Map<string, unknown>();

async function issueInvoice(raw: unknown) {
  const order = Order.parse(raw);
  const cached = issued.get(order.orderId);
  if (cached) return { reused: true, invoice: cached };

  const invoice = buildInvoice(order);
  const pdf = await infrai.pdf.generate({
    html: invoiceHtml(order, invoice),
    page_size: "A4",
    orientation: "portrait",
    store: true,
  });

  const result = {
    orderId: order.orderId,
    total: money(invoice.totalCents, order.currency),
    billedLines: invoice.billed.length,
    heldForModeration: invoice.held.map((line) => line.sku),
    pdf,
  };
  issued.set(order.orderId, result);
  return { reused: false, invoice: result };
}

function send(res: any, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/invoices") {
    return send(res, 404, { error: "POST /invoices" });
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    try {
      const parsed = await issueInvoice(JSON.parse(body));
      send(res, parsed.reused ? 200 : 201, parsed.invoice);
    } catch (err: any) {
      if (err?.name === "ZodError") {
        return send(res, 400, { error: "invalid order", issues: err.issues });
      }
      // A rejection that the API described in its envelope is the caller's
      // problem to fix, so it stays a 4xx here rather than becoming a 500.
      if (err instanceof InfraiError) {
        const status = err.status >= 400 && err.status < 500 ? err.status : 502;
        return send(res, status, { error: err.code, message: err.message });
      }
      send(res, 500, { error: "internal" });
    }
  });
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => {
  console.log(`invoice service listening on http://localhost:${port}`);
});
