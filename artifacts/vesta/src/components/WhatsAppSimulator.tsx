import React, { useState, useRef, useEffect } from "react";
import {
  Camera, Check, Home, Mic, MoreHorizontal, Phone, Plus, Video,
} from "lucide-react";

/* ──────────────────────────────────────────────
   Types
────────────────────────────────────────────── */
export type Intent =
  | "add_event" | "add_task" | "multi_intent" | "ask_status"
  | "delegate" | "reschedule" | "ask_memory" | "confirm_payment"
  | "low_confidence" | "undo" | "confirm" | "correction" | "unknown";

export interface PendingAction {
  intent: Intent;
  /** Human-readable summary of what Vesta extracted */
  summary: string;
  /** Structured payload for when a real LLM replaces the mock */
  payload: Record<string, unknown>;
}

interface Message {
  id: number;
  from: "user" | "vesta";
  text: string;
  quickReplies?: string[];
  pendingAction?: PendingAction;
  timestamp: Date;
  undone?: boolean;
}

/* ──────────────────────────────────────────────
   Mock parser — swap for LLM call later
────────────────────────────────────────────── */
const CORRECTION_PATTERNS: Array<{ re: RegExp; transform: (pa: PendingAction, m: RegExpMatchArray) => PendingAction | null }> = [
  { re: /na verdade (?:é|e) (.*)/i,    transform: (pa, m) => ({ ...pa, summary: pa.summary.replace(/—.*/, `— ${m[1]}`) }) },
  { re: /muda (?:para?|pra) (.*)/i,    transform: (pa, m) => ({ ...pa, summary: pa.summary.replace(/—.*/, `— ${m[1]}`) }) },
  { re: /troca (?:para?|pra) (.*)/i,   transform: (pa, m) => ({ ...pa, summary: pa.summary.replace(/—.*/, `— ${m[1]}`) }) },
  { re: /manda (?:para?|pra) (\w+)/i,  transform: (pa, m) => ({ ...pa, summary: pa.summary + ` → para ${m[1]}`, payload: { ...pa.payload, assignee: m[1] } }) },
  { re: /(?:pra|para) (\w+) resolver/i,transform: (pa, m) => ({ ...pa, summary: pa.summary + ` → para ${m[1]}`, payload: { ...pa.payload, assignee: m[1] } }) },
  { re: /lembra um dia antes/i,         transform: (pa) => ({ ...pa, payload: { ...pa.payload, reminder: "1d_before" } }) },
  { re: /não salva isso/i,              transform: (pa) => ({ ...pa, payload: { ...pa.payload, no_save: true } }) },
  { re: /sempre me pergunta antes/i,    transform: (pa) => ({ ...pa, payload: { ...pa.payload, always_ask: true } }) },
];

const UNDO_WORDS = /^(desfaz isso|desfaz|undo)$/i;
const CONFIRM_WORDS = /^(sim|pode confirmar|confirma|ok|certo|isso|✓)$/i;
const REJECT_WORDS = /^(não|nao|cancela|ignora)$/i;

