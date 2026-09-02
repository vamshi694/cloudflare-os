// The agent's side of case intelligence: reads the firm reasons over, and the passes it can start.
// Mirrors the KnowledgeImpl pattern in matter.ts (observations on every read). The lead wires it:
//   MatterSession.intelligence(): Promise<MatterIntelligence>  →  new IntelligenceImpl(q, store)

import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type { ApprovalQueue } from "@gadgets/workshop-shared/gatekeeper";
import type {
  BlastRadius, Chronology, Contradiction, CriteriaFindings, EntityPath, GapAudit, Grounding, IntelRun, OrganizeProposal, RecordInventory, ReviewState,
} from "@gadgets/workshop-shared/legal";
import type { MatterIntelligence } from "./types.js";
import type { MatterStore } from "./store.js";

type ObservationQueue = Pick<ApprovalQueue, "authorizeObservation">;

const RUN_TITLES: Record<IntelRun, string> = {
  contradictions: "Check the record for contradictions", duplicate: "Review duplicate entities", conflict: "Review how the evidence is filed",
  findings: "Assess the criteria", gaps: "Audit the record for gaps", strategy: "Write the strategy memo", organize: "Organize the record",
};

@validateRpc()
export class IntelligenceImpl extends RpcTarget implements MatterIntelligence {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async #observe(title: string, description: string): Promise<void> { await this.q.authorizeObservation({ title, description }); }

  async chronology(): Promise<Chronology> {
    const c = await this.store.chronology();
    await this.#observe("Read the chronology", `${c.dated} dated facts across ${c.years.length} years; ${c.undated} undated.`);
    return c;
  }
  async contradictions(): Promise<Contradiction[]> {
    const rows = await this.store.contradictions();
    await this.#observe("Read the contradictions", `${rows.filter(r => r.status === "open").length} open of ${rows.length} on file.`);
    return rows;
  }
  async blastRadius(documentId: string): Promise<BlastRadius> {
    const b = await this.store.blastRadius(documentId);
    await this.#observe("Trace what a document touches", `"${b.documentTitle}": ${b.claims.length} claims, ${b.sections.length} sections.`);
    return b;
  }
  async path(fromEntityId: string, toEntityId: string): Promise<EntityPath> {
    const p = await this.store.entityPath(fromEntityId, toEntityId);
    await this.#observe("Trace a connection", p.found ? `${p.hops.length - 1} hops.` : "No connection on file.");
    return p;
  }
  async review(kind: "duplicate" | "conflict"): Promise<ReviewState> {
    const r = await this.store.review(kind);
    await this.#observe(kind === "duplicate" ? "Read the duplicate review" : "Read the evidence-conflict review", `${r.pairs.filter(p => p.verdict === "pending").length} pending of ${r.pairs.length}.`);
    return r;
  }
  async decideReview(pairId: string, verdict: "merge" | "set_aside" | "keep", reason: string): Promise<void> {
    await this.store.decideReview(pairId, verdict, "firm", reason);
    await this.#observe("Rule on a review pair", `${verdict}: ${reason.slice(0, 120)}`);
  }
  async criteriaFindings(): Promise<CriteriaFindings> {
    const f = await this.store.criteriaFindings();
    await this.#observe("Read the criteria findings", f.assessedAt ? `Assessed ${f.assessedAt}.` : "Not assessed yet.");
    return f;
  }
  async gapAudit(): Promise<GapAudit> {
    const g = await this.store.gapAudit();
    await this.#observe("Read the gap audit", `${g.items.length} gaps on file.`);
    return g;
  }
  async grounding(): Promise<Grounding> {
    const g = await this.store.grounding();
    await this.#observe("Read the grounding score", `${Math.round(g.score * 100)}% of ${g.claims} claims grounded.`);
    return g;
  }
  async inventory(): Promise<RecordInventory> {
    const i = await this.store.inventory();
    await this.#observe("Read the record inventory", `${i.documents} documents in ${i.kinds.length} kinds.`);
    return i;
  }
  async organizeProposal(): Promise<OrganizeProposal | null> {
    const p = await this.store.organizeProposal();
    await this.#observe("Read the organizing proposal", p ? `${p.titles.length} titles, ${p.exhibitOrder.length} exhibits.` : "No proposal on file.");
    return p;
  }
  async run(kind: IntelRun): Promise<void> {
    await this.store.runIntel(kind, "agent");
    await this.#observe(RUN_TITLES[kind], "Started the pass; it reports through its read.");
  }
  async running(): Promise<Record<IntelRun, boolean>> { return this.store.intelRunning(); }
}
