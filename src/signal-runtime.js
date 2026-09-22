// One-shot discovery is not message intake. This describes the app's receive
// capability, not the status of an external signal-cli process or account.
export function describeSignalRuntime(config) {
  const savedEnabled = config?.intake_enabled === true;
  return {
    connected: false,
    receiving: false,
    message: savedEnabled
      ? 'У збережених налаштуваннях є позначка приймання, але EasyWAR не отримує повідомлень. Одноразова перевірка демона не вмикає приймання.'
      : 'EasyWAR не отримує повідомлень Signal. Одноразова перевірка демона не вмикає приймання.',
  };
}
