// easyPay у «Робочому середовищі» → «Особисте» (контракт docs/WORKSPACE.md): калькулятор
// грошового забезпечення й журнал виплат із нагадуваннями. Журнал — лише файл .easypay через host.
import { mountEasyPay } from './easypay-ui.js';
import './easypay.css';

export const contract = 1;

export async function mount(container, host) {
  return mountEasyPay(container, host);
}
