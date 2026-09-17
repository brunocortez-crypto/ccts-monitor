# Prompt — Monitor de CCTs do escritório (Mediador MTE + sites dos sindicatos)

> Cole este arquivo inteiro como primeira mensagem para o agente que vai construir o sistema.
> A seção "Fatos verificados" foi levantada na mão em 17/09/2026 contra o Mediador em produção.
> **Não é suposição. Não refaça essa investigação — construa em cima dela.**

---

## 1. Contexto

Sou desenvolvedor de um escritório de contabilidade. Preciso saber quando sai uma convenção
ou acordo coletivo novo dos sindicatos que atendem as empresas do meu escritório — **só
desses**, que estão numa planilha minha, não do Brasil inteiro.

Duas fontes, porque elas divergem:

1. **Mediador do MTE** — onde o instrumento é registrado oficialmente.
2. **Site do próprio sindicato** — às vezes publica o documento antes de homologar no MTE,
   ou publica algo que nunca é homologado. Esse descompasso é exatamente o que eu preciso
   enxergar.

O sistema é **interno**. Não precisa de domínio, login público nem multi-tenant. Já existe
host na Vercel para o painel.

## 2. Fonte de dados dos sindicatos

`C:\Users\bruno\OneDrive\Desktop\Convenções\Sindicatos_Data_Base (2).xlsx`

- Aba **`Sindicatos`**: 109 linhas × 8 colunas
  (`Sindicato`, `Mês da Data-Base`, `Sigla`, `Entidade`, `CNPJ`, `Município`, `Estado`, `Site`)
- Aba **`Sindicatos únicos`**: 63 linhas, sem a coluna de mês
- **63 CNPJs distintos.** As 109 linhas repetem CNPJ porque a planilha veio do relatório
  cadastral "Relação Sindical pela Data-Base" — um sindicato aparece **uma vez por data-base**.

> **Requisito de modelagem, não detalhe:** um sindicato tem **N data-bases**, não uma.
> SINDTTRANS tem quatro (janeiro, março, maio, dezembro). 23 dos 63 têm mais de uma.
> Deduplicar por CNPJ guardando só a primeira linha **perde meses de alerta silenciosamente** —
> foi o que aconteceu na versão anterior, que ficou com 40 sindicatos e um mês cada.
> Modele `sindicato (1) ──< (N) data_base`.

## 3. Fatos verificados sobre o Mediador

Endereço: `https://mediador.trabalho.gov.br/sistemas/mediador/ConsultarInstColetivo`

### 3.1 Não é o sistema velho que aparenta

Apesar da cara de 2005, **não é ASP.NET WebForms** — não existe `__VIEWSTATE` nem
`__EVENTVALIDATION`. É uma SPA em jQuery que conversa com uma **API JSON**. A versão é
`3.3.1` no rodapé.

### 3.2 Cloudflare exige User-Agent

`curl` sem `User-Agent` de navegador → **HTTP 403**.
Com `User-Agent` de Chrome → **HTTP 200**.

Não há desafio de JavaScript nem interstitial. É só o header.

### 3.3 Endpoint de busca

```
POST /sistemas/mediador/ConsultarInstColetivo/getConsultaAvancada
Content-Type: application/json; charset=UTF-8
X-Requested-With: XMLHttpRequest
Referer: https://mediador.trabalho.gov.br/sistemas/mediador/ConsultarInstColetivo
```

Corpo (campos exatos que a página monta):

```json
{
  "nrCnpj": "17219585000138",
  "nrCei": "",
  "noRazaoSocial": "",
  "dsCategoria": "",
  "tpRequerimento": ["acordo", "convencao", "termoAditivoAcordo", "termoAditivoConvecao"],
  "tpVigencia": "1",
  "sgUfDeRegistro": "",
  "dtInicioRegistro": "", "dtFimRegistro": "",
  "dtInicioVigenciaInstrumentoColetivo": "", "dtFimVigenciaInstrumentoColetivo": "",
  "tpAbrangencia": "", "dsTipoAbrangencia": "",
  "ufsAbrangidasTotalmente": "", "cdMunicipiosAbrangidos": "", "dsAbrangenciaTerritorial": "",
  "cdGrupo": "", "cdSubGrupo": "", "noTituloClausula": "",
  "utilizarSiracc": "",
  "excel": false,
  "pagina": "1",
  "qtdTotalRegistro": "-1",
  "recaptchaToken": "<token do reCAPTCHA v3>"
}
```

Existe também `getConsultaAvancadaClausula` (mesmo corpo) quando se filtra por cláusula.

### 3.4 reCAPTCHA v3, não v2

```html
<script src="https://www.google.com/recaptcha/api.js?render=6LdPnewrAAAAADM60VqWAyvhreJD6Jpyr1tORg6G"></script>
grecaptcha.execute('6LdPnewrAAAAADM60VqWAyvhreJD6Jpyr1tORg6G', { action: 'pesquisar' })
```

