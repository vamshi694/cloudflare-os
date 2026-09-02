export type ConfiguratorOption = {
  value: string;
  title: string;
  subtitle?: string;
  meta?: string;
};

export type MatterConfiguratorValues = {
  /** "existing" to pick a matter already on the desk, "new" to open one. */
  mode?: string | null;
  /** The chosen matter id (existing mode). */
  matterId?: string | null;
  /** New-matter fields. */
  title?: string | null;
  clientName?: string | null;
  caseType?: string | null;
};

export interface MatterConfiguratorRpc {
  /** Matters on this lawyer's desk, filtered by a query over title and client. */
  listMatters(query: string): Promise<ConfiguratorOption[]>;
  /** Open a new matter and return its id. */
  createMatter(input: { title: string; clientName: string; caseType: string | null }): Promise<{ id: string }>;
}
