/**
 * Procura, nos 87 documentos, os padrões de erro que a leitura manual revelou.
 *
 * Ler duas convenções rendeu três defeitos publicados. Ler as 85 restantes uma a
 * uma levaria dias; generalizar o que a leitura ensinou e rodar nos 87 leva
 * segundos. Este script não substitui a leitura — aponta ONDE ler.
 *
 * Cada achado é uma suspeita com o trecho do documento junto, para conferência
 * humana. Nenhum é corrigido automaticamente: foi exatamente a correção
 * automática por heurística que criou os defeitos.
 *
 * Uso:  node scripts/auditar-extracao.js [--tema piso]
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

if (!existsSync('data/documentos.json')) {
  console.error('data/documentos.json não existe.');
  process.exit(1);
}

const documentos = JSON.parse(await readFile('data/documentos.json', 'utf8'));
const paraNumero = (v) => Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));

const achados = [];
const marcar = (d, tipo, detalhe, trecho = null) =>
  achados.push({ tipo, sigla: d.sindicato_sigla, registro: d.nr_registro_mte, detalhe, trecho });

for (const d of documentos) {
  const i = d.indicadores || {};
  const clausulas = (d.clausulas_titulos || []).join(' | ');

  /* 1. Piso preso a período que já passou.
     Caso SETH-TAP: a cláusula trazia jan-jun e jul-dez; o painel mostrava o
     primeiro semestre, já vencido. */
  const trechoPiso = (i.piso || []).map((p) => p.trecho).join(' ');
  if (/a partir de|at[ée]\s+\d{2}\/\d{2}|1º semestre|primeiro semestre|julho|junho/i.test(trechoPiso)
      && (i.piso_faixa || i.piso_mensal)) {
    const datas = [...trechoPiso.matchAll(/\d{1,2}º?\s+de\s+\w+\s+de\s+\d{4}|\d{2}\/\d{2}\/\d{4}/gi)]
      .map((m) => m[0]);
    if (datas.length >= 2) {
      marcar(d, 'piso-por-periodo',
        `a cláusula de piso cita ${datas.length} datas — o valor pode mudar no meio da vigência`,
        datas.slice(0, 4).join(' · '));
    }
  }

  /* 2. Piso muito distante do salário mínimo: pode ser piso de função sênior
     tomado como piso de ingresso, ou valor de outra natureza. */
  const piso = paraNumero(i.piso_mensal ?? i.piso_faixa?.min);
  if (Number.isFinite(piso) && piso > 3000) {
    marcar(d, 'piso-alto', `piso de R$ ${i.piso_mensal ?? i.piso_faixa?.min} — confirmar se é o de ingresso`);
  }

  /* 3. Reajuste implausível ou proporcional.
     Caso FECCOEMG: "3,90%" era só para admitidos até janeiro/2025; o resto da
     categoria tinha índices menores numa tabela. */
  const reaj = (i.reajuste || [])[0];
  if (reaj) {
    const n = paraNumero(reaj.valor);
    if (n > 25) marcar(d, 'reajuste-alto', `reajuste de ${reaj.valor}% — confirmar`, reaj.trecho);
    if (/propor|admiss|admitido|tabela|[íi]ndice/i.test(reaj.trecho || '')) {
      marcar(d, 'reajuste-proporcional',
        `reajuste de ${reaj.valor}% parece proporcional por mês de admissão`, reaj.trecho);
    }
  }

  /* 4. Benefício condicionado a adesão, certificado ou adimplência.
     Caso FECCOEMG: usar REPIS, banco de horas ou feriado sem Certificado de
     Adesão gera multa. Isso não aparece em nenhum indicador. */
  if (/certificado de ades[ãa]o|em dia com|adimpl/i.test(clausulas)) {
    marcar(d, 'condicionado-a-adesao',
      'há cláusula que exige certificado/adimplência para usar benefícios — quem não cumprir paga multa');
  }

  /* 5. Convenção sem piso reconhecível: não é erro, é lacuna a conferir. */
  if (!i.piso_mensal && !i.piso_faixa) {
    const temClausulaDePiso = /piso|sal[áa]rio/i.test(clausulas);
    marcar(d, temClausulaDePiso ? 'piso-nao-extraido' : 'sem-clausula-de-piso',
      temClausulaDePiso
        ? 'tem cláusula de salário mas nenhum valor foi extraído'
        : 'nenhuma cláusula de piso reconhecida');
  }

  /* 6. Documento com vigência vencida ainda marcado como vigente. */
  if (d.vigencia_fim && d.vigencia_fim < new Date().toISOString().slice(0, 10)) {
    marcar(d, 'vigencia-vencida', `vigência terminou em ${d.vigencia_fim}`);
  }
}

const filtro = process.argv.includes('--tema')
  ? process.argv[process.argv.indexOf('--tema') + 1] : null;
const lista = filtro ? achados.filter((a) => a.tipo.includes(filtro)) : achados;

const porTipo = {};
for (const a of lista) (porTipo[a.tipo] = porTipo[a.tipo] || []).push(a);

console.log(`${documentos.length} documentos auditados · ${lista.length} ponto(s) para conferir\n`);

const GRAVIDADE = {
  'piso-por-periodo': 'ALTA  ',
  'reajuste-proporcional': 'ALTA  ',
  'vigencia-vencida': 'ALTA  ',
  'piso-nao-extraido': 'média ',
  'piso-alto': 'média ',
  'reajuste-alto': 'média ',
  'condicionado-a-adesao': 'aviso ',
  'sem-clausula-de-piso': 'aviso '
};

for (const [tipo, itens] of Object.entries(porTipo)
  .sort((a, b) => (GRAVIDADE[a[0]] ?? 'z').localeCompare(GRAVIDADE[b[0]] ?? 'z'))) {
  console.log(`${GRAVIDADE[tipo] ?? '      '} ${tipo}  (${itens.length})`);
  for (const a of itens.slice(0, 6)) {
    console.log(`         ${String(a.sigla).padEnd(22).slice(0, 22)} ${a.registro}  ${a.detalhe}`);
    if (a.trecho) console.log(`           ${String(a.trecho).slice(0, 100)}`);
  }
  if (itens.length > 6) console.log(`         … mais ${itens.length - 6}`);
  console.log('');
}

console.log('Nenhum destes foi corrigido automaticamente: foi a correção por');
console.log('heurística que criou os defeitos que a leitura encontrou.\n');
