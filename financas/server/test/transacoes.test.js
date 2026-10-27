import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ehTransacao, extrairTransacao, extrairTransacaoComIa } from '../src/transacoes.js';
import { textoDoEmail } from '../src/email.js';
import { abrirBanco } from '../src/db.js';
import { importar, registrarCarteira, resumo } from '../src/servico.js';
import { bancoDoRemetente } from '../src/faturas.js';

// Textos inventados no formato típico dos avisos dos bancos.
const RECEBIDO = '2026-10-26T22:43:00Z';
const diaDoRecebido = new Date(Date.parse(RECEBIDO) - new Date(RECEBIDO).getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

test('reconhece aviso de transação e descarta propaganda, fatura e o que não aconteceu', () => {
  for (const s of ['Compra aprovada no cartão final 4321', 'Você recebeu um Pix', 'Comprovante de transferência', 'Pix enviado com sucesso',
    'Estorno realizado', 'Compra estornada', 'Pix devolvido', 'Pagamento de boleto realizado', 'Débito automático efetuado', 'Transferência recebida']) assert.ok(ehTransacao(s), s);
  for (const s of ['Sua fatura chegou', 'Compra recusada', 'Aproveite: cashback nas compras', 'Recebemos seu pagamento',
    'Novidades do app', 'Pix agendado para amanhã', 'Seu limite aumentou',
    // propaganda e tentativas que falharam com palavras de transação (achados da revisão)
    'Pix no crédito: pague em até 12x', 'Saque-Aniversário FGTS', 'Novo: Pix Automático', 'Seguro Pix por R$ 3,90/mês',
    'Suas compras internacionais com IOF zero', 'Transação suspeita? Saiba como se proteger', 'Compra não autorizada',
    'Saldo insuficiente para a compra', 'Pix não realizado', 'Compra bloqueada', 'Agendamento de Pix', 'Faça seu primeiro depósito']) assert.ok(!ehTransacao(s), s);
});

test('remetente: domínio do banco ancorado, sem pegar winter.co, graffiti, nomadcoffee ou tabb', () => {
  assert.equal(bancoDoRemetente('Banco Inter <no-reply@inter.co>').id, 'inter');
  assert.equal(bancoDoRemetente('BB <aviso@bb.com.br>').id, 'bb');
  for (const r of ['Loja <vendas@winter.co.uk>', 'X <a@printer.co>', 'Arte <oi@graffiti.com>', 'Café <oi@nomadcoffee.com>', 'Y <a@tabb.com.br>']) {
    assert.equal(bancoDoRemetente(r), null, r);
  }
});

test('estorno e devolução são entrada; compra parcelada fica com o valor da parcela', () => {
  assert.equal(extrairTransacao('Compra estornada', 'O estorno de R$ 59,90 da compra em LOJA X foi feito.', RECEBIDO).entrada, true);
  assert.equal(extrairTransacao('Pix devolvido', 'Seu Pix de R$ 20,00 foi devolvido.', RECEBIDO).entrada, true);
  assert.equal(extrairTransacao('Compra aprovada', 'Compra de R$ 1.200,00 em 10x de R$ 120,00 em LOJA X aprovada.', RECEBIDO).valor, 120);
  assert.equal(extrairTransacao('Compra aprovada', 'Compra de R$ 900,00 parcelada em 3x em LOJA X aprovada.', RECEBIDO).valor, 300);
  for (const corpo of ['Valor: R$ 1.200,00\nParcelas: 10x de R$ 120,00', 'Compra de R$ 1.200,00 (10x de R$ 120,00) aprovada.',
    'Compra de R$ 1.200,00 dividida em 10x aprovada.', 'Compra de R$ 1.200,00 - 10x de R$ 120,00 aprovada.']) {
    assert.equal(extrairTransacao('Compra aprovada', corpo, RECEBIDO).valor, 120, corpo);
  }
  for (const corpo of ['COMPRA DE R$ 1.200,00 EM 10X NA LOJA X APROVADA', 'COMPRA DE R$ 1.200,00 EM 10X COM JUROS APROVADA']) {
    assert.equal(extrairTransacao('Compra aprovada', corpo, RECEBIDO).valor, 120, corpo);
  }
  // "Parcela: 3/10" é qual parcela, não em quantas: o valor fica.
  for (const corpo of ['Valor: R$ 120,00\nParcela: 3/10', 'Valor: R$ 120,00\nParcela: 3 de 10', 'Valor: R$ 120,00\nParcelas: 3/10']) {
    assert.equal(extrairTransacao('Compra aprovada', corpo, RECEBIDO).valor, 120, corpo);
  }
  // Loja que começa com "3X" não é parcela; propaganda de parcelamento no rodapé não mexe no valor.
  assert.equal(extrairTransacao('Compra aprovada', 'Compra de R$ 50,00 em 3X SPORTS LTDA aprovada.', RECEBIDO).valor, 50);
  assert.equal(extrairTransacao('Pix enviado', 'Você enviou um Pix de R$ 120,00 para FULANO. Sabia que dá pra parcelar Pix no crédito em 12x?', RECEBIDO).valor, 120);
  assert.equal(extrairTransacao('Compra aprovada', 'Compra de R$ 300,00 em LOJA X aprovada. Pague sua fatura em 10 vezes no app.', RECEBIDO).valor, 300);
  assert.equal(extrairTransacao('Compra aprovada', 'Compra de R$ 45,00 em LOJA X aprovada. Parcele em 10x de R$ 99,90!', RECEBIDO).valor, 45);
});

test('compra no cartão: valor ignora o limite, estabelecimento, final e hora da compra', () => {
  const t = extrairTransacao('Compra aprovada',
    'Olá! Seu limite disponível é R$ 3.000,00. Uma compra de R$ 1.234,56 no cartão final 4321 foi aprovada em 26/10/2026 às 19:42 em LOJA EXEMPLO LTDA. Obrigado.', RECEBIDO);
  assert.deepEqual(t, { valor: 1234.56, entrada: false, descricao: 'LOJA EXEMPLO LTDA', cartao_final: '4321', quando: '2026-10-26T19:42:00' });
});

test('Pix recebido: entrada, quem mandou e data sem ano', () => {
  const t = extrairTransacao('Você recebeu um Pix', 'Você recebeu um Pix de R$ 250,00 de MARIA EXEMPLO em 25/10.\nSaldo disponível: R$ 1.000,00', RECEBIDO);
  assert.equal(t.valor, 250);
  assert.equal(t.entrada, true);
  assert.equal(t.descricao, 'MARIA EXEMPLO');
  assert.equal(t.quando, '2026-10-25T12:00:00');
});

test('comprovante em HTML com rótulos em tabela', () => {
  const html = '<table><tr><td>Valor</td><td>R$ 89,90</td></tr><tr><td>Pagador</td><td>FULANO</td></tr><tr><td>Destinatário</td><td>JOAO EXEMPLO</td></tr>'
    + '<tr><td>Data</td><td>24/10/2026 - 08:15</td></tr></table>';
  const t = extrairTransacao('Comprovante de Pix', textoDoEmail({ html }), RECEBIDO);
  assert.deepEqual(t, { valor: 89.9, entrada: false, descricao: 'JOAO EXEMPLO', cartao_final: null, quando: '2026-10-24T08:15:00' });
  // Data longe do recebimento (ex.: e-mail antigo citado) não vale: fica o dia do recebimento.
  assert.equal(extrairTransacao('Compra aprovada', 'Compra de R$ 10,00 em 05/01/2026 aprovada.', RECEBIDO).quando.slice(0, 10), diaDoRecebido);
});

test('IA para o valor: só vale número que existe no e-mail', async () => {
  const falsa = resp => async () => ({ texto: resp, origem: 'teste' });
  const txt = 'Transação concluída. Total: 57,30 reais no mercado.';
  assert.deepEqual(await extrairTransacaoComIa(txt, falsa('{"valor":"57,30","sentido":"saida","descricao":"Mercado"}'), {}), { valor: 57.3, entrada: false, descricao: 'Mercado' });
  assert.equal((await extrairTransacaoComIa(txt, falsa('{"valor":"999,00","sentido":"saida"}'), {})).valor, null);
  assert.equal((await extrairTransacaoComIa(txt, falsa('não sei'), {})).valor, null);
  // Só a parte inteira não basta: ano e protocolo também são números do texto.
  const comNumeros = 'Pix realizado em 26/10/2026. Protocolo 8812345.';
  assert.equal((await extrairTransacaoComIa(comNumeros, falsa('{"valor":"2026,00"}'), {})).valor, null);
  assert.equal((await extrairTransacaoComIa(comNumeros, falsa('{"valor":"8812,34"}'), {})).valor, null);
});

test('aviso do e-mail fica pendente, não duplica a Carteira e concilia com o extrato (entrada e saída)', () => {
  const db = abrirBanco(mkdtempSync(join(tmpdir(), 'fin-')));
  const conta = Number(db.prepare("INSERT INTO contas (nome, tipo, dono) VALUES ('Conta','corrente','Fulano')").run().lastInsertRowid);
  assert.ok(registrarCarteira(db, { valor: 250, entrada: true, loja: 'MARIA EXEMPLO', quando: '2026-10-25T12:00:00', origem: 'email', banco: 'Nubank' }));
  assert.ok(registrarCarteira(db, { valor: 42, loja: 'PADARIA', quando: '2026-10-25T10:00:00' }));
  // A mesma compra avisada também pelo e-mail do banco não entra de novo.
  assert.equal(registrarCarteira(db, { valor: 42, loja: 'PADARIA X', quando: '2026-10-25T10:01:00', origem: 'email' }), null);
  // Dois bancos avisando a mesma compra (carteira digital + cartão): uma vez só. Mesmo banco, mesmo valor: duas compras.
  assert.ok(registrarCarteira(db, { valor: 30, loja: 'LOJA', quando: '2026-10-24T10:00:00', origem: 'email', banco: 'Mercado Pago' }));
  assert.equal(registrarCarteira(db, { valor: 30, loja: 'LOJA', quando: '2026-10-24T10:00:00', origem: 'email', banco: 'Inter' }), null);
  assert.ok(registrarCarteira(db, { valor: 30, loja: 'LOJA', quando: '2026-10-24T15:00:00', origem: 'email', banco: 'Mercado Pago' }));
  db.prepare('DELETE FROM carteira WHERE valor = 30').run();

  let r = resumo(db, '2026-10');
  assert.deepEqual([r.carteiraPendente.total, r.entradasPendentes.total], [42, 250]);

  const imp = importar(db, { contaId: conta, arquivo: 'x.csv', formato: 'csv', linhas: [
    { data: '2026-10-26', descricao: 'PIX RECEBIDO MARIA', valor: 250 }, { data: '2026-10-25', descricao: 'PADARIA', valor: -42 }] });
  assert.equal(imp.conciliados, 2);
  r = resumo(db, '2026-10');
  assert.deepEqual([r.carteiraPendente.n, r.entradasPendentes.n], [0, 0]);
  assert.equal(r.entradas, 250);
});
