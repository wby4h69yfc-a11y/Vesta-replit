/**
 * WaButtonPreview — read-only WhatsApp-style interactive message preview.
 *
 * Shows a representative preview of the interactive button message that was (or
 * would be) sent to the household admin on WhatsApp. The preview is entirely
 * cosmetic — tapping the buttons does nothing.
 *
 * Used in ApprovalCard when wa_can_approve_via_wa === true.
 */
import { MessageSquare } from "lucide-react";

interface Button {
  title: string;
}

interface WaButtonPreviewProps {
  body: string;
  buttons: Button[];
  footer?: string;
  label?: string;
}

export default function WaButtonPreview({
  body,
  buttons,
  footer,
  label = "Preview WhatsApp · botões interativos",
}: WaButtonPreviewProps) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(14,59,46,0.15)" }}>
      <div
        className="px-3 py-1.5 flex items-center gap-1.5"
        style={{ background: "#075E54" }}
      >
        <MessageSquare className="h-3 w-3" style={{ color: "#D1E8C7" }} />
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: "#D1E8C7" }}
        >
          {label}
        </span>
      </div>

      <div className="p-3 space-y-1.5" style={{ background: "#ECE5DD" }}>
        <div
          className="rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: "#FFFFFF", color: "#111B21", maxWidth: "90%", marginLeft: "auto" }}
        >
          {body.split("\n").map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {line || "\u00A0"}
            </span>
          ))}
          {footer && (
            <p className="mt-1 text-[10px]" style={{ color: "#667781" }}>
              {footer}
            </p>
          )}
        </div>

        <div className="space-y-1">
          {buttons.map((btn, i) => (
            <div
              key={i}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-center cursor-default select-none"
              style={{
                background: "#FFFFFF",
                color: "#075E54",
                border: "1px solid rgba(7,94,84,0.2)",
                maxWidth: "90%",
                marginLeft: "auto",
              }}
            >
              {btn.title}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
