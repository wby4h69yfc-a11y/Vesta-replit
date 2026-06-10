# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: group-gates.spec.ts >> WhatsApp group gates >> group Tier-0 PAUSAR from non-admin: NON_ADMIN reply sent to group JID
- Location: src/e2e/group-gates.spec.ts:426:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "@g.us"
Received string:    "whatsapp:+55992528493002"
```

# Test source

```ts
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
  403 |     const { status } = await sendWebhook(request, {
  404 |       from: adminPhone,
  405 |       to: twilioNumber, // DM: `To` is the Twilio number, not a group JID
  406 |       // Non-mutation, non-question household statement — not intercepted by any
  407 |       // early-return gate before step 6 (inbox item creation).
  408 |       body: "Reunião de pais no colégio confirmada para quinta-feira às 19h.",
  409 |       messageSid: uniqueSid("contrast-dm"),
  410 |     });
  411 | 
  412 |     expect(status).toBe(200);
  413 | 
  414 |     // The DM path must create an inbox item — neither group gate fired.
  415 |     const countAfter = await countInboxItems(db, hhId);
  416 |     expect(countAfter).toBeGreaterThan(countBefore);
  417 |   });
  418 | 
  419 |   // ── 13. Tier-0 PAUSAR from non-admin: group_non_admin reply, no inbox item ────
  420 |   //
  421 |   // PAUSAR is a Tier-0 command handled in webhook.ts before processInboundWAMessage.
  422 |   // The webhook applies its own admin gate for group messages so a non-admin
  423 |   // cannot pause proactive messages.  The gate must emit NON_ADMIN_BODY into the
  424 |   // group thread.
  425 | 
  426 |   test("group Tier-0 PAUSAR from non-admin: NON_ADMIN reply sent to group JID", async ({ request }) => {
  427 |     const adminPhone = uniquePhone();
  428 |     const nonAdminPhone = uniquePhone();
  429 |     const groupJid = uniqueGroupJid();
  430 |     const hhId = await seedHousehold(db, "tier0-pausar-non-admin");
  431 |     await seedMember(db, hhId, adminPhone, "admin");
  432 |     await seedMember(db, hhId, nonAdminPhone, "member");
  433 | 
  434 |     await drainWaSends(request);
  435 |     const countBefore = await countInboxItems(db, hhId);
  436 | 
  437 |     const { status } = await sendWebhook(request, {
  438 |       from: nonAdminPhone,
  439 |       to: groupJid,
  440 |       body: "/vesta PAUSAR",
  441 |       messageSid: uniqueSid("tier0-pausar-non-admin"),
  442 |     });
  443 | 
  444 |     expect(status).toBe(200);
  445 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  446 | 
  447 |     const sends = await drainWaSends(request);
  448 |     expect(sends).toHaveLength(1);
> 449 |     expect(sends[0]!.to).toContain("@g.us");
      |                          ^ Error: expect(received).toContain(expected) // indexOf
  450 |     expect(sends[0]!.to).toBe(groupJid);
  451 |     // The Tier-0 DM-only gate in webhook.ts fires before processInboundWAMessage,
  452 |     // so any sender (admin or non-admin) gets replyGroupMutationBlocked().
  453 |     expect(sends[0]!.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  454 |   });
  455 | 
  456 |   // ═══════════════════════════════════════════════════════════════════════════════
  457 |   // Tier-0 DM-only gate: PAUSAR / PARAR / RETOMAR in group chats
  458 |   //
  459 |   // webhook.ts lines 192–208: when a Tier-0 keyword arrives from a group JID the
  460 |   // route calls sendWhatsApp(groupId, replyGroupMutationBlocked()) and returns
  461 |   // immediately, before any household lookup or processInboundWAMessage call.
  462 |   //
  463 |   // Assertions per command (PAUSAR, PARAR, RETOMAR):
  464 |   //   a) Webhook returns 200
  465 |   //   b) Exactly one sendWhatsApp call is made
  466 |   //   c) `to` is the group JID (contains "@g.us"), NOT the sender's phone
  467 |   //   d) Body contains MUTATION_BLOCKED_BODY_PREFIX
  468 |   //   e) No inbox item is created (early return before ingestion)
  469 |   //
  470 |   // Contrast (test 17): the same keywords sent as a DM (no @g.us in To) do NOT
  471 |   // trigger the group-block reply — the DM path handles them normally.
  472 |   // ═══════════════════════════════════════════════════════════════════════════════
  473 | 
  474 |   // ── 14. Tier-0 PAUSAR in group: replyGroupMutationBlocked sent to group JID ───
  475 | 
  476 |   test("Tier-0 PAUSAR in group: replyGroupMutationBlocked sent to group JID, no inbox item", async ({ request }) => {
  477 |     const adminPhone = uniquePhone();
  478 |     const groupJid = uniqueGroupJid();
  479 |     const hhId = await seedHousehold(db, "tier0-grp-pausar");
  480 |     await seedMember(db, hhId, adminPhone, "admin");
  481 | 
  482 |     await drainWaSends(request);
  483 |     const countBefore = await countInboxItems(db, hhId);
  484 | 
  485 |     // Group messages need the /vesta prefix; the webhook strips it before the
  486 |     // Tier-0 check so effectiveBody becomes "PAUSAR".
  487 |     const { status } = await sendWebhook(request, {
  488 |       from: adminPhone,
  489 |       to: groupJid,
  490 |       body: "/vesta PAUSAR",
  491 |       messageSid: uniqueSid("tier0-grp-pausar"),
  492 |     });
  493 | 
  494 |     expect(status).toBe(200);
  495 | 
  496 |     // No inbox item — the gate returns before ingestion.
  497 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  498 | 
  499 |     const sends = await drainWaSends(request);
  500 |     // Exactly one reply.
  501 |     expect(sends).toHaveLength(1);
  502 |     const send = sends[0]!;
  503 |     // (c) Must go to the group JID, not the sender's DM.
  504 |     expect(send.to).toContain("@g.us");
  505 |     expect(send.to).toBe(groupJid);
  506 |     expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
  507 |     // (d) Body identifies the group-mutation-blocked outcome.
  508 |     expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  509 |   });
  510 | 
  511 |   // ── 15. Tier-0 PARAR in group: replyGroupMutationBlocked sent to group JID ────
  512 | 
  513 |   test("Tier-0 PARAR in group: replyGroupMutationBlocked sent to group JID, no inbox item", async ({ request }) => {
  514 |     const adminPhone = uniquePhone();
  515 |     const groupJid = uniqueGroupJid();
  516 |     const hhId = await seedHousehold(db, "tier0-grp-parar");
  517 |     await seedMember(db, hhId, adminPhone, "admin");
  518 | 
  519 |     await drainWaSends(request);
  520 |     const countBefore = await countInboxItems(db, hhId);
  521 | 
  522 |     const { status } = await sendWebhook(request, {
  523 |       from: adminPhone,
  524 |       to: groupJid,
  525 |       body: "/vesta PARAR",
  526 |       messageSid: uniqueSid("tier0-grp-parar"),
  527 |     });
  528 | 
  529 |     expect(status).toBe(200);
  530 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  531 | 
  532 |     const sends = await drainWaSends(request);
  533 |     expect(sends).toHaveLength(1);
  534 |     const send = sends[0]!;
  535 |     expect(send.to).toContain("@g.us");
  536 |     expect(send.to).toBe(groupJid);
  537 |     expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
  538 |     expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  539 |   });
  540 | 
  541 |   // ── 16. Tier-0 RETOMAR in group: replyGroupMutationBlocked sent to group JID ──
  542 | 
  543 |   test("Tier-0 RETOMAR in group: replyGroupMutationBlocked sent to group JID, no inbox item", async ({ request }) => {
  544 |     const adminPhone = uniquePhone();
  545 |     const groupJid = uniqueGroupJid();
  546 |     const hhId = await seedHousehold(db, "tier0-grp-retomar");
  547 |     await seedMember(db, hhId, adminPhone, "admin");
  548 | 
  549 |     await drainWaSends(request);
```