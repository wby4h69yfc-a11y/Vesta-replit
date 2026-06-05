-- Migration: pre-built rule templates library
-- Creates the rule_templates table, adds source_template_id to rules, and seeds 14 templates.

CREATE TABLE IF NOT EXISTS rule_templates (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rules ADD COLUMN IF NOT EXISTS source_template_id INTEGER REFERENCES rule_templates(id) ON DELETE SET NULL;

INSERT INTO rule_templates (slug, category, name, description, trigger_config, action_config, sort_order) VALUES
  (
    'escola_boleto', 'escola', 'Boleto da escola',
    'Quando a escola mandar aviso de boleto ou mensalidade, cria tarefa de pagamento automaticamente.',
    '{"trigger_desc": "Mensagem da escola com boleto, mensalidade ou cobrança"}',
    '{"action_desc": "Criar tarefa de pagamento com vencimento", "approval_level": "one_tap"}',
    1
  ),
  (
    'escola_aviso', 'escola', 'Aviso escolar importante',
    'Avisos da escola com reunião, entrega de documento ou prazo ficam no topo da Caixa com lembrete.',
    '{"trigger_desc": "Aviso da escola sobre reunião, evento, prazo ou circular"}',
    '{"action_desc": "Criar lembrete com data e prioridade alta", "approval_level": "one_tap"}',
    2
  ),
  (
    'escola_reuniao', 'escola', 'Reunião de pais',
    'Convocação para reunião de pais cria automaticamente um evento no calendário da família.',
    '{"trigger_desc": "Convocação para reunião de pais, responsáveis ou conselho escolar"}',
    '{"action_desc": "Criar evento no calendário da família", "approval_level": "one_tap"}',
    3
  ),
  (
    'escola_lista_material', 'escola', 'Lista de material escolar',
    'Lista de material enviada pela escola vira tarefa de compras com prazo.',
    '{"trigger_desc": "Lista de material escolar enviada pela escola ou professora"}',
    '{"action_desc": "Criar tarefa de compras com itens da lista e prazo", "approval_level": "explicit"}',
    4
  ),
  (
    'saude_consulta', 'saude', 'Consulta médica confirmada',
    'Confirmação de consulta médica cria evento no calendário com lembrete 1 dia antes.',
    '{"trigger_desc": "Mensagem confirmando consulta, exame ou procedimento médico"}',
    '{"action_desc": "Criar evento médico no calendário com lembrete 1 dia antes", "approval_level": "one_tap"}',
    10
  ),
  (
    'saude_receita', 'saude', 'Receita e medicação',
    'Mensagem com receita médica ou medicação cria tarefa de comprar remédio ou renovar receita.',
    '{"trigger_desc": "Mensagem com receita médica, prescrição, medicação ou farmácia"}',
    '{"action_desc": "Criar tarefa de farmácia com prazo e detalhes da receita", "approval_level": "one_tap"}',
    11
  ),
  (
    'saude_retorno', 'saude', 'Retorno e acompanhamento médico',
    'Indicação de retorno ou check-up é agendada automaticamente no calendário.',
    '{"trigger_desc": "Indicação de retorno médico, check-up anual ou acompanhamento"}',
    '{"action_desc": "Criar evento de retorno médico no calendário", "approval_level": "one_tap"}',
    12
  ),
  (
    'diarista_cancelamento', 'diarista', 'Cancelamento da diarista',
    'Quando a diarista cancelar, a Vesta pergunta se quer reagendar ou encontrar cobertura.',
    '{"trigger_desc": "Mensagem da diarista cancelando, desmarcando ou não podendo vir"}',
    '{"action_desc": "Notificar e sugerir reagendamento ou cobertura emergencial", "approval_level": "explicit"}',
    20
  ),
  (
    'diarista_confirmacao', 'diarista', 'Confirmação da diarista',
    'Confirmação de visita fica registrada no calendário sem precisar fazer nada.',
    '{"trigger_desc": "Mensagem da diarista confirmando visita, horário ou presença"}',
    '{"action_desc": "Registrar confirmação no calendário silenciosamente", "approval_level": "soft"}',
    21
  ),
  (
    'diarista_suprimentos', 'diarista', 'Suprimentos para limpeza',
    'Pedido de produto de limpeza da diarista vira tarefa de compra automática.',
    '{"trigger_desc": "Diarista pedindo produto de limpeza, material ou suprimento"}',
    '{"action_desc": "Criar tarefa de compras com o item solicitado", "approval_level": "one_tap"}',
    22
  ),
  (
    'casa_compras', 'casa', 'Lista de compras',
    'Mensagem com item em falta em casa vira tarefa na lista de compras da semana.',
    '{"trigger_desc": "Mensagem mencionando item em falta, acabou ou necessidade de compra"}',
    '{"action_desc": "Adicionar à lista de compras da semana", "approval_level": "soft"}',
    30
  ),
  (
    'casa_manutencao', 'casa', 'Manutenção e conserto',
    'Problema em casa mencionado no WhatsApp vira tarefa de manutenção com prioridade.',
    '{"trigger_desc": "Mensagem sobre problema, conserto, vazamento ou manutenção em casa"}',
    '{"action_desc": "Criar tarefa de manutenção com descrição do problema", "approval_level": "one_tap"}',
    31
  ),
  (
    'casa_entrega', 'casa', 'Entrega e encomenda',
    'Confirmação de entrega ou encomenda cria lembrete para receber ou retirar o pacote.',
    '{"trigger_desc": "Mensagem sobre entrega, encomenda saiu para entrega ou rastreamento"}',
    '{"action_desc": "Criar lembrete de entrega com prazo e detalhes", "approval_level": "one_tap"}',
    32
  ),
  (
    'casa_conta', 'casa', 'Conta e boleto doméstico',
    'Boleto ou conta de serviço (água, luz, internet) cria tarefa de pagamento com vencimento.',
    '{"trigger_desc": "Boleto ou conta de serviço doméstico (água, luz, gás, internet, condomínio)"}',
    '{"action_desc": "Criar tarefa de pagamento com vencimento", "approval_level": "one_tap"}',
    33
  )
ON CONFLICT (slug) DO NOTHING;