**v3 é invisível e baseado em score — não existe imagem para clicar.** Um navegador real
carrega a página, o script do Google roda sozinho e devolve o token. Verificado: o token
saiu no console e a consulta retornou resultado.

POST sem token, direto por `curl`: **HTTP 504 após ~16s**, de forma consistente. A origem
engole a requisição. Trate o token como obrigatório.

**Restrição de implementação:** o token tem que vir do reCAPTCHA rodando de verdade, na
página do MTE, dentro de um navegador de verdade. **Não use serviço de resolução de captcha,
fazenda de tokens, nem token forjado ou reaproveitado de outra sessão.** Se a abordagem com
navegador real não passar no score, pare e me avise — a saída aí é pedir acesso autorizado
ao MTE, não contornar o controle.

### 3.5 Download e texto integral são GET puro — sem token, sem sessão

Verificado com `curl` limpo, só com `User-Agent`:

```
GET /sistemas/mediador/Resumo/resumoVisualizarSalvarMsWordDoc?NrSolicitacao=MR000649/2026
    → HTTP 200 · 33.503 bytes · application/msword; charset=windows-1252

GET /sistemas/mediador/Resumo/ResumoVisualizar?NrSolicitacao=MR000649%2F2026
    → HTTP 200 · 34.182 bytes · text/html; charset=utf-8
```

**Esta é a chave da arquitetura.** O reCAPTCHA protege só a *busca*. Assim que você tem o
`NrSolicitacao`, baixar o documento e ler o texto integral é HTTP comum.

### 3.6 O `.doc` é HTML disfarçado

`Content-Type: application/msword`, mas o conteúdo começa com
`<html xmlns:o='urn:schemas-microsoft-com:office:office'>`. **Não precisa de parser de .doc.**
Remova as tags e você tem o texto.

Cuidados reais, medidos no arquivo baixado:
- Encoding **windows-1252**, não UTF-8.
- Entidades HTML no meio das palavras: `CL&#193;USULA`, `VIG&#202;NCIA`. Rode
  `html.unescape` **depois** de tirar as tags, senão buscar `"CLÁUSULA"` retorna zero e você
  conclui errado que o documento não tem cláusulas.

O extrato traz: número de registro MTE, data de registro, nº da solicitação, nº do processo,
data do protocolo, partes com CNPJ, vigência e as cláusulas com título e corpo.

### 3.7 Armadilhas do formulário

| Armadilha | O que acontece se ignorar |
|---|---|
| `chkNRCNPJ` precisa estar marcado | O campo de CNPJ é ignorado e a busca volta o país inteiro |
| `tpVigencia` é `"0"`/`"1"`/`"2"` | `"vigente"` dispara "O campo Vigência é de preenchimento obrigatório" |
| `tpVigencia` é obrigatório | Sem ele a busca nem sai |
| `termoAditivoConvecao` | Está **escrito errado na API do MTE**. Se você "corrigir" para `termoAditivoConvencao`, o filtro volta vazio, sem erro |
| Resultado é paginado | "Página 1 de 2" — pagine até o fim ou perca metade |
| `excel: true` no payload | Modo alternativo de exportação; investigue, pode substituir a paginação |

Valores de `tpVigencia`: `2`=Todos, `1`=Vigentes, `0`=Não Vigentes.

Valores de `tpRequerimento`: `acordo`, `acordoColetivoEspecificoPPE`,
`acordoColetivoEspecificoDomingosFeriados`, `convencao`, `termoAditivoAcordo`,
`termoAditivoConvecao`, `termoAditivoAcordoEspecificoPPE`,
`termoAditivoAcordoEspecificoDomingoFeriado`.

## 4. Arquitetura pedida

Separe o que precisa de navegador do que não precisa. Só o **Estágio 1** precisa.

```
ESTÁGIO 1 — Busca (navegador real, Playwright)
  63 CNPJs · 1× por mês · abre o Mediador, deixa o reCAPTCHA v3 rodar, submete
  → lista de instrumentos por sindicato (NrSolicitacao, registro, tipo, vigência, partes)

ESTÁGIO 2 — Coleta (HTTP puro, sem navegador)
  para cada NrSolicitacao novo: GET do .doc + GET do ResumoVisualizar
  → arquivo salvo + texto limpo + cláusulas extraídas (piso, reajuste %, benefícios)

ESTÁGIO 3 — Sites dos sindicatos (HTTP puro)
  usa a coluna `Site` da planilha · procura link de CCT/CCT 2026/convenção
  → marca "publicado no site mas sem registro no MTE" (o descompasso que eu quero ver)

ESTÁGIO 4 — Painel (estático na Vercel)
  lê os JSONs versionados · por data-base do mês, por sindicato, por divergência
```

