
/**
 * Consulta ao Mediador do MTE.
 *
 * Levantamento em PROMPT-SISTEMA-CCT.md §3. O resumo que importa aqui:
 *
 *  - A BUSCA é protegida por reCAPTCHA v3 (invisível, por score). Precisa de navegador
 *    real: a página carrega o script do Google, ele gera o token sozinho e a busca sai.
 *    Não existe imagem para resolver. Nada de serviço de resolução de captcha.
 *  - O DOWNLOAD e o TEXTO INTEGRAL são GET puro, sem token e sem sessão — mas o
 *    Cloudflare gateia por reputação. Depois de algumas dezenas de requisições no
 *    mesmo dia ele passa a devolver 403 com desafio, e nem o cliente HTTP do
 *    Playwright passa (ele fingerprinta TLS). O que funciona é fazer o fetch de
 *    dentro da página. Ver coletar-documentos.js.
 */

export const URL_CONSULTA =
  'https://mediador.trabalho.gov.br/sistemas/mediador/ConsultarInstColetivo';

export const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Sem User-Agent de navegador o Cloudflare devolve 403. Medido. */
export const CABECALHOS_HTTP = {
  'User-Agent': UA_NAVEGADOR,
  'Accept-Language': 'pt-BR,pt;q=0.9'
};

/**
 * Valores do <select> de vigência. São numéricos.
 * Mandar "vigente" dispara "O campo Vigência é de preenchimento obrigatório".
 */
export const VIGENCIA = { NAO_VIGENTES: '0', VIGENTES: '1', TODOS: '2' };

/**
 * Valores do <select> de tipo de instrumento.
 *
 * Atenção ao TERMO_ADITIVO_CONVENCAO: "Convecao" está escrito errado na própria API
 * do MTE. Corrigir para "Convencao" faz o filtro voltar vazio, sem erro nenhum.
 *
 * O escritório monitora CONVENCAO. Acordo coletivo é negociação empresa a empresa e
 * não entra no escopo; deixar "todos os tipos" enche o painel de acordo de empresa
 * que ninguém vai ler.
 */
export const TIPO = {
  TODOS: '',
  ACORDO: 'acordo',
  ACORDO_PPE: 'acordoColetivoEspecificoPPE',
  ACORDO_DOMINGOS: 'acordoColetivoEspecificoDomingosFeriados',
  CONVENCAO: 'convencao',
  TERMO_ADITIVO_ACORDO: 'termoAditivoAcordo',
  TERMO_ADITIVO_CONVENCAO: 'termoAditivoConvecao',
  TERMO_ADITIVO_ACORDO_PPE: 'termoAditivoAcordoEspecificoPPE',
  TERMO_ADITIVO_ACORDO_DOMINGOS: 'termoAditivoAcordoEspecificoDomingoFeriado'
};

export function urlDocumento(nrSolicitacao) {
  return 'https://mediador.trabalho.gov.br/sistemas/mediador/Resumo/' +
    `resumoVisualizarSalvarMsWordDoc?NrSolicitacao=${nrSolicitacao}`;
}

export function urlResumo(nrSolicitacao) {
  return 'https://mediador.trabalho.gov.br/sistemas/mediador/Resumo/' +
    `ResumoVisualizar?NrSolicitacao=${encodeURIComponent(nrSolicitacao)}`;
}

export const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lê os resultados renderizados. Roda dentro da página.
 *
 * Cada resultado é um <tr indice="MR000649/2026"> dentro de #grdInstrumentos —
 * o nº da solicitação vem como atributo, que é a âncora estável. O resto sai do
 * texto por rótulo, porque o HTML é uma pilha de tabelas aninhadas.
 */
