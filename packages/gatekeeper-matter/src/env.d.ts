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
    /** OpenRouter model for the reading lane (a var), used only when READER_PROVIDER=openrouter. */
    UNDERSTAND_MODEL: string;
    /** "workers-ai" (default) or "openrouter". */
    READER_PROVIDER?: string;
    /** Workers AI model id for the reading lane. */
    READER_MODEL?: string;
    KNOWLEDGE_MODEL?: string;
    /** Workers AI model id for the drafting lane; defaults to the reader, then the knowledge model. */
    DRAFT_MODEL?: string;
    /** The firm gatekeeper's FirmLibraryApi over a service binding (deploy.ts wires it); absent in tests. */
    FIRM_LIBRARY?: import("./firm-library.js").FirmLibraryBinding;
    /** The research gatekeeper's ResearchApi (Visa Bulletin, processing times, eCFR) over a service binding; absent in tests. Typed structurally by its readers. */
    RESEARCH_API?: import("./store-docket.js").ResearchBinding;
    /** Firm-level OpenRouter key for the reading lane (a Worker secret, never in config). */
    OPENROUTER_API_KEY?: string;
    /** Public origin of the deployment (e.g. https://ocios.app); empty means relative links. Set by deploy.ts. */
    PUBLIC_BASE_URL?: string;
    /** Extra entropy for signed file links (a var or secret); empty is allowed but weaker. */
    PORTAL_SECRET?: string;
    /** The per-matter case store. */
    MATTER_STORE: DurableObjectNamespace<import("./store.js").MatterStore>;
    /** The firm's registry (ownership, holds, lane models). */
    FIRM_INDEX: DurableObjectNamespace<import("./firm-index.js").FirmIndex>;
  }

  interface GlobalProps {
    mainModule: typeof import("./index.js");
    durableNamespaces: "MatterAccount" | "MatterGatekeeper" | "MatterStore" | "FirmMattersGatekeeper" | "FirmIndex";
  }
}
