import { useState } from "react";
import { Shield, CheckSquare, Square, ExternalLink, AlertTriangle } from "lucide-react";
import { V } from "@/lib/brand";

type PaymentDetails = {
  recipient?: string | null;
  amount_cents?: number | null;
  description?: string | null;
  due_date?: string | null;
  payment_method?: string | null;
};

const METHOD_LABELS: Record<string, string> = {
  pix:      "Pix",
  boleto:   "Boleto",
  cartao:   "Cartão",
  dinheiro: "Dinheiro",
  ted:      "TED/DOC",
};

function formatCents(cents: number): string {
  return `R$\u00A0${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDueDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

export default function PaymentSafetyChecklist({ payment }: { payment: PaymentDetails }) {
  const [confirmed, setConfirmed] = useState(false);

  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Destinatário",  value: payment.recipient ?? null },
    { label: "Valor",         value: payment.amount_cents ? formatCents(payment.amount_cents) : null },
    { label: "Referente a",   value: payment.description ?? null },
    { label: "Vencimento",    value: payment.due_date ? formatDueDate(payment.due_date) : null },
    { label: "Forma",         value: payment.payment_method ? METHOD_LABELS[payment.payment_method] ?? payment.payment_method : null },
  ].filter((r) => r.value !== null);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "rgba(14,59,46,0.12)", background: V.cream }}>
      <div className="px-4 py-3 flex items-center gap-2" style={{ background: "#EAF1E5" }}>
        <Shield className="w-4 h-4" style={{ color: V.primary }} />
        <span className="text-sm font-semibold" style={{ color: V.primary }}>Checklist de Segurança</span>
      </div>

      <div className="px-4 py-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium" style={{ color: V.muted }}>{row.label}</span>
            <span className="text-sm font-semibold text-right" style={{ color: V.ink }}>{row.value}</span>
          </div>
        ))}
      </div>

      <div className="px-4 pb-3 pt-1 space-y-3">
        <button
          onClick={() => setConfirmed(!confirmed)}
          className="flex items-center gap-2 w-full text-left"
          aria-pressed={confirmed}
        >
          {confirmed
            ? <CheckSquare className="w-5 h-5 shrink-0" style={{ color: V.primary }} />
            : <Square className="w-5 h-5 shrink-0" style={{ color: V.muted }} />
          }
          <span className="text-sm" style={{ color: confirmed ? V.primary : V.ink }}>
            Conferi todos os dados acima
          </span>
        </button>

        <a
          href={payment.payment_method === "pix" ? "intent://pix/#Intent;scheme=nubank;end" : "#"}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity"
          style={{
            background:  confirmed ? V.primary : "rgba(14,59,46,0.15)",
            color:       confirmed ? "white"   : V.muted,
            pointerEvents: confirmed ? "auto" : "none",
            opacity:       confirmed ? 1       : 0.6,
          }}
          aria-disabled={!confirmed}
          data-testid="btn-open-bank"
        >
          <ExternalLink className="w-4 h-4" />
          Abrir app do banco
        </a>

        <div className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(217,119,6,0.08)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#B45309" }} />
          <p className="text-xs leading-snug" style={{ color: "#92400E" }}>
            O Vesta <strong>NUNCA</strong> executa pagamentos. Sempre confirme os dados diretamente no app do seu banco.
          </p>
        </div>
      </div>
    </div>
  );
}
