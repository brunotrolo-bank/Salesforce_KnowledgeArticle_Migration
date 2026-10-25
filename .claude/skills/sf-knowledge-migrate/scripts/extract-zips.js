#!/usr/bin/env node
/**
 * Extrai todos os .zip de um diretório de origem para subpastas individuais
 * e grava um manifest.json com o inventário de cada artigo (nº de painéis de
 * acordeão, imagens, links, listas) — a baseline usada por validate.js para
 * confirmar fidelidade depois da conversão. Mapear 100% do conteúdo original
 * ANTES de converter é o que permite detectar truncamento automaticamente.
 *
 * Usa o utilitário `unzip` do sistema para extrair (não lê o formato ZIP
 * sozinho — diferente de package-zip.js, que escreve ZIP sem dependências).
 *
 * Uso:
 *   node extract-zips.js --source <pasta-com-zips> --out <pasta-destino>
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function countPanels(html) {
  // Mesma lógica de profundidade de <div> usada em convert.js — precisa bater
  // exatamente, senão o manifest de origem mente sobre o que convert.js vai
  // efetivamente capturar.
  let count = 0;
  const openRe = /<div\b[^>]*\bclass="[^"]*panel-body[^"]*"[^>]*>/gi;
  let m;
  while ((m = openRe.exec(html)) !== null) {
    let depth = 1;
    const tagRe = /<div\b[^>]*>|<\/div\s*>/gi;
    tagRe.lastIndex = m.index + m[0].length;
    let tagMatch;
    let endIndex = tagRe.lastIndex;
    while ((tagMatch = tagRe.exec(html)) !== null) {
      if (tagMatch[0].toLowerCase().startsWith('</div')) {
        depth--;
        if (depth === 0) { endIndex = tagMatch.index + tagMatch[0].length; break; }
      } else {
        depth++;
      }
    }
    count++;
    openRe.lastIndex = endIndex;
  }
  return count;
}

function extractAndInventory(source, out, zips) {
  const extracted = [];
  const manifestArticles = [];

  for (const zipFile of zips) {
    const baseName = zipFile.replace(/\.zip$/i, '');
    const destDir = path.join(out, baseName);
    fs.mkdirSync(destDir, { recursive: true });
    try {
      execFileSync('unzip', ['-q', '-o', path.join(source, zipFile), '-d', destDir]);
      const indexPath = path.join(destDir, 'index.html');
      const hasIndex = fs.existsSync(indexPath);
      console.log(`  ${hasIndex ? '✅' : '⚠️ sem index.html'} ${baseName}`);
      extracted.push({ zipFile, dir: baseName, hasIndex });

      if (hasIndex) {
        const html = fs.readFileSync(indexPath, 'utf8');
        // Remove comentários antes de contar: um comentário que MENCIONA
        // "<img" como texto (comum em HTML anotado) não deve contar como
        // tag real — já causou falso-positivo de divergência no validate.js.
        const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, '');
        manifestArticles.push({
          dir: baseName,
          zipFile,
          panels: countPanels(html),
          images: (htmlNoComments.match(/<img/gi) || []).length,
          links: (htmlNoComments.match(/<a href/gi) || []).length,
          lists: (htmlNoComments.match(/<ul>|<ol>/gi) || []).length,
        });
      }
    } catch (e) {
      console.log(`  ❌ ${baseName} — erro ao extrair: ${e.message}`);
      extracted.push({ zipFile, dir: baseName, hasIndex: false, error: e.message });
    }
  }

  return { extracted, manifestArticles };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args.source;
  const out = args.out;

  if (!source || !out) {
    console.error('Uso: node extract-zips.js --source <pasta-com-zips> --out <pasta-destino>');
    process.exit(1);
  }
  if (!fs.existsSync(source)) {
    console.error(`Pasta de origem não existe: ${source}`);
    process.exit(1);
  }

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const zips = fs.readdirSync(source).filter(f => f.toLowerCase().endsWith('.zip')).sort();
  if (zips.length === 0) {
    console.error(`Nenhum .zip encontrado em: ${source}`);
    process.exit(1);
  }

  console.log(`Extraindo ${zips.length} ZIP(s) de ${source}...`);
  const { extracted, manifestArticles } = extractAndInventory(source, out, zips);

  const manifestPath = path.join(out, '..', 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ totalZips: zips.length, articles: manifestArticles }, null, 2), 'utf8');

  console.log(`\nExtração concluída: ${extracted.filter(e => e.hasIndex).length}/${zips.length} com index.html válido.`);
  console.log(`Manifest de inventário gravado em: ${manifestPath}`);
  process.exit(extracted.some(e => !e.hasIndex) ? 2 : 0);
}

main();
