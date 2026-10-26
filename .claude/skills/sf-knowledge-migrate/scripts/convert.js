#!/usr/bin/env node
/**
 * Converte artigos HTML extraídos (um index.html por pasta) para o formato de
 * importação do Salesforce Knowledge: um article_NN.html por artigo + import.csv.
 *
 * Trabalho mecânico apenas (parsing/estruturação de HTML, título, slug, CSV).
 * NÃO escreve Summary nem Question__c com conteúdo de verdade — isso é
 * responsabilidade do agente/subagente kb-converter (ver references/
 * content-authoring-rules.md). Este script grava placeholders detectáveis
 * para o agente substituir, e falha ruidosamente se os placeholders
 * sobreviverem até o pacote final (ver validate.js).
 *
 * Uso:
 *   node convert.js --source <pasta-extraída> --out <pasta-saída> --record-type-id <Id de 15 chars> [--category <coluna> --category-value <valor> --channels <valor> --report-out <caminho-do-conversion-report.json>]
 *
 * Layout de 5 pastas fixas desta skill (ver references/run-state.md):
 *   node convert.js --source 01-originais/extracted --out 02-processados --record-type-id <Id> --category <col> --category-value <valor> --report-out 05-docs/conversion-report.json
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith('--') ? next : true;
      if (next && !next.startsWith('--')) i++;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Parser de HTML por profundidade de tags (não regex gulosa)
//
// Por quê: uma regex de linha única como /<div[^>]*panel-body[^>]*>(.*?)<\/div>/
// para no PRIMEIRO </div> interno, truncando qualquer painel de acordeão com
// conteúdo HTML aninhado (listas, divs de aviso, etc). Isso já causou perda de
// até 80% do conteúdo real em produção. A solução é contar profundidade de
// abertura/fechamento de <div> para achar o </div> que realmente fecha o painel.
// ---------------------------------------------------------------------------
function findAllPanels(html) {
  const panels = [];
  const openRe = /<div\b[^>]*\bclass="[^"]*panel-body[^"]*"[^>]*>/gi;
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const contentStart = m.index + m[0].length;
    let depth = 1;
    let i = contentStart;
    const tagRe = /<div\b[^>]*>|<\/div\s*>/gi;
    tagRe.lastIndex = contentStart;
    let tagMatch;
    while ((tagMatch = tagRe.exec(html)) !== null) {
      if (tagMatch[0].toLowerCase().startsWith('</div')) {
        depth--;
        if (depth === 0) {
          panels.push(html.slice(contentStart, tagMatch.index));
          i = tagMatch.index + tagMatch[0].length;
          break;
        }
      } else {
        depth++;
      }
    }
    openRe.lastIndex = i;
  }
  return panels;
}

// Generaliza a mesma lógica de profundidade para qualquer <div class="...">,
// usada pelas transformações de alerta e abas abaixo (também aninhadas).
function findBalancedDivs(html, classFragment) {
  const results = [];
  const openRe = new RegExp(`<div\\b[^>]*\\bclass="[^"]*${classFragment}[^"]*"[^>]*>`, 'gi');
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const contentStart = m.index + m[0].length;
    let depth = 1;
    const tagRe = /<div\b[^>]*>|<\/div\s*>/gi;
    tagRe.lastIndex = contentStart;
    let tagMatch;
    let endStart = null;
    let endEnd = null;
    while ((tagMatch = tagRe.exec(html)) !== null) {
      if (tagMatch[0].toLowerCase().startsWith('</div')) {
        depth--;
        if (depth === 0) { endStart = tagMatch.index; endEnd = tagMatch.index + tagMatch[0].length; break; }
      } else {
        depth++;
      }
    }
    if (endStart !== null) {
      results.push({ start: m.index, end: endEnd, content: html.slice(contentStart, endStart) });
      openRe.lastIndex = endEnd;
    } else {
      break; // div malformado/não fechado — evita loop infinito
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Título de cada painel.
//
// Por quê usar <h4 class="panel-title"> em vez de um id específico: a
// primeira versão deste parser procurava só `id="component-title_link"`.
// Em uma migração real de 16 artigos, esse id só existia em 5 deles — os
// outros 11 usavam o mesmo wrapper <h4 class="panel-title"><a>Título</a>
// </h4>, só que com atributos diferentes no <a> (ex.: data-toggle=
// "collapse", sem id nenhum). Resultado: 11 artigos tiveram painéis de
// acordeão REAIS tratados como "conteúdo sem título", perdendo o
// comportamento colapsável inteiro. Usar o <h4 class="panel-title"> como
// critério — não um id específico do <a> interno — é robusto contra as
// duas variações observadas na prática.
// ---------------------------------------------------------------------------
function findPanelTitles(html) {
  const titles = [];
  const re = /<h4[^>]*class="[^"]*panel-title[^"]*"[^>]*>([\s\S]*?)<\/h4>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    titles.push(m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim());
  }
  return titles;
}

// ---------------------------------------------------------------------------
// Emoji como <img> do Google Noto → caractere unicode real.
//
// Por quê: o Wiki de origem renderiza emoji como <img src="...notoemoji...">
// com o emoji real já disponível no atributo alt (ex.: alt="🤖"). Isso força
// o Salesforce a depender de uma requisição externa por emoji, sem
// necessidade — o caractere unicode já renderiza nativamente em qualquer
// lugar que mostre o artigo, sem rede, com acessibilidade melhor.
// ---------------------------------------------------------------------------
function convertEmojiImages(html) {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!/notoemoji/i.test(tag)) return tag;
    const altMatch = tag.match(/\balt="([^"]*)"/i);
    return altMatch && altMatch[1] ? altMatch[1] : tag;
  });
}

// ---------------------------------------------------------------------------
// Caixa de alerta Bootstrap (.alert.alert-warning) → <div> com cor de fundo.
//
// Por quê: essas classes dependem do CSS do Bootstrap carregado no Wiki de
// origem (fundo amarelo sólido) — no Salesforce elas não existem, então a
// caixa de aviso viraria um <div> sem nenhum destaque visual. Reproduzimos
// com background-color inline — recurso real do Lightning Article Editor
// (grupo de formatação "font size, color and typeface"), mais fiel ao
// visual original do que um <blockquote> sem cor.
// ---------------------------------------------------------------------------
function convertAlertBoxes(html) {
  const divs = findBalancedDivs(html, 'alert');
  if (divs.length === 0) return html;

  let result = '';
  let cursor = 0;
  for (const d of divs) {
    result += html.slice(cursor, d.start);

    const titleMatch = d.content.match(/<p[^>]*class="title"[^>]*>([\s\S]*?)<\/p>/i);
    const titleText = titleMatch
      ? titleMatch[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, '').trim()
      : 'Atenção!';

    let bodyHtml = titleMatch ? d.content.replace(titleMatch[0], '') : d.content;
    // Desembrulha divs de layout do Bootstrap (ex.: "pad-ico"), mantendo o
    // conteúdo real (parágrafos, listas) intacto.
    bodyHtml = bodyHtml.replace(/<div\b[^>]*>/gi, '').replace(/<\/div>/gi, '').trim();

    result += `<div style="background-color: #fff8e1; border-left: 4px solid #f0ad4e; padding: 10px 14px; margin: 10px 0;"><p style="margin: 0 0 6px 0;"><strong>${titleText}</strong></p>${bodyHtml}</div>`;
    cursor = d.end;
  }
  result += html.slice(cursor);
  return result;
}

// Monta um <details> de accordion com respiro visual: margem abaixo do
// próprio accordion (separação de um do outro) e margem entre o <summary>
// e o corpo (senão título e texto ficam grudados, ilegível quando aberto).
// Usado tanto para os painéis de topo quanto para abas convertidas em
// accordion aninhado (convertTabsToAccordions).
function accordionBlock(title, contentHtml, { open = true } = {}) {
  const openAttr = open ? ' open="open"' : '';
  return `<details${openAttr} class="mce-accordion" style="margin-bottom: 16px;"><summary style="margin-bottom: 8px;">${title}</summary><div style="margin-top: 8px;">${contentHtml.trim()}</div></details>`;
}

// ---------------------------------------------------------------------------
// Abas Bootstrap (nav-pills + tab-pane) → accordion nativo.
//
// Por quê: o Salesforce RTA não tem componente de abas. Accordion é o
// equivalente funcional mais próximo (mesmo objetivo: mostrar um conteúdo
// extenso dividido em seções, uma de cada vez). Processa TODOS os grupos de
// abas do artigo — alguns têm mais de um (ex.: "produtos atuais" e
// "produtos antigos" em artigos de seguros).
// ---------------------------------------------------------------------------
function convertTabsToAccordions(html) {
  let result = html;
  let safety = 0;

  while (/class="[^"]*nav-pills[^"]*"/i.test(result) && safety < 20) {
    safety++;
    const navMatch = result.match(/<ul\b[^>]*class="[^"]*nav-pills[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
    if (!navMatch) break;

    const navHtml = navMatch[1];
    const labelMap = {};
    const linkRe = /<a[^>]*href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let lm;
    while ((lm = linkRe.exec(navHtml)) !== null) {
      labelMap[lm[1]] = lm[2].replace(/<[^>]*>/g, '').trim();
    }

    const afterNav = result.slice(navMatch.index + navMatch[0].length);
    const contentOpenMatch = afterNav.match(/<div\b[^>]*class="[^"]*tab-content[^"]*"[^>]*>/i);
    if (!contentOpenMatch) break;

    const contentBlocks = findBalancedDivs(afterNav, 'tab-content');
    if (contentBlocks.length === 0) break;
    const wrapper = contentBlocks[0];
    const panes = findBalancedDivs(wrapper.content, 'tab-pane');

    let accordionHtml = '';
    for (const p of panes) {
      const idMatch = wrapper.content.slice(p.start, p.start + 300).match(/id="([^"]+)"/);
      const id = idMatch ? idMatch[1] : null;
      const label = (id && labelMap[id]) || 'Seção';
      accordionHtml += accordionBlock(label, p.content, { open: false }) + '\n';
    }

    const absoluteWrapperEnd = navMatch.index + navMatch[0].length + wrapper.end;
    result = result.slice(0, navMatch.index) + accordionHtml + result.slice(absoluteWrapperEnd);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Derivação de título a partir do nome da pasta/ZIP de origem.
//
// Por quê: o <title> do HTML de origem costuma ser um placeholder fixo do
// exportador do Wiki (não descreve o artigo). O primeiro painel de acordeão
// também não serve como título (gera nomes genéricos como "Conceito" ou
// "Visão Geral"). O nome do arquivo/pasta de origem é normalmente o único
// identificador descritivo disponível.
//
// Limitação conhecida: o processo de slug → título não tem como recuperar
// acentuação perdida. ACCENT_FIX é um dicionário ABERTO, começando vazio —
// preencha-o com termos recorrentes do SEU domínio à medida que forem
// aparecendo (ver references/html-parsing-rules.md).
// ---------------------------------------------------------------------------
const ACCENT_FIX = {};

function titleFromDirName(dirName) {
  const withoutHash = dirName.replace(/^[a-f0-9]{20,40}-/i, '');
  const words = withoutHash.split('-').filter(Boolean);
  return words
    .map(w => ACCENT_FIX[w.toLowerCase()] || (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function extractDocTitle(html, dirName) {
  if (dirName) return titleFromDirName(dirName);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return h1[1].replace(/<[^>]*>/g, '').trim();
  const titles = findPanelTitles(html);
  return titles.length > 0 ? titles[0] : 'Artigo sem título';
}

function cleanFragment(fragment) {
  let result = fragment
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+on\w+="[^"]*"/gi, '')
    .replace(/\s+on\w+='[^']*'/gi, '')
    .trim();

  // Ordem importa: abas→accordion e alerta→cor de fundo operam sobre <div>
  // ainda intactos (vêm logo após a limpeza de script/style/comentário);
  // emoji é independente e pode vir por último.
  result = convertTabsToAccordions(result);
  result = convertAlertBoxes(result);
  result = convertEmojiImages(result);
  return result;
}

function buildArticleHtml(docTitle, panelTitles, panelBodies) {
  let body = '';
  for (let i = 0; i < panelBodies.length; i++) {
    const title = (panelTitles[i] || '').trim();
    const content = cleanFragment(panelBodies[i]);

    if (title) {
      // Painel com título real no original = era um componente de acordeão
      // interativo no Wiki de origem. Fiel ao original: vira um accordion
      // nativo do Salesforce, não um <h2> estático — preserva o
      // comportamento colapsável, não só o texto.
      body += accordionBlock(title, content) + '\n';
    } else {
      // Sem título: não é um painel de acordeão de verdade, é conteúdo
      // sequencial empilhado (ex.: histórico de comunicados). Separador
      // visual nativo (<hr>) entre blocos, sem inventar um título que não
      // existia no original.
      if (body) body += '<hr/>\n';
      body += content + '\n';
    }
  }
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<h1>${docTitle}</h1>
${body}
</body>
</html>`;
}

function slugify(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Placeholder detectável — kb-converter (subagente) substitui por conteúdo de
// verdade, lendo o article_NN.html gerado. validate.js falha se sobreviver.
const SUMMARY_PLACEHOLDER = '__TODO_SUMMARY_NAO_PREENCHIDO_PELO_AGENTE__';
const QUESTION_PLACEHOLDER = '__TODO_QUESTION_NAO_PREENCHIDO_PELO_AGENTE__';
const SUMMARY_ENHANCED_PLACEHOLDER = '__TODO_SUMMARY_ENHANCED_NAO_GERADO__';

function csvEscape(s) {
  return String(s).replace(/"/g, '""');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const SOURCE = args.source;
  const OUTPUT = args.out;
  const RECORD_TYPE_ID = args['record-type-id'];
  const CATEGORY_COLUMN = args.category || 'datacategorygroup.YourCategoryGroup';
  const CATEGORY_VALUE = args['category-value'] || '';
  const CHANNELS = args.channels || 'application+sites';
  const REPORT_OUT = args['report-out'];

  if (!SOURCE || !OUTPUT) {
    console.error('Uso: node convert.js --source <pasta-extraída> --out <pasta-saída> --record-type-id <Id de 15 chars> [--category <coluna> --category-value <valor> --channels <valor>]');
    process.exit(1);
  }
  if (!RECORD_TYPE_ID) {
    // Travado de propósito: um Record Type ausente NÃO falha no Import Wizard,
    // só deixa o campo em branco nos registros criados — erro silencioso já
    // ocorrido em produção. Esta skill se recusa a gerar CSV sem ele.
    console.error('ERRO: --record-type-id é obrigatório. Sem ele, o Import Wizard cria os artigos com Record Type EM BRANCO sem acusar erro nenhum. Consulte references/field-mapping.md.');
    process.exit(1);
  }
  if (RECORD_TYPE_ID.length !== 15) {
    // O Import Wizard de Knowledge exige especificamente o Id de 15
    // caracteres — o Id de 18 (o que normalmente se copia de um registro
    // qualquer no Salesforce) falha com "A lookup field value is not a
    // lookup ID". Isso já aconteceu em produção; travamos aqui para nunca
    // mais acontecer silenciosamente.
    console.error(`ERRO: --record-type-id precisa ter exatamente 15 caracteres (recebido: "${RECORD_TYPE_ID}", ${RECORD_TYPE_ID.length} caracteres). O Import Wizard de Knowledge rejeita o Id de 18 caracteres com "A lookup field value is not a lookup ID". Pegue o Id de 15 chars em Setup > Object Manager > Knowledge > Record Types. Consulte references/field-mapping.md.`);
    process.exit(1);
  }

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUTPUT, 'data'), { recursive: true });

  const extractedDirs = fs.readdirSync(SOURCE, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const csvLines = [`Title,Summary,URLName,RecordTypeId,${CATEGORY_COLUMN},channels,Question__c,Answer__c,Summary_Enhanced__c`];
  const report = [];
  let num = 1;

  for (const dirName of extractedDirs) {
    const indexPath = path.join(SOURCE, dirName, 'index.html');
    if (!fs.existsSync(indexPath)) continue;

    const html = fs.readFileSync(indexPath, 'utf8');
    const docTitle = extractDocTitle(html, dirName);
    const panelTitles = findPanelTitles(html);
    let panelBodies = findAllPanels(html);

    let fallbackUsed = false;
    if (panelBodies.length === 0) {
      fallbackUsed = true;
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      panelBodies = [bodyMatch ? bodyMatch[1] : html];
    }

    const articleFile = `article_${String(num).padStart(2, '0')}.html`;
    const questionFile = `article_${String(num).padStart(2, '0')}_question.html`;
    const summaryEnhancedFile = `article_${String(num).padStart(2, '0')}_summary_enhanced.html`;
    const finalHtml = buildArticleHtml(docTitle, panelTitles, panelBodies);
    fs.writeFileSync(path.join(OUTPUT, 'data', articleFile), finalHtml, 'utf8');

    // Pergunta é Rich Text Area: precisa de arquivo próprio, texto inline no
    // CSV é rejeitado pelo Import Wizard ("Invalid file path for the Rich
    // Text Area field"). O conteúdo real (QUESTION_PLACEHOLDER) é substituído
    // pelo subagente kb-converter.
    fs.writeFileSync(
      path.join(OUTPUT, 'data', questionFile),
      `<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"></head>\n<body>\n<p>${QUESTION_PLACEHOLDER}</p>\n</body>\n</html>`,
      'utf8'
    );

    // Summary_Enhanced__c (Rich Text Area, ver content-authoring-rules.md):
    // versão formatada do mesmo Summary, para exibição no LWC. Gerada de
    // verdade por scripts/format-summary-enhanced.js DEPOIS que o agente
    // escrever o Summary real — aqui só o placeholder (mecânico, sem
    // conteúdo ainda).
    fs.writeFileSync(
      path.join(OUTPUT, 'data', summaryEnhancedFile),
      `<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"></head>\n<body>\n<p>${SUMMARY_ENHANCED_PLACEHOLDER}</p>\n</body>\n</html>`,
      'utf8'
    );

    const urlName = slugify(docTitle);
    const titleEsc = csvEscape(docTitle);
    const summary = csvEscape(SUMMARY_PLACEHOLDER);

    csvLines.push(
      `"${titleEsc}","${summary}","${urlName}","${RECORD_TYPE_ID}","${CATEGORY_VALUE}","${CHANNELS}","data/${questionFile}","data/${articleFile}","data/${summaryEnhancedFile}"`
    );

    report.push({
      num, dirName, docTitle, urlName,
      panels: panelBodies.length,
      titledPanels: panelTitles.filter(Boolean).length,
      fallbackUsed,
      bytes: finalHtml.length,
      images: (finalHtml.match(/<img/gi) || []).length,
      links: (finalHtml.match(/<a href/gi) || []).length,
      lists: (finalHtml.match(/<ul>|<ol>/gi) || []).length,
    });

    console.log(`  ${fallbackUsed ? '⚠️ ' : '✅'} ${String(num).padStart(2, '0')}. ${docTitle} — ${panelBodies.length} painel(is), ${panelTitles.filter(Boolean).length} com título (accordion)${fallbackUsed ? ' (fallback: nenhum panel-body encontrado, usando <body> inteiro)' : ''}`);
    num++;
  }

  fs.writeFileSync(path.join(OUTPUT, 'import.csv'), csvLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(OUTPUT, 'content.properties'), 'CSVEncoding=UTF8\nRTAEncoding=UTF8\nCSVSeparator=,\n', 'utf8');
  fs.writeFileSync(path.join(OUTPUT, 'data', 'image.html'), '<!-- Image references for Knowledge articles -->\n', 'utf8');
  // --report-out é explícito porque o layout de 5 pastas fixas desta skill
  // (ver references/run-state.md) grava relatórios em 05-docs/, separado da
  // saída de dados em 02-processados/ — sem isso, o relatório ficava
  // misturado com import.csv/data/ e exigia um passo manual de mover depois
  // (mesma classe de erro já corrigida em extract-zips.js/--manifest-out).
  const reportPath = REPORT_OUT || path.join(OUTPUT, 'conversion-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n${report.length} artigo(s) convertido(s). Relatório: conversion-report.json`);
  console.log(`⚠️  Summary e Question__c de todos os artigos contêm placeholders — o subagente kb-converter (ou o agente da sessão) precisa lê-los e escrever conteúdo real antes do empacotamento final.`);
}

main();
