import { Autocomplete, Field, h, RadioCards, Section, TextInput, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type { MatterConfiguratorRpc, MatterConfiguratorValues } from "./matter-configurator-types";

const CASE_TYPES = [
  { value: "EB1A", title: "EB-1A", description: "Extraordinary ability" },
  { value: "EB2-NIW", title: "EB-2 NIW", description: "National interest waiver" },
  { value: "O1A", title: "O-1A", description: "Extraordinary ability, nonimmigrant" },
  { value: "H1B", title: "H-1B", description: "Specialty occupation" },
  { value: "", title: "Undecided", description: "Choose the category with the agent later" },
];

export default {
  initial: { mode: "existing" },

  isReady({ values }) {
    if (values.mode === "new") {
      return Boolean(values.title?.trim()) && Boolean(values.clientName?.trim());
    }
    return typeof values.matterId === "string" && values.matterId.length === 32;
  },

  initialValuesFromResourceUrl({ resourceUrl }) {
    const m = /^legal:\/\/matter\/([0-9a-f]{32})/i.exec(resourceUrl);
    return m ? { mode: "existing", matterId: m[1].toLowerCase() } : {};
  },

  async resourceUrl({ values, ui }) {
    if (values.mode === "new") {
      const { id } = await ui.createMatter({
        title: values.title!.trim(),
        clientName: values.clientName!.trim(),
        caseType: values.caseType ? values.caseType : null,
      });
      return `legal://matter/${id}`;
    }
    return `legal://matter/${values.matterId}`;
  },

  render({ values, setValues, ui }) {
    return <Section>
      <Field label="Matter">
        <RadioCards
          value={values.mode ?? "existing"}
          options={[
            { value: "existing", title: "A matter on my desk", description: "Connect a matter you already opened." },
            { value: "new", title: "Open a new matter", description: "Start a case file for a client." },
          ]}
          onChange={mode => setValues({ mode })}
        />
      </Field>
      {values.mode === "new"
        ? <Section>
            <Field label="Matter title" description="How the firm refers to it, e.g. 'Dr. Rao EB-1A'.">
              <TextInput name="title" value={values.title} placeholder="Matter title"
                         onChange={title => setValues({ title })} />
            </Field>
            <Field label="Client name">
              <TextInput name="clientName" value={values.clientName} placeholder="Full name of the beneficiary"
                         onChange={clientName => setValues({ clientName })} />
            </Field>
            <Field label="Category" description="The visa or filing type, if already decided.">
              <RadioCards value={values.caseType ?? ""} options={CASE_TYPES}
                          onChange={caseType => setValues({ caseType })} />
            </Field>
          </Section>
        : <Field label="Choose a matter" description="Search by title or client name.">
            <Autocomplete name="matterId" value={values.matterId} placeholder="Search your matters..."
                          loadOptions={query => ui.listMatters(query)}
                          onChange={matterId => setValues({ matterId })} />
          </Field>}
    </Section>;
  },
} satisfies ConfiguratorUISpec<MatterConfiguratorRpc, MatterConfiguratorValues>;
