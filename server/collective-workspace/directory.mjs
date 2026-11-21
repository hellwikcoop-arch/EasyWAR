// Індекс одноразових кодів і лічильник невдалих спроб.
// Код веде до ідентифікатора колективу і більше ні до чого: складу й файлів тут немає.

export const GUESS_LIMIT = 8;
export const GUESS_WINDOW_MS = 15 * 60 * 1000;

export function emptyDirectory() {
  return { codes: {}, guesses: {} };
}

function guessState(directory, clientKey, now) {
  const current = directory.guesses[clientKey];
  if (!current || now - current.windowStart >= GUESS_WINDOW_MS) {
    return { windowStart: now, count: 0 };
  }
  return { windowStart: current.windowStart, count: current.count };
}

function withGuess(directory, clientKey, guess) {
  return { ...directory, guesses: { ...directory.guesses, [clientKey]: guess } };
}

export function applyDirectory(directory, action) {
  const dir = directory || emptyDirectory();
  if (action?.op === 'list') {
    return { status: 200, directory: dir, body: { ok: true, codes: Object.keys(dir.codes) } };
  }
  if (action?.op === 'register') {
    return {
      status: 200,
      directory: {
        ...dir,
        codes: {
          ...dir.codes,
          [action.code]: { collectiveId: action.collectiveId, expiresAt: action.expiresAt },
        },
      },
      body: { ok: true },
    };
  }
  if (action?.op === 'forget') {
    const codes = { ...dir.codes };
    delete codes[action.code];
    return { status: 200, directory: { ...dir, codes }, body: { ok: true } };
  }
  if (action?.op === 'fail') {
    const guess = guessState(dir, action.clientKey, action.now);
    const next = withGuess(dir, action.clientKey, { ...guess, count: guess.count + 1 });
    if (action.forgetCode) {
      const codes = { ...next.codes };
      delete codes[action.forgetCode];
      return { status: 200, directory: { ...next, codes }, body: { ok: true } };
    }
    return { status: 200, directory: next, body: { ok: true } };
  }
  if (action?.op === 'lookup') {
    const guess = guessState(dir, action.clientKey, action.now);
    if (guess.count >= GUESS_LIMIT) {
      return {
        status: 429,
        directory: withGuess(dir, action.clientKey, guess),
        body: { ok: false, error: 'Забагато невдалих спроб. Спробуйте пізніше.' },
      };
    }
    const entry = dir.codes[action.code];
    if (!entry || entry.expiresAt <= action.now) {
      const codes = { ...dir.codes };
      if (entry) delete codes[action.code];
      return {
        status: 400,
        directory: withGuess({ ...dir, codes }, action.clientKey, { ...guess, count: guess.count + 1 }),
        body: { ok: false, error: 'Невірний або прострочений код запрошення.' },
      };
    }
    return {
      status: 200,
      directory: dir,
      body: { ok: true, collectiveId: entry.collectiveId },
    };
  }
  return { status: 400, directory: dir, body: { ok: false, error: 'Невідома дія довідника.' } };
}
