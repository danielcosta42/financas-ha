import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerValor, lerData, lerCsvBruto, detectarDelimitador, sugerirPerfil, aplicarPerfil, lerOfx, decodificar, atribuirChaves } from '../src/parsers.js';
import { abrirBanco } from '../src/db.js';
import { importar, registrarCarteira, resumo, categorizar, recorrentes } from '../src/servico.js';

test('valores em formatos brasileiros e americanos', () => {
  assert.equal(lerValor('R$ 1.234,56'), 1234.56);
  assert.equal(lerValor('-87,90'), -87.9);
  assert.equal(lerValor('87.5'), 87.5);
  assert.equal(lerValor('1.234'), 1234);
  assert.equal(lerValor('(12,00)'), -12);
  assert.equal(lerValor('150,00 D'), -150);
  assert.equal(lerValor('1,234.56'), 1234.56);
  assert.equal(lerValor(''), null);
});

test('datas', () => {
  assert.equal(lerData('05/10/2026', 'dd/mm/yyyy'), '2026-10-05');
  assert.equal(lerData('2026-10-05', 'yyyy-mm-dd'), '2026-10-05');
  assert.equal(lerData('5/9/26', 'dd/mm/yy'), '2026-09-05');
  assert.equal(lerData('Saldo', 'dd/mm/yyyy'), null);
});

test('preset Nubank cartão inverte o sinal', () => {
  const csv = 'date,title,amount\n2026-10-01,iFood,45.90\n2026-10-02,Pagamento recebido,-500.00\n';
  const b = lerCsvBruto(csv, detectarDelimitador(csv));
  const p = sugerirPerfil(b);
  assert.equal(p.preset, 'nubank-cartao');
  const r = aplicarPerfil(b, p);
  assert.deepEqual(r.linhas.map(l => l.valor), [-45.9, 500]);
});

test('preset Nubank conta usa identificador', () => {
  const csv = 'Data,Valor,Identificador,Descrição\n01/10/2026,-30.00,abc-1,Transferência enviada pelo Pix - Fulano\n';
  const b = lerCsvBruto(csv, ',');
  const p = sugerirPerfil(b);
  assert.equal(p.preset, 'nubank-conta');
  const r = aplicarPerfil(b, p);
  assert.equal(r.linhas[0].id_externo, 'abc-1');
  assert.equal(r.linhas[0].valor, -30);
});

test('CSV genérico com ponto e vírgula, cabeçalho deslocado, latin1 e débito/crédito', () => {
  const txt = 'Extrato conta corrente\nAgência 1234 Conta 5678\nData;Histórico;Débito;Crédito;Saldo\n02/10/2026;PAG BOLETO ENEL;150,00;;1.000,00\n03/10/2026;PIX RECEBIDO;;2.500,00;3.500,00\n03/10/2026;SALDO DO DIA;;;3.500,00\n';
  const buf = Buffer.from(txt, 'latin1');
  const t = decodificar(buf);
  assert.ok(t.includes('Histórico'));
  const b = lerCsvBruto(t, detectarDelimitador(t));
  const p = sugerirPerfil(b);
  assert.equal(p.linhaCabecalho, 2);
  assert.equal(p.colValor, -1);
  const r = aplicarPerfil(b, p);
  assert.deepEqual(r.linhas.map(l => [l.data, l.valor]), [['2026-10-02', -150], ['2026-10-03', 2500]]);
});

test('OFX', () => {
  const ofx = `OFXHEADER:100\n<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003120000[-3:BRT]<TRNAMT>-23.50<FITID>X1<MEMO>PADARIA</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261004<TRNAMT>100.00<FITID>X2<NAME>PIX</STMTTRN></BANKTRANLIST></OFX>`;
  const l = lerOfx(ofx);
  assert.equal(l.length, 2);
  assert.deepEqual(l[0], { data: '2026-10-03', descricao: 'PADARIA', valor: -23.5, id_externo: 'X1' });
});

test('chaves: lançamentos idênticos no mesmo arquivo não colidem', () => {
  const ls = atribuirChaves([{ data: '2026-10-01', descricao: 'Café', valor: -8 }, { data: '2026-10-01', descricao: 'Café', valor: -8 }]);
  assert.notEqual(ls[0].chave, ls[1].chave);
});

