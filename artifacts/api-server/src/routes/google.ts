import { Router, type IRouter, type Request, type Response } from "express";
import { google, type calendar_v3, type gmail_v1 } from "googleapis";
import crypto from "crypto";
import {
  db,
  googleTokensTable,
  calendarEventsTable,
  inboxItemsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  getSessionId,
  getSession,
  updateSession,
  type SessionData,
} from "../lib/auth";
import { getHouseholdId } from "../lib/tenant";

const router: IRouter = Router();

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
];

function getOAuth2Client() {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  const dev = process.env.REPLIT_DEV_DOMAIN;
  const host = domains ?? dev;
  const redirectUri = host
    ? `https://${host}/api/google/callback`
    : "http://localhost:8080/api/google/callback";

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri,
  );
}

export async function getAuthedOAuth2(userId: string) {
  const [token] = await db
    .select()
    .from(googleTokensTable)
    .where(eq(googleTokensTable.user_id, userId))
    .limit(1);

  if (!token) return null;

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token ?? undefined,
    expiry_date: token.expiry?.getTime(),
  });

  oauth2.on("tokens", async (newTokens) => {
    await db
      .update(googleTokensTable)
      .set({
        access_token: newTokens.access_token ?? token.access_token,
        refresh_token: newTokens.refresh_token ?? token.refresh_token,
        expiry: newTokens.expiry_date
          ? new Date(newTokens.expiry_date)
          : token.expiry,
        updated_at: new Date(),
      })
      .where(eq(googleTokensTable.user_id, userId));
  });

  return oauth2;
}

// ── OAuth connect ─────────────────────────────────────────────────────────────

router.get("/google/connect", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sid = getSessionId(req);
  if (!sid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const session = await getSession(sid);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const nonce = crypto.randomBytes(32).toString("hex");
  await updateSession(sid, { ...session, google_oauth_nonce: nonce });

  const oauth2 = getOAuth2Client();
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: nonce,
  });

  res.redirect(url);
});

router.get("/google/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    req.log.warn({ error }, "Google OAuth denied by user");
    res.redirect("/app?google=denied");
    return;
  }

  if (!code || !state) {
    res.redirect("/app?google=error");
    return;
  }

  if (!req.isAuthenticated()) {
    res.redirect("/login");
    return;
  }

  const sid = getSessionId(req);
  if (!sid) {
    res.redirect("/login");
    return;
  }

  const session = await getSession(sid);
  if (!session?.user?.id) {
    res.redirect("/login");
    return;
  }

  const stateBuffer = Buffer.from(state);
  const nonceBuffer = Buffer.from(session.google_oauth_nonce ?? "");
  if (
    !session.google_oauth_nonce ||
    stateBuffer.length !== nonceBuffer.length ||
    !crypto.timingSafeEqual(stateBuffer, nonceBuffer)
  ) {
    req.log.warn({ userId: session.user.id }, "Google OAuth state mismatch — possible CSRF");
    res.redirect("/app?google=error");
    return;
  }

  const { google_oauth_nonce: _removed, ...sessionWithoutNonce } = session;
  await updateSession(sid, sessionWithoutNonce as SessionData);

  const oauth2 = getOAuth2Client();
  let accessToken: string;
  let refreshToken: string | null | undefined;
  let expiryDate: number | null | undefined;
  try {
    const result = await oauth2.getToken(code);
    const t = result.tokens;
    if (!t.access_token) throw new Error("No access token returned");
    accessToken = t.access_token;
    refreshToken = t.refresh_token;
    expiryDate = t.expiry_date;
  } catch (err) {
    req.log.error({ err }, "Google OAuth token exchange failed");
    res.redirect("/app?google=error");
    return;
  }

  if (!accessToken) {
    res.redirect("/app?google=error");
    return;
  }

  const userId = session.user.id;

  await db
    .insert(googleTokensTable)
    .values({
      user_id: userId,
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      expiry: expiryDate ? new Date(expiryDate) : null,
      scopes: SCOPES.join(" "),
    })
    .onConflictDoUpdate({
      target: googleTokensTable.user_id,
      set: {
        access_token: accessToken,
        refresh_token: refreshToken ?? null,
        expiry: expiryDate ? new Date(expiryDate) : null,
        updated_at: new Date(),
      },
    });

  await updateSession(sid, {
    ...sessionWithoutNonce,
    user: { ...sessionWithoutNonce.user, google_connected: true },
  } as SessionData);

  res.redirect("/app?google=connected");
});

// ── Status & disconnect ───────────────────────────────────────────────────────

