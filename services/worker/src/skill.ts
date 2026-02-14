const SKILL_MD_URL = process.env.SKILL_MD_URL || 'https://iab-docs.apti.jp/skill.md';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedContent: string | null = null;
let cachedAt = 0;

export async function getSkillContext(): Promise<string> {
  const now = Date.now();
  if (cachedContent !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedContent;
  }

  try {
    const res = await fetch(SKILL_MD_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    cachedContent = text;
    cachedAt = now;
    console.log(`skill.md fetched (${text.length} bytes)`);
    return text;
  } catch (err: any) {
    console.warn(`Failed to fetch skill.md: ${err.message}`);
    return cachedContent ?? '';
  }
}
