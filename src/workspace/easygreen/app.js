// EasyGreen у «Робочому середовищі»: точка входу за контрактом оболонки (docs/WORKSPACE.md).
import { mountEasyGreen } from './easygreen-panel.js';

export const contract = 1;

export async function mount(container, host) {
  return mountEasyGreen(container, { host, appUrl: host.resolve('workspace/easygreen/app/index.html') });
}
