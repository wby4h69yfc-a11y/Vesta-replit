# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: group-gates.spec.ts >> WhatsApp group gates >> group_mutation_blocked: reply goes to group JID and body signals correct outcome
- Location: src/e2e/group-gates.spec.ts:204:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "@g.us"
Received string:    "whatsapp:+55992853067001"
```

# Test source

```ts
  132 | ): Promise<{ status: number }> {
  133 |   const res = await request.post(`${BASE}/api/webhook/whatsapp`, {
  134 |     form: {
  135 |       From: `whatsapp:${params.from}`,
  136 |       To: params.to,
  137 |       Body: params.body,
  138 |       NumMedia: "0",
  139 |       MessageSid: params.messageSid,
  140 |     },
  141 |   });
  142 |   // ACK is immediate; wait for the async processing path to settle.
  143 |   await new Promise((r) => setTimeout(r, 500));
  144 |   return { status: res.status() };
  145 | }
  146 | 
  147 | // ── Unique identifiers ─────────────────────────────────────────────────────────
  148 | 
  149 | let counter = 0;
  150 | 
  151 | function uniquePhone(): string {
  152 |   counter += 1;
  153 |   const suffix = String(Date.now()).slice(-7) + String(counter).padStart(3, "0");
  154 |   return `+5599${suffix}`;
  155 | }
  156 | 
  157 | function uniqueGroupJid(): string {
  158 |   const digits = String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  159 |   return `whatsapp:+${digits}@g.us`;
  160 | }
  161 | 
  162 | function uniqueTwilioNumber(): string {
  163 |   const digits = String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  164 |   return `whatsapp:+1${digits}`;
  165 | }
  166 | 
  167 | function uniqueSid(label: string): string {
  168 |   return `SM_grp_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  169 | }
  170 | 
  171 | // ── Expected reply bodies from wa-reply-composer.ts ───────────────────────────
  172 | // These snippets are stable anchors extracted from the composer functions:
  173 | //   replyGroupMutationBlocked() → starts with "⚠️ Comandos de alteração precisam ser enviados"
  174 | //   replyGroupNonAdmin()        → "🔒 Só admins da Vesta podem usar esse comando."
  175 | 
  176 | const MUTATION_BLOCKED_BODY_PREFIX = "⚠️ Comandos de alteração";
  177 | const NON_ADMIN_BODY = "🔒 Só admins da Vesta podem usar esse comando.";
  178 | 
  179 | // ═══════════════════════════════════════════════════════════════════════════════
  180 | // Test suite
  181 | // ═══════════════════════════════════════════════════════════════════════════════
  182 | 
  183 | test.describe("WhatsApp group gates", () => {
  184 |   let db: Client;
  185 | 
  186 |   test.beforeAll(async () => {
  187 |     db = await dbClient();
  188 |   });
  189 | 
  190 |   test.afterAll(async () => {
  191 |     await db.end();
  192 |   });
  193 | 
  194 |   // ── 1. group_mutation_blocked: reply body and destination ─────────────────────
  195 |   //
  196 |   // Admin sends a mutation command (/vesta cancela…) in a group.
  197 |   // Assertions:
  198 |   //   a) Webhook returns 200
  199 |   //   b) No inbox item created (gate fires before ingestion)
  200 |   //   c) sendWhatsApp was called exactly once
  201 |   //   d) Reply `to` is the group JID (contains "@g.us"), NOT the sender's phone
  202 |   //   e) Reply body starts with MUTATION_BLOCKED_BODY_PREFIX — proves outcome kind
  203 | 
  204 |   test("group_mutation_blocked: reply goes to group JID and body signals correct outcome", async ({ request }) => {
  205 |     const adminPhone = uniquePhone();
  206 |     const groupJid = uniqueGroupJid();
  207 |     const hhId = await seedHousehold(db, "mutation-blocked-dest");
  208 |     await seedMember(db, hhId, adminPhone, "admin");
  209 | 
  210 |     // Drain any prior telemetry so this test starts clean.
  211 |     await drainWaSends(request);
  212 | 
  213 |     const countBefore = await countInboxItems(db, hhId);
  214 |     const { status } = await sendWebhook(request, {
  215 |       from: adminPhone,
  216 |       to: groupJid,
  217 |       body: "/vesta cancela aquela reunião de quinta",
  218 |       messageSid: uniqueSid("mutation-blocked-dest"),
  219 |     });
  220 | 
  221 |     expect(status).toBe(200);
  222 | 
  223 |     // ── (b) No ingestion ──────────────────────────────────────────────────────
  224 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  225 | 
  226 |     // ── (c-e) Reply destination and body ─────────────────────────────────────
  227 |     const sends = await drainWaSends(request);
  228 |     // Exactly one sendWhatsApp call for this outcome.
  229 |     expect(sends).toHaveLength(1);
  230 |     const send = sends[0]!;
  231 |     // (d) Must go to the group JID, not the sender's DM.
> 232 |     expect(send.to).toContain("@g.us");
      |                     ^ Error: expect(received).toContain(expected) // indexOf
  233 |     expect(send.to).toBe(groupJid); // exact match
  234 |     // Verify the sender's phone was NOT used as destination.
  235 |     expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
  236 |     // (e) Body confirms group_mutation_blocked outcome, not some other path.
  237 |     expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  238 |   });
  239 | 
  240 |   // ── 2. group_non_admin: reply body and destination ────────────────────────────
  241 |   //
  242 |   // Non-admin household member sends a /vesta command in a group.
  243 |   // Assertions mirror test 1 but for the group_non_admin outcome.
  244 | 
  245 |   test("group_non_admin: reply goes to group JID and body signals correct outcome", async ({ request }) => {
  246 |     const adminPhone = uniquePhone();
  247 |     const nonAdminPhone = uniquePhone();
  248 |     const groupJid = uniqueGroupJid();
  249 |     const hhId = await seedHousehold(db, "non-admin-dest");
  250 |     await seedMember(db, hhId, adminPhone, "admin");
  251 |     await seedMember(db, hhId, nonAdminPhone, "member");
  252 | 
  253 |     await drainWaSends(request);
  254 | 
  255 |     const countBefore = await countInboxItems(db, hhId);
  256 |     const { status } = await sendWebhook(request, {
  257 |       from: nonAdminPhone,
  258 |       to: groupJid,
  259 |       body: "/vesta o que tenho hoje",
  260 |       messageSid: uniqueSid("non-admin-dest"),
  261 |     });
  262 | 
  263 |     expect(status).toBe(200);
  264 | 
  265 |     // ── No ingestion ──────────────────────────────────────────────────────────
  266 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  267 | 
  268 |     // ── Reply destination and body ────────────────────────────────────────────
  269 |     const sends = await drainWaSends(request);
  270 |     expect(sends).toHaveLength(1);
  271 |     const send = sends[0]!;
  272 |     // Must go to the group JID, not the non-admin's DM.
  273 |     expect(send.to).toContain("@g.us");
  274 |     expect(send.to).toBe(groupJid);
  275 |     expect(send.to).not.toContain(nonAdminPhone.replace(/\D/g, ""));
  276 |     // Body confirms group_non_admin outcome, not some other early-return path.
  277 |     expect(send.body).toBe(NON_ADMIN_BODY);
  278 |   });
  279 | 
  280 |   // ── 3. group_non_admin fires first even when body is a mutation command ────────
  281 |   //
  282 |   // The non-admin check runs before the mutation gate in the processor.
  283 |   // A non-admin sending a mutation command produces group_non_admin, not
  284 |   // group_mutation_blocked.  The reply body must match NON_ADMIN_BODY.
  285 | 
  286 |   test("group_non_admin body sent even when non-admin uses mutation verb", async ({ request }) => {
  287 |     const adminPhone = uniquePhone();
  288 |     const nonAdminPhone = uniquePhone();
  289 |     const groupJid = uniqueGroupJid();
  290 |     const hhId = await seedHousehold(db, "non-admin-mutation-prio");
  291 |     await seedMember(db, hhId, adminPhone, "admin");
  292 |     await seedMember(db, hhId, nonAdminPhone, "member");
  293 | 
  294 |     await drainWaSends(request);
  295 | 
  296 |     await sendWebhook(request, {
  297 |       from: nonAdminPhone,
  298 |       to: groupJid,
  299 |       body: "/vesta cria uma tarefa nova",
  300 |       messageSid: uniqueSid("non-admin-mutation-prio"),
  301 |     });
  302 | 
  303 |     const sends = await drainWaSends(request);
  304 |     expect(sends).toHaveLength(1);
  305 |     const send = sends[0]!;
  306 |     expect(send.to).toContain("@g.us");
  307 |     // Should be non-admin reply, not mutation-blocked reply.
  308 |     expect(send.body).toBe(NON_ADMIN_BODY);
  309 |     expect(send.body).not.toContain(MUTATION_BLOCKED_BODY_PREFIX);
  310 |   });
  311 | 
  312 |   // ── 4. Group message without /vesta trigger is silently ignored ───────────────
  313 |   //
  314 |   // A group message that does NOT start with /vesta is discarded before reaching
  315 |   // the processor.  No sendWhatsApp call and no inbox item must result.
  316 | 
  317 |   test("group message without /vesta trigger: no reply sent and no inbox item created", async ({ request }) => {
  318 |     const adminPhone = uniquePhone();
  319 |     const groupJid = uniqueGroupJid();
  320 |     const hhId = await seedHousehold(db, "no-trigger-silent");
  321 |     await seedMember(db, hhId, adminPhone, "admin");
  322 | 
  323 |     await drainWaSends(request);
  324 |     const countBefore = await countInboxItems(db, hhId);
  325 | 
  326 |     await sendWebhook(request, {
  327 |       from: adminPhone,
  328 |       to: groupJid,
  329 |       body: "alguém sabe o horário do treino?",
  330 |       messageSid: uniqueSid("no-trigger"),
  331 |     });
  332 | 
```