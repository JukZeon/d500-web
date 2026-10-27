let reverseGbk: Map<string, number[]> | undefined;
const decoder = new TextDecoder('gbk', { fatal: true });
export function decodeName(bytes: number[]): string {
  const end = bytes.findIndex(v => v === 255 || v === 0);
  return decoder.decode(new Uint8Array(end < 0 ? bytes : bytes.slice(0, end)));
}
export function encodeName(text: string): number[] {
  if (!reverseGbk) {
    reverseGbk = new Map();
    for (let i = 0; i < 128; i++) reverseGbk.set(String.fromCharCode(i), [i]);
    reverseGbk.set('€', [128]);
    for (let a = 129; a <= 254; a++) for (let b = 64; b <= 254; b++) {
      if (b === 127) continue;
      try {
        const char = decoder.decode(new Uint8Array([a, b]));
        if (char !== '\ufffd' && [...char].length === 1 && !reverseGbk.has(char)) reverseGbk.set(char, [a, b]);
      } catch { /* This byte pair is not a valid GBK character. */ }
    }
  }
  const out: number[] = [];
  for (const char of text) {
    const bytes = reverseGbk.get(char);
    if (!bytes || char === '\0' || /[\r\n\t]/.test(char)) throw new Error(`名称包含电台不支持的字符“${char}”`);
    out.push(...bytes);
  }
  if (out.length > 16) throw new Error(`名称占 ${out.length} 字节，D500 最多允许 16 字节（通常为 8 个汉字）`);
  return out;
}
