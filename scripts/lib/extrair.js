
/**
 * Extração de texto e cláusulas do extrato do Mediador.
 *
 * O arquivo que o MTE serve como "documento" vem com Content-Type application/msword,
 * mas o conteúdo é HTML (<html xmlns:o='urn:schemas-microsoft-com:office:office'>).
 * Não precisa de parser de .doc — precisa de cuidado com duas coisas:
 *
 *   1. encoding windows-1252, não UTF-8;
 *   2. entidades HTML no meio das palavras: "CL&#193;USULA", "VIG&#202;NCIA".
 *      Decodificar DEPOIS de tirar as tags, senão procurar "CLÁUSULA" volta zero e
 *      a conclusão errada é "este documento não tem cláusulas".
 */

const ENTIDADES_NOMEADAS = {
 AElig: 'Æ', Aacute: 'Á', Acirc: 'Â', Agrave: 'À', Aring: 'Å', Atilde: 'Ã',
  Auml: 'Ä', Ccedil: 'Ç', Dagger: '‡', ETH: 'Ð', Eacute: 'É', Ecirc: 'Ê',
  Egrave: 'È', Euml: 'Ë', Iacute: 'Í', Icirc: 'Î', Igrave: 'Ì', Iuml: 'Ï',
  Ntilde: 'Ñ', Oacute: 'Ó', Ocirc: 'Ô', Ograve: 'Ò', Oslash: 'Ø',
  Otilde: 'Õ', Ouml: 'Ö', THORN: 'Þ', Uacute: 'Ú', Ucirc: 'Û', Ugrave: 'Ù',
  Uuml: 'Ü', Yacute: 'Ý', aacute: 'á', acirc: 'â', acute: '´', aelig: 'æ',
  agrave: 'à', amp: '&', apos: "'", aring: 'å', atilde: 'ã', auml: 'ä',
  bdquo: '„', brvbar: '¦', bull: '•', ccedil: 'ç', cedil: '¸', cent: '¢',
  copy: '©', curren: '¤', dagger: '†', deg: '°', divide: '÷', eacute: 'é',
  ecirc: 'ê', egrave: 'è', eth: 'ð', euml: 'ë', euro: '€', frac12: '½',
  frac14: '¼', frac34: '¾', gt: '>', harr: '↔', hellip: '…', iacute: 'í',
  icirc: 'î', iexcl: '¡', igrave: 'ì', iquest: '¿', iuml: 'ï', laquo: '«',
  larr: '←', ldquo: '“', lsaquo: '‹', lsquo: '‘', lt: '<', macr: '¯',
  mdash: '—', micro: 'µ', middot: '·', minus: '−', nbsp: ' ', ndash: '–',
  not: '¬', ntilde: 'ñ', oacute: 'ó', ocirc: 'ô', ograve: 'ò', ordf: 'ª',
  ordm: 'º', oslash: 'ø', otilde: 'õ', ouml: 'ö', para: '¶', permil: '‰',
  plusmn: '±', pound: '£', quot: '"', raquo: '»', rarr: '→', rdquo: '”',
  reg: '®', rsaquo: '›', rsquo: '’', sbquo: '‚', sect: '§', shy: '­',
  sup1: '¹', sup2: '²', sup3: '³', szlig: 'ß', thorn: 'þ', times: '×',
  trade: '™', uacute: 'ú', ucirc: 'û', ugrave: 'ù', uml: '¨', uuml: 'ü',
  yacute: 'ý', yen: '¥', yuml: 'ÿ'
};

