// EasyWAR has no Signal connector yet. This describes the app's capability,
// not the status of an external signal-cli process or account.
export function describeSignalRuntime(config) {
  const savedEnabled = config?.intake_enabled === true;
  return {
    connected: false,
    receiving: false,
    message: savedEnabled
      ? 'У збережених налаштуваннях є позначка приймання, але EasyWAR не підключений до Signal і не отримує повідомлень.'
      : 'EasyWAR не підключений до Signal і не отримує повідомлень. Це не перевірка стану signal-cli.',
  };
}
