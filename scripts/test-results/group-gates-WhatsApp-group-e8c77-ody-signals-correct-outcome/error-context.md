# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: group-gates.spec.ts >> WhatsApp group gates >> group_mutation_blocked: reply goes to group JID and body signals correct outcome
- Location: src/e2e/group-gates.spec.ts:202:3

# Error details

```
Error: expect(received).toHaveLength(expected)

Expected length: 1
Received length: 0
Received array:  []
```

# Test source

```ts
  127 |     body: string;
  128 |     messageSid: string;
  129 |   },
  130 | ): Promise<{ status: number }> {
  131 |   const res = await request.post(`${BASE}/api/webhook/whatsapp`, {
  132 |     form: {
  133 |       From: `whatsapp:${params.from}`,
  134 |       To: params.to,
  135 |       Body: params.body,
  136 |       NumMedia: "0",
  137 |       MessageSid: params.messageSid,
  138 |     },
  139 |   });
  140 |   // ACK is immediate; wait for the async processing path to settle.
  141 |   await new Promise((r) => setTimeout(r, 500));
  142 |   return { status: res.status() };
  143 | }
  144 | 
  145 | // ── Unique identifiers ─────────────────────────────────────────────────────────
  146 | 
  147 | let counter = 0;
  148 | 
  149 | function uniquePhone(): string {
  150 |   counter += 1;
  151 |   const suffix = String(Date.now()).slice(-7) + String(counter).padStart(3, "0");
  152 |   return `+5599${suffix}`;
  153 | }
  154 | 
  155 | function uniqueGroupJid(): string {
  156 |   const digits = String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  157 |   return `whatsapp:+${digits}@g.us`;
  158 | }
  159 | 
  160 | function uniqueTwilioNumber(): string {
  161 |   const digits = String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  162 |   return `whatsapp:+1${digits}`;
  163 | }
  164 | 
  165 | function uniqueSid(label: string): string {
  166 |   return `SM_grp_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  167 | }
  168 | 
  169 | // ── Expected reply bodies from wa-reply-composer.ts ───────────────────────────
  170 | // These snippets are stable anchors extracted from the composer functions:
  171 | //   replyGroupMutationBlocked() → starts with "⚠️ Comandos de alteração precisam ser enviados"
  172 | //   replyGroupNonAdmin()        → "🔒 Só admins da Vesta podem usar esse comando."
  173 | 
  174 | const MUTATION_BLOCKED_BODY_PREFIX = "⚠️ Comandos de alteração";
  175 | const NON_ADMIN_BODY = "🔒 Só admins da Vesta podem usar esse comando.";
  176 | 
  177 | // ═══════════════════════════════════════════════════════════════════════════════
  178 | // Test suite
  179 | // ═══════════════════════════════════════════════════════════════════════════════
  180 | 
  181 | test.describe("WhatsApp group gates", () => {
  182 |   let db: Client;
  183 | 
  184 |   test.beforeAll(async () => {
  185 |     db = await dbClient();
  186 |   });
  187 | 
  188 |   test.afterAll(async () => {
  189 |     await db.end();
  190 |   });
  191 | 
  192 |   // ── 1. group_mutation_blocked: reply body and destination ─────────────────────
  193 |   //
  194 |   // Admin sends a mutation command (/vesta cancela…) in a group.
  195 |   // Assertions:
  196 |   //   a) Webhook returns 200
  197 |   //   b) No inbox item created (gate fires before ingestion)
  198 |   //   c) sendWhatsApp was called exactly once
  199 |   //   d) Reply `to` is the group JID (contains "@g.us"), NOT the sender's phone
  200 |   //   e) Reply body starts with MUTATION_BLOCKED_BODY_PREFIX — proves outcome kind
  201 | 
  202 |   test("group_mutation_blocked: reply goes to group JID and body signals correct outcome", async ({ request }) => {
  203 |     const adminPhone = uniquePhone();
  204 |     const groupJid = uniqueGroupJid();
  205 |     const hhId = await seedHousehold(db, "mutation-blocked-dest");
  206 |     await seedMember(db, hhId, adminPhone, "admin");
  207 | 
  208 |     // Drain any prior telemetry so this test starts clean.
  209 |     await drainWaSends(request);
  210 | 
  211 |     const countBefore = await countInboxItems(db, hhId);
  212 |     const { status } = await sendWebhook(request, {
  213 |       from: adminPhone,
  214 |       to: groupJid,
  215 |       body: "/vesta cancela aquela reunião de quinta",
  216 |       messageSid: uniqueSid("mutation-blocked-dest"),
  217 |     });
  218 | 
  219 |     expect(status).toBe(200);
  220 | 
  221 |     // ── (b) No ingestion ──────────────────────────────────────────────────────
  222 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  223 | 
  224 |     // ── (c-e) Reply destination and body ─────────────────────────────────────
  225 |     const sends = await drainWaSends(request);
  226 |     // Exactly one sendWhatsApp call for this outcome.
> 227 |     expect(sends).toHaveLength(1);
      |                   ^ Error: expect(received).toHaveLength(expected)
  228 |     const send = sends[0]!;
  229 |     // (d) Must go to the group JID, not the sender's DM.
  230 |     expect(send.to).toContain("@g.us");
  231 |     expect(send.to).toBe(groupJid); // exact match
  232 |     // Verify the sender's phone was NOT used as destination.
  233 |     expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
  234 |     // (e) Body confirms group_mutation_blocked outcome, not some other path.
  235 |     expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  236 |   });
  237 | 
  238 |   // ── 2. group_non_admin: reply body and destination ────────────────────────────
  239 |   //
  240 |   // Non-admin household member sends a /vesta command in a group.
  241 |   // Assertions mirror test 1 but for the group_non_admin outcome.
  242 | 
  243 |   test("group_non_admin: reply goes to group JID and body signals correct outcome", async ({ request }) => {
  244 |     const adminPhone = uniquePhone();
  245 |     const nonAdminPhone = uniquePhone();
  246 |     const groupJid = uniqueGroupJid();
  247 |     const hhId = await seedHousehold(db, "non-admin-dest");
  248 |     await seedMember(db, hhId, adminPhone, "admin");
  249 |     await seedMember(db, hhId, nonAdminPhone, "member");
  250 | 
  251 |     await drainWaSends(request);
  252 | 
  253 |     const countBefore = await countInboxItems(db, hhId);
  254 |     const { status } = await sendWebhook(request, {
  255 |       from: nonAdminPhone,
  256 |       to: groupJid,
  257 |       body: "/vesta o que tenho hoje",
  258 |       messageSid: uniqueSid("non-admin-dest"),
  259 |     });
  260 | 
  261 |     expect(status).toBe(200);
  262 | 
  263 |     // ── No ingestion ──────────────────────────────────────────────────────────
  264 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  265 | 
  266 |     // ── Reply destination and body ────────────────────────────────────────────
  267 |     const sends = await drainWaSends(request);
  268 |     expect(sends).toHaveLength(1);
  269 |     const send = sends[0]!;
  270 |     // Must go to the group JID, not the non-admin's DM.
  271 |     expect(send.to).toContain("@g.us");
  272 |     expect(send.to).toBe(groupJid);
  273 |     expect(send.to).not.toContain(nonAdminPhone.replace(/\D/g, ""));
  274 |     // Body confirms group_non_admin outcome, not some other early-return path.
  275 |     expect(send.body).toBe(NON_ADMIN_BODY);
  276 |   });
  277 | 
  278 |   // ── 3. group_non_admin fires first even when body is a mutation command ────────
  279 |   //
  280 |   // The non-admin check runs before the mutation gate in the processor.
  281 |   // A non-admin sending a mutation command produces group_non_admin, not
  282 |   // group_mutation_blocked.  The reply body must match NON_ADMIN_BODY.
  283 | 
  284 |   test("group_non_admin body sent even when non-admin uses mutation verb", async ({ request }) => {
  285 |     const adminPhone = uniquePhone();
  286 |     const nonAdminPhone = uniquePhone();
  287 |     const groupJid = uniqueGroupJid();
  288 |     const hhId = await seedHousehold(db, "non-admin-mutation-prio");
  289 |     await seedMember(db, hhId, adminPhone, "admin");
  290 |     await seedMember(db, hhId, nonAdminPhone, "member");
  291 | 
  292 |     await drainWaSends(request);
  293 | 
  294 |     await sendWebhook(request, {
  295 |       from: nonAdminPhone,
  296 |       to: groupJid,
  297 |       body: "/vesta cria uma tarefa nova",
  298 |       messageSid: uniqueSid("non-admin-mutation-prio"),
  299 |     });
  300 | 
  301 |     const sends = await drainWaSends(request);
  302 |     expect(sends).toHaveLength(1);
  303 |     const send = sends[0]!;
  304 |     expect(send.to).toContain("@g.us");
  305 |     // Should be non-admin reply, not mutation-blocked reply.
  306 |     expect(send.body).toBe(NON_ADMIN_BODY);
  307 |     expect(send.body).not.toContain(MUTATION_BLOCKED_BODY_PREFIX);
  308 |   });
  309 | 
  310 |   // ── 4. Group message without /vesta trigger is silently ignored ───────────────
  311 |   //
  312 |   // A group message that does NOT start with /vesta is discarded before reaching
  313 |   // the processor.  No sendWhatsApp call and no inbox item must result.
  314 | 
  315 |   test("group message without /vesta trigger: no reply sent and no inbox item created", async ({ request }) => {
  316 |     const adminPhone = uniquePhone();
  317 |     const groupJid = uniqueGroupJid();
  318 |     const hhId = await seedHousehold(db, "no-trigger-silent");
  319 |     await seedMember(db, hhId, adminPhone, "admin");
  320 | 
  321 |     await drainWaSends(request);
  322 |     const countBefore = await countInboxItems(db, hhId);
  323 | 
  324 |     await sendWebhook(request, {
  325 |       from: adminPhone,
  326 |       to: groupJid,
  327 |       body: "alguém sabe o horário do treino?",
```