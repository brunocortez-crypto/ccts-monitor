# Monitor de CCTs

Acompanha as convenções e acordos coletivos dos sindicatos que atendem as empresas do
escritório. Duas fontes, porque elas divergem: o **Mediador do MTE**, onde o
instrumento é registrado, e o **site do próprio sindicato**, que às vezes publica antes
de homologar — ou publica algo que nunca é homologado.

Especificação técnica e levantamento do Mediador: [PROMPT-SISTEMA-CCT.md](PROMPT-SISTEMA-CCT.md).

## Como está montado

Só a busca precisa de navegador. O reCAPTCHA v3 do MTE protege a consulta; o download
do documento é GET puro. Essa divisão é o que torna o sistema viável.

| Estágio | Script | Precisa de navegador | Quando roda |
|---|---|---|---|
| 1 · Buscar no Mediador | `buscar-mediador.js` | **Sim** (Playwright) | dia 20, mensal |
| 2 · Baixar documentos | `coletar-documentos.js` | Não | depois do 1 |
| 3 · Sites dos sindicatos | `verificar-sites.js` | Não | depois do 1 |
| 4 · Painel | `index.html` | — | estático na Vercel |

O estágio 1 **não roda na Vercel**: serverless não sustenta navegador para 63 consultas
pausadas. Roda no GitHub Actions (`.github/workflows/rodada-mensal.yml`) ou na máquina
do escritório. A Vercel serve o painel.

## Instalar

```bash
npm install
npx playwright install chromium
```

## Usar

```bash
npm run importar     # planilha .xlsx -> data/sindicatos.json
npm run buscar       # estágio 1: Convenções Coletivas vigentes dos 63 CNPJs
npm run coletar      # estágio 2: baixa os documentos e extrai as cláusulas
npm run sites        # estágio 3: varre os sites dos sindicatos
npm run verificar    # confere se todo link aponta para documento de verdade
```

Ou a rodada inteira: `npm run rodada`

Durante o desenvolvimento, atalhos úteis:

```bash
node scripts/testar-mediador.js              # 1 consulta, confere o aceite (FECCOEMG = 17)
node scripts/buscar-mediador.js --limite 5   # amostra rápida
node scripts/buscar-mediador.js --sigla SECUA
node scripts/buscar-mediador.js --visivel    # abre a janela, para depurar
node scripts/verificar-links.js --url https://ccts-monitor.vercel.app
```

## Dados

Tudo versionado no repositório, em `data/`:

| Arquivo | O que guarda |
|---|---|
| `sindicatos.json` | os sindicatos monitorados, cada um com **lista** de data-bases |
| `sindicatos-extras.json` | incluídos fora da planilha |
| `sindicatos-ignorados.json` | tirados do monitoramento, com o motivo |
| `documentos.json` | instrumentos do MTE, chaveados por `nr_solicitacao` |
| `execucoes.json` | cada rodada, com o que falhou e por quê |
| `divergencias.json` | site publicou e o MTE não registrou |
| `sites.json` | o que foi encontrado em cada site |

Os arquivos baixados ficam em `docs/MTE/`.

## Incluir ou tirar um sindicato

A planilha manda nas linhas dela, mas não é a única fonte. `npm run importar`
reescreve `data/sindicatos.json` inteiro — então editar aquele arquivo na mão
funciona até alguém reimportar, e aí a alteração some sem avisar.

Use os dois arquivos que o importador respeita:

```bash
npm run sindicato -- --cnpj 12.345.678/0001-90 --sigla SINDXYZ   --nome "SINDICATO DOS ..." --uf MG --meses "Janeiro,Maio"

npm run sindicato -- --ignorar 00.000.000/0000-00 --motivo "CNPJ de preenchimento"

npm run sindicato -- --listar
```

Depois, `npm run importar` aplica. O painel tem um formulário na aba Sindicatos que
valida os campos e monta o comando pronto — ele não grava sozinho porque é um site
estático, e um formulário que fingisse salvar guardaria o dado no navegador de quem
digitou, invisível para todo mundo.

## Três coisas que este sistema existe para não repetir

**Um sindicato tem N data-bases, não uma.** A planilha veio do relatório "Relação
Sindical pela Data-Base", onde o sindicato aparece uma vez por data-base. 23 dos 63 têm
mais de uma; o SINDTTRANS tem quatro. Agrupar por CNPJ guardando só a primeira linha faz
o alerta dos outros meses nunca disparar — em silêncio.

**HTTP 500 no Mediador quer dizer "sem resultado".** Aceitar isso direto seria
perigoso: uma queda real do MTE viraria "nenhum sindicato tem convenção", e o painel
ficaria verde mentindo. Por isso existe o canário — ao receber 500, o sistema consulta
um CNPJ que sabidamente tem resultado antes de concluir qualquer coisa. E no fim da
rodada pergunta de novo: se o canário não responder, os vazios da última janela viram
falha, porque "sem convenção" e "não consegui verificar" são coisas diferentes.

**Piso só sai de cláusula de piso.** O extrator procura o valor dentro da cláusula
("PISO SALARIAL", "SALÁRIO DA CATEGORIA", "SALÁRIO NORMATIVO"), nunca no documento
inteiro. Varrer o documento trazia cobertura de seguro de vida (R$ 26.744,14) e
auxílio funeral como se fossem piso. Quando não há cláusula reconhecível, o campo fica
vazio: 70 dos 87 têm piso. Número errado num campo de piso é pior que campo vazio,
porque alguém calcula folha com ele.

**Link quebrado tem que dar erro.** A versão anterior tinha 123 links apontando para
uma pasta que não existia; a Vercel respondia com o próprio painel e HTTP 200, e quem
clicava baixava a página achando que era a CCT. `npm run verificar` falha se qualquer
link responder `text/html`.
