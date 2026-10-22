import persona from './kombat-persona.json' with { type: 'json' };

export const KOMBAT_NAME = persona.name;
export const KOMBAT_ROLE = persona.role;
export const KOMBAT_PERSONA_PROMPT = Object.freeze([...persona.system]).join('\n');
export const KOMBAT_GROUNDED_PROMPT = [KOMBAT_PERSONA_PROMPT, ...persona.grounding].join('\n');

// Direct identity answers are deterministic so a model cannot obscure the active technology.
export function identityReply(query, provider = 'local') {
  if (typeof query !== 'string') return null;
  const text = query.normalize('NFKC').toLocaleLowerCase('uk-UA').trim();
  if (text.length > 160 || !/^(?:а\s+)?(?:ти|ви|хто|що|яка|який|на\s+якій|чия|чий|назви|скажи)/u.test(text)) return null;
  // Межі слів через \p{L}: \b не працює з кирилицею, а «ші» інакше знаходиться в «інші».
  const identity = /(?<!\p{L})(?:хто\s+(?:ти|ви)|(?:ти|ви)\s+(?:людин|реальн|справжн|живий|жива|військов|командир|штучн|ші|ai|бот)|що\s+(?:ти|ви)\s+(?:таке|за))(?:\p{L}*)(?!\p{L})/u.test(text);
  // Технологію питають саме про помічника: без «ти/тебе/твій…» це звичайне питання до довідки
  // («Яка модель літака в ПС?», «Що таке API?»), і його не можна перехоплювати.
  const aboutAssistant = /(?<!\p{L})(?:ти|тебе|тобі|тобою|твій|твоя|твоє|твої|твого|твоєї|ви|вас|вам|ваш|ваша|ваше)(?!\p{L})/u.test(text);
  const technology = aboutAssistant
    && /(?<!\p{L})(?:модел\p{L}*|провайдер\p{L}*|технолог\p{L}*|anthropic|claude|sonnet|openai|ollama|api|штучн\p{L}*|нейромереж\p{L}*|ші|ai)(?!\p{L})/u.test(text);
  if (!identity && !technology) return null;
  const suffix = provider === 'anthropic'
    ? 'Для онлайн-розмови налаштовано Anthropic Claude Sonnet 5.5; цю відповідь про технологію сформовано локально.'
    : 'Цю відповідь формує локальне ядро EasyWAR; зовнішній провайдер зараз не використовується.';
  return { status: 'found', text: `Я — Комбат, віртуальний AI-помічник EasyWAR, не реальна людина й не учасник бойових дій. ${suffix}`, sources: [], warnings: [], origin: 'persona' };
}
