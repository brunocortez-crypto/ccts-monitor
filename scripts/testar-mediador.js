/**
 * Teste do critério de aceite §8.2:
 * CNPJ 17.219.585/0001-38 (FECCOEMG), tipo Convenção Coletiva, vigência Vigentes
 * -> 13 convenções. Conferido na mão no site em 17/09/2026.
 *
 * Serve para responder, antes de investir na rodada inteira, se o reCAPTCHA v3
 * deixa passar o navegador automatizado.
 *
 * Uso:  node scripts/testar-mediador.js [--visivel]
 */
import { chromium } from 'playwright';
import { consultarCnpj, UA_NAVEGADOR, VIGENCIA, TIPO } from './lib/mediador.js';

const CNPJ = '17219585000138';
const ESPERADO = 13;
const visivel = process.argv.includes('--visivel');

console.log(`Consultando ${CNPJ} (FECCOEMG), tipo = Convenção Coletiva, vigência = Vigentes`);
console.log(`Navegador: ${visivel ? 'visível' : 'headless'}\n`);

const navegador = await chromium.launch({ headless: !visivel });
const contexto = await navegador.newContext({
  userAgent: UA_NAVEGADOR,
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1366, height: 900 }
});
const page = await contexto.newPage();

let saida = 0;
try {
  const inicio = Date.now();
  const r = await consultarCnpj(page, CNPJ, { vigencia: VIGENCIA.VIGENTES, tipo: TIPO.CONVENCAO });
  const seg = ((Date.now() - inicio) / 1000).toFixed(1);

  console.log(`total declarado pelo site .... ${r.total_declarado}`);
  console.log(`instrumentos extraídos ....... ${r.instrumentos.length}`);
  console.log(`páginas percorridas .......... ${r.paginas}`);
  console.log(`tempo ........................ ${seg}s\n`);

  for (const i of r.instrumentos.slice(0, 5)) {
    console.log(`  ${i.nr_registro_mte}  ${i.nr_solicitacao}  ${i.tipo}`);
    console.log(`    vigência: ${i.vigencia.inicio} a ${i.vigencia.fim}`);
    console.log(`    partes: ${i.partes.join(' x ').slice(0, 90)}`);
  }
  if (r.instrumentos.length > 5) console.log(`  ... mais ${r.instrumentos.length - 5}`);

  const problemas = [];
  if (r.total_declarado !== ESPERADO) {
    problemas.push(`site declarou ${r.total_declarado}, esperava ${ESPERADO}`);
  }
  if (r.instrumentos.length !== r.total_declarado) {
    problemas.push(
      `extraí ${r.instrumentos.length} mas o site declarou ${r.total_declarado} — ` +
      'paginação incompleta'
    );
  }
  if (r.instrumentos.some((i) => !i.nr_solicitacao || !i.nr_registro_mte)) {
    problemas.push('algum instrumento veio sem nº de solicitação ou de registro');
  }
  const foraDoTipo = r.instrumentos.filter((i) => !/conven[çc][ãa]o coletiva/i.test(i.tipo || ''));
  if (foraDoTipo.length) {
    problemas.push(
      `${foraDoTipo.length} instrumento(s) que não são Convenção Coletiva: ` +
      [...new Set(foraDoTipo.map((i) => i.tipo))].join(', ')
    );
  }

  if (problemas.length) {
    console.error('\nACEITE FALHOU:');
    for (const p of problemas) console.error(`  - ${p}`);
    console.error(
      '\nSe o site mudou o número, confira na mão em ' +
      'https://mediador.trabalho.gov.br/sistemas/mediador/ConsultarInstColetivo'
    );
    saida = 1;
  } else {
    console.log(`\nACEITE OK: ${r.instrumentos.length} instrumentos, íntegros.`);
    console.log('O reCAPTCHA v3 aceitou o navegador automatizado.');
  }
} catch (erro) {
  console.error(`\nFALHOU: ${erro.message}`);
  console.error('\nSe for timeout na busca, o reCAPTCHA v3 provavelmente barrou por score.');
  console.error('Tente com janela visível:  node scripts/testar-mediador.js --visivel');
  saida = 1;
} finally {
  await navegador.close();
}

process.exit(saida);
