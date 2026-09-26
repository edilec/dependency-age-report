import { EvidenceError } from './validate.mjs';

function decimal(token) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(token);
  if (!match) throw new EvidenceError('');
  const fractional = match[3] ?? '';
  let coefficient = `${match[2]}${fractional}`.replace(/^0+/u, '');
  if (!coefficient) return '0';
  const trailing = /0+$/u.exec(coefficient)?.[0].length ?? 0;
  coefficient = coefficient.slice(0, coefficient.length - trailing);
  const exponentToken = match[4] ?? '0';
  const exponentDigits = exponentToken.replace(/^[+-]/u, '').replace(/^0+/u, '') || '0';
  // Decimal exponents larger than the maximum input cannot cancel into a
  // representable finite JS number. Test this after coefficient-zero removal.
  if (exponentDigits.length > 7) throw new EvidenceError('');
  const exponent = BigInt(exponentToken) - BigInt(fractional.length) + BigInt(trailing);
  return `${match[1]}${coefficient}e${exponent}`;
}

export function parseStrictJson(text, { maxBytes = 4194304, maxDepth = 32, maxNodes = 200000 } = {}) {
  if (typeof text !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      !Number.isSafeInteger(maxDepth) || maxDepth < 0 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1 ||
      Buffer.byteLength(text, 'utf8') > maxBytes) throw new EvidenceError('');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new EvidenceError(''); }
  let offset = 0, nodes = 0;
  const space = () => { while (offset < text.length && /[\u0020\t\r\n]/u.test(text[offset])) offset++; };
  const string = () => {
    const start = offset++;
    while (offset < text.length) {
      if (text[offset] === '\\') { offset += 2; continue; }
      if (text[offset++] === '"') {
        try { return JSON.parse(text.slice(start, offset)); }
        catch { throw new EvidenceError(''); }
      }
    }
    throw new EvidenceError('');
  };
  const value = depth => {
    space();
    if (++nodes > maxNodes || depth > maxDepth) throw new EvidenceError('');
    const mark = text[offset];
    if (mark === '"') { string(); return; }
    if (mark === '{') {
      offset++;
      const keys = new Set();
      space();
      if (text[offset] === '}') { offset++; return; }
      for (;;) {
        const key = string();
        if (keys.has(key)) throw new EvidenceError('');
        keys.add(key);
        space();
        if (text[offset++] !== ':') throw new EvidenceError('');
        value(depth + 1);
        space();
        if (text[offset] === '}') { offset++; return; }
        if (text[offset++] !== ',') throw new EvidenceError('');
        space();
      }
    }
    if (mark === '[') {
      offset++;
      space();
      if (text[offset] === ']') { offset++; return; }
      for (;;) {
        value(depth + 1);
        space();
        if (text[offset] === ']') { offset++; return; }
        if (text[offset++] !== ',') throw new EvidenceError('');
      }
    }
    if (mark === 't') { offset += 4; return; }
    if (mark === 'f') { offset += 5; return; }
    if (mark === 'n') { offset += 4; return; }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(offset));
    if (!match) throw new EvidenceError('');
    const number = Number(match[0]);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER ||
        decimal(match[0]) !== decimal(number.toString())) throw new EvidenceError('');
    offset += match[0].length;
  };
  value(0);
  space();
  if (offset !== text.length) throw new EvidenceError('');
  return parsed;
}
