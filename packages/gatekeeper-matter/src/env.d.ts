// Project-specific Env/ctx.exports augmentation for Wrangler's generated types.

declare namespace Cloudflare {
  interface Env {
    /** Document bytes and extracted text, keyed matters/<matterId>/docs/<docId>/... */
    MATTER_FILES: R2Bucket;
    /** Per-fact embeddings, namespaced by matter id. */
    FACT_VECTORS: VectorizeIndex;
    /** One message per uploaded document; consumed by this worker's queue() handler. */
    INGEST_QUEUE: Queue<import("./store.js").IngestMessage>;
    AI: Ai;
    /** OpenRouter model for the reading lane (a var). */
    UNDERSTAND_MODEL: string;
    /** Firm-level OpenRouter key for the reading lane (a Worker secret, never in config). */
    OPENROUTER_API_KEY?: string;
    /** The per-matter case store. */
    MATTER_STORE: DurableObjectNamespace<import("./store.js").MatterStore>;
  }

  interface GlobalProps {
    mainModule: typeof import("./index.js");
    durableNamespaces: "MatterAccount" | "MatterGatekeeper" | "MatterStore";
  }
}
