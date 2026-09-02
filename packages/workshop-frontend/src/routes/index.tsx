import { classifyRpcError, logRpcFailure } from "../rpcErrors";
import { useState, useEffect, useRef, useCallback } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useKumoToastManager } from "@cloudflare/kumo";
import { ChatInput } from "../ChatInterface";
import MeshBackground from "../components/MeshBackground";
import HomeTaskSuggestions from "../components/AppShell/HomeTaskSuggestions";
import { useAuthenticatedApi } from "../AuthContext";
import { RpcStub } from "capnweb";
import {
  Overseer,
  AiChatAuthorInfo,
  CapsuleSpecifier,
  ChatAttachmentHandle,
  MessageFormatRef,
  SlashCommandRequest,
  AuthenticatedApi,
} from "@gadgets/workshop-shared/api";
import type { FirmBrief, LegalDesk, MatterListEntry } from "@gadgets/workshop-shared/legal";
import {
  getStoredSelectedModel,
  persistSelectedModel,
} from "../modelSelection";
import { useDocumentTitle } from "../useDocumentTitle";
import { homePromptFromSearch } from "../homePrompt";
import { composerDraftStorageKey } from "../composerDraft";
import InlineConversation from "../components/firm/InlineConversation";
import { useDesk, usePolled } from "../components/firm/useDesk";
import { Notice, Pill, Skeleton, StatusDot, caseTypeLabel, plural, type DotTone } from "../components/legal/primitives";

type HomeSearch = { prompt?: string };

export const Route = createFileRoute("/")({
  component: HomePage,
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    prompt: homePromptFromSearch(search.prompt),
  }),
});

/**
 * Legal OS: the home is "Ask the firm" — the morning brief and the firm-wide conversation. The
 * platform's workspace launcher below stays reachable through the ?prompt= deep link (a shared
 * link that seeds a new workspace's first message), and for the tests that pin that flow.
 */
function HomePage() {
  const { prompt } = Route.useSearch();
  if (prompt) return <HomePageContent prompt={prompt} />;
  return <AskTheFirmPage />;
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Ask the firm
// ──────────────────────────────────────────────────────────────────────────────────────────────

const BRIEF_POLL_MS = 60_000;
const mintLegalDesk = (api: RpcStub<AuthenticatedApi>) => api.getLegalDesk();

type FirmChat =
  | { kind: "opening" }
  | { kind: "failed" }
  | { kind: "ready"; workspaceId: string };

/**
 * THE MORNING BRIEF — the firm already knows the day; the home opens with it instead of a void.
 * Matters needing the lawyer float first; quiet matters stay one quiet line each. THE
 * CONVERSATION IS THE PAGE (its one job); the day's status lives in a right rail it can be
 * scanned from without ever crowding the thread.
 */
function AskTheFirmPage() {
  useDocumentTitle("Ask the firm");
  const { authenticatedApi } = useAuthenticatedApi();
  const desk = useDesk<LegalDesk>(mintLegalDesk, "the matters desk");
  const legal = desk.kind === "ready" ? desk.stub : null;

  const readBrief = useCallback(() => (legal ? legal.brief() : Promise.reject(new Error("no desk"))), [legal]);
  const readMatters = useCallback(() => (legal ? legal.listMatters() : Promise.reject(new Error("no desk"))), [legal]);
  const brief = usePolled<FirmBrief>(legal ? readBrief : null, BRIEF_POLL_MS);
  const matters = usePolled<MatterListEntry[]>(legal ? readMatters : null, BRIEF_POLL_MS);

  const [chat, setChat] = useState<FirmChat>({ kind: "opening" });
  useEffect(() => {
    let cancelled = false;
    setChat({ kind: "opening" });
    authenticatedApi
      .ensureFirmWorkspace()
      .then((id) => { if (!cancelled) setChat({ kind: "ready", workspaceId: id }); })
      .catch((err) => {
        logRpcFailure("Failed to open the firm conversation:", err);
        if (!cancelled) setChat({ kind: "failed" });
      });
    return () => { cancelled = true; };
  }, [authenticatedApi]);

  const emptyPractice = matters.data !== null && matters.data.length === 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-[1080px] flex-col px-4 sm:px-8">
      <header className="shrink-0 pt-8 pb-4 sm:pt-10">
        <h1
          className="m-0 text-[34px] leading-none font-bold tracking-[-0.02em] text-kumo-default sm:text-[38px]"
          style={{ fontFamily: 'Georgia, "Times New Roman", Times, serif' }}
        >
          Ask the firm
        </h1>
        <p className="mt-2 mb-0 text-[13.5px] leading-5 tracking-[-0.25px] text-kumo-subtle">
          Your concierge has context on every matter.
        </p>
        {/* Below lg the rail folds to one line. */}
        <div className="mt-3 lg:hidden">
          <Link to="/matters" className="inline-flex">
            {brief.data ? (
              brief.data.needsYou > 0 ? (
                <Pill tone="needsYou">{plural(brief.data.needsYou, "decision waiting for you", "decisions waiting for you")}</Pill>
              ) : (
                <Pill>Nothing needs you right now</Pill>
              )
            ) : null}
          </Link>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-6 pb-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10">
        <section className="flex min-h-0 flex-col" aria-label="The firm conversation">
          {emptyPractice && <GettingStarted />}
          {chat.kind === "ready" ? (
            <div className="min-h-[420px] flex-1">
              <InlineConversation
                workspaceId={chat.workspaceId}
                intro={<ConversationIntro />}
              />
            </div>
          ) : chat.kind === "failed" ? (
            <div className="py-10 text-center">
              <p className="m-0 text-[19px] leading-6 font-semibold tracking-[-0.3px] text-kumo-default">
                The conversation can&apos;t open right now.
              </p>
              <p className="mt-1.5 text-[13.5px] leading-5 text-kumo-subtle">
                The connection to the firm&apos;s engine failed. Nothing on your matters is affected; reload to try again.
              </p>
            </div>
          ) : (
            // Hold the shape while the conversation resolves: a blank page reads as broken.
            <div className="space-y-3 pt-4">
              <Skeleton className="h-[52px] w-2/3" />
              <Skeleton className="h-[52px] w-1/2" />
              <Skeleton className="h-[88px]" />
            </div>
          )}
        </section>

        <aside className="hidden min-h-0 overflow-y-auto lg:block lg:border-l lg:border-kumo-line lg:pl-8" aria-label="Today">
          {desk.kind === "disabled" ? (
            <Notice tone="info" title="Matters aren't turned on for this deployment." />
          ) : (
            <TodayRail brief={brief.data} failed={brief.failed} />
          )}
        </aside>
      </div>
    </div>
  );
}

