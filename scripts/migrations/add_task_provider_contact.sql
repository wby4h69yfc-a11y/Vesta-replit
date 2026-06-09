-- Add provider_contact_id to tasks table for post-completion rating prompts
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provider_contact_id INTEGER REFERENCES contacts(id);