**Onde cada coisa roda:**

- Estágio 1 **não roda na Vercel.** Serverless não sustenta navegador para 63 consultas
  pausadas. Rode em **GitHub Actions** com Playwright, agendado, ou localmente na minha máquina.
- Estágios 2 e 3 rodam em qualquer lugar — são `fetch`.
- A Vercel serve **só o painel estático**, lendo os JSONs do repositório.

**Volume e educação com o serviço público:** 63 consultas por mês. Serialize, com pausa de
alguns segundos entre elas. Nada de paralelismo. Nada de re-baixar documento que já está em
disco — compare por `NrSolicitacao`.

## 5. Modelo de dados

Quatro arquivos JSON versionados no repositório, um array cada:

- `sindicatos.json` — 63 registros, cada um com **lista** de data-bases
- `documentos.json` — um por instrumento; chave natural é `NrSolicitacao`
- `execucoes.json` — log de cada rodada: quando, quantos consultados, quantos novos, **quais falharam e por quê**
- `divergencias.json` — o que o site do sindicato tem e o MTE não, e vice-versa

`documentos.json` deve guardar, por item: `nr_solicitacao`, `nr_registro_mte`, `tipo`,
`vigencia_inicio`, `vigencia_fim`, `partes[]`, `cnpj_sindicato`, `data_registro`,
`arquivo_local`, `texto_extraido`, `clausulas[]`, `descoberto_em`, `origem` (`mte` | `site`).

## 6. Material que já existe — leia antes de escrever código

- `C:\Users\bruno\OneDrive\Desktop\Sindicato\consulta-mediador-2026-07-21.json` — **rodada real
  bem-sucedida dos 63 CNPJs**: 46 OK, 16 sem instrumento vigente, 1 sem CNPJ, 573 documentos
  no total. Use como fixture de teste e como verdade de referência.
- `C:\Users\bruno\OneDrive\Desktop\Convenções\CCT_2026\` — 21 CCTs em `.docx` já baixadas,
  mais `Relatorio_Consolidado_CCT_2026-07.docx`, `ccts_ja_processadas.csv` e
  `lista_sindicatos_prioritarios.csv`.
- `C:\Users\bruno\OneDrive\Desktop\Convenções\Relatorios_Cadastrais_..._Relacao_Sindical_pela_Data_Base.pdf`
  — relatório que originou a planilha.
- Repositório atual: `github.com/brunocortez-crypto/ccts-monitor`, painel em
  `ccts-monitor.vercel.app`.

## 7. Estado atual do repositório — três defeitos a corrigir

1. **O bot está desligado do painel.** `scripts/buscar-ccts.js` grava
   `data/ccts-encontradas.json` e `data/log-execucoes.json`; o painel lê `documentos.json`,
   `sindicatos.json`, `status-sindicatos.json` e `logs.json`. A rodada de 20/08/2026 rodou e
   **não apareceu em lugar nenhum**.
2. **Os 123 links de download estão quebrados sem dar erro.** `data/documentos.json` aponta
   para `docs/MTE/...`, pasta que não existe no repositório. A Vercel devolve o próprio
   `index.html` com **HTTP 200** e `Content-Type: text/html` — quem clica baixa a página
   achando que é a CCT.
3. **Só 40 dos 63 sindicatos estão no ar**, cada um com um único mês de data-base (seção 2).

## 8. Critérios de aceite

Não considere pronto sem provar cada um:

1. `sindicatos.json` tem **63** sindicatos e a soma de data-bases é **109**.
2. Rodar o Estágio 1 devolve, para o CNPJ `17.219.585/0001-38` (FECCOEMG) com
   `tpVigencia="1"`, **17 instrumentos** — número conferido no site em 17/09/2026.
3. Baixar `MR000649/2026` produz arquivo cujo texto extraído contém `CESTAS ALIMENTAÇÃO`
   (com acento, depois do `html.unescape`).
4. Todo link de documento no painel responde com `Content-Type` de documento, **nunca**
   `text/html`. Teste com `curl -I` e falhe o build se voltar HTML.
5. `execucoes.json` registra os sindicatos que falharam, com motivo. Rodada sem nenhuma falha
   e com zero achados é um resultado legítimo — rodada que falha calada, não.
6. O painel, em novembro, lista o SINTICOMTAP (data-base janeiro **e** novembro).

## 9. Como trabalhar

- Pergunte antes de assumir. Se um endpoint se comportar diferente do descrito aqui, **me
  avise** em vez de contornar — a seção 3 foi medida, se divergiu é porque o MTE mudou.
- Prefira a correção de raiz. Este projeto já acumulou três falhas silenciosas; não empilhe a quarta.
- Nada de `try/catch` que engole erro e segue. Falha tem que aparecer no `execucoes.json` e no painel.
- Verifique antes de dizer que terminou. Rode, mostre a saída.
