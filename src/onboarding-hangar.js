// Ангар не входить у граф HTML Vite: сторінка підключає цей файл як є.
import { detectHangarModule } from './onboarding-core.js';
import { mountOnboarding } from './onboarding-shell.js';

const hash = () => {
  const raw = (location.hash || '').replace(/^#/, '').split('/')[0];
  return raw ? `#${raw}` : '#hangar';
};

mountOnboarding({ module: detectHangarModule(hash()) });
