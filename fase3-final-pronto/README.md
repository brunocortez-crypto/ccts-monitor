# 🤖 CCT Monitor — Fase 3: Bot de Busca Automática

## O que é?

Um **bot automático** que busca CCTs (Convenções Coletivas de Trabalho) em:
1. **MTE/Mediador** — portal oficial do governo
2. **Websites dos 63 sindicatos** — busca direta nos sites
3. **Scraping inteligente** — detecta PDFs e documentos relevantes

## 📋 Como funciona?

```
EXECUÇÃO (todo dia 20, 08:00 - BRT)
    ↓
Acessa MTE para cada CNPJ de sindicato
    ↓
Raspa os 63 sites dos sindicatos
    ↓
Procura por PDFs de CCT e documentos
    ↓
Compara com achados anteriores
    ↓
Detecta o que é NOVO
    ↓
Salva em data/ccts-encontradas.json
    ↓
Envia email (opcional)
    ↓
Dashboard atualiza automaticamente
```

## 🚀 Como rodar (GitHub Actions)

### 1. Push do código para GitHub

```bash
git add .
git commit -m "Fase 3: Bot v2.0 - MTE + Scraping"
git push origin main
```

### 2. Ir em GitHub Actions

```
https://github.com/brunocortez-crypto/ccts-monitor/actions
```

### 3. Clicar em "Busca Automática de CCTs" → "Run workflow"

### 4. Aguardar ~5-10 minutos

O bot vai:
- Verificar os 63 sindicatos
- Buscar no MTE
- Raspar os sites
- Salvar resultados em `data/ccts-encontradas.json`
- Fazer commit automático

### 5. Ver resultados no dashboard

```
https://ccts-monitor.vercel.app → aba "🤖 Achados do Robô"
```

## 🔧 Configuração (OPCIONAL)

### Email automático (quando encontrar CCTs novas)

Se quiser receber alertas por email:

1. GitHub → Settings → Secrets and variables → Actions → New secret

2. Adicione 3 secrets:
   - `GMAIL_USER` = seu email Gmail
   - `GMAIL_APP_PASSWORD` = [senha de app Google](https://myaccount.google.com/apppasswords)
   - `EMAIL_DESTINO` = para qual email enviar alertas

**Pronto!** Quando o bot encontrar CCTs, você recebe email! 📧

## 📂 Estrutura de arquivos

```
ccts-monitor/
├── .github/workflows/
│   └── busca-mensal.yml          ← agendador (dia 20, 08:00)
├── scripts/
│   └── buscar-ccts.js            ← o bot (v2.0)
├── data/
│   ├── sindicatos.json           ← 63 sindicatos
│   ├── ccts-encontradas.json     ← resultados do bot
│   └── log-execucoes.json        ← histórico de execuções
└── index.html                    ← dashboard com aba do robô
```

## 🔍 Como o bot busca

### MTE/Mediador
- Acessa: `https://www3.mte.gov.br/sistemas/mediador/`
- Busca por CNPJ de cada sindicato
- Extrai PDFs de CCTs encontradas

### Website dos Sindicatos
- Acessa cada um dos 63 sites
- Procura por:
  - PDFs com palavras-chave (CCT, convenção, acordo, reajuste, piso)
  - Menção de anos (2026, 2025, etc)
  - Links internos relevantes
- Máximo 15 resultados por site (evita sobrecarga)

### Detecção de Novidades
- Compara URLs com achados anteriores
- Só salva o que é NEW

## 💾 Dados salvos

Cada achado tem:

```json
{
  "id": "achado_1234567_abc",
  "sindicato": "SECUA",
  "titulo": "CCT Comércio Uberlândia 2026",
  "url": "https://example.com/cct.pdf",
  "resumo": "PDF encontrado no site do sindicato",
  "fonte": "Site do sindicato",
  "piso": "R$ 1.620,00",        // detectado automaticamente
  "reajuste": "8%",               // detectado automaticamente
  "dataDescoberta": "2026-07-20",
  "status": "Revisar"             // você valida depois
}
```

## ⚙️ Agendamento automático

**Dia:** 20 de cada mês  
**Horário:** 08:00 UTC = 05:00 Brasília (verão) / 06:00 Brasília (inverno)

Para mudar, edite `.github/workflows/busca-mensal.yml`:

```yaml
schedule:
  - cron: '0 11 20 * *'  # minuto hora dia mês dia-da-semana (UTC)
```

## 🆘 Troubleshooting

**"O bot rodou mas não achou nada"**
- Normal! MTE às vezes demora a indexar
- Pode estar fora do período de busca
- Deixa rodar por alguns dias

**"Erro de timeout no site X"**
- Site pode estar lento ou indisponível
- Bot tenta de novo no próximo ciclo (dia 20)
- Não é problema

**"Email não chegou"**
- Verifica se as 3 secrets foram adicionadas corretamente
- Revisa o GMAIL_APP_PASSWORD (pode expirar)
- Confere spam/lixo eletrônico

## 📊 Métricas

Cada execução gera log:

```json
{
  "data": "2026-07-20T11:30:00.000Z",
  "sindicatosVerificados": 63,
  "novosAchados": 5,
  "totalAcumulado": 127
}
```

## 🔐 Segurança

- ✅ Sem dependência do Google Custom Search (complicado)
- ✅ Nenhuma chave de API armazenada em código
- ✅ Secrets guardadas no GitHub (criptografadas)
- ✅ Requests com timeout (evita travamento)
- ✅ Sem armazenamento de dados sensíveis

## 📝 Logs

Ver logs da execução:

1. GitHub → Actions → Busca Automática de CCTs
2. Clique no workflow que rodou
3. Clique em "Executar bot de busca"
4. Veja a saída em tempo real

## 🚀 Próximas melhorias

- [ ] Extrair dados de PDFs (requer API)
- [ ] Alertas por Telegram
- [ ] Dashboard com gráficos de reajustes
- [ ] Histórico de mudanças por sindicato

## 📞 Suporte

Qualquer dúvida, me avisa! 

---

**Versão:** 2.0 (sem Google Custom Search)  
**Última atualização:** 21/07/2026
