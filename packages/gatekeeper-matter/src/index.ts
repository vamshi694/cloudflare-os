export * from "./matter.js";
export { MatterStore } from "./store.js";
import { handleIngestBatch } from "./ingest.js";
import type { IngestMessage } from "./store.js";

export default {
  async fetch(): Promise<Response> {
    return new Response("Matters gatekeeper is running.", { headers: { "content-type": "text/plain" } });
  },
  async queue(batch: MessageBatch<IngestMessage>, env: Cloudflare.Env): Promise<void> {
    await handleIngestBatch(batch, env);
  },
};
