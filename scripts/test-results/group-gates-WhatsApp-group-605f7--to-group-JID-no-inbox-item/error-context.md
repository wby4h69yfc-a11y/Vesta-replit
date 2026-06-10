# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: group-gates.spec.ts >> WhatsApp group gates >> Tier-0 PAUSAR in group: replyGroupMutationBlocked sent to group JID, no inbox item
- Location: src/e2e/group-gates.spec.ts:478:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "@g.us"
Received string:    "whatsapp:+55992876482001"
```

# Test source

```ts
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
  418 |     expect(countAfter).toBeGreaterThan(countBefore);
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
> 506 |     expect(send.to).toContain("@g.us");
      |                     ^ Error: expect(received).toContain(expected) // indexOf
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
  519 |     await seedMember(db, hhId, adminPhone, "admin");
  520 | 
  521 |     await drainWaSends(request);
  522 |     const countBefore = await countInboxItems(db, hhId);
  523 | 
  524 |     const { status } = await sendWebhook(request, {
  525 |       from: adminPhone,
  526 |       to: groupJid,
  527 |       body: "/vesta PARAR",
  528 |       messageSid: uniqueSid("tier0-grp-parar"),
  529 |     });
  530 | 
  531 |     expect(status).toBe(200);
  532 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  533 | 
  534 |     const sends = await drainWaSends(request);
  535 |     expect(sends).toHaveLength(1);
  536 |     const send = sends[0]!;
  537 |     expect(send.to).toContain("@g.us");
  538 |     expect(send.to).toBe(groupJid);
  539 |     expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
  540 |     expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  541 |   });
  542 | 
  543 |   // ── 16. Tier-0 RETOMAR in group: replyGroupMutationBlocked sent to group JID ──
  544 | 
  545 |   test("Tier-0 RETOMAR in group: replyGroupMutationBlocked sent to group JID, no inbox item", async ({ request }) => {
  546 |     const adminPhone = uniquePhone();
  547 |     const groupJid = uniqueGroupJid();
  548 |     const hhId = await seedHousehold(db, "tier0-grp-retomar");
  549 |     await seedMember(db, hhId, adminPhone, "admin");
  550 | 
  551 |     await drainWaSends(request);
  552 |     const countBefore = await countInboxItems(db, hhId);
  553 | 
  554 |     const { status } = await sendWebhook(request, {
  555 |       from: adminPhone,
  556 |       to: groupJid,
  557 |       body: "/vesta RETOMAR",
  558 |       messageSid: uniqueSid("tier0-grp-retomar"),
  559 |     });
  560 | 
  561 |     expect(status).toBe(200);
  562 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  563 | 
  564 |     const sends = await drainWaSends(request);
  565 |     expect(sends).toHaveLength(1);
  566 |     const send = sends[0]!;
  567 |     expect(send.to).toContain("@g.us");
  568 |     expect(send.to).toBe(groupJid);
  569 |     expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
  570 |     expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  571 |   });
  572 | 
  573 |   // ── 17. Contrast: Tier-0 keywords via DM are NOT blocked by the group gate ────
  574 |   //
  575 |   // When the `To` field is a plain Twilio number (no "@g.us"), groupSourced is
  576 |   // false.  The Tier-0 DM-only gate (if (groupSourced)) is skipped, and
  577 |   // replyGroupMutationBlocked() is never sent.
  578 |   //
  579 |   // For each keyword the test seeds no onboarding_state for the sender phone so
  580 |   // the household lookup finds nothing and no reply is sent at all.  An empty
  581 |   // send-buffer proves the group-block reply was NOT triggered by the DM path.
  582 | 
  583 |   const tier0DmCases: Array<[string, string]> = [
  584 |     ["PAUSAR", "tier0-dm-pausar"],
  585 |     ["PARAR", "tier0-dm-parar"],
  586 |     ["RETOMAR", "tier0-dm-retomar"],
  587 |   ];
  588 | 
  589 |   for (const [keyword, label] of tier0DmCases) {
  590 |     test(`Tier-0 ${keyword} via DM: replyGroupMutationBlocked is NOT sent (group gate does not fire)`, async ({ request }) => {
  591 |       // Use a phone number that has no onboarding_state row so the DM Tier-0
  592 |       // handler finds no household and sends nothing — cleanly proving the
  593 |       // group-block reply was not triggered.
  594 |       const unknownPhone = uniquePhone();
  595 |       const twilioNumber = uniqueTwilioNumber(); // plain number, no "@g.us"
  596 | 
  597 |       await drainWaSends(request);
  598 | 
  599 |       const { status } = await sendWebhook(request, {
  600 |         from: unknownPhone,
  601 |         to: twilioNumber, // DM: To is the Twilio number, NOT a group JID
  602 |         body: keyword,    // no /vesta prefix required for DMs
  603 |         messageSid: uniqueSid(label),
  604 |       });
  605 | 
  606 |       expect(status).toBe(200);
```