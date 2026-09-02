export * from "./matter.js";
export { MatterStore } from "./store.js";
import { handleIngestBatch } from "./ingest.js";
import { handlePublic } from "./portal.js";
import { handleFormRoutes } from "./forms-pdf.js";
import { handleFilingRoutes } from "./manifest.js";
import type { IngestMessage } from "./store.js";

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const handled = await handlePublic(request, env);
    if (handled) return handled;
    // Government forms (WP-7): the rendered, filled PDF behind a signed link.
    const form = await handleFormRoutes(request, env);
    if (form) return form;
    // The filing (WP-6): signed links to packets and Word exports, and the firm's manifest key.
    const filing = await handleFilingRoutes(request, env);
    if (filing) return filing;
    return new Response("Matters gatekeeper is running.", { headers: { "content-type": "text/plain" } });
  },
  async queue(batch: MessageBatch<IngestMessage>, env: Cloudflare.Env): Promise<void> {
    await handleIngestBatch(batch, env);
  },
};
