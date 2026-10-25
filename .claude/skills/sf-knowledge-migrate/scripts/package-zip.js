#!/usr/bin/env node
/**
 * Empacota uma pasta (import.csv + content.properties + data/) em um .zip
 * válido para o Import Wizard do Salesforce Knowledge, sem dependências
 * externas (zero npm install, não precisa do binário `zip` no PATH).
 *
 * Por quê sem dependências: o Import Wizard roda em ambientes sem acesso de
 * rede confiável, e `zip`/`unzip` nem sempre estão disponíveis no PATH do
 * Windows — este script implementa o formato ZIP manualmente com
 * zlib.deflateRawSync.
 *
 * Uso:
 *   node package-zip.js --source <pasta-processada> --out <caminho-do-zip.zip>
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function listFiles(dir, base) {
  const entries = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    const rel = path.join(base, item.name);
    if (item.isDirectory()) entries.push(...listFiles(full, rel));
    else entries.push({ full, rel });
  }
  return entries;
}

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ (-1)) >>> 0;
}

function makeZip(entries, outPath) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { full, rel } of entries) {
    const data = fs.readFileSync(full);
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const nameBuf = Buffer.from(rel.split(path.sep).join('/'), 'utf8');

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);
  const centralOffset = offset;

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(centralOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  fs.writeFileSync(outPath, Buffer.concat([...localParts, ...centralParts, endRecord]));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args.source;
  const out = args.out;

  if (!source || !out) {
    console.error('Uso: node package-zip.js --source <pasta-processada> --out <caminho-do-zip.zip>');
    process.exit(1);
  }
  if (!fs.existsSync(source)) {
    console.error(`Pasta de origem não existe: ${source}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });

  const entries = listFiles(source, '.').filter(e => !e.rel.endsWith('.zip') && !e.rel.endsWith('.json'));
  if (entries.length === 0) {
    console.error(`Nenhum arquivo para empacotar em: ${source}`);
    process.exit(1);
  }

  makeZip(entries, out);
  const sizeKB = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`ZIP criado: ${out} (${entries.length} arquivo(s), ${sizeKB} KB)`);
}

main();