function extrairDaPagina() {
  const grade = document.querySelector('#grdInstrumentos');
  const corpo = document.body.innerText || '';

  const mTotal = corpo.match(/Resultado:\s*(\d+)\s*Instrumento/i);
  const mPag = corpo.match(/P[áa]gina\s*(\d+)\s*de\s*(\d+)/i);
  const semRegistro = /nenhum\s+(registro|instrumento)|n[ãa]o\s+(foram|foi)\s+encontrad/i.test(corpo);

  const depoisDe = (txt, rotulo) => {
    const re = new RegExp(rotulo + '\\s*\\n?\\s*([^\\n\\t]+)', 'i');
    const m = txt.match(re);
    return m ? m[1].trim() : null;
  };

  const instrumentos = [];
  for (const tr of grade ? grade.querySelectorAll('tr[indice]') : []) {
    const txt = (tr.innerText || '').replace(/ /g, ' ');

    const partes = [];
    const iPartes = txt.search(/\bPartes\b/i);
    if (iPartes !== -1) {
      const bloco = txt.slice(iPartes).replace(/^\s*Partes\s*/i, '');
      for (const linha of bloco.split('\n')) {
        const t = linha.replace(/\t/g, ' ').trim();
        if (!t) continue;
        if (/^(Download|Visualizar)/i.test(t)) break;
        partes.push(t);
      }
    }

    instrumentos.push({
      nr_solicitacao: tr.getAttribute('indice'),
      nr_registro_mte: depoisDe(txt, 'N[ºo°]\\s*do Registro'),
      tipo: depoisDe(txt, 'Tipo do Instrumento'),
      vigencia_texto: depoisDe(txt, 'Vig[êe]ncia'),
      partes
    });
  }

  return {
    total_declarado: mTotal ? Number(mTotal[1]) : null,
    pagina_atual: mPag ? Number(mPag[1]) : 1,
    paginas: mPag ? Number(mPag[2]) : 1,
    sem_registro: semRegistro && instrumentos.length === 0,
    instrumentos
  };
}

/** "01/11/2025 - 31/10/2026" -> { inicio: "2025-11-01", fim: "2026-10-31" } */
export function partirVigencia(texto) {
  const m = String(texto ?? '').match(
    /(\d{2})\/(\d{2})\/(\d{4})\s*[-–a]+\s*(\d{2})\/(\d{2})\/(\d{4})/
  );
  if (!m) return { inicio: null, fim: null, texto: texto ?? null };
  return {
    inicio: `${m[3]}-${m[2]}-${m[1]}`,
    fim: `${m[6]}-${m[5]}-${m[4]}`,
    texto
  };
}

async function esperarResposta(page, acao, { timeout = 90000 } = {}) {
  const esperaXhr = page
    .waitForResponse((r) => r.url().includes('getConsultaAvancada'), { timeout })
    .catch(() => null);
  await acao();
  const resp = await esperaXhr;
  // A resposta chega antes do DOM terminar de renderizar.
  await page.waitForTimeout(1200);
  return resp;
}

/**
 * Consulta um CNPJ e devolve todos os instrumentos, percorrendo as páginas.
 * Lança em caso de falha — quem chama decide se registra e segue.
 */
export async function consultarCnpj(page, cnpjDigitos, opcoes = {}) {
  return consultar(page, { cnpj: cnpjDigitos }, opcoes);
}

/**
 * Varredura por período de registro, SEM CNPJ.
 *
 * Descoberta em 17/09/2026: o Mediador aceita buscar só por "Período do Registro",
 * devolvendo tudo que foi registrado no país naquela janela — ~12 convenções por
 * dia. É assim que os serviços comerciais cobrem 18 mil sindicatos sem consultar
 * 18 mil CNPJs.
 *
 * Vantagem sobre a busca por CNPJ: não depende de como o MTE indexa as partes, então
 * pega convenção de sindicato que a busca por CNPJ não encontra. O resultado traz só
 * o NOME das partes; para casar com a carteira do escritório é preciso baixar o
 * extrato, que traz os CNPJs.
 *
 * Datas no formato dd/mm/aaaa.
 */
export async function consultarPorPeriodo(page, de, ate, opcoes = {}) {
  return consultar(page, { periodo: { de, ate } }, opcoes);
}

