# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: group-gates.spec.ts >> WhatsApp group gates >> contrast: admin DM with household message creates inbox item (group gates are group-specific)
- Location: src/e2e/group-gates.spec.ts:396:3

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
```

# Test source

```ts
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
  333 |     const sends = await drainWaSends(request);
  334 |     expect(sends).toHaveLength(0); // silent ignore — no reply at all
  335 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  336 |   });
  337 | 
  338 |   // ── 5–11. group_mutation_blocked across mutation verb families ────────────────
  339 |   //
  340 |   // MUTATION_IMPERATIVE_RE and MUTATION_MODAL_RE in wa-qa-handler.ts cover
  341 |   // several Portuguese verb families.  Each case must produce the blocked body,
  342 |   // addressed to the group JID, with no inbox item.
  343 | 
  344 |   const mutationCases: Array<[string, string]> = [
  345 |     ["/vesta cancela o evento", "cancela"],
  346 |     ["/vesta apaga aquela tarefa", "apaga"],
  347 |     ["/vesta cria uma tarefa nova", "cria"],
  348 |     ["/vesta adiciona evento na sexta", "adiciona"],
  349 |     ["/vesta muda o horário da reunião", "muda"],
  350 |     ["/vesta pode cancelar aquele evento?", "pode-cancelar-modal"],
  351 |     ["/vesta dá pra criar uma tarefa?", "da-pra-criar-modal"],
  352 |   ];
  353 | 
  354 |   for (const [body, label] of mutationCases) {
  355 |     test(`group_mutation_blocked: "${label}" verb — reply to group JID with blocked body`, async ({ request }) => {
  356 |       const adminPhone = uniquePhone();
  357 |       const groupJid = uniqueGroupJid();
  358 |       const hhId = await seedHousehold(db, `verb-${label}`);
  359 |       await seedMember(db, hhId, adminPhone, "admin");
  360 | 
  361 |       await drainWaSends(request);
  362 |       const countBefore = await countInboxItems(db, hhId);
  363 | 
  364 |       const { status } = await sendWebhook(request, {
  365 |         from: adminPhone,
  366 |         to: groupJid,
  367 |         body,
  368 |         messageSid: uniqueSid(`verb-${label}`),
  369 |       });
  370 | 
  371 |       expect(status).toBe(200);
  372 |       expect(await countInboxItems(db, hhId)).toBe(countBefore);
  373 | 
  374 |       const sends = await drainWaSends(request);
  375 |       expect(sends).toHaveLength(1);
  376 |       expect(sends[0]!.to).toContain("@g.us");
  377 |       expect(sends[0]!.to).toBe(groupJid);
  378 |       expect(sends[0]!.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  379 |     });
  380 |   }
  381 | 
  382 |   // ── 12. Contrast: normal message via DM creates an inbox item ────────────────
  383 |   //
  384 |   // When a non-mutation, non-question message arrives in a DIRECT MESSAGE (To
  385 |   // field has no "@g.us"), payload.groupId is null and NEITHER group gate fires.
  386 |   // The message reaches step 6 of wa-message-processor.ts (inbox item creation)
  387 |   // so inbox_items count MUST increase by 1.  This proves the group gates are
  388 |   // group-context specific — they check payload.groupId, not the message body.
  389 |   //
  390 |   // A plain household statement like a school notification is chosen because:
  391 |   //   - it is NOT a mutation command → Q&A handler step 0 guard doesn't intercept
  392 |   //   - it is NOT a question → Q&A handler keyword/LLM path returns undefined
  393 |   //   - it falls through to step 6 where the inbox item is created (before
  394 |   //     classifyAndSaveAction, so the assertion holds even if OpenAI is absent)
  395 | 
  396 |   test("contrast: admin DM with household message creates inbox item (group gates are group-specific)", async ({ request }) => {
  397 |     const adminPhone = uniquePhone();
  398 |     const twilioNumber = uniqueTwilioNumber(); // plain number, no "@g.us"
  399 |     const hhId = await seedHousehold(db, "contrast-dm");
  400 |     await seedMember(db, hhId, adminPhone, "admin");
  401 | 
  402 |     await drainWaSends(request);
  403 |     const countBefore = await countInboxItems(db, hhId);
  404 | 
  405 |     const { status } = await sendWebhook(request, {
  406 |       from: adminPhone,
  407 |       to: twilioNumber, // DM: `To` is the Twilio number, not a group JID
  408 |       // Non-mutation, non-question household statement — not intercepted by any
  409 |       // early-return gate before step 6 (inbox item creation).
  410 |       body: "Reunião de pais no colégio confirmada para quinta-feira às 19h.",
  411 |       messageSid: uniqueSid("contrast-dm"),
  412 |     });
  413 | 
  414 |     expect(status).toBe(200);
  415 | 
  416 |     // The DM path must create an inbox item — neither group gate fired.
  417 |     const countAfter = await countInboxItems(db, hhId);
> 418 |     expect(countAfter).toBeGreaterThan(countBefore);
      |                        ^ Error: expect(received).toBeGreaterThan(expected)
  419 |   });
  420 | 
  421 |   // ── 13. Tier-0 PAUSAR from non-admin: group_non_admin reply, no inbox item ────
  422 |   //
  423 |   // PAUSAR is a Tier-0 command handled in webhook.ts before processInboundWAMessage.
  424 |   // The webhook applies its own admin gate for group messages so a non-admin
  425 |   // cannot pause proactive messages.  The gate must emit NON_ADMIN_BODY into the
  426 |   // group thread.
  427 | 
  428 |   test("group Tier-0 PAUSAR from non-admin: NON_ADMIN reply sent to group JID", async ({ request }) => {
  429 |     const adminPhone = uniquePhone();
  430 |     const nonAdminPhone = uniquePhone();
  431 |     const groupJid = uniqueGroupJid();
  432 |     const hhId = await seedHousehold(db, "tier0-pausar-non-admin");
  433 |     await seedMember(db, hhId, adminPhone, "admin");
  434 |     await seedMember(db, hhId, nonAdminPhone, "member");
  435 | 
  436 |     await drainWaSends(request);
  437 |     const countBefore = await countInboxItems(db, hhId);
  438 | 
  439 |     const { status } = await sendWebhook(request, {
  440 |       from: nonAdminPhone,
  441 |       to: groupJid,
  442 |       body: "/vesta PAUSAR",
  443 |       messageSid: uniqueSid("tier0-pausar-non-admin"),
  444 |     });
  445 | 
  446 |     expect(status).toBe(200);
  447 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  448 | 
  449 |     const sends = await drainWaSends(request);
  450 |     expect(sends).toHaveLength(1);
  451 |     expect(sends[0]!.to).toContain("@g.us");
  452 |     expect(sends[0]!.to).toBe(groupJid);
  453 |     // The Tier-0 DM-only gate in webhook.ts fires before processInboundWAMessage,
  454 |     // so any sender (admin or non-admin) gets replyGroupMutationBlocked().
  455 |     expect(sends[0]!.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  456 |   });
  457 | 
  458 |   // ═══════════════════════════════════════════════════════════════════════════════
  459 |   // Tier-0 DM-only gate: PAUSAR / PARAR / RETOMAR in group chats
  460 |   //
  461 |   // webhook.ts lines 192–208: when a Tier-0 keyword arrives from a group JID the
  462 |   // route calls sendWhatsApp(groupId, replyGroupMutationBlocked()) and returns
  463 |   // immediately, before any household lookup or processInboundWAMessage call.
  464 |   //
  465 |   // Assertions per command (PAUSAR, PARAR, RETOMAR):
  466 |   //   a) Webhook returns 200
  467 |   //   b) Exactly one sendWhatsApp call is made
  468 |   //   c) `to` is the group JID (contains "@g.us"), NOT the sender's phone
  469 |   //   d) Body contains MUTATION_BLOCKED_BODY_PREFIX
  470 |   //   e) No inbox item is created (early return before ingestion)
  471 |   //
  472 |   // Contrast (test 17): the same keywords sent as a DM (no @g.us in To) do NOT
  473 |   // trigger the group-block reply — the DM path handles them normally.
  474 |   // ═══════════════════════════════════════════════════════════════════════════════
  475 | 
  476 |   // ── 14. Tier-0 PAUSAR in group: replyGroupMutationBlocked sent to group JID ───
  477 | 
  478 |   test("Tier-0 PAUSAR in group: replyGroupMutationBlocked sent to group JID, no inbox item", async ({ request }) => {
  479 |     const adminPhone = uniquePhone();
  480 |     const groupJid = uniqueGroupJid();
  481 |     const hhId = await seedHousehold(db, "tier0-grp-pausar");
  482 |     await seedMember(db, hhId, adminPhone, "admin");
  483 | 
  484 |     await drainWaSends(request);
  485 |     const countBefore = await countInboxItems(db, hhId);
  486 | 
  487 |     // Group messages need the /vesta prefix; the webhook strips it before the
  488 |     // Tier-0 check so effectiveBody becomes "PAUSAR".
  489 |     const { status } = await sendWebhook(request, {
  490 |       from: adminPhone,
  491 |       to: groupJid,
  492 |       body: "/vesta PAUSAR",
  493 |       messageSid: uniqueSid("tier0-grp-pausar"),
  494 |     });
  495 | 
  496 |     expect(status).toBe(200);
  497 | 
  498 |     // No inbox item — the gate returns before ingestion.
  499 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  500 | 
  501 |     const sends = await drainWaSends(request);
  502 |     // Exactly one reply.
  503 |     expect(sends).toHaveLength(1);
  504 |     const send = sends[0]!;
  505 |     // (c) Must go to the group JID, not the sender's DM.
  506 |     expect(send.to).toContain("@g.us");
  507 |     expect(send.to).toBe(groupJid);
  508 |     expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
  509 |     // (d) Body identifies the group-mutation-blocked outcome.
  510 |     expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  511 |   });
  512 | 
  513 |   // ── 15. Tier-0 PARAR in group: replyGroupMutationBlocked sent to group JID ────
  514 | 
  515 |   test("Tier-0 PARAR in group: replyGroupMutationBlocked sent to group JID, no inbox item", async ({ request }) => {
  516 |     const adminPhone = uniquePhone();
  517 |     const groupJid = uniqueGroupJid();
  518 |     const hhId = await seedHousehold(db, "tier0-grp-parar");
```