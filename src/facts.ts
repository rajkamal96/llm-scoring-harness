// Facts that code can count exactly. Counting is not left to the model: models are inconsistent at it,
// and a rubric score should not change just because the model miscounted bullets.

export interface Page {
  name: string;
  title: string;
  /** Full page text (markdown) after the front matter. */
  text: string;
}

export interface Facts {
  titleChars: number;
  wordCount: number;
  bulletCount: number;
  numberWithUnitCount: number;
  superlativeCount: number;
}

const UNIT = String.raw`(?:mm|cm|m|km|kg|g|mg|ml|l|oz|lb|lbs|in|inch|inches|ft|w|kw|v|mah|wh|lm|lumens?|k|hz|db|hrs?|hours?|mins?|minutes?|years?|months?|°c|°f|%|gb|tb|mb|mp)`;
const NUMBER_WITH_UNIT = new RegExp(String.raw`(?<![\w.])\d+(?:[.,]\d+)?\s?${UNIT}(?![a-z])`, 'gi');

const SUPERLATIVES = [
  'best', '#1', 'number one', 'perfect', 'ultimate', 'amazing', 'revolutionary', 'unbeatable', 'greatest', 'incredible',
  'world-class', "world's", 'unmatched', 'flawless', 'life-changing', 'game-changing', 'must-have', 'premium quality',
];

export function normaliseText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

export function parsePage(name: string, raw: string): Page {
  const src = raw.replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  const body = fm ? src.slice(fm[0].length) : src;
  const fmTitle = fm ? /^title:\s*(.+)$/m.exec(fm[1])?.[1]?.replace(/^["']|["']$/g, '').trim() : undefined;
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return { name, title: fmTitle || h1 || '', text: normaliseText(body) };
}

export function computeFacts(page: Page): Facts {
  const lower = page.text.toLowerCase();
  const words = page.text.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  return {
    titleChars: page.title.length,
    wordCount: words.length,
    bulletCount: (page.text.match(/^\s*(?:[-*•]|\d+\.)\s+\S/gm) ?? []).length,
    numberWithUnitCount: (page.text.match(NUMBER_WITH_UNIT) ?? []).length,
    superlativeCount: SUPERLATIVES.reduce((n, w) => {
      let i = 0, c = 0;
      while ((i = lower.indexOf(w, i)) !== -1) {
        const before = lower[i - 1], after = lower[i + w.length];
        if (!/[\p{L}]/u.test(before ?? ' ') && !/[\p{L}]/u.test(after ?? ' ')) c++;
        i += w.length;
      }
      return n + c;
    }, 0),
  };
}
