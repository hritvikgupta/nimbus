"use client";
/**
 * Streaming chat view — ported from company-brain web/components/AgentThread.tsx
 * (Vercel AI-SDK). An assistant turn is parsed from the AI-SDK message `parts`
 * in stream order into ordered blocks: spoken TEXT (markdown) and WORK groups
 * (the collapsible "Worked for Ns" timeline of reasoning + tool steps).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown } from "../common/Icons.jsx";
import "../../styles/agentchat.css";

function toolStateOf(state) {
  if (state === "output-available") return "done";
  if (state === "output-error") return "error";
  return "running";
}

// Build the ordered block list from a UIMessage's parts (stream order).
function partsToBlocks(parts) {
  const blocks = [];
  const last = () => blocks[blocks.length - 1];
  const work = () => {
    const b = last();
    if (b && b.type === "work") return b;
    const nb = { type: "work", steps: [] };
    blocks.push(nb);
    return nb;
  };

  for (const raw of parts) {
    const p = raw;
    const type = p.type ?? "";
    if (type === "text") {
      if (!p.text) continue;
      const b = last();
      if (b && b.type === "text") b.text += p.text;
      else blocks.push({ type: "text", text: p.text });
    } else if (type === "reasoning") {
      if (!p.text) continue;
      const w = work();
      const s = w.steps[w.steps.length - 1];
      if (s && s.type === "reasoning") s.text += p.text;
      else w.steps.push({ type: "reasoning", text: p.text });
    } else if (type.startsWith("tool-") || type === "dynamic-tool") {
      const name = type === "dynamic-tool" ? (p.toolName ?? "tool") : type.slice(5);
      work().steps.push({ type: "tool", name, state: toolStateOf(p.state), args: p.input, result: p.output });
    }
  }
  return blocks;
}

function messageText(m) {
  return (m.parts)
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("");
}

const TOOL_LABEL = {
  list_cloud_resources: "Reading cloud resources",
  estimate_cost: "Estimating cost",
};

function toolLabel(name) {
  if (TOOL_LABEL[name]) return TOOL_LABEL[name];
  const parts = name.split("_");
  if (parts.length > 1) {
    const app = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
    const action = parts.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    return `${app} · ${action}`;
  }
  return name;
}

function pretty(v) {
  try { return typeof v === "string" ? v : JSON.stringify(v, null, 2); } catch { return String(v); }
}

export function Markdown({ text, className }) {
  return (
    <div className={"agent-md" + (className ? " " + className : "")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function WorkToolStep({ step }) {
  const [open, setOpen] = useState(false);
  const hasDetail = step.args !== undefined || step.result !== undefined;
  return (
    <div className={"work-step is-tool " + step.state}>
      <span className="work-dot" />
      <button className={"work-tool" + (hasDetail ? "" : " plain")} onClick={() => hasDetail && setOpen((o) => !o)}>
        <span className="work-tool-name">{toolLabel(step.name)}</span>
        {hasDetail && <span className={"work-tool-chev" + (open ? " open" : "")}><ChevronDown size={11} /></span>}
      </button>
      {open && hasDetail && (
        <div className="work-tool-detail">
          {step.args !== undefined && (
            <div className="work-detail-block"><div className="work-detail-label">Input</div><pre>{pretty(step.args)}</pre></div>
          )}
          {step.result !== undefined && (
            <div className="work-detail-block"><div className="work-detail-label">Result</div><pre>{pretty(step.result)}</pre></div>
          )}
        </div>
      )}
    </div>
  );
}

// Last non-empty line of a text block — the live status line the AI wrote for this step.
function lastLine(text) {
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const l = lines[lines.length - 1] || "";
  return l.replace(/[*_`#>]/g, "").replace(/[….]+\s*$/, "").slice(0, 90);
}

// While streaming it shows the AI's OWN latest status line (dynamic per request) shimmering with an
// animated gradient — falls back to "Working". Steps stay hidden until the header is clicked.
export function WorkGroup({ steps, streaming, liveLabel }) {
  const [open, setOpen] = useState(false);
  const startRef = useRef(Date.now());
  const [secs, setSecs] = useState(null);
  useEffect(() => {
    if (!streaming && secs === null) setSecs(Math.max(1, Math.round((Date.now() - startRef.current) / 1000)));
  }, [streaming, secs]);

  const expanded = open;
  const label = streaming ? (liveLabel || "Working") : `Worked for ${secs ?? 1}s`;
  return (
    <div className={"work-group" + (streaming ? " streaming" : "") + (expanded ? " open" : "")}>
      <button className="work-head" onClick={() => setOpen((o) => !o)}>
        <span className={"work-label" + (streaming ? " shimmer" : "")}>{label}</span>
        <span className={"work-chev" + (expanded ? " open" : "")}><ChevronDown size={13} /></span>
      </button>
      {expanded && (
        <div className="work-steps">
          {steps.map((s, i) =>
            s.type === "reasoning"
              ? <div key={i} className="work-step is-reason"><span className="work-dot" /><Markdown className="work-reason" text={s.text} /></div>
              : <WorkToolStep key={i} step={s} />
          )}
        </div>
      )}
    </div>
  );
}

export function AgentMessage({ message, streaming }) {
  if (message.role === "user") {
    return <div className="home-row user"><div className="home-bubble">{messageText(message)}</div></div>;
  }
  const blocks = partsToBlocks(message.parts);
  const lastIdx = blocks.length - 1;
  const hasContent = blocks.length > 0;
  const fallback = !blocks.some((b) => b.type === "text") ? messageText(message) : "";
  // Always render markdown — even mid-stream. ReactMarkdown handles partial input fine, and
  // rendering raw text while streaming left literal **bold** / - bullets on screen.
  const TextOut = ({ text }) => <Markdown text={text} />;
  return (
    <div className="home-row assistant">
      <div className="home-assistant-main">
        {blocks.map((b, i) => {
          if (b.type === "text") {
            // While streaming, a short text line right before the trailing work group IS the AI's
            // live status — don't render it here; it shimmers inside that work header instead.
            const nxt = blocks[i + 1];
            const isLiveStatus = streaming && i + 1 === lastIdx && nxt?.type === "work" && b.text.trim().length <= 140;
            if (isLiveStatus) return null;
            return b.text.trim() ? <TextOut key={i} text={b.text} /> : null;
          }
          const live = streaming && i === lastIdx;
          const prev = blocks[i - 1];
          const liveLabel = live && prev?.type === "text" ? lastLine(prev.text) : undefined;
          return <WorkGroup key={i} steps={b.steps} streaming={live} liveLabel={liveLabel} />;
        })}
        {fallback.trim() && <TextOut text={fallback} />}
        {streaming && !hasContent && <span className="typing"><i /><i /><i /></span>}
        {streaming && hasContent && blocks[lastIdx]?.type === "text" && <span className="stream-caret" />}
      </div>
    </div>
  );
}

// ── conversation hook (useChat → /api/agent) ──
export function useConversation(opts) {
  const ctx = useRef({ ...opts });
  ctx.current = { ...opts };
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agent",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { ...(body || {}), messages, ...ctx.current },
        }),
      }),
    []
  );
  const { messages, sendMessage, status, setMessages, error } = useChat({ transport });
  const [draft, setDraft] = useState("");
  const streaming = status === "submitted" || status === "streaming";
  const send = (text) => {
    if (!text.trim() || streaming) return;
    setDraft("");
    void sendMessage({ text: text.trim() });
  };
  return { messages, send, draft, setDraft, streaming, setMessages, error };
}

export function AgentThread({ messages, streaming, error }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming]);
  return (
    <>
      {messages.map((m, i) => (
        <AgentMessage key={m.id ?? i} message={m} streaming={streaming && i === messages.length - 1} />
      ))}
      {streaming && messages[messages.length - 1]?.role !== "assistant" && (
        <div className="home-row assistant"><span className="typing"><i /><i /><i /></span></div>
      )}
      {error && <div className="agent-err">⚠️ {error.message}</div>}
      <div ref={endRef} />
    </>
  );
}
