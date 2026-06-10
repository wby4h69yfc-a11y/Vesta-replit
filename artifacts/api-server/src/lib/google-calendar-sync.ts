/**
 * google-calendar-sync.ts
 *
 * Shared helper that pulls events from Google Calendar into the local
 * `calendar_events` table.  Used by both the HTTP sync route
 * (`routes/google.ts`) and the WhatsApp calendar query handler
 * (`wa-calendar-query-handler.ts`) so there is a single canonical
 * implementation of the upsert logic.
 *
 * Security: callers are responsible for verifying the user is authorised to
 * act on behalf of the household before calling this function.
 */

import type { Logger } from "pino";
import { db } from "@workspace/db";
import { calendarEventsTable } from "@workspace/db";
import type { calendar_v3 } from "googleapis";
import { google } from "googleapis";
import { getAuthedOAuth2 } from "../routes/google";

export interface SyncCalendarOptions {
  /** How many past days to include. Default 7, max 30. */
  daysBack?: number;
  /** How many future days to include. Default 90, max 365. */
  daysForward?: number;
}

export interface SyncCalendarResult {
  synced: number;
  total: number;
}

/**
 * Pulls calendar events from Google Calendar and upserts them into the local
 * `calendar_events` table for the given household.
 *
 * @param userId      - ID of the user whose Google OAuth token to use.
 * @param householdId - Household to write events into.
 * @param log         - Pino logger instance.
 * @param opts        - Optional window configuration.
 * @returns           Counts of synced / total events, or null if the user has
 *                    no Google OAuth token.
 */
export async function syncHouseholdGoogleCalendar(
  userId: string,
  householdId: number,
  log: Logger,
  opts: SyncCalendarOptions = {},
): Promise<SyncCalendarResult | null> {
  const oauth2 = await getAuthedOAuth2(userId);
  if (!oauth2) return null;

  const daysBack = Math.min(opts.daysBack ?? 7, 30);
  const daysForward = Math.min(opts.daysForward ?? 90, 365);

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
    log.error({ err, householdId }, "google-calendar-sync: Google Calendar API call failed");
    throw err;
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
        household_id: householdId,
        title: ev.summary,
        start_at: startAt,
        end_at: endAt ?? undefined,
        all_day: isAllDay,
        source: "google",
        sync_status: "synced",
        gcal_event_id: ev.id,
        notes: ev.description ?? null,
        location: ev.location ?? null,
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
          location: ev.location ?? null,
          updated_at: new Date(),
        },
      });
    synced++;
  }

  log.info({ householdId, synced, total: gcalEvents.length }, "google-calendar-sync: sync complete");
  return { synced, total: gcalEvents.length };
}
