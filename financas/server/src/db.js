import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CATEGORIAS_PADRAO = [
  // [nome, grupo, cor, fora_do_total]
  ['Mercado', 'Casa', '#4ff0c9', 0],
  ['Delivery', 'Alimentação', '#ffb86b', 0],
  ['Restaurantes', 'Alimentação', '#ffb86b', 0],
  ['Moradia', 'Casa', '#7fb2ff', 0],
  ['Contas da casa', 'Casa', '#7fb2ff', 0],
  ['Transporte', 'Transporte', '#b18cff', 0],
  ['Saúde', 'Pessoal', '#ff7a7a', 0],
  ['Lazer', 'Pessoal', '#ff4fd8', 0],
  ['Assinaturas', 'Pessoal', '#ff4fd8', 0],
  ['Compras', 'Pessoal', '#ffe38a', 0],
  ['Pets', 'Casa', '#4ff0c9', 0],
  ['Educação', 'Pessoal', '#7fb2ff', 0],
  ['Impostos', 'Ferion', '#ffb86b', 0],
  ['Salário e pró-labore', 'Entradas', '#4ff0c9', 0],
  ['Outras entradas', 'Entradas', '#4ff0c9', 0],
  ['Transferência entre contas', 'Movimentação', '#8089a7', 1],
  ['Pagamento de fatura', 'Movimentação', '#8089a7', 1],
  ['Investimentos', 'Movimentação', '#8089a7', 1],
  ['Seguros e tarifas', 'Pessoal', '#8089a7', 0],
];

const REGRAS_PADRAO = [
  ['ifood', 'Delivery'], ['rappi', 'Delivery'], ['ze delivery', 'Delivery'],
  ['uber', 'Transporte'], ['99app', 'Transporte'], ['99 tecnologia', 'Transporte'], ['posto', 'Transporte'], ['estapar', 'Transporte'],
  ['netflix', 'Assinaturas'], ['spotify', 'Assinaturas'], ['youtube', 'Assinaturas'], ['amazon prime', 'Assinaturas'], ['disney', 'Assinaturas'], ['apple.com', 'Assinaturas'], ['claude.ai', 'Assinaturas'], ['openai', 'Assinaturas'],
  ['pao de acucar', 'Mercado'], ['carrefour', 'Mercado'], ['assai', 'Mercado'], ['hirota', 'Mercado'], ['st marche', 'Mercado'], ['oba hortifruti', 'Mercado'],
  ['drogasil', 'Saúde'], ['droga raia', 'Saúde'], ['drogaria', 'Saúde'], ['petz', 'Pets'], ['cobasi', 'Pets'],
  ['aluguel', 'Moradia'], ['condominio', 'Moradia'], ['iptu', 'Moradia'], ['enel', 'Contas da casa'], ['sabesp', 'Contas da casa'], ['comgas', 'Contas da casa'], ['claro', 'Contas da casa'], ['vivo', 'Contas da casa'],
  ['pagamento de fatura', 'Pagamento de fatura'], ['pagamento recebido', 'Pagamento de fatura'], ['pgto fatura', 'Pagamento de fatura'],
  ['aplicacao', 'Investimentos'], ['resgate', 'Investimentos'], ['das simples', 'Impostos'], ['darf', 'Impostos'],
  ['pagamento fatura', 'Pagamento de fatura'], ['receita federal', 'Impostos'], ['resgate pontos', 'Outras entradas'], ['cashback', 'Outras entradas'],
  ['seguro pix', 'Seguros e tarifas'], ['seguro cartao', 'Seguros e tarifas'], ['protecao financeira', 'Seguros e tarifas'], ['tarifa', 'Seguros e tarifas'],
  ['lanchonete', 'Restaurantes'], ['restaurante', 'Restaurantes'], ['padaria', 'Restaurantes'], ['oxxo', 'Mercado'], ['minuto pa', 'Mercado'], ['conveniencia', 'Mercado'],
  ['amazon', 'Compras'], ['mercadolivre', 'Compras'], ['mercado livre', 'Compras'], ['shopee', 'Compras'], ['metro', 'Transporte'],
];

