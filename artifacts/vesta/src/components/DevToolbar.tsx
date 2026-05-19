import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

const IS_DEV = import.meta.env.DEV;

async function apiPost(path: string) {
  const r = await fetch(path, { method: "POST", credentials: "include" });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export default function DevToolbar() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  if (!IS_DEV) return null;

  async function run(action: () => Promise<unknown>, redirect?: string) {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries();
      if (redirect) navigate(redirect);
    } catch (e) {
      alert(`Dev action failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col items-end gap-2">
      {open && (
        <div
          className="rounded-2xl shadow-xl border text-xs font-mono overflow-hidden"
          style={{ background: "#1E2D24", borderColor: "#2E4035", minWidth: 200 }}
        >
          <div
            className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "#6F856F", borderBottom: "1px solid #2E4035" }}
          >
            Dev tools
          </div>
          {[
            {
              label: "↺ Reset onboarding",
              action: () => run(() => apiPost("/api/dev/reset-onboarding"), "/onboarding"),
            },
            {
              label: "⏩ Complete onboarding",
              action: () => run(() => apiPost("/api/dev/complete-onboarding"), "/app"),
            },
            {
              label: "🗑 Clear session",
              action: () =>
                run(async () => {
                  await fetch("/api/dev/session", { method: "DELETE", credentials: "include" });
                  window.location.href = "/";
                }),
            },
          ].map(({ label, action }) => (
            <button
              key={label}
              disabled={busy}
              onClick={action}
              className="w-full text-left px-3 py-2 transition-colors disabled:opacity-40"
              style={{ color: "#D1E8C7" }}
              onMouseEnter={(e) =>
                ((e.target as HTMLButtonElement).style.background = "#2A3D30")
              }
              onMouseLeave={(e) =>
                ((e.target as HTMLButtonElement).style.background = "transparent")
              }
            >
              {busy ? "…" : label}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        title="Dev tools"
        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm shadow-lg transition-transform hover:scale-110"
        style={{ background: open ? "#0E3B2E" : "#6F856F" }}
      >
        {open ? "×" : "⚙"}
      </button>
    </div>
  );
}
