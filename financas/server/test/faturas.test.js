import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectarBanco, extrairResumo, extrairComIa, completarAno, contaDoBanco, conciliarFaturas, resumoFaturas } from '../src/faturas.js';
import { abrirBanco } from '../src/db.js';
import { importar } from '../src/servico.js';

const RECEBIDO = '2026-10-27T12:00:00Z';

test('reconhece o banco pelo remetente e só e-mails de fatura', () => {
  assert.equal(detectarBanco({ remetente: 'Nubank <todomundo@nubank.com.br>', assunto: 'A fatura do seu cartão fechou' }).id, 'nubank');
  assert.equal(detectarBanco({ remetente: 'Banco Inter <no-reply@inter.co>', assunto: 'Sua fatura está disponível' }).id, 'inter');
  assert.equal(detectarBanco({ remetente: 'Itaú <faturadigital@itau.com.br>', assunto: 'Fatura do cartão final 1234' }).id, 'itau');
  assert.equal(detectarBanco({ remetente: 'Nubank <x@nubank.com.br>', assunto: 'Parcele sua fatura com desconto' }), null);
  assert.equal(detectarBanco({ remetente: 'Nubank <x@nubank.com.br>', assunto: 'Recebemos seu pagamento da fatura' }), null);
  assert.equal(detectarBanco({ remetente: 'Loja <x@loja.com>', assunto: 'Sua fatura chegou' }), null);
  assert.equal(detectarBanco({ remetente: 'Nubank <x@nubank.com.br>', assunto: 'Novidades do app' }), null);
});

test('valor e vencimento em textos típicos', () => {
  assert.deepEqual(extrairResumo('A fatura do seu cartão de crédito fechou no valor de R$ 1.234,56 e vence dia 15/11.', RECEBIDO),
    { valor: 1234.56, vencimento: '2026-11-15', cartao_final: null });
  assert.deepEqual(extrairResumo('Fatura do cartão final 4321 disponível.\nValor total da fatura: R$ 2.345,67\nVencimento: 20/11/2026', RECEBIDO),
    { valor: 2345.67, vencimento: '2026-11-20', cartao_final: '4321' });
  assert.deepEqual(extrairResumo('Sua fatura de novembro: total a pagar R$ 980,00. Data de vencimento 10 de novembro de 2026.', RECEBIDO),
    { valor: 980, vencimento: '2026-11-10', cartao_final: null });
});

test('vencimento sem ano vira o próximo, e data absurda é descartada', () => {
  assert.equal(completarAno(5, 1, null, '2026-12-20T10:00:00Z'), '2027-01-05');
  assert.equal(completarAno(28, 12, null, '2026-12-20T10:00:00Z'), '2026-12-28');
  assert.equal(extrairResumo('Fatura de R$ 100,00 com vencimento em 10/03/2024', RECEBIDO).vencimento, null);
});

test('IA: aceita só número que existe no e-mail', async () => {
  const falsa = resp => async () => ({ texto: resp, origem: 'teste' });
  const txt = 'Sua fatura ficou em R$ 1.500,00, pagável até o dia 12/11.';
  assert.deepEqual(await extrairComIa(txt, RECEBIDO, falsa('{"valor":"1500,00","vencimento":"12/11/2026"}'), {}), { valor: 1500, vencimento: '2026-11-12', origem: 'teste' });
  const inventado = await extrairComIa(txt, RECEBIDO, falsa('{"valor":"9999,99","vencimento":"12/11/2026"}'), {});
  assert.equal(inventado.valor, null);
  assert.equal((await extrairComIa(txt, RECEBIDO, falsa('não sei'), {})).valor, null);
});

test('acha a conta do cartão e concilia o pagamento', () => {
  const db = abrirBanco(mkdtempSync(join(tmpdir(), 'fin-')));
  const cartao = Number(db.prepare("INSERT INTO contas (nome, tipo, dono, banco) VALUES ('Inter cartão','cartao','Daniel','Inter')").run().lastInsertRowid);
  const corrente = Number(db.prepare("INSERT INTO contas (nome, tipo, dono, banco) VALUES ('Inter conta','corrente','Daniel','Inter')").run().lastInsertRowid);
  assert.equal(contaDoBanco(db, { id: 'inter', nome: 'Inter' }), cartao);
  assert.equal(contaDoBanco(db, { id: 'nubank', nome: 'Nubank' }), null);

  db.prepare("INSERT INTO faturas (mensagem_id, banco, recebido_em, valor, vencimento) VALUES ('m1','Inter','2026-10-27T12:00:00Z',1234.56,'2026-11-10')").run();
  let r = resumoFaturas(db, '2026-10-30');
  assert.equal(r.proxima.dias, 11);
  assert.equal(r.total, 1234.56);

  importar(db, { contaId: corrente, linhas: [{ data: '2026-11-09', descricao: 'Pagamento fatura cartão Inter', valor: -1234.56 }], arquivo: 'x', formato: 'csv' });
  assert.equal(conciliarFaturas(db), 1);
  assert.equal(db.prepare("SELECT status FROM faturas WHERE mensagem_id = 'm1'").get().status, 'paga');
  assert.equal(resumoFaturas(db, '2026-11-10').proxima, null);
});
