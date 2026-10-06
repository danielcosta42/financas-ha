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
- Nenhuma senha de banco: só arquivos que vocês exportam.
- O banco fica em `/data/financas.sqlite`, que entra no backup do HA.