function parseMessage(text: string, pending: PendingAction | null): { action: PendingAction | null; reply: string; quick: string[] } {
  const t = text.trim();

  // Undo
  if (UNDO_WORDS.test(t)) {
    return { action: null, reply: "Desfeito.", quick: [] };
  }

  // Confirm pending
  if (CONFIRM_WORDS.test(t) && pending) {
    return { action: null, reply: `Feito. Anotei: ${pending.summary} ✓`, quick: ["Ótimo", "Ver tudo"] };
  }

  // Reject pending
  if (REJECT_WORDS.test(t) && pending) {
    return { action: null, reply: "Entendido, descartei.", quick: [] };
  }

  // Correction of pending action
  if (pending) {
    for (const { re, transform } of CORRECTION_PATTERNS) {
      const m = t.match(re);
      if (m) {
        const updated = transform(pending, m);
        if (updated) {
          return {
            action: updated,
            reply: `Corrigi: ${updated.summary}. Confirmar?`,
            quick: ["Sim", "Editar", "Não"],
          };
        }
      }
    }
  }

  const tl = t.toLowerCase();

  // Ask memory
  if (/quando|qual dia|que dia|qual hora|a .* vem/i.test(tl) && /vem|é|foi|tem/i.test(tl)) {
    if (/maria|diarista|faxineira/i.test(tl)) {
      return {
        action: null,
        reply: "Tenho salvo: Maria vem às terças de manhã. Quer ver próximos lembretes?",
        quick: ["Sim", "Não"],
      };
    }
    return {
      action: null,
      reply: "Não tenho isso salvo ainda. Quer me contar?",
      quick: ["Salvar", "Agora não"],
    };
  }

  // Ask status
  if (/(?:o que|quais|tem algo|ficou|pendente|pendências|escola|saúde)/i.test(tl) && /pendente|ficou|tem|há/i.test(tl)) {
    const action: PendingAction = { intent: "ask_status", summary: "Status da escola", payload: { category: "escola" } };
    return {
      action,
      reply: "Da escola, tenho 2 pendências:\n1. Pagar passeio até sexta\n2. Levar lanche quinta\n\nQuer resolver alguma agora?",
      quick: ["Pagar passeio", "Ver tudo", "Depois"],
    };
  }

  // Payment confirmation
  if (/paguei|comprovante|pagamento|pix/i.test(tl)) {
    const action: PendingAction = { intent: "confirm_payment", summary: "Pagamento registrado", payload: { type: "payment" } };
    return {
      action,
      reply: "Anotei o pagamento. Quer salvar o comprovante?",
      quick: ["Salvar", "Só marcar como pago", "Não"],
    };
  }

  // Reschedule
  if (/troca|reagenda|muda|transfere|adiant/i.test(tl)) {
    const what = tl.replace(/troca|reagenda|muda|transfere|adiant/gi, "").replace(/\bpra\b|\bpara\b/gi, "").trim() || "evento";
    const action: PendingAction = { intent: "reschedule", summary: `Reagendar ${what}`, payload: { original: what } };
    return {
      action,
      reply: `Qual dia da semana que vem?`,
      quick: ["Segunda", "Terça", "Quarta", "Outro"],
    };
  }

  // Delegate
  if (/manda|delega|passa|atribui|resolve/i.test(tl) && /pedro|paulo|parceiro|marido|esposa|mama|papai|\w+/i.test(tl)) {
    const match = tl.match(/(?:manda|delega|passa|pra|para)\s+(\w+)/i);
    const who = match?.[1] ?? "parceiro";
    const action: PendingAction = { intent: "delegate", summary: `Delegar para ${who}`, payload: { assignee: who } };
    return {
      action,
      reply: `Posso atribuir para ${who.charAt(0).toUpperCase() + who.slice(1)}. Quer que eu avise ele?`,
      quick: ["Sim", "Só atribuir", "Outra pessoa"],
    };
  }

  // Multi-intent detector: event + task + payment
  const hasEvent = /(?:reunião|consulta|festa|passeio|evento|prova|formatura|aniversário|show|compromisso)/i.test(tl);
  const hasTask  = /(?:levar|comprar|buscar|ligar|trazer|pegar|mandar|enviar|resolver)/i.test(tl);
  const hasMoney = /R\$|reais|real|pagar|pagamento/i.test(tl);
  const multiCount = [hasEvent, hasTask, hasMoney].filter(Boolean).length;

  if (multiCount >= 2) {
    const parts: string[] = [];
    const payload: Record<string, unknown> = {};

    // Extract date/time
    const timeMatch = tl.match(/(?:segunda|terça|quarta|quinta|sexta|sábado|domingo|\d{1,2}\/\d{1,2}|\d{1,2}h)/i);
    const timeStr = timeMatch ? timeMatch[0] : "";

    if (hasEvent) {
      const eventMatch = t.match(/(?:reunião|consulta|festa|passeio|evento|prova|formatura|aniversário|show|compromisso)[^,.;]*/i);
      const ev = eventMatch ? eventMatch[0].trim() : "Evento";
      parts.push(`Evento: ${ev}${timeStr ? ` — ${timeStr}` : ""}`);
      payload.event = ev;
    }
    if (hasTask) {
      const taskMatch = t.match(/(?:levar|comprar|buscar|ligar|trazer|pegar|mandar|enviar|resolver)[^,.;]*/i);
      parts.push(`Tarefa: ${taskMatch ? taskMatch[0].trim() : "tarefa pendente"}`);
      payload.task = taskMatch?.[0]?.trim();
    }
    if (hasMoney) {
      const amountMatch = tl.match(/R\$\s*[\d,.]+|\d+\s*reais/i);
      parts.push(`Pagamento: ${amountMatch ? amountMatch[0] : "valor pendente"}`);
      payload.amount = amountMatch?.[0];
    }

    const numbered = parts.map((p, i) => `${i + 1}. ${p}`).join("\n");
    const action: PendingAction = {
      intent: "multi_intent",
      summary: parts.join(" + "),
      payload,
    };
    return {
      action,
      reply: `Anotei ${parts.length} coisas:\n${numbered}\n\nConfirmar tudo?`,
      quick: ["Sim", "Revisar", "Não"],
    };
  }

  // Event
  if (hasEvent || /(?:segunda|terça|quarta|quinta|sexta|sábado|domingo)\s+\d{1,2}h/i.test(tl)) {
    const timeMatch = tl.match(/(?:segunda|terça|quarta|quinta|sexta|sábado|domingo|\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})/i);
    const titleMatch = t.match(/(?:reunião|consulta|festa|passeio|evento|prova)[^,.;—]*/i) ?? t.match(/^[^.!?]{4,40}/);
    const title = titleMatch ? titleMatch[0].trim() : t.slice(0, 40);
    const when  = timeMatch ? timeMatch[0] : "horário a definir";

    const action: PendingAction = {
      intent: "add_event",
      summary: `${title} — ${when}`,
      payload: { title, when, reminder: "1h_before" },
    };
    return {
      action,
      reply: `Anotei: ${title} — ${when}. Vou colocar no calendário e lembrar 1h antes. Quem vai?`,
      quick: ["Eu", "Outra pessoa", "Depois"],
    };
  }

  // Task / reminder
  if (hasTask || /lembra|não esquece|me avisa|tem que/i.test(tl)) {
    const dueMatch = t.match(/(?:até|antes|em)\s+\w+/i);
    const due = dueMatch ? ` ${dueMatch[0]}` : "";
    const action: PendingAction = {
      intent: "add_task",
      summary: `${t.slice(0, 60).trim()}${due ? ` ${due}` : ""}`,
      payload: { title: t.slice(0, 80), due },
    };
    return {
      action,
      reply: `Anotei: ${t.slice(0, 60).trim()}${due}. Quer lembrete?`,
      quick: ["Sim", "Editar", "Não"],
    };
  }

  // Low confidence fallback
  const action: PendingAction = { intent: "low_confidence", summary: t.slice(0, 60), payload: { raw: t } };
  return {
    action,
    reply: "Não tenho certeza se isso é ação ou só aviso.",
    quick: ["Criar lembrete", "Só aviso", "Revisar"],
  };
}

