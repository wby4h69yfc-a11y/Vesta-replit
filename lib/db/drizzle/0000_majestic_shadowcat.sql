CREATE TABLE "otp_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" varchar(20) NOT NULL,
	"code" varchar(6) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"phone" varchar(20),
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"google_id" varchar,
	"apple_id" varchar,
	"household_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_apple_id_unique" UNIQUE("apple_id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"concierge_eligible" boolean DEFAULT false NOT NULL,
	"last_briefing_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"display_name" text,
	"role" text DEFAULT 'member' NOT NULL,
	"relationship_type" text DEFAULT 'adult' NOT NULL,
	"phone" text,
	"avatar_url" text,
	"colour" text,
	"birth_year" integer,
	"school" text,
	"grade" text,
	"primary_doctor" text,
	"schedule" text,
	"medical_plan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"whatsapp_id" text,
	"category" text DEFAULT 'outros' NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"source" text DEFAULT 'user_created' NOT NULL,
	"consent_status" text,
	"consent_granted_at" timestamp with time zone,
	"consent_withdrawn_at" timestamp with time zone,
	"consent_check_in_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"raw_content" text NOT NULL,
	"media_url" text,
	"status" text DEFAULT 'received' NOT NULL,
	"sender_name" text,
	"twilio_message_sid" text,
	"gmail_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggested_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"inbox_item_id" integer NOT NULL,
	"household_id" integer NOT NULL,
	"category" text DEFAULT 'outros' NOT NULL,
	"type" text DEFAULT 'task' NOT NULL,
	"title" text NOT NULL,
	"datetime" text,
	"suggested_owner" text,
	"approval_level" text DEFAULT 'one_tap' NOT NULL,
	"confidence" real DEFAULT 0.7 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"cascade_check_needed" boolean DEFAULT false NOT NULL,
	"workflow_tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"title" text NOT NULL,
	"owner_id" integer,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"category" text,
	"linked_event_id" integer,
	"workflow_tags" text[] DEFAULT '{}' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"category" text DEFAULT 'outros' NOT NULL,
	"members" text[] DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"sync_status" text DEFAULT 'local' NOT NULL,
	"gcal_event_id" text,
	"notes" text,
	"workflow_tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'outros' NOT NULL,
	"trigger_desc" text NOT NULL,
	"action_desc" text NOT NULL,
	"approval_level" text DEFAULT 'one_tap' NOT NULL,
	"confidence" real DEFAULT 0.55 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"origin" text DEFAULT 'system_template' NOT NULL,
	"times_triggered" integer DEFAULT 0 NOT NULL,
	"times_approved" integer DEFAULT 0 NOT NULL,
	"times_dismissed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"status" text DEFAULT 'accumulating' NOT NULL,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"action" text NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"action_type" text DEFAULT 'approved' NOT NULL,
	"category" text,
	"description" text NOT NULL,
	"metadata" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_places" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"address" text,
	"related_to_member_id" integer,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"source" text DEFAULT 'user_created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"applies_to_member_id" integer,
	"preference_type" text NOT NULL,
	"preference_key" text NOT NULL,
	"preference_value" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"source" text DEFAULT 'user_created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_routines" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'outros' NOT NULL,
	"recurrence_pattern" jsonb NOT NULL,
	"involves_member_id" integer,
	"responsible_member_id" integer,
	"location_id" integer,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"source" text DEFAULT 'user_created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_staging" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"target_table" text NOT NULL,
	"proposed_record" jsonb NOT NULL,
	"extracted_from_inbox_id" integer,
	"context_summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"surfaced_to_user_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"composition" jsonb,
	"pain_points" text[] DEFAULT '{}' NOT NULL,
	"whatsapp_verified" boolean DEFAULT false NOT NULL,
	"calendar_connected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expiry" timestamp with time zone,
	"scopes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_tokens_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "household_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"household_id" integer NOT NULL,
	"invited_phone" text NOT NULL,
	"invited_by_user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "household_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "google_tokens" ADD CONSTRAINT "google_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_twilio_message_sid_unique" ON "inbox_items" USING btree ("twilio_message_sid") WHERE "inbox_items"."twilio_message_sid" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_household_gmail_message_id_unique" ON "inbox_items" USING btree ("household_id","gmail_message_id") WHERE "inbox_items"."gmail_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "suggested_actions_inbox_item_id_unique" ON "suggested_actions" USING btree ("inbox_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_household_gcal_event_id_idx" ON "calendar_events" USING btree ("household_id","gcal_event_id");