# Finanças da casa — add-on do Home Assistant

App de finanças pessoais que roda dentro do Home Assistant, abre na barra lateral e guarda tudo num SQLite no próprio servidor.

## O que faz (v0.1)

- **Importa extratos** CSV e OFX de qualquer banco. Detecta delimitador, codificação, linha do cabeçalho e colunas; reconhece o Nubank (cartão e conta) sozinho. O mapeamento fica salvo por conta.
- **Não duplica**: reimportar um período que se sobrepõe só traz o que é novo.
- **Categoriza** com regras ("descrição contém …"); ao categorizar um lançamento, oferece criar a regra.
- **Concilia a Carteira do iPhone**: escuta o evento `financas_compra` do HA e casa a compra com o lançamento do extrato (mesmo valor, até 3 dias depois).
- **Resumo do mês**: saídas, entradas, por categoria, por dono (Daniel, Naomi, Casa, Ferion) e contas com extrato atrasado.
- **Sensores no HA**: `sensor.financas_saidas_do_mes`, `sensor.financas_entradas_do_mes`, `sensor.financas_sem_categoria`, `sensor.financas_ultima_importacao` (com `contas_atrasadas`).
- **Pasta de entrada** (opcional): `/share/financas/entrada/<Dono> - <Conta>/` — um arquivo solto ali é importado com o mapeamento salvo e movido para `importados/`.

## Novidades

- **v0.4 — faturas pelo e-mail**: lê a caixa de e-mail por IMAP (somente leitura) atrás das faturas dos cartões. Reconhece o banco pelo remetente (Inter, Nubank, Itaú, Bradesco, Santander, C6, BTG, XP, Mercado Pago, PicPay, Caixa, BB, Porto, Neon, Will, Pan, Sicredi, Nomad) e descarta propaganda e confirmação de pagamento. Valor e vencimento saem por regras; quando não acham, a IA da casa lê o texto, e o valor só é aceito se o número aparecer no e-mail. PDF anexo: guardado em `/share/financas/faturas`, e a fatura do Inter tem os lançamentos importados direto no cartão (quando há uma só conta de cartão daquele banco; senão escolhe na tela). PDF com senha: tenta as senhas de `pdf_senhas`. A fatura vira **paga** sozinha quando o extrato mostra o pagamento com o mesmo valor. Tela **Faturas**, sensor `sensor.financas_proxima_fatura` (atributos `vencimento`, `dias_para_vencer`, `abertas`, `total_em_aberto`) e evento `financas_fatura_nova` no HA.
  - Opções: `email_usuario` e `email_senha_de_app` (no Gmail, senha de app; nunca a senha da conta), `email_servidor` (imap.gmail.com), `email_pasta` (INBOX), `email_dias` (60), `email_intervalo_min` (30), `pdf_senhas`, `pasta_faturas`.
- **v0.3.1**: corrige o add-on caindo ao iniciar (exit 132) em CPUs sem AVX — o pacote nativo opcional do pdfjs não é mais instalado.
- **v0.3 — IA local**: depois de cada importação, a IA do HA (`ai_task`, Ollama por padrão) sugere categoria pros lançamentos sem regra, aprendendo com as categorias que vocês já usaram. Nada muda sozinho: a sugestão aparece na lista com ✓/×, e "Aceitar todas" cria regras pros estabelecimentos que se repetem. Comentário do mês gerado pela IA no Resumo (e no atributo `comentario` do sensor de saídas). Presets do **Inter** (conta e cartão, e a **fatura do cartão em PDF**, já que o app do Inter não exporta CSV do cartão: separa por cartão, marca parcela e lança a parcela no mês em que pesa), com o Histórico ("Pix enviado", "Compra no débito") guardado como detalhe e usado pelas regras. Card **Cobranças que se repetem** (mesmo valor 3+ vezes em 90 dias). Regras: vence a que aparece primeiro na descrição. Corrige uma recursão que derrubava o add-on quando o WebSocket do HA caía.
  - Opções: `ia_entidade` (padrão `ai_task.ollama_casa`), `ia_reserva` (usada se a primeira falhar), `ia_automatica`.
- **v0.2**: perfis com renda declarada, recebimento, regime, meta de poupança e aviso no celular.

## Instalar

1. No HA: **Configurações → Complementos → Loja de complementos → ⋮ → Repositórios** e adicione a URL deste repositório.
2. Instale **Finanças**, ative **Mostrar na barra lateral** e inicie. O primeiro build leva alguns minutos.
3. Abra **Finanças** na barra lateral → **Contas** → cadastre uma conta por extrato (conta corrente, cada cartão, conta da Ferion).
4. **Importar** → escolha a conta → solte o CSV/OFX → confira a prévia → importar.

## Desenvolvimento

```bash
cd financas/server && npm install && npm run dev      # API em :8099 (FINANCAS_DEV=1 libera acesso fora do ingress)
cd financas/web && npm install && npm run dev         # front em :5173 com proxy para a API
cd financas/server && npm test                        # parsers, deduplicação e conciliação
```

## Segurança

- Só aceita requisições do ingress do HA (172.30.32.2), então vale o login do HA.
- Nenhuma senha de banco: só arquivos que vocês exportam. O e-mail usa senha de app (revogável a qualquer momento) e é aberto em modo somente leitura.
- O banco fica em `/data/financas.sqlite`, que entra no backup do HA.
