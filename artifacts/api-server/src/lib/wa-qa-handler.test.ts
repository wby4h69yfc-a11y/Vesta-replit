/**
 * Unit tests for wa-qa-handler.ts
 *
 * Covers:
 *   - detectQuestionKeyword: all five question types and false-positive patterns
 *   - isMutationCommand: scope-boundary enforcement (read-only, single-turn)
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectQuestionKeyword, isMutationCommand } from "./wa-qa-handler.js";

// ── agenda_tomorrow ───────────────────────────────────────────────────────────

test("detects agenda_tomorrow: classic query 'o que tenho amanhã?'", () => {
  assert.equal(detectQuestionKeyword("o que tenho amanhã?"), "agenda_tomorrow");
});

test("detects agenda_tomorrow: 'O que tem amanhã?'", () => {
  assert.equal(detectQuestionKeyword("O que tem amanhã?"), "agenda_tomorrow");
});

test("detects agenda_tomorrow: 'minha agenda amanhã'", () => {
  assert.equal(detectQuestionKeyword("minha agenda amanhã"), "agenda_tomorrow");
});

test("detects agenda_tomorrow: 'agenda de amanhã?' (with question mark)", () => {
  assert.equal(detectQuestionKeyword("agenda de amanhã?"), "agenda_tomorrow");
});

test("detects agenda_tomorrow: no-accent 'o que tenho amanha'", () => {
  assert.equal(detectQuestionKeyword("o que tenho amanha"), "agenda_tomorrow");
});

// ── agenda_today ──────────────────────────────────────────────────────────────

test("detects agenda_today: 'o que tenho hoje?'", () => {
  assert.equal(detectQuestionKeyword("o que tenho hoje?"), "agenda_today");
});

test("detects agenda_today: 'minha agenda hoje'", () => {
  assert.equal(detectQuestionKeyword("minha agenda hoje"), "agenda_today");
});

test("detects agenda_today: 'o que tem hoje'", () => {
  assert.equal(detectQuestionKeyword("o que tem hoje"), "agenda_today");
});

// ── agenda_week ───────────────────────────────────────────────────────────────

test("detects agenda_week: 'o que tenho essa semana?'", () => {
  assert.equal(detectQuestionKeyword("o que tenho essa semana?"), "agenda_week");
});

test("detects agenda_week: 'agenda desta semana?' (with question mark)", () => {
  assert.equal(detectQuestionKeyword("agenda desta semana?"), "agenda_week");
});

test("detects agenda_week: 'o que tem na semana que vem'", () => {
  assert.equal(detectQuestionKeyword("o que tem na semana que vem"), "agenda_week");
});

// ── tasks_open ────────────────────────────────────────────────────────────────

test("detects tasks_open: 'quais tarefas abertas?'", () => {
  assert.equal(detectQuestionKeyword("quais tarefas abertas?"), "tasks_open");
});

test("detects tasks_open: 'quais tarefas pendentes'", () => {
  assert.equal(detectQuestionKeyword("quais tarefas pendentes"), "tasks_open");
});

test("detects tasks_open: 'lista de tarefas'", () => {
  assert.equal(detectQuestionKeyword("lista de tarefas"), "tasks_open");
});

test("detects tasks_open: 'o que está pra fazer?'", () => {
  assert.equal(detectQuestionKeyword("o que está pra fazer?"), "tasks_open");
});

test("detects tasks_open: 'o que está para fazer'", () => {
  assert.equal(detectQuestionKeyword("o que está para fazer"), "tasks_open");
});

// ── inbox_pending ─────────────────────────────────────────────────────────────

test("detects inbox_pending: 'o que tem no inbox?'", () => {
  assert.equal(detectQuestionKeyword("o que tem no inbox?"), "inbox_pending");
});

test("detects inbox_pending: 'inbox'", () => {
  assert.equal(detectQuestionKeyword("inbox"), "inbox_pending");
});

test("detects inbox_pending: 'caixa de entrada'", () => {
  assert.equal(detectQuestionKeyword("caixa de entrada"), "inbox_pending");
});

test("detects inbox_pending: 'mensagens pendentes?' (with question mark)", () => {
  assert.equal(detectQuestionKeyword("mensagens pendentes?"), "inbox_pending");
});

test("inbox beats agenda_today: 'o que tem no inbox hoje'", () => {
  assert.equal(detectQuestionKeyword("o que tem no inbox hoje"), "inbox_pending");
});

// ── false positives — should return null ─────────────────────────────────────

test("returns null for regular forwarded message (no question marker)", () => {
  assert.equal(
    detectQuestionKeyword("Consulta da Bia marcada para quinta 14h na UBS Central"),
    null,
  );
});

test("returns null for statement 'Vou sair amanhã cedo'", () => {
  assert.equal(detectQuestionKeyword("Vou sair amanhã cedo"), null);
});

test("returns null for approval 'sim'", () => {
  assert.equal(detectQuestionKeyword("sim"), null);
});

test("returns null for approval 'não'", () => {
  assert.equal(detectQuestionKeyword("não"), null);
});

test("returns null for 'amanhã tem reunião de pais' (statement, no question marker)", () => {
  assert.equal(detectQuestionKeyword("amanhã tem reunião de pais"), null);
});

test("returns null for 'agenda de amanhã' without question mark (prevents false positive on forwarded content)", () => {
  assert.equal(detectQuestionKeyword("agenda de amanhã"), null);
});

test("returns null for 'Temos reunião com agenda de amanhã às 14h' (forwarded message)", () => {
  assert.equal(
    detectQuestionKeyword("Temos reunião com agenda de amanhã às 14h"),
    null,
  );
});

test("returns null for 'Mensagem da escola sobre pendências da matrícula' (contains pendência but not a question)", () => {
  assert.equal(
    detectQuestionKeyword("Mensagem da escola sobre pendências da matrícula"),
    null,
  );
});

test("returns null for blank string", () => {
  assert.equal(detectQuestionKeyword(""), null);
});

// ── isMutationCommand — scope boundary: read-only ─────────────────────────────
// These tests document that mutation commands are intercepted so they never
// fall through to ingestion and never accidentally trigger a read resolver.

test("isMutationCommand: 'Cancela aquela reunião' (imperative)", () => {
  assert.equal(isMutationCommand("Cancela aquela reunião"), true);
});

test("isMutationCommand: 'Apaga essa tarefa' (imperative)", () => {
  assert.equal(isMutationCommand("Apaga essa tarefa"), true);
});

test("isMutationCommand: 'Cria uma tarefa para amanhã' (imperative)", () => {
  assert.equal(isMutationCommand("Cria uma tarefa para amanhã"), true);
});

test("isMutationCommand: 'Reagenda a consulta' (imperative)", () => {
  assert.equal(isMutationCommand("Reagenda a consulta"), true);
});

test("isMutationCommand: 'Vesta, cancela o evento de sexta' (prefixed imperative)", () => {
  assert.equal(isMutationCommand("Vesta, cancela o evento de sexta"), true);
});

test("isMutationCommand: 'Pode cancelar a consulta de amanhã?' (modal form)", () => {
  assert.equal(isMutationCommand("Pode cancelar a consulta de amanhã?"), true);
});

test("isMutationCommand: 'Você pode criar uma tarefa pra mim?' (modal form)", () => {
  assert.equal(isMutationCommand("Você pode criar uma tarefa pra mim?"), true);
});

test("isMutationCommand: 'Dá pra mudar o horário?' (modal form)", () => {
  assert.equal(isMutationCommand("Dá pra mudar o horário?"), true);
});

// Non-mutation — must return false so these reach normal read/ingest flow
test("isMutationCommand: false for read question 'o que tenho amanhã?'", () => {
  assert.equal(isMutationCommand("o que tenho amanhã?"), false);
});

test("isMutationCommand: false for forwarded statement 'Reunião cancelada — avisa o grupo'", () => {
  assert.equal(isMutationCommand("Reunião cancelada — avisa o grupo"), false);
});

test("isMutationCommand: false for 'o que foi cancelado essa semana?' (past-tense read query)", () => {
  assert.equal(isMutationCommand("o que foi cancelado essa semana?"), false);
});

test("isMutationCommand: false for approval 'sim'", () => {
  assert.equal(isMutationCommand("sim"), false);
});

test("isMutationCommand: false for blank string", () => {
  assert.equal(isMutationCommand(""), false);
});
