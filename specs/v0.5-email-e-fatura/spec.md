# v0.5 — transações por e-mail, leitura da fatura do Inter e correções (#1)

## Problema
1. A fatura do Inter em PDF mostra um total errado. O layout atual imprime "Total da sua fatura" com o
   valor na linha de baixo, e a regra não acha. Sem o total impresso, o app estimava pela soma dos
   lançamentos, **descontando o crédito do pagamento da fatura anterior** (ex.: despesas de R$ 10 mil
   menos o pagamento de R$ 9,9 mil viravam uma fatura de algumas centenas de reais).
2. E-mails transacionais dos bancos (compra aprovada, Pix, transferência) são ignorados.
3. Bugs de robustez achados na revisão (ver issue #1).

## Comportamento esperado

### Fatura do Inter (PDF)
- Total, nesta ordem: soma das linhas "Total CARTÃO ****NNNN"; cabeçalho (cartão · vencimento · valor);
  "Total da sua fatura" **na mesma linha**; "Despesas do mês". Só sem nada disso estima. (Não olha a linha
  de baixo de "Total da sua fatura": no layout atual o pdfjs põe ali o limite de crédito.)
- A estimativa soma as compras e desconta só créditos que não são pagamento de fatura (estorno etc.).
- Conferência por cartão: a soma das compras lidas tem que bater com o "Total CARTÃO" impresso
  (aceita também compras − estornos). Se não bater, vira **aviso** (prévia e fatura do e-mail).
- No e-mail, o total impresso no PDF ganha do valor achado no texto do e-mail.

### Transações por e-mail
- Remetente de banco conhecido (lista `BANCOS`, domínio ancorado em `@`/`.`) + assunto de transação
  (compra, Pix, transferência, TED, pagamento, boleto, débito automático, saque, comprovante, estorno)
  **que diga que aconteceu** (aprovada, enviado, recebido, realizada, efetuado, comprovante…). Fora
  propaganda ("Pix no crédito: pague em 12x"), fatura e o que não aconteceu (recusada, bloqueada,
  não realizado, agendado, suspeita).
- Extração por regras: valor (ignora limite/saldo disponível; parcelada → valor da parcela, que é o que
  o extrato mostra), sentido (entrada se recebeu/estorno/devolução), descrição (estabelecimento ou
  contraparte), final do cartão e data/hora. IA só quando falta o valor, e o valor da IA só vale se
  aparecer no texto com os centavos.
- Vira um registro pendente na tabela `carteira` (`origem = 'email'`), igual à Carteira do iPhone:
  conta no resumo até o extrato chegar, e concilia com o lançamento de mesmo valor e sentido
  (data −1/+3 dias). A mesma compra avisada por dois caminhos (Carteira e e-mail, ou dois bancos) não
  entra duas vezes; do mesmo caminho, valor igual no mesmo dia conta duas (compras repetidas de verdade).
- Entradas pendentes somam nas entradas do mês. Painel: lista na tela Faturas, com remoção.
- Busca IMAP incremental: varre `email_dias` ao iniciar e depois só desde a última leitura (−2 dias);
  envelopes em lote, corpo baixado só de e-mail de banco ainda não visto.
- **Carregar histórico** (botão na tela Faturas): a caixa inteira, em segundo plano com progresso.
  Filtra no servidor IMAP por palavras inteiras do assunto (o Gmail não acha pedaço de palavra). Sem IA
  para transações (centenas de avisos levariam horas), sem evento/aviso no celular, e fatura antiga
  sem pagamento achado no extrato (vencida há mais de 5 dias) entra como paga.

### Avisos no celular
- Fatura nova achada no e-mail → `notify.<serviço>` do dono da conta do cartão (ou de todos os
  perfis com aviso, se a fatura não tem conta).

### Build (v0.5.1, #3)
- O Dockerfile não declara `# syntax=docker/dockerfile:1`: a diretiva baixa o frontend do BuildKit do Docker
  Hub, e a versão atual quebra na VM do HA ("frontend grpc server closed unexpectedly", mesma família do SIGILL
  da v0.3.1). Só recursos que o frontend embutido entende (multi-stage, `COPY --from`).

## Fora do escopo
- Novos layouts de PDF além do Inter. Conciliação por conta/cartão (segue só por valor e data).

## Tarefas
- [x] Issue #1, spec
- [x] Correções da revisão (server, config, Dockerfile, higiene)
- [x] Fatura Inter: totais, conferência, avisos, precedência no e-mail
- [x] E-mails transacionais: classificação, extração, IA, carteira, conciliação, resumo, tela
- [x] Carga do histórico
- [x] Testes com dados sintéticos (repo público: nada real em fixture)
