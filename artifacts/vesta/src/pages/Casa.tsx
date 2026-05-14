import { useState, useRef } from "react";
import { Link } from "wouter";
import { Users, Phone, Plus, Home, Trash2, MessageCircle, Copy, CheckCheck, ExternalLink, Upload, Inbox, Zap, X, Check, ArrowRight } from "lucide-react";
import {
  useGetHousehold,
  useListMembers,
  useListContacts,
  useCreateContact,
  useDeleteContact,
  getListContactsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import CategoryBadge from "@/components/CategoryBadge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const CONTACT_CATS = [
  { id: "escola",   label: "Escola" },
  { id: "saude",    label: "Saúde" },
  { id: "diarista", label: "Diarista" },
  { id: "portaria", label: "Portaria" },
  { id: "sindico",  label: "Síndico" },
  { id: "familia",  label: "Família" },
  { id: "servicos", label: "Serviços" },
  { id: "social",   label: "Social" },
  { id: "outros",   label: "Outros" },
];

type WebhookInfo = {
  webhook_url: string | null;
  method: string;
  description: string;
  status: string;
};

type ImportCandidate = {
  name: string;
  phone: string | null;
};

const SAMPLE_WA_MESSAGES = [
  "Boa tarde! Aqui é a secretária da Escola Estadual. A reunião de pais está marcada para quinta-feira, dia 22, às 19h. Confirme presença.",
  "Dona Ana, a Maria não vai conseguir ir sexta-feira. Pode compensar na segunda?",
  "Ana, a consulta da Larissa com a Dra. Beatriz está confirmada para amanhã às 10h. Lembre a carteirinha do plano.",
  "Oi! Festa de aniversário do Lucas vai ser sábado dia 24, das 15h às 19h. Rua das Palmeiras 45. Confirme presença do Guilherme!",
  "Bom dia! O técnico do ar condicionado pode ir na quinta-feira às 14h. Confirma?",
];

