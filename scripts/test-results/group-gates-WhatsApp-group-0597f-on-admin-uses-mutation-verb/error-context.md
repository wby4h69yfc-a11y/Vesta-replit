# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: group-gates.spec.ts >> WhatsApp group gates >> group_non_admin body sent even when non-admin uses mutation verb
- Location: src/e2e/group-gates.spec.ts:284:3

# Error details

```
Error: expect(received).toHaveLength(expected)

Expected length: 1
Received length: 0
Received array:  []
```

# Test source

```ts
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
  227 |     expect(sends).toHaveLength(1);
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
> 302 |     expect(sends).toHaveLength(1);
      |                   ^ Error: expect(received).toHaveLength(expected)
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
  328 |       messageSid: uniqueSid("no-trigger"),
  329 |     });
  330 | 
  331 |     const sends = await drainWaSends(request);
  332 |     expect(sends).toHaveLength(0); // silent ignore — no reply at all
  333 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  334 |   });
  335 | 
  336 |   // ── 5–11. group_mutation_blocked across mutation verb families ────────────────
  337 |   //
  338 |   // MUTATION_IMPERATIVE_RE and MUTATION_MODAL_RE in wa-qa-handler.ts cover
  339 |   // several Portuguese verb families.  Each case must produce the blocked body,
  340 |   // addressed to the group JID, with no inbox item.
  341 | 
  342 |   const mutationCases: Array<[string, string]> = [
  343 |     ["/vesta cancela o evento", "cancela"],
  344 |     ["/vesta apaga aquela tarefa", "apaga"],
  345 |     ["/vesta cria uma tarefa nova", "cria"],
  346 |     ["/vesta adiciona evento na sexta", "adiciona"],
  347 |     ["/vesta muda o horário da reunião", "muda"],
  348 |     ["/vesta pode cancelar aquele evento?", "pode-cancelar-modal"],
  349 |     ["/vesta dá pra criar uma tarefa?", "da-pra-criar-modal"],
  350 |   ];
  351 | 
  352 |   for (const [body, label] of mutationCases) {
  353 |     test(`group_mutation_blocked: "${label}" verb — reply to group JID with blocked body`, async ({ request }) => {
  354 |       const adminPhone = uniquePhone();
  355 |       const groupJid = uniqueGroupJid();
  356 |       const hhId = await seedHousehold(db, `verb-${label}`);
  357 |       await seedMember(db, hhId, adminPhone, "admin");
  358 | 
  359 |       await drainWaSends(request);
  360 |       const countBefore = await countInboxItems(db, hhId);
  361 | 
  362 |       const { status } = await sendWebhook(request, {
  363 |         from: adminPhone,
  364 |         to: groupJid,
  365 |         body,
  366 |         messageSid: uniqueSid(`verb-${label}`),
  367 |       });
  368 | 
  369 |       expect(status).toBe(200);
  370 |       expect(await countInboxItems(db, hhId)).toBe(countBefore);
  371 | 
  372 |       const sends = await drainWaSends(request);
  373 |       expect(sends).toHaveLength(1);
  374 |       expect(sends[0]!.to).toContain("@g.us");
  375 |       expect(sends[0]!.to).toBe(groupJid);
  376 |       expect(sends[0]!.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  377 |     });
  378 |   }
  379 | 
  380 |   // ── 12. Contrast: normal message via DM creates an inbox item ────────────────
  381 |   //
  382 |   // When a non-mutation, non-question message arrives in a DIRECT MESSAGE (To
  383 |   // field has no "@g.us"), payload.groupId is null and NEITHER group gate fires.
  384 |   // The message reaches step 6 of wa-message-processor.ts (inbox item creation)
  385 |   // so inbox_items count MUST increase by 1.  This proves the group gates are
  386 |   // group-context specific — they check payload.groupId, not the message body.
  387 |   //
  388 |   // A plain household statement like a school notification is chosen because:
  389 |   //   - it is NOT a mutation command → Q&A handler step 0 guard doesn't intercept
  390 |   //   - it is NOT a question → Q&A handler keyword/LLM path returns undefined
  391 |   //   - it falls through to step 6 where the inbox item is created (before
  392 |   //     classifyAndSaveAction, so the assertion holds even if OpenAI is absent)
  393 | 
  394 |   test("contrast: admin DM with household message creates inbox item (group gates are group-specific)", async ({ request }) => {
  395 |     const adminPhone = uniquePhone();
  396 |     const twilioNumber = uniqueTwilioNumber(); // plain number, no "@g.us"
  397 |     const hhId = await seedHousehold(db, "contrast-dm");
  398 |     await seedMember(db, hhId, adminPhone, "admin");
  399 | 
  400 |     await drainWaSends(request);
  401 |     const countBefore = await countInboxItems(db, hhId);
  402 | 
```