function ConversationIntro() {
  return (
    <div className="mx-auto max-w-[720px] px-2 pt-6 pb-2">
      <p className="m-0 text-[15px] leading-6 tracking-[-0.25px] text-kumo-default">
        I have context on every matter in the firm. Ask me anything: which cases need documents, what&apos;s blocked,
        where to focus today.
      </p>
    </div>
  );
}

function signalTone(kind: "paused" | "needs_you" | "reading" | "updates"): DotTone {
  return kind === "paused" ? "paused" : kind === "needs_you" ? "needsYou" : kind === "reading" ? "working" : "quiet";
}

function signalText(s: { kind: "paused" | "needs_you" | "reading" | "updates"; count: number }): string {
  switch (s.kind) {
    case "paused": return "paused by you";
    case "needs_you": return plural(s.count, "decision for you", "decisions for you");
    case "reading": return `reading ${plural(s.count, "document", "documents")}`;
    default: return plural(s.count, "update today", "updates today");
  }
}

/**
 * The day, compact, as ONE card: the needs-you number leads; each active matter is a row with
 * its single strongest signal (labeled, never a bare number); resting matters collapse to one
 * quiet closing line. The docket rides inside the same card — one rail, one day.
 */
function TodayRail({ brief, failed }: { brief: FirmBrief | null; failed: boolean }) {
  if (!brief) {
    return failed ? (
      <Notice title="The day's brief couldn't load." body="It keeps retrying — your matters are safe." />
    ) : (
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  const shown = brief.active.slice(0, 6);
  return (
    <div className="rounded-[14px] border border-kumo-line bg-kumo-base">
      <div className="px-4 pt-4 pb-3">
        <p className="m-0 text-[11px] leading-4 font-semibold uppercase tracking-[0.9px] text-kumo-subtle">Today</p>
        {failed && (
          <p className="mt-1 mb-0 text-[12px] leading-4 italic text-kumo-subtle">
            The day&apos;s brief isn&apos;t updating right now — showing the last view that loaded.
          </p>
        )}
        {brief.needsYou > 0 ? (
          <p className="mt-1.5 mb-0 text-[14px] leading-5 text-kumo-default">
            <span className="text-[26px] leading-8 font-semibold tracking-[-0.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>
              {brief.needsYou}
            </span>{" "}
            {brief.needsYou === 1 ? "decision waiting for you" : "decisions waiting for you"}
          </p>
        ) : (
          <p className="mt-1.5 mb-0 text-[14px] leading-5 text-kumo-default">Nothing needs you right now.</p>
        )}
      </div>

      {shown.length > 0 && (
        <ul className="m-0 list-none border-t border-kumo-line p-0">
          {shown.map((row) => (
            <li key={row.matterId} className="border-b border-kumo-line last:border-b-0">
              <Link
                to="/matter/$id"
                params={{ id: row.matterId }}
                className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-kumo-tint"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex flex-wrap items-center gap-1.5 text-[13px] leading-[18px] font-medium tracking-[-0.2px] text-kumo-default">
                    <span className="truncate">{row.title}</span>
                    <span className="text-[11px] font-normal text-kumo-inactive">{caseTypeLabel(row.caseType)}</span>
                  </p>
                  <p className="m-0 mt-0.5 line-clamp-2 text-[12.5px] leading-4 text-kumo-subtle">
                    {row.ask ?? (row.signal ? signalText(row.signal) : "")}
                  </p>
                </div>
                {row.signal && <StatusDot tone={signalTone(row.signal.kind)} className="mt-1.5" />}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {brief.docket.length > 0 && (
        <div className="border-t border-kumo-line px-4 py-3">
          <p className="m-0 mb-1.5 text-[11px] leading-4 font-semibold uppercase tracking-[0.9px] text-kumo-subtle">Docket</p>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {brief.docket.slice(0, 6).map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 truncate text-[12.5px] leading-4 text-kumo-default">{d.title}</p>
                  <p className="m-0 truncate text-[11.5px] leading-4 text-kumo-subtle">{d.matterTitle}</p>
                </div>
                <span
                  className={`shrink-0 text-[11.5px] leading-4 ${d.urgency === "overdue" ? "text-kumo-danger" : d.urgency === "in_window" ? "text-kumo-warning" : "text-kumo-subtle"}`}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {new Date(d.dueOn).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {d.daysLeft}d
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-kumo-line px-4 py-2.5 text-[12px] leading-4 text-kumo-subtle">
        {brief.moreActive > 0 && (
          <Link to="/matters" className="text-kumo-default hover:underline">
            +{brief.moreActive} more with activity today
          </Link>
        )}
        {brief.moreActive > 0 && brief.resting > 0 && " · "}
        {brief.resting > 0 && plural(brief.resting, "matter resting", "matters resting")}
        {brief.moreActive === 0 && brief.resting === 0 && shown.length === 0 && "No matters yet."}
      </div>
    </div>
  );
}

/** The empty practice teaches itself: the three moves that start a matter, then the ask box. */
function GettingStarted() {
  const steps = [
    { title: "Open a matter", body: "Name the client and the case type. The firm takes it from there." },
    { title: "Send the invite", body: "Your client gets a private link to upload their documents. No account." },
    { title: "Ask anything", body: "“What’s the strongest criterion?” “What’s still missing?” The firm answers from the record." },
  ];
  return (
    <div className="mb-6 rounded-[14px] border border-kumo-line bg-kumo-base px-5 py-5">
      <ol className="m-0 list-none space-y-3 p-0">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3">
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-kumo-tint text-[11px] font-semibold text-kumo-subtle"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {i + 1}
            </span>
            <div>
              <p className="m-0 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">{s.title}</p>
              <p className="m-0 mt-0.5 text-[13px] leading-[18px] text-kumo-subtle">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link
        to="/matters"
        className="press mt-4 inline-flex h-9 items-center rounded-lg bg-kumo-brand px-3.5 text-[13px] font-medium text-white hover:bg-kumo-brand-hover"
      >
        Open your first matter
      </Link>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// The platform's workspace launcher, kept for the ?prompt= deep link.
// ──────────────────────────────────────────────────────────────────────────────────────────────

export function HomePageContent({ prompt }: HomeSearch) {
  useDocumentTitle("New conversation");

  const { authenticatedApi, currentUser } = useAuthenticatedApi();
  const navigate = useNavigate();
  const toasts = useKumoToastManager();

  const [models, setModels] = useState<AiChatAuthorInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  // Bumped each time a task suggestion is picked; the composer re-seeds its text off the nonce.
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);

  useEffect(() => {
    if (!prompt) return;
    setSeed((previous) => ({ text: prompt, nonce: (previous?.nonce ?? 0) + 1 }));
    navigate({ to: "/", search: {}, replace: true });
  }, [navigate, prompt]);

  useEffect(() => {
    let cancelled = false;
    authenticatedApi.listModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setSelectedModel(getStoredSelectedModel(list));
      })
      .catch((err) => {
        logRpcFailure("Failed to fetch models:", err);
        // Toast unless it's a connection error (reconnect refetches); a do-reset here already
        // survived the Worker's same-colo retry, so the user should hear about it.
        if (classifyRpcError(err) !== "connection") {
          toasts.add({ title: "Couldn't load AI models", variant: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedApi]);

  const handleModelChange = useCallback((value: string | null) => {
    setSelectedModel(value);
    persistSelectedModel(value);
  }, []);

  // Pre-create a provisional gadget as soon as the user starts interacting, so that navigation
  // after submit is instant. Same pattern as before — disposed on unmount if never consumed.
  const provisionalOverseerRef = useRef<{ stub: RpcStub<Overseer> } | null>(null);

  const ensureProvisionalGadget = useCallback(() => {
    if (!provisionalOverseerRef.current) {
      const overseer = authenticatedApi.newGadget();
      provisionalOverseerRef.current = { stub: overseer };
    }
  }, [authenticatedApi]);

  useEffect(() => {
    return () => {
      provisionalOverseerRef.current?.stub[Symbol.dispose]();
      provisionalOverseerRef.current = null;
    };
  }, []);

  const handleSend = useCallback(
    async (
      message: string | SlashCommandRequest,
      modelId: string | null,
      capsules?: CapsuleSpecifier[],
      attachments?: ChatAttachmentHandle[],
      formats?: MessageFormatRef[],
    ) => {
      try {
        ensureProvisionalGadget();
        const overseer = provisionalOverseerRef.current!.stub;
        // Pipeline both independent calls in one batch, but settle both before releasing the stub.
        const [chat, {id}] = await Promise.all([
          overseer.newChat(message, modelId, capsules, attachments, formats),
          overseer.getMetadata(),
        ]);
        provisionalOverseerRef.current?.stub[Symbol.dispose]();
        provisionalOverseerRef.current = null;
        // Open the conversation we just started.
        navigate({ to: "/workspace/$id", params: { id }, search: { chat } });
      } catch (err) {
        const transient = logRpcFailure("Failed to create gadget:", err,
            { reportSite: "workspace.create" });
        // A retry reuses the provisional gadget while the draft contains gadget-scoped references.
        if (!attachments?.length && !capsules?.length) {
          provisionalOverseerRef.current?.stub[Symbol.dispose]();
          provisionalOverseerRef.current = null;
        }
        if (!transient) {
          toasts.add({ title: "Failed to create workspace", variant: "error" });
        }
        throw err;
      }
    },
    [ensureProvisionalGadget, navigate, toasts],
  );

  const getOverseer = useCallback((): RpcStub<Overseer> => {
    ensureProvisionalGadget();
    return provisionalOverseerRef.current!.stub;
  }, [ensureProvisionalGadget]);

  const createCapsuleGatekeeper = useCallback(
    (accountId: number, url: string) => {
      ensureProvisionalGadget();
      return provisionalOverseerRef.current!.stub.newGatekeeper(accountId, url);
    },
    [ensureProvisionalGadget],
  );

  return (
    <div className="relative isolate flex min-h-full w-full flex-col items-center justify-start px-4 pb-16 pt-10 sm:px-8 sm:pt-16 lg:pt-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px] overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 45%, rgba(0,0,0,0) 95%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 45%, rgba(0,0,0,0) 95%)",
        }}
      >
        <MeshBackground />
      </div>
      <div className="flex w-full max-w-2xl flex-col items-stretch gap-8">
        <header className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight leading-tight text-kumo-default sm:text-4xl">
            Start a new conversation
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[14px] leading-5 tracking-[-0.25px] text-kumo-subtle">
            A conversation outside any matter. For a case, open it from Matters.
          </p>
        </header>

        <ChatInput
          createCapsuleGatekeeper={createCapsuleGatekeeper}
          getOverseer={getOverseer}
          onSend={handleSend}
          isAgentActive={false}
          models={models}
          selectedModel={selectedModel}
          onModelChange={handleModelChange}
          newChat
          offerFormats
          autoFocus
          minRows={3}
          seedText={seed?.text}
          seedNonce={seed?.nonce}
          draftStorageKey={currentUser
            ? composerDraftStorageKey(currentUser.id, "home")
            : undefined}
        />

        <HomeTaskSuggestions
          onPick={(suggestion) =>
            setSeed((prev) => ({ text: suggestion, nonce: (prev?.nonce ?? 0) + 1 }))
          }
        />
      </div>
    </div>
  );
}
