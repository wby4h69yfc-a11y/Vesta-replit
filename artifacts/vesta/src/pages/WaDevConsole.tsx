/**
 * WaDevConsole — developer-only pipeline tester.
 *
 * Injects messages into the real API processor (POST /api/dev/wa-simulate).
 * Not a product screen. Not visible in production. Not linked from any nav.
 */
import { useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { AlertTriangle, Terminal, Send, CheckCircle2, XCircle, Loader2, MessageSquare } from "lucide-react";

const IS_DEV = import.meta.env.DEV;

interface ProposedReply {
  kind: "interactive" | "text";
  body: string;
  buttons?: string[];
}

interface SimulateResult {
  outcome: string;
  inboxItemId?: number;
  approvalLevel?: string;
  actionTitle?: string | null;
  senderName?: string | null;
  waEligible?: boolean;
  proposedReply?: ProposedReply | null;
  error?: string;
}

export default function WaDevConsole() {
  const { user } = useAuth();
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

  async function simulate() {
    if (!body.trim()) return;
    setLoading(true);
    setResult(null);
    const ts = new Date().toLocaleTimeString("pt-BR");
    setLog((l) => [...l, `[${ts}] → "${body.slice(0, 70)}${body.length > 70 ? "…" : ""}"`]);

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
      const replyKind = data.proposedReply?.kind === "interactive" ? " 🔘buttons" : data.proposedReply?.kind === "text" ? " 📝text" : "";
      const parts = [
        `outcome="${data.outcome}"`,
        data.inboxItemId ? `inbox_item=${data.inboxItemId}` : null,
        data.approvalLevel ? `approval=${data.approvalLevel}` : null,
        data.actionTitle ? `action="${data.actionTitle}"` : null,
        data.waEligible !== undefined ? `wa_eligible=${data.waEligible}` : null,
        replyKind ? `reply=${replyKind}` : null,
      ].filter(Boolean).join(" ");
      setLog((l) => [...l, `[${ts2}] ← ${res.status} ${parts}`]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ outcome: "error", error: msg });
      setLog((l) => [...l, `[error] ${msg}`]);
    } finally {
      setLoading(false);
    }
  }

  const isOk = result && !result.error && result.outcome !== "unknown_sender" && result.outcome !== "token_expired" && result.outcome !== "error";

  return (
    <div className="min-h-screen" style={{ background: "#F7F4EA" }}>
      {/* DEV BANNER */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: "#1E2D24", color: "#D1E8C7" }}>
        <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "#F59E0B" }} />
        <div className="flex-1">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "#F59E0B" }}>
            Dev Pipeline Tester — não é uma tela do produto
          </span>
          <span className="text-xs ml-2" style={{ color: "#6F856F" }}>
            {user?.email ?? "desconhecido"}
          </span>
        </div>
        <Terminal className="h-4 w-4 opacity-50" />
      </div>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        {/* Context note */}
        <div className="rounded-xl px-3 py-2.5 text-xs font-mono leading-relaxed" style={{ background: "#EEE6D6", color: "#5F6B61" }}>
          ⚙️ Injeta mensagens no pipeline real: classify com AI → inbox_item → suggestedAction → reply composer.
          sender_phone deve corresponder a um membro/contato no DB para resolver o household.
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
              onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) simulate(); }}
              rows={3}
              placeholder="Reunião da escola quinta 19h..."
              className="w-full px-4 py-3 rounded-xl text-sm resize-none border-0 outline-none"
              style={{ background: "#F7F4EA", color: "#12231C" }}
            />
            <p className="text-[10px] mt-1" style={{ color: "#5F6B61" }}>⌘+Enter para enviar</p>
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
              <p className="text-[10px] mt-1" style={{ color: "#5F6B61" }}>Em branco → admin do household</p>
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
            onClick={simulate}
            disabled={!body.trim() || loading}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity"
            style={{ background: "#0E3B2E" }}
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Processando…</>
            ) : (
              <><Send className="h-4 w-4" /> Injetar no pipeline</>
            )}
          </button>
        </div>

        {/* Result */}
        {result && (
          <div
            className="rounded-2xl p-4 space-y-3"
            style={{
              background: isOk ? "#EAF1E5" : "#FEF2F2",
              border: `1px solid ${isOk ? "rgba(14,59,46,0.15)" : "#FECACA"}`,
            }}
          >
            <div className="flex items-center gap-2">
              {isOk ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "#0E3B2E" }} />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" style={{ color: "#DC2626" }} />
              )}
              <span className="text-sm font-semibold font-mono" style={{ color: "#12231C" }}>
                {result.outcome}
              </span>
              {result.waEligible !== undefined && (
                <span
                  className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded-full"
                  style={{
                    background: result.waEligible ? "#D1E8C7" : "#FEE2E2",
                    color: result.waEligible ? "#0E3B2E" : "#991B1B",
                  }}
                >
                  {result.waEligible ? "✅ WA-eligible" : "📱 app-only"}
                </span>
              )}
            </div>

            {result.actionTitle && (
              <p className="text-xs font-mono" style={{ color: "#5F6B61" }}>
                action: "{result.actionTitle}"
              </p>
            )}
            {result.inboxItemId && (
              <p className="text-xs font-mono" style={{ color: "#5F6B61" }}>
                inbox_item_id: {result.inboxItemId} · approval: {result.approvalLevel}
              </p>
            )}
            {result.senderName && (
              <p className="text-xs font-mono" style={{ color: "#5F6B61" }}>
                sender: {result.senderName}
              </p>
            )}

            {/* WhatsApp message preview */}
            {result.proposedReply && (
              <div className="mt-1 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(14,59,46,0.15)" }}>
                <div
                  className="px-3 py-1.5 flex items-center gap-1.5"
                  style={{ background: "#075E54" }}
                >
                  <MessageSquare className="h-3 w-3" style={{ color: "#D1E8C7" }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#D1E8C7" }}>
                    WhatsApp preview
                    {result.proposedReply.kind === "interactive" ? " · botões interativos" : " · texto simples"}
                  </span>
                </div>
                <div className="p-3 space-y-2" style={{ background: "#ECE5DD" }}>
                  {/* Message bubble */}
                  <div
                    className="rounded-lg px-3 py-2 text-xs leading-relaxed"
                    style={{ background: "#FFFFFF", color: "#111B21", maxWidth: "85%", marginLeft: "auto" }}
                  >
                    {result.proposedReply.body.split("\n").map((line, i) => (
                      <span key={i}>
                        {i > 0 && <br />}
                        {line || "\u00A0"}
                      </span>
                    ))}
                  </div>

                  {/* Interactive buttons */}
                  {result.proposedReply.kind === "interactive" && result.proposedReply.buttons && (
                    <div className="space-y-1.5">
                      {result.proposedReply.buttons.map((btn, i) => (
                        <div
                          key={i}
                          className="rounded-lg px-3 py-2 text-xs font-medium text-center cursor-default"
                          style={{
                            background: "#FFFFFF",
                            color: "#075E54",
                            border: "1px solid rgba(7,94,84,0.2)",
                            maxWidth: "85%",
                            marginLeft: "auto",
                          }}
                        >
                          {btn}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {result.error && (
              <p className="text-xs font-mono" style={{ color: "#DC2626" }}>{result.error}</p>
            )}
          </div>
        )}

        {/* Request log */}
        {log.length > 0 && (
          <div className="rounded-xl p-4 space-y-1" style={{ background: "#1E2D24" }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#6F856F" }}>Log</p>
              <button
                onClick={() => setLog([])}
                className="text-[10px]"
                style={{ color: "#6F856F" }}
              >
                limpar
              </button>
            </div>
            {log.map((line, i) => (
              <p key={i} className="text-[11px] font-mono leading-relaxed" style={{ color: "#D1E8C7" }}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
