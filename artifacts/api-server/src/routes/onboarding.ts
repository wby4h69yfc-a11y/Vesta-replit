import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, ne, sql } from "drizzle-orm";
import { db, onboardingStateTable, membersTable, householdsTable, contactsTable } from "@workspace/db";
import { CompleteOnboardingBody } from "@workspace/api-zod";
import { getHouseholdId } from "../lib/tenant";
import { createToken, isTokenVerified, getVerifiedPhone } from "../lib/wa-token-store";

const router: IRouter = Router();

/**
 * GET /api/onboarding/state
 *
 * Returns (or creates) the onboarding state for the current user.
 */
router.get("/onboarding/state", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const userId = req.user.id;
    const householdId = getHouseholdId(req);

    let [state] = await db
      .select()
      .from(onboardingStateTable)
      .where(eq(onboardingStateTable.user_id, userId));

    if (!state) {
      [state] = await db
        .insert(onboardingStateTable)
        .values({
          user_id: userId,
          household_id: householdId,
          current_step: 0,
          completed: false,
        })
        .returning();
    }

    res.json({ state });
  } catch (err) {
    req.log.error({ err }, "Failed to get onboarding state");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/onboarding/whatsapp-connect
 *
 * Generates a short verification token and returns the Twilio WhatsApp
 * number so the frontend can open a deep link and display the token.
 *
 * The token lives in an in-memory store (wa-token-store) and expires in 10 min.
 * When the user sends the token via WhatsApp, the inbound webhook calls
 * markTokenVerified() so GET /whatsapp-status can confirm success.
 */
router.post("/onboarding/whatsapp-connect", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;
  const householdId = getHouseholdId(req);
  const token = createToken(userId, householdId);

  // Strip the "whatsapp:" prefix if present before returning number
  const rawFrom = process.env.TWILIO_WHATSAPP_FROM ?? "";
  const waNumber = rawFrom.replace(/^whatsapp:/i, "").replace(/\D/g, "");

  req.log.info({ userId }, "WhatsApp onboarding token created");

  res.json({
    token,
    whatsapp_number: waNumber || null,
    configured: !!waNumber,
  });
});

/**
 * GET /api/onboarding/whatsapp-status
 *
 * Polled by the frontend every ~2 s after showing the token.
 * Returns { verified: true } once the webhook has confirmed the token.
 */
router.get("/onboarding/whatsapp-status", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const verified = isTokenVerified(req.user.id);

  // If verified, also persist it on the onboarding_state row so it survives
  // server restarts and is visible from GET /onboarding/state.
  if (verified) {
    try {
      const verifiedPhone = getVerifiedPhone(req.user.id);
      await db
        .update(onboardingStateTable)
        .set({
          whatsapp_verified: true,
          whatsapp_verified_phone: verifiedPhone,
          updated_at: new Date(),
        })
        .where(eq(onboardingStateTable.user_id, req.user.id));
    } catch (err) {
      req.log.warn({ err }, "Could not persist whatsapp_verified flag");
    }
  }

  res.json({ verified });
});

/**
 * POST /api/onboarding/complete
 *
 * Marks onboarding as complete. Renames the household and creates the
 * primary member record.
 */
router.post("/onboarding/complete", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;
  const parsed = CompleteOnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  try {
    const {
      display_name,
      composition,
      pain_points,
      calendar_connected,
      // whatsapp_phone and whatsapp_verified are intentionally ignored —
      // they are client-controlled fields that cannot be trusted.
      // We derive the verified status and phone number from the server-side
      // token store, which records the number that actually sent the token.
    } = parsed.data;

    const householdId = getHouseholdId(req);

    // Server-side verification: check the token store, not the request body.
    const serverVerified = isTokenVerified(userId);
    const serverPhone = serverVerified ? getVerifiedPhone(userId) : null;

    if (display_name) {
      await db
        .update(householdsTable)
        .set({ name: `Casa de ${display_name}` })
        .where(eq(householdsTable.id, householdId));
    }

    const updated = await db
      .update(onboardingStateTable)
      .set({
        completed: true,
        current_step: 7,
        household_id: householdId,
        composition: composition ?? null,
        pain_points: pain_points ?? [],
        whatsapp_verified: serverVerified,
        calendar_connected: calendar_connected ?? false,
        updated_at: new Date(),
      })
      .where(eq(onboardingStateTable.user_id, userId));

    if (!updated.rowCount) {
      await db.insert(onboardingStateTable).values({
        user_id: userId,
        household_id: householdId,
        completed: true,
        current_step: 7,
        composition: composition ?? null,
        pain_points: pain_points ?? [],
        whatsapp_verified: serverVerified,
        calendar_connected: calendar_connected ?? false,
      });
    }

    const memberName = display_name ?? req.user.firstName ?? req.user.email ?? "Você";

    const [existing] = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.household_id, householdId))
      .limit(1);

    if (!existing) {
      // Determine the phone to store.  Even though serverPhone was confirmed via
      // the WhatsApp token flow, an attacker in another household could have
      // pre-registered the same number as a contact or member.  We re-run the
      // cross-household uniqueness check inside an advisory-locked transaction
      // before writing it.  On conflict we insert with phone = null so the
      // victim's onboarding succeeds rather than being blocked (DoS-resilient).
      let safePhone: string | null = null;
      if (serverPhone) {
        const phoneNorm = serverPhone.replace(/\D/g, "");
        if (phoneNorm) {
          await db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext('wa_phone'::text), hashtext(${phoneNorm}::text))`,
            );

            // Check contacts in other households.
            const [cc] = await tx
              .select({ id: contactsTable.id })
              .from(contactsTable)
              .where(
                and(
                  sql`regexp_replace(${contactsTable.phone}, '\\D', '', 'g') = ${phoneNorm}`,
                  ne(contactsTable.household_id, householdId),
                ),
              )
              .limit(1);

            // Check members in other households.
            const [cm] = !cc
              ? await tx
                  .select({ id: membersTable.id })
                  .from(membersTable)
                  .where(
                    and(
                      sql`regexp_replace(${membersTable.phone}, '\\D', '', 'g') = ${phoneNorm}`,
                      ne(membersTable.household_id, householdId),
                    ),
                  )
                  .limit(1)
              : [undefined];

            if (cc || cm) {
              // Another household has already claimed this verified phone.
              // Log for ops to investigate but don't block the user's onboarding.
              req.log.warn(
                { householdId },
                "onboarding/complete: verified phone already claimed by another household — inserting member without phone",
              );
              safePhone = null;
            } else {
              safePhone = serverPhone;
            }

            await tx.insert(membersTable).values({
              household_id: householdId,
              user_id: userId,
              name: memberName,
              display_name: memberName,
              role: "admin",
              relationship_type: "adult",
              phone: safePhone,
              // Mark phone as verified only when we could store it;
              // null means a conflict was detected, so nothing to verify.
              phone_verified: safePhone !== null,
            });
          });
        } else {
          await db.insert(membersTable).values({
            household_id: householdId,
            user_id: userId,
            name: memberName,
            display_name: memberName,
            role: "admin",
            relationship_type: "adult",
            phone: null,
            phone_verified: false,
          });
        }
      } else {
        await db.insert(membersTable).values({
          household_id: householdId,
          user_id: userId,
          name: memberName,
          display_name: memberName,
          role: "admin",
          relationship_type: "adult",
          phone: null,
          phone_verified: false,
        });
      }
    } else if (!existing.user_id) {
      await db
        .update(membersTable)
        .set({ user_id: userId })
        .where(eq(membersTable.id, existing.id));
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to complete onboarding");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
