// The iframe-facing capability behind the matter picker. Narrow on purpose: list and create, on
// this account only.

import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type { ConfiguratorOption, MatterConfiguratorRpc } from "./configurator/matter-configurator-types.js";
import type { MatterAccount } from "./matter.js";

@validateRpc()
export class MatterConfiguratorUI extends RpcTarget implements MatterConfiguratorRpc {
  constructor(private readonly account: DurableObjectStub<MatterAccount>) { super(); }

  async listMatters(query: string): Promise<ConfiguratorOption[]> {
    const q = query.trim().toLowerCase();
    const matters = await this.account.listMatters();
    return matters
      .filter(m => !q || m.title.toLowerCase().includes(q) || m.clientName.toLowerCase().includes(q))
      .slice(0, 25)
      .map(m => ({ value: m.id, title: m.title, subtitle: m.clientName, meta: m.caseType ?? "undecided" }));
  }

  async createMatter(input: { title: string; clientName: string; caseType: string | null }): Promise<{ id: string }> {
    const created = await this.account.createMatter(input);
    return { id: created.id };
  }
}