export function abrirBanco(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'financas.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS pessoas (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'pessoa' CHECK (tipo IN ('pessoa','casa','empresa')),
      cor TEXT,
      renda_mensal REAL,
      dia_recebimento INTEGER,
      regime TEXT,
      meta_poupanca REAL,
      notificar TEXT,
      arquivada INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contas (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'corrente' CHECK (tipo IN ('corrente','cartao','outro')),
      dono TEXT NOT NULL,
      banco TEXT,
      perfil_json TEXT,
      arquivada INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      grupo TEXT,
      cor TEXT,
      fora_do_total INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS regras (
      id INTEGER PRIMARY KEY,
      padrao TEXT NOT NULL,
      categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS importacoes (
      id INTEGER PRIMARY KEY,
      conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      arquivo TEXT,
      formato TEXT,
      novos INTEGER NOT NULL DEFAULT 0,
      duplicados INTEGER NOT NULL DEFAULT 0,
      de TEXT, ate TEXT,
      quem TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lancamentos (
      id INTEGER PRIMARY KEY,
      conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      descricao TEXT NOT NULL,
      valor REAL NOT NULL,
      categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
      chave TEXT NOT NULL,
      id_externo TEXT,
      origem TEXT NOT NULL DEFAULT 'import',
      importacao_id INTEGER REFERENCES importacoes(id) ON DELETE SET NULL,
      nota TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (conta_id, chave)
    );
    CREATE INDEX IF NOT EXISTS idx_lanc_data ON lancamentos(data);
    CREATE TABLE IF NOT EXISTS carteira (
      id INTEGER PRIMARY KEY,
      valor REAL NOT NULL,
      loja TEXT,
      cartao TEXT,
      quando TEXT NOT NULL,
      lancamento_id INTEGER REFERENCES lancamentos(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migrar(db);

  const n = db.prepare('SELECT COUNT(*) AS n FROM categorias').get().n;
  if (n === 0) {
    const ins = db.prepare('INSERT INTO categorias (nome, grupo, cor, fora_do_total) VALUES (?,?,?,?)');
    for (const c of CATEGORIAS_PADRAO) ins.run(...c);
    const idDe = db.prepare('SELECT id FROM categorias WHERE nome = ?');
    const insR = db.prepare('INSERT INTO regras (padrao, categoria_id) VALUES (?,?)');
    for (const [p, c] of REGRAS_PADRAO) insR.run(p, idDe.get(c).id);
  }
  return db;
}

// v0.3: detalhe (ex.: "Pix enviado" no Inter), sugestão da IA e comentários do mês.
function migrar(db) {
  const cols = db.prepare('PRAGMA table_info(lancamentos)').all().map(c => c.name);
  const add = (nome, tipo) => { if (!cols.includes(nome)) db.exec(`ALTER TABLE lancamentos ADD COLUMN ${nome} ${tipo}`); };
  add('detalhe', 'TEXT');
  add('sugestao_categoria_id', 'INTEGER REFERENCES categorias(id) ON DELETE SET NULL');
  add('sugestao_de', 'TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS comentarios (
    mes TEXT PRIMARY KEY,
    texto TEXT NOT NULL,
    origem TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  // Categoria nova padrão (bases antigas não têm).
  if (db.prepare('SELECT COUNT(*) AS n FROM categorias').get().n > 0) {
    db.prepare("INSERT OR IGNORE INTO categorias (nome, grupo, cor, fora_do_total) VALUES ('Seguros e tarifas','Pessoal','#8089a7',0)").run();
  }
}

const CORES = ['#7fb2ff', '#ff4fd8', '#4ff0c9', '#ffb86b', '#b18cff', '#ffe38a'];
const NOTIFICAR_PADRAO = { Daniel: 'mobile_app_iphone_de_daniel', Naomi: 'mobile_app_naomi' };

// Garante os perfis: os nomes das opções do add-on, Casa e Ferion, e qualquer dono de conta antigo.
export function semearPessoas(db, nomes) {
  const ins = db.prepare('INSERT OR IGNORE INTO pessoas (nome, tipo, cor, notificar) VALUES (?,?,?,?)');
  const vazia = db.prepare('SELECT COUNT(*) AS n FROM pessoas').get().n === 0;
  if (vazia) {
    nomes.forEach((n, i) => ins.run(n, 'pessoa', CORES[i % CORES.length], NOTIFICAR_PADRAO[n] || null));
    ins.run('Casa', 'casa', '#4ff0c9', null);
    ins.run('Ferion', 'empresa', '#ffb86b', null);
  }
  for (const { dono } of db.prepare('SELECT DISTINCT dono FROM contas').all()) ins.run(dono, 'pessoa', '#8089a7', null);
}

export function transacao(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
