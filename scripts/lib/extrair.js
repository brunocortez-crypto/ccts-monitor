
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
 * Indicadores que o escritório usa: piso salarial, reajuste e benefícios.
 *
 * Heurística sobre texto livre — cada achado guarda o título da cláusula e o
 * trecho de origem. Não substitui a leitura da cláusula, aponta onde olhar.
 */
export function extrairIndicadores(texto, clausulas = []) {
  const acharEm = (fonte, padrao, limite, rotulo = null) => {
    const saida = [];
    const rx = new RegExp(padrao, 'gi');
    let m;
    while ((m = rx.exec(fonte)) !== null && saida.length < limite) {
      saida.push({
        valor: m[1],
        clausula: rotulo,
        trecho: fonte.slice(Math.max(0, m.index - 80), m.index + 120).replace(/\s+/g, ' ').trim()
      });
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
  const porClausula = (filtroTitulo, padrao, limite) => {
    const alvo = clausulas.filter((c) => filtroTitulo.test(c.titulo || ''));
    const achados = [];
    for (const c of alvo) {
      achados.push(...acharEm(c.texto || '', padrao, limite - achados.length, c.titulo));
      if (achados.length >= limite) break;
    }
    return achados;
  };

  const tituloTem = (re) => clausulas.filter((c) => re.test(c.titulo || '')).map((c) => c.titulo);

  const piso = porClausula(TITULO_PISO, `R\\$\\s*${DINHEIRO}`, 4);
  const reajuste = porClausula(TITULO_REAJUSTE, `${PERCENTUAL}\\s*%`, 4);

  return {
    piso,
    reajuste,
    // O menor valor da cláusula NÃO serve: a mesma cláusula costuma trazer o
    // valor-hora junto do mensal ("R$14,70" ao lado de "R$1.739,21"). Pegamos o
    // menor valor dentro da faixa plausível de piso MENSAL — abaixo do salário
    // mínimo não é piso, e acima de trinta mil é outra coisa.
    piso_mensal: menorNaFaixa(piso.map((p) => p.valor), 1000, 30000),
    // De onde veio: título da cláusula, ou null se foi do documento inteiro.
    piso_origem: piso[0]?.clausula ?? null,
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
