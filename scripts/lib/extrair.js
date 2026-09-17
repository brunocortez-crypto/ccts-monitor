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
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', atilde: 'ã', otilde: 'õ',
  ccedil: 'ç', agrave: 'à', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Atilde: 'Ã', Otilde: 'Õ',
  Ccedil: 'Ç', Agrave: 'À', ordm: 'º', ordf: 'ª', deg: '°',
  laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”'
};

export function decodificarEntidades(txt) {
  return String(txt ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, nome) => ENTIDADES_NOMEADAS[nome] ?? m);
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
  const re = /CL[ÁA]USULA\s+([A-ZÁÂÃÉÊÍÓÔÕÚÇÀ-ÿ\s]+?)\s*[-–]\s*([^\n]+)/gi;
  const marcas = [];
  let m;
  while ((m = re.exec(texto)) !== null) {
    marcas.push({ pos: m.index, ordinal: m[1].trim(), titulo: m[2].trim() });
  }
  return marcas.map((marca, i) => {
    const fim = i + 1 < marcas.length ? marcas[i + 1].pos : texto.length;
    const bloco = texto.slice(marca.pos, fim);
    const corpo = bloco.split('\n').slice(1).join('\n').trim();
    return { ordinal: marca.ordinal, titulo: marca.titulo, texto: corpo };
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
 * Indicadores que o escritório usa: piso salarial, reajuste e benefícios.
 *
 * Heurística sobre texto livre — cada achado guarda o trecho de origem para
 * conferência. Não substitui a leitura da cláusula, aponta onde olhar.
 */
export function extrairIndicadores(texto, clausulas = []) {
  const achar = (re, limite = 3) => {
    const saida = [];
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = rx.exec(texto)) !== null && saida.length < limite) {
      saida.push({
        valor: m[1],
        trecho: texto.slice(Math.max(0, m.index - 70), m.index + 110).replace(/\n/g, ' ').trim()
      });
    }
    return saida;
  };

  const tituloTem = (re) => clausulas.filter((c) => re.test(c.titulo)).map((c) => c.titulo);

  return {
    piso: achar(new RegExp(`piso\\s+salarial[^.]{0,120}?R\\$\\s*${DINHEIRO}`, 'i')),
    reajuste: achar(new RegExp(`reajuste[^.]{0,120}?${PERCENTUAL}\\s*%`, 'i')),
    percentuais: achar(new RegExp(`${PERCENTUAL}\\s*%\\s*\\(`, 'i'), 5),
    valores: achar(new RegExp(`R\\$\\s*${DINHEIRO}`, 'i'), 8),
    clausulas_salariais: tituloTem(/sal[áa]ri|piso|reajust|remunera/i),
    clausulas_beneficios: tituloTem(/cesta|vale|aux[íi]lio|alimenta|transporte|sa[úu]de|plano/i)
  };
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