router.get("/google/status", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.json({ connected: false });
    return;
  }

  const [token] = await db
    .select({ id: googleTokensTable.id, scopes: googleTokensTable.scopes })
    .from(googleTokensTable)
    .where(eq(googleTokensTable.user_id, req.user.id))
    .limit(1);

  res.json({ connected: !!token, scopes: token?.scopes ?? null });
});

router.delete("/google/disconnect", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await db
    .delete(googleTokensTable)
    .where(eq(googleTokensTable.user_id, req.user.id));

  res.json({ success: true });
});

// ── Calendar sync ─────────────────────────────────────────────────────────────

/**
 * POST /api/google/calendar/sync
 *
 * Pulls events from Google Calendar into the local DB using an upsert keyed
 * on (household_id, gcal_event_id).  Conflicts are resolved by overwriting
 * local copies with the authoritative Google data.
 *
 * Query params:
 *   days_back    — how many past days to include (default 7, max 30)
 *   days_forward — how many future days to include (default 90, max 365)
 */
router.post("/google/calendar/sync", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const hid = getHouseholdId(req);

  const oauth2 = await getAuthedOAuth2(req.user.id);
  if (!oauth2) {
    res.status(400).json({ error: "Google not connected" });
    return;
  }

  // Configurable window — clamp to safe maximums to avoid hammering the API
  const daysBack = Math.min(
    parseInt(String(req.query.days_back ?? "7"), 10) || 7,
    30,
  );
  const daysForward = Math.min(
    parseInt(String(req.query.days_forward ?? "90"), 10) || 90,
    365,
  );

  const now = new Date();
  const timeMin = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const timeMax = new Date(now.getTime() + daysForward * 24 * 60 * 60 * 1000);

  const cal = google.calendar({ version: "v3", auth: oauth2 });

  let gcalEvents: calendar_v3.Schema$Event[] = [];
  try {
    const resp = await cal.events.list({
      calendarId: "primary",
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 500,
    });
    gcalEvents = resp.data.items ?? [];
  } catch (err) {
    req.log.error({ err }, "Google Calendar sync failed");
    res.status(500).json({ error: "Calendar sync failed" });
    return;
  }

  let synced = 0;
  for (const ev of gcalEvents) {
    if (!ev.id || !ev.summary) continue;

    const startAt = ev.start?.dateTime
      ? new Date(ev.start.dateTime)
      : ev.start?.date
        ? new Date(ev.start.date)
        : null;
    if (!startAt) continue;

    const endAt = ev.end?.dateTime
      ? new Date(ev.end.dateTime)
      : ev.end?.date
        ? new Date(ev.end.date)
        : null;

    const isAllDay = !ev.start?.dateTime;

    await db
      .insert(calendarEventsTable)
      .values({
        household_id: hid,
        title: ev.summary,
        start_at: startAt,
        end_at: endAt ?? undefined,
        all_day: isAllDay,
        source: "google",
        sync_status: "synced",
        gcal_event_id: ev.id,
        notes: ev.description ?? null,
      })
      .onConflictDoUpdate({
        target: [calendarEventsTable.household_id, calendarEventsTable.gcal_event_id],
        set: {
          title: ev.summary,
          start_at: startAt,
          end_at: endAt ?? undefined,
          all_day: isAllDay,
          sync_status: "synced",
          notes: ev.description ?? null,
          updated_at: new Date(),
        },
      });
    synced++;
  }

  res.json({
    synced,
    total: gcalEvents.length,
    window: { days_back: daysBack, days_forward: daysForward },
  });
});

// ── Calendar write-back ────────────────────────────────────────────────────────

/**
 * POST /api/google/calendar/events
 *
 * Creates an event in Google Calendar and mirrors it into the local DB.
 * If the user has not connected Google, falls back to local-only creation.
 *
 * Body: { title, start_at, end_at?, all_day?, notes?, category? }
 */