async function consultar(page, filtros, opcoes = {}) {
  const {
    vigencia = VIGENCIA.VIGENTES,
    tipo = TIPO.CONVENCAO,
    timeout = 90000,
    pausaPagina = 2500
  } = opcoes;

  await page.goto(URL_CONSULTA, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForSelector('#btnPesquisar', { timeout });
  // O script do reCAPTCHA precisa estar de pé antes do clique.
  await page.waitForFunction(() => typeof window.grecaptcha !== 'undefined', { timeout });

  // Cada filtro só entra na busca se a caixa dele estiver marcada. Sem marcar, o
  // campo é ignorado e a consulta volta o país inteiro — sem erro nenhum.
  const selecionado = await page.evaluate(
    ({ f, vig, tp }) => {
      const marcar = (id, ligar) => {
        const chk = document.querySelector(id);
        if (chk && chk.checked !== ligar) chk.click();
      };

      marcar('#chkNRCNPJ', Boolean(f.cnpj));
      if (f.cnpj) document.querySelector('#txtNRCNPJ').value = f.cnpj;

      marcar('#chkPeriodoRegistro', Boolean(f.periodo));
      if (f.periodo) {
        document.querySelector('#txtDTInicioRegistro').value = f.periodo.de;
        document.querySelector('#txtDTFimRegistro').value = f.periodo.ate;
      }

      document.querySelector('#cboSTVigencia').value = vig;
      const cboTipo = document.querySelector('#cboTPRequerimento');
      if (cboTipo) cboTipo.value = tp;

      // Devolve o que os campos realmente aceitaram: atribuir um value inexistente
      // deixa o <select> vazio, e vazio no Mediador quer dizer "todos os tipos" —
      // o filtro sumiria sem nenhum erro.
      return {
        tipo: cboTipo ? cboTipo.value : null,
        vigencia: document.querySelector('#cboSTVigencia').value,
        cnpj: document.querySelector('#txtNRCNPJ').value,
        de: document.querySelector('#txtDTInicioRegistro').value,
        ate: document.querySelector('#txtDTFimRegistro').value
      };
    },
    { f: filtros, vig: vigencia, tp: tipo }
  );

  if (filtros.cnpj && selecionado.cnpj !== filtros.cnpj) {
    throw new Error(`o Mediador não aceitou o CNPJ "${filtros.cnpj}"`);
  }
  if (filtros.periodo && (selecionado.de !== filtros.periodo.de || selecionado.ate !== filtros.periodo.ate)) {
    throw new Error(
      `o Mediador não aceitou o período ${filtros.periodo.de}–${filtros.periodo.ate} ` +
      `(ficou ${selecionado.de}–${selecionado.ate})`
    );
  }

  if (selecionado.tipo !== tipo) {
    throw new Error(`o Mediador não aceitou o tipo "${tipo}" (ficou "${selecionado.tipo}")`);
  }
  if (selecionado.vigencia !== vigencia) {
    throw new Error(`o Mediador não aceitou a vigência "${vigencia}" (ficou "${selecionado.vigencia}")`);
  }

  const resp = await esperarResposta(
    page,
    () => page.evaluate(() => document.querySelector('#btnPesquisar').click()),
    { timeout }
  );

  if (resp && !resp.ok()) {
    const alvo = filtros.cnpj ?? `${filtros.periodo?.de}–${filtros.periodo?.ate}`;
    throw new Error(`Mediador respondeu HTTP ${resp.status()} na busca de ${alvo}`);
  }

  const alerta = await page.evaluate(() => {
    const t = document.body.innerText || '';
    const m = t.match(/O campo [^\n]+ é de preenchimento obrigatório/i);
    return m ? m[0] : null;
  });
  if (alerta) throw new Error(`Validação do Mediador: ${alerta}`);

  let dados = await page.evaluate(extrairDaPagina);
  const todos = [...dados.instrumentos];
  const paginasFalhas = [];

  for (let p = 2; p <= (dados.paginas || 1); p++) {
    await pausa(pausaPagina);

    // Confirma que a página REALMENTE trocou antes de ler. Sem isso, uma troca
    // lenta faz reler a página anterior; a deduplicação depois descarta as
    // repetidas e o resultado sai 10 itens menor sem nenhum erro aparecer.
    let parcial = null;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      await esperarResposta(
        page,
        () => page.evaluate(({ pagina, total }) => {
          const alvo = document.querySelector('#hgidgrdInstrumentos');
          if (alvo) alvo.value = String(pagina);
          // funcPaginar remonta o mesmo payload da busca e repagina no servidor.
          // eslint-disable-next-line no-undef
          funcPaginar(pagina, total);
        }, { pagina: p, total: dados.total_declarado }),
        { timeout }
      );

      const lido = await page.evaluate(extrairDaPagina);
      if (lido.pagina_atual === p && lido.instrumentos.length) {
        parcial = lido;
        break;
      }
      await pausa(2000 * tentativa);
    }

    if (!parcial) {
      paginasFalhas.push(p);
      continue;
    }
    todos.push(...parcial.instrumentos);
  }

  const vistos = new Set();
  const instrumentos = todos.filter((i) => {
    if (!i.nr_solicitacao || vistos.has(i.nr_solicitacao)) return false;
    vistos.add(i.nr_solicitacao);
    return true;
  });

  if (paginasFalhas.length) {
    throw new Error(
      `não consegui ler a(s) página(s) ${paginasFalhas.join(', ')} de ${dados.paginas} ` +
      `(${instrumentos.length} de ${dados.total_declarado} instrumentos)`
    );
  }

  return {
    filtros,
    cnpj: filtros.cnpj ?? null,
    total_declarado: dados.total_declarado,
    paginas: dados.paginas,
    sem_registro: dados.sem_registro,
    instrumentos: instrumentos.map((i) => ({ ...i, vigencia: partirVigencia(i.vigencia_texto) }))
  };
}