export function decodificarEntidades(txt) {
  return String(txt ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // O nome da entidade e case-sensitive no HTML (&Eacute; != &eacute;), mas os
    // extratos do MTE as vezes mandam tudo em caixa alta junto com o titulo. Tenta
    // exato primeiro; so entao a forma minuscula.
    .replace(/&([a-zA-Z]+);/g, (m, nome) =>
      ENTIDADES_NOMEADAS[nome] ?? ENTIDADES_NOMEADAS[nome.toLowerCase()] ?? m);
}

/** HTML do extrato -> texto corrido legível. */
export function htmlParaTexto(html) {
  let t = String(html ?? '');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = decodificarEntidades(t);
  t = t.replace(/\r/g, '');
  t = t.replace(/[ \t ]+/g, ' ');
  t = t.replace(/ *\n */g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** Campos do cabeçalho do extrato. */
export function extrairCabecalho(texto) {
  const pega = (rotulo) => {
    const re = new RegExp(rotulo + '\\s*:?\\s*\\n?\\s*([^\\n]+)', 'i');
    const m = texto.match(re);
    return m ? m[1].trim() : null;
  };
  return {
    nr_registro_mte: pega('N[ÚU]MERO DE REGISTRO NO MTE'),
    data_registro: pega('DATA DE REGISTRO NO MTE'),
    nr_solicitacao: pega('N[ÚU]MERO DA SOLICITA[ÇC][ÃA]O'),
    nr_processo: pega('N[ÚU]MERO DO PROCESSO'),
    data_protocolo: pega('DATA DO PROTOCOLO')
  };
}

/**
 * Quebra o corpo em cláusulas.
 * O extrato numera como "CLÁUSULA PRIMEIRA - VIGÊNCIA E DATA-BASE".
 */
export function extrairClausulas(texto) {
  // A linha TEM que começar com CLÁUSULA em caixa alta, seguida de ordinal.
  //
  // Sem exigir início de linha e caixa alta, o regex casava "cláusula" no meio de
  // frase: "descrita no caput desta cláusula fica garantido..." virava uma
  // cláusula chamada "APOSENTADORIA da CCT descrita no caput...". Eram 64 de 4216
  // (1,5%) — pouco em percentual, mas cada uma vira uma linha falsa no resumo.
  const re = /^[ \t]*CL[ÁA]USULA\s+([A-ZÁÂÃÉÊÍÓÔÕÚÇ]+(?:[ \t]+[A-ZÁÂÃÉÊÍÓÔÕÚÇ]+){0,2})\s*[-–—]\s*(.+)$/gm;
  const marcas = [];
  let m;
  while ((m = re.exec(texto)) !== null) {
    marcas.push({ pos: m.index, ordinal: m[1].trim(), titulo: m[2].trim() });
  }
  return marcas.map((marca, i) => {
    const fim = i + 1 < marcas.length ? marcas[i + 1].pos : texto.length;
    const bloco = texto.slice(marca.pos, fim);
    let corpo = bloco.split('\n').slice(1).join('\n').trim();
    let titulo = marca.titulo;

    // Parte das convenções põe título e corpo na MESMA linha, separados por
    // dois-pontos: "CESTA BÁSICA: Fica garantido o fornecimento subsidiado...".
    // Sem separar, o título vira um parágrafo inteiro e o corpo perde o começo.
    const dois = titulo.indexOf(': ');
    if (titulo.length > 60 && dois > 0 && dois <= 60) {
      corpo = `${titulo.slice(dois + 2).trim()}\n${corpo}`.trim();
      titulo = titulo.slice(0, dois).trim();
    }

    return { ordinal: marca.ordinal, titulo, texto: corpo };
  });
}

/**
 * Valor em reais com formato plausível: exige centavos ou separador de milhar.
 *
 * Sem essa exigência, "R$ 2" e "R$ 1" entravam como piso salarial — o regex casava
 * o número de um item de lista ou de uma referência de cláusula que aparecia perto
 * da expressão "piso salarial". Um piso nunca é R$ 2.
 */
const DINHEIRO = '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{2})?|\\d+,\\d{2})';

/** Percentual com ou sem casas decimais. */
const PERCENTUAL = '(\\d{1,3}(?:,\\d{1,4})?)';

/**
 * Títulos de cláusula onde cada indicador costuma morar.
 *
 * Procurar no documento inteiro não funciona: as convenções raramente escrevem
 * "piso salarial R$ X". Escrevem "SALÁRIO DA CATEGORIA: o menor salário a ser pago
 * ... será de R$1.739,21", ou põem os valores numa tabela sob "PISOS SALARIAIS".
 * Procurar DENTRO da cláusula certa é o que aproveita a estrutura do documento.
 */
const TITULO_PISO =
  /piso|sal[áa]rio\s+(d[ao]\s+)?(categoria|normativo|ingresso|admiss)|sal[áa]rios?\s+m[íi]nimos?|remunera[çc][ãa]o\s+m[íi]nima/i;
const TITULO_REAJUSTE =
  /reajuste|corre[çc][ãa]o\s+salarial|aumento\s+salarial|recomposi[çc][ãa]o/i;

/**
 * Piso que só vale sob condição, não para a categoria inteira.
 *
 * Caso real (FECCOEMG, MG000329/2026): a convenção tem "SALÁRIO DA CATEGORIA"
 * com R$ 1.739,21 e, logo abaixo, "REGIME ESPECIAL DE PISO SALARIAL (REPIS) PARA
 * AS ME E EPP" com R$ 1.663,91. O REPIS só vale para micro e pequena empresa que
 * aderiu formalmente, tem Certificado de Adesão e está adimplente.
 *
 * Como o piso geral é o MENOR valor plausível da cláusula, o REPIS — que é menor
 * ainda — ganhava. O painel publicava R$ 1.663,91 como piso da categoria: R$ 75,30
 * abaixo do correto, e quem calculasse folha com ele pagaria menos que o piso.
 *
 * Valor sob condição não é o piso da categoria. Fica registrado à parte.
 */
const CLAUSULA_CONDICIONAL =
  /repis|regime especial|\bME\b|\bEPP\b|microempresa|pequeno porte|ades[ãa]o|simples nacional/i;

/**
 * Indicadores que o escritório usa: piso salarial, reajuste e benefícios.
 *
 * Heurística sobre texto livre — cada achado guarda o título da cláusula e o
 * trecho de origem. Não substitui a leitura da cláusula, aponta onde olhar.
 */
/**
 * Palavras que, perto do valor, dizem que aquilo NÃO é piso.
 *
 * Caso real (FECCOEMG): dentro da cláusula do REPIS convivem o piso
 * (R$ 1.663,91), a taxa de utilização (R$ 14,70) e duas multas por falta do
 * Certificado de Adesão (R$ 1.000,00). Como o piso é o menor valor plausível da
 * cláusula, a multa de mil reais ganhava do piso de mil seiscentos.
 *
 * Estar na cláusula certa não basta: o valor precisa não ser uma penalidade.
 */
const NAO_E_PISO = /multa|penalidade|taxa|juros|mora|indeniza[çc][ãa]o|honor[áa]rio/i;

export function extrairIndicadores(texto, clausulas = []) {
  const acharEm = (fonte, padrao, limite, rotulo = null, excluir = null) => {
    const saida = [];
    const rx = new RegExp(padrao, 'gi');
    let m;
    while ((m = rx.exec(fonte)) !== null && saida.length < limite) {
      const trecho = fonte.slice(Math.max(0, m.index - 80), m.index + 120)
        .replace(/\s+/g, ' ').trim();
      // Só o contexto imediato ANTES do valor decide: "multa no importe de
      // R$1.000,00" exclui; uma multa citada no fim do parágrafo não deveria
      // derrubar um piso citado no começo.
      const antes = fonte.slice(Math.max(0, m.index - 70), m.index);
      if (excluir && excluir.test(antes)) continue;
      saida.push({ valor: m[1], clausula: rotulo, trecho });
    }
    return saida;
  };

  /**
   * Procura SÓ dentro das cláusulas do tema. Sem fallback para o documento inteiro,
   * de propósito.
   *
   * O fallback foi testado e produzia lixo com cara de dado bom: cobertura de seguro
   * de vida (R$ 26.744,14), auxílio funeral (R$ 5.500,00) e teto de reajuste
   * (R$ 14.000,00) entravam como "piso salarial". Todo valor implausível vinha dele.
   *
   * Quando a convenção não tem cláusula de piso reconhecível, a resposta certa é
   * "não sei" — o painel mostra as cláusulas para leitura. Um número errado num
   * campo de piso é pior que campo vazio: alguém calcula folha com ele.
   */
  const porClausula = (filtroTitulo, padrao, limite, excluir = null) => {
    const alvo = clausulas.filter((c) => filtroTitulo.test(c.titulo || ''));
    const achados = [];
    for (const c of alvo) {
      achados.push(...acharEm(c.texto || '', padrao, limite - achados.length, c.titulo, excluir));
      if (achados.length >= limite) break;
    }
    return achados;
  };

  const tituloTem = (re) => clausulas.filter((c) => re.test(c.titulo || '')).map((c) => c.titulo);

  const piso = porClausula(TITULO_PISO, `R\\$\\s*${DINHEIRO}`, 6, NAO_E_PISO)
    .map((p) => ({ ...p, condicional: CLAUSULA_CONDICIONAL.test(String(p.clausula ?? '')) }));
  const reajuste = porClausula(TITULO_REAJUSTE, `${PERCENTUAL}\\s*%`, 4);

  const pisosGerais = piso.filter((p) => !p.condicional).map((p) => p.valor);
  const pisosCondicionais = piso.filter((p) => p.condicional).map((p) => p.valor);

  /**
   * Reajuste que não é um número, é uma tabela.
   *
   * Caso FECCOEMG: "3,90%" vale só para quem foi admitido até janeiro/2025.
   * Quem entrou depois tem índice menor, numa tabela por mês de admissão. A
   * auditoria achou o mesmo padrão em 31 dos 87 documentos.
   *
   * Mostrar "Reajuste 3,90%" para uma categoria onde a maioria recebe menos é o
   * mesmo erro do piso: um número plausível, da cláusula certa, e errado para
   * quase todo mundo.
   */
  const reajusteProporcional = reajuste.some((r) =>
    /m[êe]s de admiss[ãa]o|proporcional|fator de multiplica|tabela a seguir|[íi]ndice[s]?\s+a\s+seguir/i
      .test(String(r.trecho ?? '')));

  return {
    piso,
    reajuste,
    // Quando o reajuste é tabelado por mês de admissão, o percentual isolado vale
    // só para uma fatia da categoria. O painel avisa em vez de exibir o número seco.
    reajuste_proporcional: reajusteProporcional,
    // UM número só de piso é mentira quando a cláusula traz vários.
    //
    // Caso real (SETH-TAP, MG004433/2025): a cláusula tem quatro pisos —
    // R$ 1.804,04 (220h) e R$ 1.476,03 (180h) para jan-jun, R$ 1.822,08 e
    // R$ 1.490,79 para jul-dez. A regra do "menor plausível" mostrava
    // R$ 1.476,03: jornada parcial E semestre vencido. Para quem trabalha 220h
    // hoje, o piso é R$ 1.822,08 — R$ 346,05 acima do que o painel dizia.
    //
    // Piso varia por jornada, por função e por período dentro da mesma
    // convenção. Quando há mais de um, mostramos a FAIXA e mandamos ler a
    // cláusula; um número escolhido por heurística vira folha errada.
    piso_mensal: pisosGerais.length === 1
      ? menorNaFaixa(pisosGerais, 1000, 30000)
      : null,
    piso_faixa: faixaDe(pisosGerais, 1000, 30000),
    // Piso de regime especial (REPIS/ME/EPP), quando existe. Não substitui o da
    // categoria: mostrar como se fosse faz pagar abaixo do piso.
    piso_condicional: menorNaFaixa(pisosCondicionais, 1000, 30000),
    // De onde veio o piso GERAL. Antes apontava para piso[0], que podia ser a
    // cláusula condicional — o número mostrado e a cláusula citada divergiam.
    piso_origem: piso.find((p) => !p.condicional)?.clausula ?? null,
    percentuais: acharEm(texto, `${PERCENTUAL}\\s*%\\s*\\(`, 5),
    valores: acharEm(texto, `R\\$\\s*${DINHEIRO}`, 8),
    clausulas_salariais: tituloTem(/sal[áa]ri|piso|reajust|remunera/i),
    clausulas_beneficios: tituloTem(/cesta|vale|aux[íi]lio|alimenta|transporte|sa[úu]de|plano/i)
  };
}

/** "1.739,21" -> 1739.21 */
export function paraNumero(valor) {
  const n = Number(String(valor ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : Infinity;
}

/**
 * Faixa de valores plausíveis: { min, max, quantos } ou null.
 * Usada quando a cláusula traz mais de um piso — por jornada, função ou período.
 */
function faixaDe(valores, minimo, maximo) {
  const dentro = [...new Set(valores)]
    .map((v) => ({ texto: v, numero: paraNumero(v) }))
    .filter((x) => x.numero >= minimo && x.numero <= maximo)
    .sort((a, b) => a.numero - b.numero);
  if (dentro.length < 2) return null;
  return {
    min: dentro[0].texto,
    max: dentro[dentro.length - 1].texto,
    quantos: dentro.length
  };
}

/** Menor valor dentro da faixa, ou null se nenhum couber. Devolve como veio no texto. */
function menorNaFaixa(valores, minimo, maximo) {
  const dentro = valores
    .map((v) => ({ texto: v, numero: paraNumero(v) }))
    .filter((x) => x.numero >= minimo && x.numero <= maximo)
    .sort((a, b) => a.numero - b.numero);
  return dentro.length ? dentro[0].texto : null;
}

/** Pipeline completo: bytes crus do MTE -> estrutura. */
export function processarDocumento(buffer) {
  const html = new TextDecoder('windows-1252').decode(buffer);
  const texto = htmlParaTexto(html);
  const clausulas = extrairClausulas(texto);
  return {
    texto,
    cabecalho: extrairCabecalho(texto),
    clausulas,
    indicadores: extrairIndicadores(texto, clausulas),
    tamanho_texto: texto.length
  };
}
