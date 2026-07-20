# 📋 CCTS Monitor

**Sistema de Monitoramento Automático de Convenções Coletivas de Trabalho**

Desenvolvido para: **Escritorial Contadores e Associados** — Uberlândia/MG

---

## 🎯 O que é

Sistema web que monitora automaticamente **63 sindicatos** em busca de novas CCTs (Convenções Coletivas de Trabalho) todos os **dias 20 do mês, às 08:00**.

### ✨ Funcionalidades

- ✅ **Seletor de mês dinâmico** — clique e veja CCTs do período
- ✅ **Busca automática** — todo 20/mês, 08:00
- ✅ **Análises completas** — piso, vale-alimentação, obrigações, riscos
- ✅ **Gerenciar sindicatos** — adicione novos sem código
- ✅ **Log de verificação** — rastreie todas as buscas
- ✅ **Exportar em Word** — relatórios formatados
- ✅ **Compartilhável** — acesse de qualquer PC

---

## 🚀 Como usar

### **Passo 1: Clonar o repositório**

```bash
git clone https://github.com/brunocortez-crypto/ccts-monitor.git
cd ccts-monitor
```

### **Passo 2: Instalar dependências**

```bash
npm install
```

### **Passo 3: Executar localmente**

```bash
npm start
```

Abre automaticamente em: http://localhost:3000

### **Passo 4: Deploy no GitHub Pages**

```bash
npm run deploy
```

App fica disponível em: **https://brunocortez-crypto.github.io/ccts-monitor**

---

## 📊 Estrutura de Arquivos

```
ccts-monitor/
├── public/
│   └── index.html              # HTML principal
├── src/
│   ├── components/
│   │   ├── Header.jsx         # Cabeçalho
│   │   ├── MesSeletor.jsx     # Seletor de mês
│   │   ├── DashboardCCTs.jsx  # Dashboard principal
│   │   ├── Configuracoes.jsx  # Gerenciar sindicatos
│   │   └── LogVerificacao.jsx # Log de buscas
│   ├── data/
│   │   ├── sindicatos.json    # 63 sindicatos
│   │   ├── ccts-2026.json     # Histórico de CCTs
│   │   └── verificacoes.json  # Log de verificações
│   ├── App.jsx               # Componente principal
│   ├── App.css               # Estilos
│   └── index.jsx             # Entry point
├── scripts/
│   └── buscar-ccts.js         # Bot de busca automática
├── .github/
│   └── workflows/
│       └── busca-mensal.yml   # GitHub Actions
├── package.json
├── README.md
└── .gitignore
```

---

## 🤖 Como funciona a busca automática

### **Agendamento**

- **Dia**: 20 de cada mês
- **Hora**: 08:00 (UTC-3 Brasília = 05:00 AM)
- **Frequência**: Mensal
- **Local**: GitHub Actions (automático)

### **O que faz**

1. Verifica todos os 63 sindicatos monitorados
2. Busca por novas CCTs e aditivos
3. Detecta mudanças (piso, benefícios, obrigações)
4. Atualiza JSONs automaticamente
5. Faz commit no repositório
6. Dashboard se atualiza sozinho

### **Sem fazer nada**

O DP só abre o dashboard e vê tudo atualizado!

---

## 📝 Adicionar novo sindicato

1. Abra o app
2. Vá em **⚙️ Configurações**
3. Clique **➕ Novo Sindicato**
4. Preencha:
   - Nome completo
   - CNPJ
   - Data-base (ex: 15/01)
   - Categoria
5. Clique **Salvar**

Próxima busca automática incluirá este sindicato!

---

## 🔄 Mudar data da busca automática

Para mudar dia/hora, edite este arquivo:

`.github/workflows/busca-mensal.yml`

Linha:
```yaml
- cron: '0 8 20 * *'
         ↑ ↑ ↑
         │ │ └─ dia (20)
         │ └──── hora (8 = 08:00)
         └────── minuto (0)
```

**Exemplos:**
- `0 8 10 * *` — dia 10, 08:00
- `0 6 1 * *` — dia 1º, 06:00
- `0 8 1,15 * *` — dias 1º E 15

Depois faça `git push` e pronto!

---

## 📊 Dados iniciais

Vem carregado com:
- ✅ 5 sindicatos de exemplo
- ✅ 2 CCTs de exemplo (2026)
- ✅ 1 verificação de exemplo

Carregue seus dados:

1. Edite `src/data/sindicatos.json` (adicione seus 63)
2. Edite `src/data/ccts-2026.json` (adicione CCTs reais)
3. `git push`

---

## 💾 Backup & Exportar

### **Exportar dados**

1. Abra DevTools (F12)
2. Console → copie:
```javascript
localStorage.getItem('sindicatos')
localStorage.getItem('ccts')
```

3. Cole em um arquivo `.json` para backup

### **Importar dados**

1. Edite `src/data/sindicatos.json`
2. Adicione seus dados
3. `git push`

---

## 🐛 Troubleshooting

### Erro: `npm: command not found`
- Instale Node.js: https://nodejs.org/

### Erro: `git: command not found`
- Instale Git: https://git-scm.com/download/win

### App não atualiza
- Limpe cache: Ctrl+Shift+Delete
- Ou abra em aba anônima

### Busca automática não rodou
- Verifique: **Actions** no GitHub
- Veja logs da execução

---

## 📧 Email automático (opcional)

Para receber email quando novas CCTs forem encontradas:

1. Configure SendGrid: https://sendgrid.com/ (100 emails/dia grátis)
2. Adicione credenciais em `.env`:
```
SENDGRID_API_KEY=sua_chave
EMAIL_NOTIFICACAO=seu_email@empresa.com
```
3. Edite `scripts/buscar-ccts.js` para enviar email

---

## 🚀 Próximos passos

- [ ] Integrar API Claude para análise automática de PDFs
- [ ] Enviar email com relatório quando encontrar novas CCTs
- [ ] Bot Telegram para notificações
- [ ] Dashboard com gráficos de reajustes
- [ ] Comparativo histórico (YoY)
- [ ] Alertas de prazos críticos

---

## 📞 Suporte

Problemas? Dúvidas?

- Revise este README
- Verifique a aba **Issues** no GitHub
- Abra uma nova Issue: https://github.com/brunocortez-crypto/ccts-monitor/issues

---

## 📄 Licença

Privado — Uso exclusivo Escritorial Contadores e Associados

---

**Versão**: 1.0.0  
**Última atualização**: Julho 2026  
**Status**: ✅ Pronto para produção