router.post("/google/calendar/events", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const hid = getHouseholdId(req);

  const { title, start_at, end_at, all_day, notes, category } = req.body as {
    title?: string;
    start_at?: string;
    end_at?: string;
    all_day?: boolean;
    notes?: string;
    category?: string;
  };

  if (!title || !start_at) {
    res.status(400).json({ error: "title and start_at are required" });
    return;
  }

  const startAt = new Date(start_at);
  if (isNaN(startAt.getTime())) {
    res.status(400).json({ error: "Invalid start_at date" });
    return;
  }

  const endAt = end_at ? new Date(end_at) : null;
  const isAllDay = all_day ?? false;

  let gcalEventId: string | null = null;

  // Attempt to write to Google Calendar if connected
  const oauth2 = await getAuthedOAuth2(req.user.id);
  if (oauth2) {
    const cal = google.calendar({ version: "v3", auth: oauth2 });

    const gcalEvent: calendar_v3.Schema$Event = {
      summary: title,
      description: notes ?? undefined,
      start: isAllDay
        ? { date: startAt.toISOString().split("T")[0] }
        : { dateTime: startAt.toISOString(), timeZone: "America/Sao_Paulo" },
      end: isAllDay
        ? {
            date: (endAt ?? startAt).toISOString().split("T")[0],
          }
        : {
            dateTime: (endAt ?? new Date(startAt.getTime() + 60 * 60 * 1000)).toISOString(),
            timeZone: "America/Sao_Paulo",
          },
    };

    try {
      const created = await cal.events.insert({
        calendarId: "primary",
        requestBody: gcalEvent,
      });
      gcalEventId = created.data.id ?? null;
      req.log.info({ gcalEventId }, "Event written to Google Calendar");
    } catch (err) {
      req.log.warn({ err }, "Failed to write event to Google Calendar — saving locally only");
    }
  }

  // Upsert into local DB (use gcal ID if we got one, else local-only)
  const [event] = await db
    .insert(calendarEventsTable)
    .values({
      household_id: hid,
      title,
      start_at: startAt,
      end_at: endAt ?? undefined,
      all_day: isAllDay,
      source: gcalEventId ? "google" : "manual",
      sync_status: gcalEventId ? "synced" : "local",
      gcal_event_id: gcalEventId,
      notes: notes ?? null,
      category: category ?? "outros",
    })
    .onConflictDoUpdate({
      target: [calendarEventsTable.household_id, calendarEventsTable.gcal_event_id],
      set: {
        title,
        start_at: startAt,
        end_at: endAt ?? undefined,
        all_day: isAllDay,
        notes: notes ?? null,
        sync_status: "synced",
        updated_at: new Date(),
      },
    })
    .returning();

  res.status(201).json({ event, google_synced: !!gcalEventId });
});

// ── Gmail sync ────────────────────────────────────────────────────────────────

router.post("/google/gmail/sync", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const hid = getHouseholdId(req);

  const oauth2 = await getAuthedOAuth2(req.user.id);
  if (!oauth2) {
    res.status(400).json({ error: "Google not connected" });
    return;
  }

  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  let messageList: gmail_v1.Schema$Message[] = [];
  try {
    const resp = await gmail.users.messages.list({
      userId: "me",
      maxResults: 20,
      q: "is:unread in:inbox",
    });
    messageList = resp.data.messages ?? [];
  } catch (err) {
    req.log.error({ err }, "Gmail sync list failed");
    res.status(500).json({ error: "Gmail sync failed" });
    return;
  }

  // Determine which Gmail IDs are already stored to avoid redundant API calls.
  // Scope the check to the current household so one household's sync cannot
  // suppress imports for another household that shares the same Gmail account.
  const listedIds = messageList.map((m) => m.id).filter((id): id is string => !!id);

  let alreadyKnownIds = new Set<string>();
  if (listedIds.length > 0) {
    const existing = await db
      .select({ gmail_message_id: inboxItemsTable.gmail_message_id })
      .from(inboxItemsTable)
      .where(
        and(
          eq(inboxItemsTable.household_id, hid),
          inArray(inboxItemsTable.gmail_message_id, listedIds),
        ),
      );
    alreadyKnownIds = new Set(
      existing
        .map((r) => r.gmail_message_id)
        .filter((id): id is string => id !== null),
    );
  }

  const newMessages = messageList.filter((m) => m.id && !alreadyKnownIds.has(m.id));

  let imported = 0;
  for (const msg of newMessages) {
    if (!msg.id) continue;

    let full: gmail_v1.Schema$Message;
    try {
      const r = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });
      full = r.data;
    } catch {
      continue;
    }

    const headers = full.payload?.headers ?? [];
    const subject =
      headers.find((h: gmail_v1.Schema$MessagePartHeader) => h.name === "Subject")?.value ?? "(sem assunto)";
    const from = headers.find((h: gmail_v1.Schema$MessagePartHeader) => h.name === "From")?.value ?? "";
    const snippet = full.snippet ?? "";

    const insertResult = await db
      .insert(inboxItemsTable)
      .values({
        household_id: hid,
        source: "email",
        raw_content: `De: ${from}\nAssunto: ${subject}\n\n${snippet}`,
        status: "received",
        sender_name: from,
        gmail_message_id: msg.id,
      })
      .onConflictDoNothing()
      .returning({ id: inboxItemsTable.id });

    if (insertResult.length > 0) imported++;
  }

  res.json({ imported, total: messageList.length, skipped: alreadyKnownIds.size });
});

export default router;
