import { useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import WhatsAppSimulator from "@/components/WhatsAppSimulator";
import { AlertTriangle, Terminal, Send, CheckCircle2, XCircle, Loader2 } from "lucide-react";

const IS_DEV = import.meta.env.DEV;

interface SimulateResult {
  outcome: string;
  inboxItemId?: number;
  approvalLevel?: string;
  senderName?: string | null;
  error?: string;
}

export default function WaDevConsole() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"mock" | "real">("mock");
  const [body, setBody] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [senderName, setSenderName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [log, setLog] = useState<string[]>([]);

  if (!IS_DEV) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F7F4EA" }}>
        <p className="text-sm" style={{ color: "#5F6B61" }}>Not available in production.</p>
      </div>
    );
  }

  async function simulateReal() {
    if (!body.trim()) return;
    setLoading(true);
    setResult(null);
    const ts = new Date().toLocaleTimeString("pt-BR");
    setLog((l) => [...l, `[${ts}] → POST /api/dev/wa-simulate — "${body.slice(0, 60)}…"`]);

    try {
      const res = await fetch("/api/dev/wa-simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          body: body.trim(),
          sender_phone: senderPhone.trim() || undefined,
          sender_name: senderName.trim() || undefined,
        }),
      });
      const data = await res.json() as SimulateResult;
      setResult(data);
      const ts2 = new Date().toLocaleTimeString("pt-BR");
      setLog((l) => [
        ...l,
        `[${ts2}] ← ${res.status} outcome="${data.outcome}"${data.inboxItemId ? ` inbox_item=${data.inboxItemId}` : ""}${data.approvalLevel ? ` approval=${data.approvalLevel}` : ""}`,
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ outcome: "error", error: msg });
      setLog((l) => [...l, `[error] ${msg}`]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F4EA" }}>
      {/* DEV BANNER */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: "#1E2D24", color: "#D1E8C7" }}>
        <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "#F59E0B" }} />
        <div className="flex-1">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "#F59E0B" }}>
            Dev Test Console — não é uma tela do produto
          </span>
          <span className="text-xs ml-2" style={{ color: "#6F856F" }}>
            Logado como {user?.email ?? "desconhecido"}
          </span>
        </div>
        <Terminal className="h-4 w-4 opacity-50" />
      </div>

      {/* TABS */}
      <div className="flex border-b px-4" style={{ borderColor: "rgba(14,59,46,0.12)", background: "#FFFDF6" }}>
        {[
          { id: "mock" as const, label: "Mock client-side" },
          { id: "real" as const, label: "Real API pipeline" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-3 text-xs font-semibold transition-colors border-b-2"
            style={{
              borderColor: tab === t.id ? "#0E3B2E" : "transparent",
              color: tab === t.id ? "#0E3B2E" : "#5F6B61",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "mock" && (
        <div className="flex flex-col items-center py-8 px-4">
          <div className="w-full max-w-sm mb-3">
            <div className="rounded-xl px-3 py-2 text-xs font-mono" style={{ background: "#EEE6D6", color: "#5F6B61" }}>
              ⚠️ Respostas são simuladas client-side. Nenhuma API é chamada. Nenhum inbox item é criado.
            </div>
          </div>
          <WhatsAppSimulator
            contactName="Vesta (mock)"
            showExamples
            phoneFrame
          />
        </div>
      )}

      {tab === "real" && (
        <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
          <div className="rounded-xl px-3 py-2 text-xs font-mono" style={{ background: "#EEE6D6", color: "#5F6B61" }}>
            ⚙️ Dispara o pipeline real: classifica com AI, cria inbox_item, salva no DB. O sender_phone é usado para resolver household via membros/contatos.
          </div>

          {/* Form */}
          <div className="rounded-2xl p-5 space-y-4" style={{ background: "#FFFDF6", border: "1px solid rgba(14,59,46,0.10)" }}>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: "#12231C" }}>
                Corpo da mensagem *
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="Reunião da escola quinta 19h..."
                className="w-full px-4 py-3 rounded-xl text-sm resize-none border-0 outline-none"
                style={{ background: "#F7F4EA", color: "#12231C" }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "#12231C" }}>
                  Telefone do remetente
                </label>
                <input
                  type="tel"
                  value={senderPhone}
                  onChange={(e) => setSenderPhone(e.target.value)}
                  placeholder="+5511999990000"
                  className="w-full px-3 py-2.5 rounded-xl text-sm border-0 outline-none"
                  style={{ background: "#F7F4EA", color: "#12231C" }}
                />
                <p className="text-[10px] mt-1" style={{ color: "#5F6B61" }}>Deixar em branco usa o admin do household</p>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "#12231C" }}>
                  Nome do remetente
                </label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="Escola João Paulo"
                  className="w-full px-3 py-2.5 rounded-xl text-sm border-0 outline-none"
                  style={{ background: "#F7F4EA", color: "#12231C" }}
                />
              </div>
            </div>
            <button
              onClick={simulateReal}
              disabled={!body.trim() || loading}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: "#0E3B2E" }}
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Processando…</>
              ) : (
                <><Send className="h-4 w-4" /> Simular mensagem</>
              )}
            </button>
          </div>

          {/* Result */}
          {result && (
            <div
              className="rounded-2xl p-4 space-y-2"
              style={{
                background: result.error || result.outcome === "unknown_sender" || result.outcome === "token_expired"
                  ? "#FEF2F2"
                  : "#EAF1E5",
                border: `1px solid ${result.error ? "#FECACA" : "rgba(14,59,46,0.15)"}`,
              }}
            >
              <div className="flex items-center gap-2">
                {result.error || result.outcome === "unknown_sender" ? (
                  <XCircle className="h-4 w-4 shrink-0" style={{ color: "#DC2626" }} />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "#0E3B2E" }} />
                )}
                <span className="text-sm font-semibold font-mono" style={{ color: "#12231C" }}>
                  outcome: {result.outcome}
                </span>
              </div>
              {result.inboxItemId && (
                <p className="text-xs font-mono" style={{ color: "#5F6B61" }}>
                  inbox_item_id: {result.inboxItemId} · approval: {result.approvalLevel}
                </p>
              )}
              {result.senderName && (
                <p className="text-xs font-mono" style={{ color: "#5F6B61" }}>
                  sender_name: {result.senderName}
                </p>
              )}
              {result.error && (
                <p className="text-xs font-mono" style={{ color: "#DC2626" }}>{result.error}</p>
              )}
            </div>
          )}

          {/* Request log */}
          {log.length > 0 && (
            <div className="rounded-xl p-4 space-y-1" style={{ background: "#1E2D24" }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#6F856F" }}>Log</p>
              {log.map((line, i) => (
                <p key={i} className="text-[11px] font-mono leading-relaxed" style={{ color: "#D1E8C7" }}>
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
