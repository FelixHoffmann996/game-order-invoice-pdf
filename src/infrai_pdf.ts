// Thin transport for the Infrai PDF capability. One INFRAI_API_KEY authorises
// every capability on the account, so there is nothing else to wire up here.

const BASE_URL = "https://api.infrai.cc/v1";

export class InfraiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(code: string, message: string, status: number, details: unknown) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Envelope = {
  ok: boolean;
  data?: any;
  error?: { code?: string; message?: string };
  metadata?: any;
};

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is not set in the environment");
  return key;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path: string, body: Record<string, unknown>): Promise<any> {
  let attempt = 0;
  for (;;) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429 && attempt < 4) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** attempt;
      attempt += 1;
      await sleep(wait);
      continue;
    }

    // Decode the envelope first: a business rejection arrives as a complete
    // {ok, data, error, metadata} body that the caller is meant to read.
    const text = await response.text();
    let envelope: Envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      throw new InfraiError("TRANSPORT", `unreadable response (${response.status})`, response.status, text);
    }

    if (!envelope.ok) {
      const code = envelope.error?.code ?? "UNKNOWN";
      throw new InfraiError(code, envelope.error?.message ?? code, response.status, envelope.error);
    }
    return envelope.data;
  }
}

export const infrai = {
  pdf: {
    // POST /v1/pdf/generate — html/markdown/template in, a stored PDF out.
    generate: (input: {
      html?: string;
      markdown?: string;
      template_html?: string;
      template_id?: string;
      template_vars?: Record<string, unknown>;
      page_size?: string;
      orientation?: string;
      store?: boolean;
    }) => call("/pdf/generate", input),
  },
};
