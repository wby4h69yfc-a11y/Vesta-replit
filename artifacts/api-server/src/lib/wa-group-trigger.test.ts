/**
 * Unit tests for wa-group-trigger.ts
 *
 * Covers the two pure helpers used by the webhook handler:
 *   - isGroupMessage: @g.us detection via Twilio `To` field
 *   - extractVestaTrigger: /vesta prefix stripping
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isGroupMessage, extractVestaTrigger } from "./wa-group-trigger.js";

// ── isGroupMessage ─────────────────────────────────────────────────────────────

test("isGroupMessage: detects group JID with @g.us suffix", () => {
  assert.equal(isGroupMessage("whatsapp:+12036300000000@g.us"), true);
});

test("isGroupMessage: detects group JID without whatsapp: prefix", () => {
  assert.equal(isGroupMessage("+12036300000000@g.us"), true);
});

test("isGroupMessage: returns false for Twilio DM number", () => {
  assert.equal(isGroupMessage("whatsapp:+14155238886"), false);
});

test("isGroupMessage: returns false for empty string", () => {
  assert.equal(isGroupMessage(""), false);
});

test("isGroupMessage: returns false for sender phone (From field)", () => {
  assert.equal(isGroupMessage("whatsapp:+5511999999999"), false);
});

// ── extractVestaTrigger ────────────────────────────────────────────────────────

// (a) Non-/vesta messages must be ignored — trigger returns null
test("extractVestaTrigger: returns null for plain group message (no /vesta)", () => {
  assert.equal(extractVestaTrigger("oi, tudo bem?"), null);
});

test("extractVestaTrigger: returns null for empty string", () => {
  assert.equal(extractVestaTrigger(""), null);
});

test("extractVestaTrigger: returns null for message containing vesta mid-sentence", () => {
  assert.equal(extractVestaTrigger("fala sobre a vesta"), null);
});

test("extractVestaTrigger: returns null for message with /vesta not at start", () => {
  assert.equal(extractVestaTrigger("ok /vesta pausar"), null);
});

// (b) Non-admin /vesta foo — trigger detected, prefix stripped correctly
test("extractVestaTrigger: strips /vesta and returns remainder", () => {
  assert.equal(
    extractVestaTrigger("/vesta reunião da escola quinta 19h"),
    "reunião da escola quinta 19h",
  );
});

test("extractVestaTrigger: case-insensitive — /VESTA works", () => {
  assert.equal(extractVestaTrigger("/VESTA tarefa urgente"), "tarefa urgente");
});

test("extractVestaTrigger: case-insensitive — /Vesta works", () => {
  assert.equal(extractVestaTrigger("/Vesta o que tenho amanhã?"), "o que tenho amanhã?");
});

// (c) Non-admin /vesta pausar — trigger detected
test("extractVestaTrigger: detects /vesta pausar trigger", () => {
  assert.equal(extractVestaTrigger("/vesta pausar"), "pausar");
});

test("extractVestaTrigger: detects /vesta parar trigger", () => {
  assert.equal(extractVestaTrigger("/vesta parar"), "parar");
});

test("extractVestaTrigger: detects /vesta retomar trigger", () => {
  assert.equal(extractVestaTrigger("/vesta retomar"), "retomar");
});

// (d) Admin /vesta ... — trigger detected with correct stripping
test("extractVestaTrigger: strips /vesta with multiple leading spaces in remainder", () => {
  assert.equal(extractVestaTrigger("/vesta   agenda de amanhã"), "agenda de amanhã");
});

test("extractVestaTrigger: /vesta alone returns empty string (not null)", () => {
  assert.equal(extractVestaTrigger("/vesta"), "");
});

test("extractVestaTrigger: /vesta with trailing whitespace only returns empty string", () => {
  assert.equal(extractVestaTrigger("/vesta   "), "");
});
