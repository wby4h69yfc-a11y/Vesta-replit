# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: group-gates.spec.ts >> WhatsApp group gates >> Tier-0 PARAR in group: replyGroupMutationBlocked sent to group JID, no inbox item
- Location: src/e2e/group-gates.spec.ts:513:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "@g.us"
Received string:    "whatsapp:+55992532853001"
```

# Test source

```ts
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
  449 |     expect(sends[0]!.to).toContain("@g.us");
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
> 535 |     expect(send.to).toContain("@g.us");
      |                     ^ Error: expect(received).toContain(expected) // indexOf
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
  550 |     const countBefore = await countInboxItems(db, hhId);
  551 | 
  552 |     const { status } = await sendWebhook(request, {
  553 |       from: adminPhone,
  554 |       to: groupJid,
  555 |       body: "/vesta RETOMAR",
  556 |       messageSid: uniqueSid("tier0-grp-retomar"),
  557 |     });
  558 | 
  559 |     expect(status).toBe(200);
  560 |     expect(await countInboxItems(db, hhId)).toBe(countBefore);
  561 | 
  562 |     const sends = await drainWaSends(request);
  563 |     expect(sends).toHaveLength(1);
  564 |     const send = sends[0]!;
  565 |     expect(send.to).toContain("@g.us");
  566 |     expect(send.to).toBe(groupJid);
  567 |     expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
  568 |     expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  569 |   });
  570 | 
  571 |   // ── 17. Contrast: Tier-0 keywords via DM are NOT blocked by the group gate ────
  572 |   //
  573 |   // When the `To` field is a plain Twilio number (no "@g.us"), groupSourced is
  574 |   // false.  The Tier-0 DM-only gate (if (groupSourced)) is skipped, and
  575 |   // replyGroupMutationBlocked() is never sent.
  576 |   //
  577 |   // For each keyword the test seeds no onboarding_state for the sender phone so
  578 |   // the household lookup finds nothing and no reply is sent at all.  An empty
  579 |   // send-buffer proves the group-block reply was NOT triggered by the DM path.
  580 | 
  581 |   const tier0DmCases: Array<[string, string]> = [
  582 |     ["PAUSAR", "tier0-dm-pausar"],
  583 |     ["PARAR", "tier0-dm-parar"],
  584 |     ["RETOMAR", "tier0-dm-retomar"],
  585 |   ];
  586 | 
  587 |   for (const [keyword, label] of tier0DmCases) {
  588 |     test(`Tier-0 ${keyword} via DM: replyGroupMutationBlocked is NOT sent (group gate does not fire)`, async ({ request }) => {
  589 |       // Use a phone number that has no onboarding_state row so the DM Tier-0
  590 |       // handler finds no household and sends nothing — cleanly proving the
  591 |       // group-block reply was not triggered.
  592 |       const unknownPhone = uniquePhone();
  593 |       const twilioNumber = uniqueTwilioNumber(); // plain number, no "@g.us"
  594 | 
  595 |       await drainWaSends(request);
  596 | 
  597 |       const { status } = await sendWebhook(request, {
  598 |         from: unknownPhone,
  599 |         to: twilioNumber, // DM: To is the Twilio number, NOT a group JID
  600 |         body: keyword,    // no /vesta prefix required for DMs
  601 |         messageSid: uniqueSid(label),
  602 |       });
  603 | 
  604 |       expect(status).toBe(200);
  605 | 
  606 |       const sends = await drainWaSends(request);
  607 |       // No household lookup succeeds → no reply at all, proving the
  608 |       // group-mutation-blocked gate did not fire for a DM.
  609 |       const blockedSends = sends.filter((s) =>
  610 |         s.body.includes(MUTATION_BLOCKED_BODY_PREFIX),
  611 |       );
  612 |       expect(blockedSends).toHaveLength(0);
  613 |     });
  614 |   }
  615 | });
  616 | 
```