test('reimportar o mesmo extrato não duplica e a Carteira é conciliada', () => {
  const db = abrirBanco(mkdtempSync(join(tmpdir(), 'fin-')));
  const conta = Number(db.prepare("INSERT INTO contas (nome, tipo, dono) VALUES ('Nubank','cartao','Daniel')").run().lastInsertRowid);
  registrarCarteira(db, { valor: '45.9', loja: 'IFOOD', quando: '2026-10-01T12:00:00-03:00' });
  const linhas = [{ data: '2026-10-02', descricao: 'iFood *Restaurante', valor: -45.9 }, { data: '2026-10-02', descricao: 'Uber Trip', valor: -22 }];
  const a = importar(db, { contaId: conta, linhas, arquivo: 'a.csv', formato: 'csv' });
  assert.equal(a.novos, 2);
  assert.equal(a.conciliados, 1);
  const b = importar(db, { contaId: conta, linhas, arquivo: 'a.csv', formato: 'csv' });
  assert.equal(b.novos, 0);
  assert.equal(b.duplicados, 2);
  const r = resumo(db, '2026-10');
  assert.equal(r.saidas, 67.9);
  assert.equal(r.carteiraPendente.n, 0);
  const cats = Object.fromEntries(r.porCategoria.map(c => [c.categoria, c.total]));
  assert.equal(cats.Delivery, 45.9);
  assert.equal(cats.Transporte, 22);
});

test('Inter conta: preset lê Histórico como detalhe e a regra vê os dois', () => {
  const csv = 'Extrato Conta Corrente\nConta ;123\nPeríodo ;01/09/2026 a 30/09/2026\nSaldo ;1.000,00\nData Lançamento;Histórico;Descrição;Valor;Saldo\n15/09/2026;Pix enviado ;Renato Coelho;-900,00;100,00\n14/09/2026;Pagamento efetuado;Receita Federal;-25,48;1000,00\n29/09/2026;Pix enviado ;;-100,00;0,00\n';
  const bruto = lerCsvBruto(csv, ';');
  const perfil = sugerirPerfil(bruto);
  assert.equal(perfil.preset, 'inter-conta');
  const { linhas } = aplicarPerfil(bruto, perfil);
  assert.equal(linhas.length, 3);
  assert.equal(linhas[0].descricao, 'Renato Coelho');
  assert.equal(linhas[0].detalhe, 'Pix enviado');
  assert.equal(linhas[0].valor, -900);
  assert.equal(linhas[2].descricao, 'Sem descrição');
});

test('Inter cartão: compra positiva vira saída', () => {
  const csv = '"Data","Lançamento","Categoria","Tipo","Valor"\n"05/10/2026","IFOOD *RESTAURANTE","RESTAURANTES","Compra à vista","R$ 45,90"\n"10/10/2026","PAGAMENTO ON LINE","OUTROS","Pagamento","-R$ 1.234,56"\n';
  const bruto = lerCsvBruto(csv, ',');
  const perfil = sugerirPerfil(bruto);
  assert.equal(perfil.preset, 'inter-cartao');
  const { linhas } = aplicarPerfil(bruto, perfil);
  assert.equal(linhas[0].valor, -45.9);
  assert.equal(linhas[0].detalhe, 'Compra à vista');
  assert.equal(linhas[1].valor, 1234.56);
});

test('regra: vence a que aparece primeiro; recorrentes acham cobrança repetida', () => {
  const db = abrirBanco(mkdtempSync(join(tmpdir(), 'fin-')));
  assert.equal(categorizar(db, 'iFood *Restaurante'), db.prepare("SELECT id FROM categorias WHERE nome='Delivery'").get().id);
  assert.equal(categorizar(db, 'Pagamento Fatura - DANIEL'), db.prepare("SELECT id FROM categorias WHERE nome='Pagamento de fatura'").get().id);
  const conta = Number(db.prepare("INSERT INTO contas (nome, tipo, dono) VALUES ('Inter','corrente','Daniel')").run().lastInsertRowid);
  const linhas = ['2026-09-01', '2026-09-08', '2026-09-15'].map(d => ({ data: d, descricao: 'Raconveniencia        Ubatuba      Bra', valor: -14.99 }));
  importar(db, { contaId: conta, linhas, arquivo: 'x.csv', formato: 'csv' });
  const rec = recorrentes(db, '2026-10-01');
  assert.equal(rec.length, 1);
  assert.equal(rec[0].vezes, 3);
});