/* ──────────────────────────────────────────────
   Voice waveform bars (decorative)
────────────────────────────────────────────── */
function VoiceBars() {
  const bars = [3, 6, 9, 5, 11, 7, 4, 9, 6, 3, 8, 5, 10, 7, 4, 9, 6, 3, 8, 5, 7];
  return (
    <div className="flex items-end gap-[2.5px] h-6">
      {bars.map((h, i) => (
        <div key={i} className="w-[2.5px] rounded-full" style={{ height: `${h * 2}px`, background: i < 9 ? "#0E3B2E" : "#C8C8C8" }} />
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────
   Message bubbles
────────────────────────────────────────────── */
function UserBubble({ msg }: { msg: Message }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-tr-none px-3 py-2" style={{ background: "#D9FDD3" }}>
        <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "#12231C" }}>{msg.text}</p>
        <div className="flex items-center justify-end gap-0.5 mt-0.5">
          <span className="text-[10px]" style={{ color: "#999" }}>
            {msg.timestamp.getHours().toString().padStart(2,"0")}:{msg.timestamp.getMinutes().toString().padStart(2,"0")}
          </span>
          <Check className="h-3 w-3" style={{ color: "#53BDEB" }} strokeWidth={2.5} />
          <Check className="h-3 w-3 -ml-1.5" style={{ color: "#53BDEB" }} strokeWidth={2.5} />
        </div>
      </div>
    </div>
  );
}

function VestaBubble({ msg }: { msg: Message }) {
  return (
    <div className="flex gap-2 items-end">
      <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center" style={{ background: "#0E3B2E" }}>
        <Home className="h-3 w-3 text-white" strokeWidth={1.5} />
      </div>
      <div className="max-w-[80%]">
        <div className="rounded-2xl rounded-tl-none px-3 py-2.5" style={{ background: "white" }}>
          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "#12231C" }}>{msg.text}</p>
          <p className="text-[10px] text-right mt-1" style={{ color: "#999" }}>
            {msg.timestamp.getHours().toString().padStart(2,"0")}:{msg.timestamp.getMinutes().toString().padStart(2,"0")}
          </p>
        </div>
        {msg.quickReplies && msg.quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {msg.quickReplies.map((qr) => (
              <QuickReplyChip key={qr} label={qr} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* Quick reply chip — needs the parent dispatch, so we thread it via context */
const SimContext = React.createContext<{ send: (t: string) => void } | null>(null);

function QuickReplyChip({ label }: { label: string }) {
  const ctx = React.useContext(SimContext);
  return (
    <button
      onClick={() => ctx?.send(label)}
      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-[#EAF1E5]"
      style={{ borderColor: "#0E3B2E", color: "#0E3B2E", background: "white" }}
    >
      {label}
    </button>
  );
}

/* ──────────────────────────────────────────────
   Intro message Vesta sends on mount
────────────────────────────────────────────── */
const INTRO: Omit<Message, "id"> = {
  from: "vesta",
  text: "Oi, sou a Vesta. Me encaminhe um recado real da casa — escola, consulta, boleto, diarista, condomínio ou festa. Se preferir, mande um áudio.",
  quickReplies: [],
  timestamp: new Date(),
};

/* ──────────────────────────────────────────────
   Public props
────────────────────────────────────────────── */
export interface WhatsAppSimulatorProps {
  /** Called whenever the first item is approved (activation milestone) */
  onFirstItemApproved?: () => void;
  /** Name shown in the WA header */
  contactName?: string;
  /** Show example prompt chips below input */
  showExamples?: boolean;
  /** Extra className on the outer wrapper */
  className?: string;
  /** If true, renders in a compact phone frame */
  phoneFrame?: boolean;
}

const EXAMPLES = [
  "Reunião da escola quinta 19h",
  "Passeio da Sofia quinta 14h. Levar lanche e R$30",
  "O que ficou pendente da escola?",
  "Troca a consulta pra semana que vem",
  "Quando a Maria vem mesmo?",
  "Lembra de comprar presente da festa da Julia até sexta",
];

/* ──────────────────────────────────────────────
   Main component
────────────────────────────────────────────── */
export default function WhatsAppSimulator({
  onFirstItemApproved,
  contactName = "Vesta",
  showExamples = false,
  className = "",
  phoneFrame = false,
}: WhatsAppSimulatorProps) {
  const [messages, setMessages] = useState<Message[]>([{ id: 0, ...INTRO }]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [undoStack, setUndoStack] = useState<{ messages: Message[]; pending: PendingAction | null }[]>([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  let nextId = useRef(1);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function pushMessage(msg: Omit<Message, "id">) {
    const m: Message = { id: nextId.current++, ...msg };
    setMessages((prev) => [...prev, m]);
    return m;
  }

  function send(text: string) {
    if (!text.trim()) return;
    setInput("");

    // Save undo snapshot before mutating
    setUndoStack((s) => [...s.slice(-4), { messages: [...messages], pending }]);

    // User message
    pushMessage({ from: "user", text: text.trim(), timestamp: new Date() });

    // Parse + respond after short delay (feels like typing)
    setTimeout(() => {
      const { action, reply, quick } = parseMessage(text.trim(), pending);

      // Undo?
      if (text.trim().match(UNDO_WORDS)) {
        setUndoStack((s) => {
          const last = s[s.length - 1];
          if (last) {
            setMessages(last.messages);
            setPending(last.pending);
            return s.slice(0, -1);
          }
          return s;
        });
        pushMessage({ from: "vesta", text: "Desfeito.", timestamp: new Date() });
        return;
      }

      // Confirmed a pending action → track activation
      if (text.trim().match(CONFIRM_WORDS) && pending) {
        const newCount = approvedCount + 1;
        setApprovedCount(newCount);
        if (newCount === 1) onFirstItemApproved?.();
      }

      setPending(action);
      pushMessage({ from: "vesta", text: reply, quickReplies: quick, pendingAction: action ?? undefined, timestamp: new Date() });
    }, 600);
  }

  const content = (
    <SimContext.Provider value={{ send }}>
      <div className={`flex flex-col h-full ${className}`}>
        {/* WA header */}
        <div className="flex items-center gap-3 px-4 pb-3 pt-3 text-white shrink-0" style={{ background: "#075E54" }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "#0E3B2E" }}>
            <Home className="h-4 w-4 text-white" strokeWidth={1.5} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold leading-none">{contactName}</p>
            <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>online · responde em segundos</p>
          </div>
          <div className="flex items-center gap-4">
            <Video className="h-5 w-5 opacity-75" />
            <Phone className="h-5 w-5 opacity-75" />
            <MoreHorizontal className="h-5 w-5 opacity-75" />
          </div>
        </div>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto px-3 py-4 space-y-3"
          style={{ background: "#ECE5DD" }}
        >
          {/* Date pill */}
          <div className="flex justify-center">
            <span className="rounded-full px-3 py-0.5 text-[11px]" style={{ background: "rgba(255,255,255,0.65)", color: "#666" }}>
              hoje
            </span>
          </div>

          {messages.map((msg) =>
            msg.from === "user"
              ? <UserBubble key={msg.id} msg={msg} />
              : <VestaBubble key={msg.id} msg={msg} />
          )}
          <div ref={bottomRef} />
        </div>

        {/* Example chips */}
        {showExamples && messages.length <= 2 && (
          <div className="px-3 py-2 flex flex-wrap gap-1.5 shrink-0" style={{ background: "#ECE5DD" }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => send(ex)}
                className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-white/80"
                style={{ borderColor: "rgba(14,59,46,0.30)", color: "#0E3B2E", background: "rgba(255,255,255,0.55)" }}
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {/* Input bar */}
        <div className="flex items-center gap-2 px-2 py-2 shrink-0" style={{ background: "#F0F0F0" }}>
          <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-2">
            <Plus className="h-4 w-4 shrink-0" style={{ color: "#6F856F" }} />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="Mensagem"
              className="flex-1 text-sm outline-none bg-transparent"
              style={{ color: "#12231C" }}
            />
            <Camera className="h-4 w-4 shrink-0" style={{ color: "#6F856F" }} />
          </div>
          <button
            onClick={() => send(input)}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-opacity disabled:opacity-40"
            style={{ background: "#0E3B2E" }}
          >
            {input.trim()
              ? <svg viewBox="0 0 24 24" fill="white" className="h-5 w-5"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
              : <Mic className="h-5 w-5 text-white" />}
          </button>
        </div>
      </div>
    </SimContext.Provider>
  );

  if (!phoneFrame) return content;

  return (
    <div className="mx-auto w-[320px] h-[620px] rounded-[44px] border-[8px] border-[#111] shadow-2xl overflow-hidden relative">
      {/* Notch */}
      <div className="absolute left-1/2 top-2 z-20 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />
      <div className="h-full pt-6">{content}</div>
    </div>
  );
}

/* Named re-exports for testing */
export { parseMessage };
