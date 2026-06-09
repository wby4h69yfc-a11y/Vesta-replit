/**
 * Unit tests for the group mutation gate in wa-message-processor.ts
 *
 * These tests exercise the `isMutationCommand` helper that powers the gate
 * and verify the full `processInboundWAMessage` outcome when a mutation
 * command arrives from a group chat.
 *
 * The processor requires a real DB connection, so the integration-level cases
 * are covered by testing `isMutationCommand` in isolation (pure logic, no DB)
 * plus verifying the `replyGroupMutationBlocked` composer output.
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isMutationCommand, isTier0Command } from "./wa-qa-handler.js";
import { replyGroupMutationBlocked } from "./wa-reply-composer.js";

// ── isMutationCommand: imperative form ───────────────────────────────────────

test("blocks imperative: 'cancela a reunião'", () => {
  assert.equal(isMutationCommand("cancela a reunião"), true);
});

test("blocks imperative: 'Cancela aquela reunião de amanhã'", () => {
  assert.equal(isMutationCommand("Cancela aquela reunião de amanhã"), true);
});

test("blocks imperative: 'cria uma tarefa de compras'", () => {
  assert.equal(isMutationCommand("cria uma tarefa de compras"), true);
});

test("blocks imperative: 'apaga esse evento'", () => {
  assert.equal(isMutationCommand("apaga esse evento"), true);
});

test("blocks imperative: 'adiciona o Pedro na agenda'", () => {
  assert.equal(isMutationCommand("adiciona o Pedro na agenda"), true);
});

test("blocks imperative: 'muda o horário da consulta'", () => {
  assert.equal(isMutationCommand("muda o horário da consulta"), true);
});

test("blocks imperative: 'reagenda a consulta do João'", () => {
  assert.equal(isMutationCommand("reagenda a consulta do João"), true);
});

test("blocks imperative: 'edita o evento de sexta'", () => {
  assert.equal(isMutationCommand("edita o evento de sexta"), true);
});

test("blocks imperative: 'remove a tarefa pendente'", () => {
  assert.equal(isMutationCommand("remove a tarefa pendente"), true);
});

test("blocks imperative: 'move para semana que vem'", () => {
  assert.equal(isMutationCommand("move para semana que vem"), true);
});

// ── isMutationCommand: Vesta-prefixed imperative ──────────────────────────────

test("blocks Vesta-prefixed imperative: 'Vesta, cancela a reunião'", () => {
  assert.equal(isMutationCommand("Vesta, cancela a reunião"), true);
});

test("blocks Vesta-prefixed imperative: 'Vesta: cria uma tarefa'", () => {
  assert.equal(isMutationCommand("Vesta: cria uma tarefa"), true);
});

test("blocks Vesta-prefixed imperative: 'Vesta apaga esse evento'", () => {
  assert.equal(isMutationCommand("Vesta apaga esse evento"), true);
});

// ── isMutationCommand: modal / polite form ────────────────────────────────────

test("blocks modal: 'pode cancelar a consulta de amanhã?'", () => {
  assert.equal(isMutationCommand("pode cancelar a consulta de amanhã?"), true);
});

test("blocks modal: 'Consegue criar uma tarefa?' (bare consegue at start)", () => {
  assert.equal(isMutationCommand("Consegue criar uma tarefa?"), true);
});

test("blocks modal: 'vc pode apagar esse evento?'", () => {
  assert.equal(isMutationCommand("vc pode apagar esse evento?"), true);
});

test("blocks modal: 'dá pra mover para sexta?'", () => {
  assert.equal(isMutationCommand("dá pra mover para sexta?"), true);
});

// ── isMutationCommand: non-mutation messages (must NOT match) ────────────────

test("does NOT block a question: 'o que tenho amanhã?'", () => {
  assert.equal(isMutationCommand("o que tenho amanhã?"), false);
});

test("does NOT block a question: 'quais tarefas estão abertas?'", () => {
  assert.equal(isMutationCommand("quais tarefas estão abertas?"), false);
});

test("does NOT block a forwarded statement: 'Reunião cancelada pelo cliente'", () => {
  assert.equal(isMutationCommand("Reunião cancelada pelo cliente"), false);
});

test("does NOT block incidental mutation word in question: 'o que foi cancelado?'", () => {
  assert.equal(isMutationCommand("o que foi cancelado?"), false);
});

test("does NOT block a regular forwarded message: 'Boleto de R$150 vence amanhã'", () => {
  assert.equal(isMutationCommand("Boleto de R$150 vence amanhã"), false);
});

test("does NOT block a simple acknowledgement: 'sim'", () => {
  assert.equal(isMutationCommand("sim"), false);
});

test("does NOT block a rating keyword: 'Bom'", () => {
  assert.equal(isMutationCommand("Bom"), false);
});

test("does NOT block inbox query: 'minha agenda hoje'", () => {
  assert.equal(isMutationCommand("minha agenda hoje"), false);
});

// ── isTier0Command: recognises Tier-0 keywords ───────────────────────────────

test("isTier0Command matches PAUSAR", () => {
  assert.equal(isTier0Command("PAUSAR"), true);
});

test("isTier0Command matches PARAR", () => {
  assert.equal(isTier0Command("PARAR"), true);
});

test("isTier0Command matches RETOMAR", () => {
  assert.equal(isTier0Command("RETOMAR"), true);
});

test("isTier0Command is case-insensitive: 'pausar'", () => {
  assert.equal(isTier0Command("pausar"), true);
});

test("isTier0Command is case-insensitive: 'Retomar'", () => {
  assert.equal(isTier0Command("Retomar"), true);
});

test("isTier0Command trims surrounding whitespace", () => {
  assert.equal(isTier0Command("  PARAR  "), true);
});

test("isTier0Command does NOT match a partial word: 'pausar agora'", () => {
  assert.equal(isTier0Command("pausar agora"), false);
});

test("isTier0Command does NOT match a mutation command: 'cancela reunião'", () => {
  assert.equal(isTier0Command("cancela reunião"), false);
});

test("isTier0Command does NOT match a regular message: 'o que tenho hoje'", () => {
  assert.equal(isTier0Command("o que tenho hoje"), false);
});

test("isTier0Command does NOT match empty string", () => {
  assert.equal(isTier0Command(""), false);
});

// ── replyGroupMutationBlocked: composer output ───────────────────────────────

test("replyGroupMutationBlocked returns a non-empty Portuguese string", () => {
  const reply = replyGroupMutationBlocked();
  assert.ok(reply.length > 0, "reply should not be empty");
  assert.ok(
    reply.includes("mensagem direta") || reply.includes("DM") || reply.includes("chat privado"),
    "reply should redirect to DM",
  );
});

test("replyGroupMutationBlocked includes a clear explanation", () => {
  const reply = replyGroupMutationBlocked();
  assert.ok(
    reply.includes("⚠️") || reply.includes("alteração") || reply.includes("comandos"),
    "reply should mention mutation commands",
  );
});
