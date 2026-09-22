export const SYNTHETIC_REVIEWER = 'тестовий-рецензент';

export function createSyntheticInbox() {
  return [
    { id: 'demo-a', title: 'Тестове повідомлення А', status: 'NEW', reviewer: null },
    { id: 'demo-b', title: 'Тестове повідомлення Б', status: 'PARSED', reviewer: null },
  ];
}

export function transitionSyntheticItem(item, action, reviewer = null) {
  let status;
  if (item.status === 'NEW' && action === 'MARK_PARSED') {
    status = 'PARSED';
  } else if (['NEW', 'PARSED'].includes(item.status) && action === 'REQUEST_REVIEW') {
    status = 'NEEDS_REVIEW';
  } else if (item.status === 'NEEDS_REVIEW' && ['APPROVE', 'REJECT'].includes(action)) {
    if (typeof reviewer !== 'string' || !reviewer || reviewer.trim() !== reviewer || /\p{Cc}/u.test(reviewer)) {
      throw new Error('Для рішення потрібен коректний тестовий ідентифікатор рецензента.');
    }
    status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  } else {
    throw new Error('Недозволений перехід стану тестової черги.');
  }
  return { ...item, status, reviewer: ['APPROVED', 'REJECTED'].includes(status) ? reviewer : null };
}