export default function CasaPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [catFilter, setCatFilter] = useState<string | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", category: "escola", notes: "" });

  // Webhook state
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testSending, setTestSending] = useState(false);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importTab, setImportTab] = useState<"inbox" | "export">("inbox");
  const [inboxSenders, setInboxSenders] = useState<ImportCandidate[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [exportSenders, setExportSenders] = useState<ImportCandidate[]>([]);
  const [fileParseLoading, setFileParseLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [catForImport, setCatForImport] = useState("outros");
  const [importSaving, setImportSaving] = useState(false);

  const { data: household } = useGetHousehold();
  const { data: members } = useListMembers();
  const { data: contacts, isLoading } = useListContacts(catFilter ? { category: catFilter } : {});

  const createContact = useCreateContact({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setShowCreate(false);
        setForm({ name: "", phone: "", category: "escola", notes: "" });
        toast({ description: "Contato adicionado." });
      },
    },
  });

  const deleteContact = useDeleteContact({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ description: "Contato removido." });
      },
    },
  });

  async function loadWebhookInfo() {
    setWebhookLoading(true);
    try {
      const res = await fetch("/api/webhook/whatsapp/info");
      const data: WebhookInfo = await res.json();
      setWebhookInfo(data);
    } catch {
      toast({ description: "Não foi possível carregar as informações do webhook.", variant: "destructive" });
    } finally {
      setWebhookLoading(false);
    }
  }

  async function copyWebhookUrl() {
    if (!webhookInfo?.webhook_url) return;
    await navigator.clipboard.writeText(webhookInfo.webhook_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function testWebhook() {
    setTestSending(true);
    try {
      const msg = SAMPLE_WA_MESSAGES[Math.floor(Math.random() * SAMPLE_WA_MESSAGES.length)];
      const body = new URLSearchParams({
        From: "whatsapp:+5511988880001",
        Body: msg,
        ProfileName: "Contato Teste",
        NumMedia: "0",
        MessageSid: `SMtest${Date.now()}`,
      });
      await fetch("/api/webhook/whatsapp", { method: "POST", body });
      toast({ description: "Mensagem de teste enviada! Verifique o Para Processar." });
    } catch {
      toast({ description: "Falha ao enviar teste.", variant: "destructive" });
    } finally {
      setTestSending(false);
    }
  }

  async function openImport() {
    setShowImport(true);
    setSelected(new Set());
    setExportSenders([]);
    setImportTab("inbox");
    setInboxLoading(true);
    try {
      const res = await fetch("/api/contacts/whatsapp-senders");
      const data: ImportCandidate[] = await res.json();
      setInboxSenders(data);
    } catch {
      toast({ description: "Erro ao carregar remetentes.", variant: "destructive" });
    } finally {
      setInboxLoading(false);
    }
  }

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll(candidates: ImportCandidate[]) {
    const allNames = candidates.map((c) => c.name);
    const allSelected = allNames.every((n) => selected.has(n));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        allNames.forEach((n) => next.delete(n));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        allNames.forEach((n) => next.add(n));
        return next;
      });
    }
  }

  async function handleFileUpload(file: File) {
    setFileParseLoading(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/contacts/parse-whatsapp-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("parse failed");
      const data: ImportCandidate[] = await res.json();
      setExportSenders(data);
      setImportTab("export");
      if (data.length === 0) {
        toast({ description: "Nenhum remetente novo encontrado no arquivo." });
      }
    } catch {
      toast({ description: "Erro ao processar o arquivo.", variant: "destructive" });
    } finally {
      setFileParseLoading(false);
    }
  }

  async function importSelected() {
    const candidates = importTab === "inbox" ? inboxSenders : exportSenders;
    const toImport = candidates.filter((c) => selected.has(c.name));
    if (toImport.length === 0) return;
    setImportSaving(true);
    try {
      const res = await fetch("/api/contacts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contacts: toImport.map((c) => ({
            name: c.name,
            phone: c.phone ?? undefined,
            category: catForImport,
          })),
        }),
      });
      if (!res.ok) throw new Error("bulk failed");
      qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
      toast({ description: `${toImport.length} contato${toImport.length > 1 ? "s" : ""} importado${toImport.length > 1 ? "s" : ""}!` });
      setShowImport(false);
      setSelected(new Set());
    } catch {
      toast({ description: "Erro ao importar contatos.", variant: "destructive" });
    } finally {
      setImportSaving(false);
    }
  }

  const activeCandidates = importTab === "inbox" ? inboxSenders : exportSenders;

  return (
    <div className="p-4 space-y-5 animate-fade-in-up">
      <h1 className="text-xl font-bold text-foreground">Casa</h1>

      {/* Household info */}
      {household && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Home className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{household.name}</p>
              {household.location && <p className="text-xs text-muted-foreground">{household.location}</p>}
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium mt-0.5 inline-block", household.plan === "premium" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground")}>
                {household.plan === "premium" ? "Premium" : "Gratuito"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Members */}
      {(members?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Membros</h2>
          <div className="flex gap-3 flex-wrap">
            {members?.map((m) => (
              <div key={m.id} className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground">{m.name}</p>
                  <p className="text-[10px] text-muted-foreground">{m.role === "admin" ? "Admin" : m.role === "restricted" ? "Restrito" : "Membro"}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Smart Rules shortcut */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Automação</h2>
        <Link href="/regras">
          <div className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3 hover:bg-muted/40 transition-colors cursor-pointer group">
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#D8EDD5" }}>
              <Zap className="w-5 h-5" style={{ color: "#1B3A2D" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Regras inteligentes</p>
              <p className="text-xs text-muted-foreground leading-snug">
                Defina padrões para aprovar, delegar e classificar mensagens automaticamente.
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
        </Link>
      </section>

      {/* WhatsApp section */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">WhatsApp</h2>
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">

          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Integração via Twilio</p>
              <p className="text-xs text-muted-foreground leading-snug">
                Receba mensagens do WhatsApp diretamente no Para Processar — a Vesta classifica automaticamente.
              </p>
            </div>
          </div>

          {/* Webhook URL */}
          {!webhookInfo ? (
            <button
              onClick={loadWebhookInfo}
              disabled={webhookLoading}
              className="w-full py-2 rounded-xl text-xs font-medium bg-green-600 text-white disabled:opacity-50"
            >
              {webhookLoading ? "Carregando…" : "Ver URL do webhook"}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="bg-muted rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">URL para o console do Twilio</p>
                <p className="text-xs font-mono text-foreground break-all leading-relaxed">
                  {webhookInfo.webhook_url ?? "Publique o app para obter a URL"}
                </p>
              </div>

              <div className="flex gap-2">
                {webhookInfo.webhook_url && (
                  <button
                    onClick={copyWebhookUrl}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium bg-primary text-primary-foreground"
                  >
                    {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copiado!" : "Copiar URL"}
                  </button>
                )}
                <a
                  href="https://console.twilio.com/us1/develop/phone-numbers/manage/active"
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium bg-muted text-foreground border border-border"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Console Twilio
                </a>
              </div>

              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-1">
                <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Como configurar</p>
                <ol className="text-xs text-amber-800 space-y-0.5 list-decimal list-inside">
                  <li>Abra o Console do Twilio</li>
                  <li>Vá em Messaging → Active Numbers</li>
                  <li>Cole a URL acima em "A message comes in"</li>
                  <li>Selecione método HTTP POST e salve</li>
                </ol>
              </div>
            </div>
          )}

          {/* Test webhook */}
          <button
            onClick={testWebhook}
            disabled={testSending}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50 transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            {testSending ? "Enviando…" : "Testar: simular mensagem recebida"}
          </button>

          {/* Import contacts */}
          <button
            onClick={openImport}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium border border-border text-foreground bg-muted hover:bg-muted/80 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            Importar contatos do WhatsApp
          </button>
        </div>
      </section>

      {/* Contacts */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contatos</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-primary text-primary-foreground rounded-xl text-xs font-medium"
            data-testid="button-add-contact"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </button>
        </div>

        {/* Category filter */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2">
          <button
            onClick={() => setCatFilter(undefined)}
            className={cn("shrink-0 px-3 py-1 rounded-full text-xs font-medium", !catFilter ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground")}
          >
            Todos
          </button>
          {CONTACT_CATS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCatFilter(catFilter === c.id ? undefined : c.id)}
              className={cn("shrink-0 px-3 py-1 rounded-full text-xs font-medium", catFilter === c.id ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground")}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Create contact form */}
        {showCreate && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-2 mb-3 animate-fade-in-up">
            <h3 className="text-sm font-semibold">Novo contato</h3>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nome"
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-contact-name"
            />
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Telefone/WhatsApp"
              type="tel"
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="select-contact-category"
            >
              {CONTACT_CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notas (opcional)"
              rows={2}
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground">Cancelar</button>
              <button
                onClick={() => createContact.mutate({ data: { name: form.name, category: form.category, phone: form.phone || undefined, notes: form.notes || undefined } })}
                disabled={!form.name || createContact.isPending}
                className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                data-testid="button-submit-contact"
              >
                {createContact.isPending ? "Salvando..." : "Adicionar"}
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}</div>
        ) : !contacts?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Nenhum contato ainda</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Adicione a escola, médico, diarista e mais.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-3 bg-card border border-border rounded-xl px-3 py-2.5 group"
                data-testid={`contact-${contact.id}`}
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">
                  {contact.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{contact.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <CategoryBadge category={contact.category} />
                    {contact.phone && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="w-3 h-3" />
                        {contact.phone}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteContact.mutate({ id: contact.id })}
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"
                  data-testid={`delete-contact-${contact.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Import contacts modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={(e) => { if (e.target === e.currentTarget) setShowImport(false); }}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowImport(false)} />
          <div className="relative bg-background rounded-t-3xl shadow-xl max-h-[85vh] flex flex-col z-10">

            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <h3 className="text-base font-bold text-foreground">Importar contatos</h3>
                <p className="text-xs text-muted-foreground">Selecione quem adicionar à sua lista</p>
              </div>
              <button onClick={() => setShowImport(false)} className="p-2 rounded-xl hover:bg-muted">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-5 pt-3">
              <button
                onClick={() => setImportTab("inbox")}
                className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-colors",
                  importTab === "inbox" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
              >
                <Inbox className="w-3.5 h-3.5" />
                Do histórico
                {inboxSenders.length > 0 && (
                  <span className={cn("ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                    importTab === "inbox" ? "bg-white/20 text-white" : "bg-primary/10 text-primary")}>
                    {inboxSenders.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-colors",
                  importTab === "export" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
              >
                <Upload className="w-3.5 h-3.5" />
                {fileParseLoading ? "Lendo…" : "Conversa exportada"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = "";
                }}
              />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 min-h-0">

              {/* Category selector */}
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground shrink-0">Categoria:</p>
                <div className="flex gap-1.5 overflow-x-auto">
                  {CONTACT_CATS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCatForImport(c.id)}
                      className={cn("shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium",
                        catForImport === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground border border-border")}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Candidates list */}
              {importTab === "inbox" && inboxLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />)}</div>
              ) : activeCandidates.length === 0 ? (
                <div className="py-10 text-center">
                  {importTab === "inbox" ? (
                    <>
                      <Inbox className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Nenhum remetente novo no histórico</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Todos os remetentes do WhatsApp já são contatos.</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Selecione um arquivo exportado</p>
                      <p className="text-xs text-muted-foreground/60 mt-1 px-4">
                        No WhatsApp, abra uma conversa → ⋮ → Mais → Exportar conversa → sem mídia → selecione o .txt
                      </p>
                      <button
                        onClick={() => fileRef.current?.click()}
                        className="mt-3 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium"
                      >
                        Escolher arquivo
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {/* Select all */}
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{activeCandidates.length} remetente{activeCandidates.length !== 1 ? "s" : ""} encontrado{activeCandidates.length !== 1 ? "s" : ""}</p>
                    <button
                      onClick={() => toggleAll(activeCandidates)}
                      className="text-xs text-primary font-medium"
                    >
                      {activeCandidates.every((c) => selected.has(c.name)) ? "Desmarcar todos" : "Selecionar todos"}
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {activeCandidates.map((c) => (
                      <button
                        key={c.name}
                        onClick={() => toggleSelect(c.name)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left",
                          selected.has(c.name)
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card"
                        )}
                      >
                        <div className={cn(
                          "w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                          selected.has(c.name) ? "bg-primary border-primary" : "border-border"
                        )}>
                          {selected.has(c.name) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                          {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            {selected.size > 0 && (
              <div className="px-5 py-4 border-t border-border">
                <button
                  onClick={importSelected}
                  disabled={importSaving}
                  className="w-full py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
                >
                  {importSaving
                    ? "Importando…"
                    : `Adicionar ${selected.size} contato${selected.size !== 1 ? "s" : ""}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
