// One-shot discovery is not message intake. This describes the app's receive
// capability, not the status of an external signal-cli process or account.
export function describeSignalRuntime(config, session = null) {
  if (session?.active === true) {
    return {
      connected: true,
      receiving: true,
      message: 'Активний явний сеанс Signal. EasyWAR приймає лише дозволені джерела до ручної зупинки, межі 64 повідомлень або тайм-ауту 5 хвилин.',
    };
  }
  const savedEnabled = config?.intake_enabled === true;
  return {
    connected: false,
    receiving: false,
    message: savedEnabled
      ? 'У збережених налаштуваннях є позначка приймання, але EasyWAR не отримує повідомлень. Одноразова перевірка демона не вмикає приймання.'
      : 'EasyWAR не отримує повідомлень Signal. Одноразова перевірка демона не вмикає приймання.',
  };
}

const SIGNAL_INBOX_STATUS_LABELS = Object.freeze({
  NEW: 'Нове',
  PARSED: 'Розібрано',
  NEEDS_REVIEW: 'Потребує перевірки',
  APPROVED: 'Схвалено',
  REJECTED: 'Відхилено',
});

function formatInboxTimestamp(value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'час не визначено';
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

export function describePersistedSignalInbox(items) {
  const rows = Array.isArray(items)
    ? items.map(item => ({
      reportId: String(item?.report_id || ''),
      sourceItemKey: String(item?.source_item_key || ''),
      capturedAt: formatInboxTimestamp(item?.captured_at),
      currentStatus: String(item?.current_status || ''),
      statusLabel: SIGNAL_INBOX_STATUS_LABELS[item?.current_status] || 'Невідомий стан',
    })).filter(item => item.reportId && item.sourceItemKey)
    : [];

  return {
    rows,
    message: rows.length
      ? `Записів у локальній черзі Signal: ${rows.length}.`
      : 'Локальна черга Signal порожня.',
  };
}

function uniqueAllowlistLines(value) {
  return [...new Set(String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

// The allowlist object the settings form saves. `allow_group_members` is the
// "bot in a group" mode: any member of a listed group is accepted in that group.
export function buildSignalAllowlist(sendersText, groupsText, allowGroupMembers) {
  return {
    allowed_senders: uniqueAllowlistLines(sendersText),
    allowed_groups: uniqueAllowlistLines(groupsText),
    allow_group_members: allowGroupMembers === true,
  };
}

// Adds one identifier as its own line unless it is already listed.
export function appendAllowlistLine(text, id) {
  const lines = uniqueAllowlistLines(text);
  const value = String(id || '').trim();
  if (!value || lines.includes(value)) return { text: lines.join('\n'), added: false };
  return { text: [...lines, value].join('\n'), added: true };
}
