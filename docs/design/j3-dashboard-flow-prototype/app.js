(() => {
  'use strict';

  const screens = [...document.querySelectorAll('[data-screen]')];
  const viewButtons = [...document.querySelectorAll('[data-view]')];
  const themeToggle = document.querySelector('#theme-toggle');
  const technicalToggle = document.querySelector('#technical-toggle');
  const technicalPanel = document.querySelector('#technical-panel');
  const issueSummary = document.querySelector('.issue-summary');
  const issueDetails = document.querySelector('#create-issues');
  const dataFrame = document.querySelector('.data-frame');
  const flightTable = document.querySelector('#flight-table');
  const groupFilter = document.querySelector('.group-filter');
  const visibleColumns = document.querySelector('#visible-columns');
  const tableSearch = document.querySelector('#table-search');
  const storageToggle = document.querySelector('#storage-toggle');
  const editDrawer = document.querySelector('#edit-drawer');
  const drawerBackdrop = document.querySelector('#drawer-backdrop');
  const drawerTitle = document.querySelector('#drawer-title');
  const toast = document.querySelector('#toast');
  let activeGroup = 'all';
  let toastTimer = 0;

  const groups = [
    { id: 'all', label: 'Усі' },
    { id: 'main', label: 'Основне' },
    { id: 'time', label: 'Час і наліт' },
    { id: 'weather', label: 'Метеоумови' },
    { id: 'crew', label: 'Екіпаж' },
    { id: 'cargo', label: 'Вантаж' },
    { id: 'grade', label: 'Оцінки' },
  ];

  const columns = [
    ['list_number', '№ за списком', 'main'],
    ['aircraft_type', 'Тип ПС', 'main'],
    ['aircraft_number', 'Номер ПС', 'main'],
    ['crew_ke_callsign', 'Позивний командира', 'crew'],
    ['day_night', 'День / ніч', 'main'],
    ['flight_shift_number', 'Льотна зміна', 'main'],
    ['training_program_fuel', 'Програма підготовки', 'main'],
    ['combat_training_exercise_number', 'Вправа бойової підготовки', 'main'],
    ['complex_exercise_number_1', 'Вправа комплексу №1', 'main'],
    ['complex_exercise_number_2', 'Вправа комплексу №2', 'main'],
    ['flight_count', 'Кількість польотів', 'time'],
    ['engine_test_time', 'Запуск / проба, год', 'time'],
    ['takeoff_time', 'Час зльоту', 'time'],
    ['landing_time', 'Час посадки', 'time'],
    ['airborne_hours', 'Наліт у повітрі, год', 'time'],
    ['total_hours', 'Наліт загальний, год', 'time'],
    ['flight_altitude', 'Висота польоту, м', 'time'],
    ['combat_application_grade', 'Оцінка бойового застосування', 'grade'],
    ['flight_grade', 'Оцінка за політ', 'grade'],
    ['cloud_base_upper', 'Верхня межа хмар, м', 'weather'],
    ['cloud_base_lower', 'Нижня межа хмар, м', 'weather'],
    ['cloud_cover', 'Хмарність, 0–10', 'weather'],
    ['visibility', 'Видимість, км', 'weather'],
    ['instrument_meteorological_conditions', 'Політ у СМУ', 'weather'],
    ['time_in_clouds', 'Час у хмарах, год', 'weather'],
    ['hood_time', 'Час під шторкою, год', 'weather'],
    ['fuel_consumption', 'Витрата палива, л', 'cargo'],
    ['crew_ke', 'Екіпаж: КЕ', 'crew'],
    ['crew_lsh', 'Екіпаж: ЛШ', 'crew'],
    ['crew_bt', 'Екіпаж: БТ', 'crew'],
    ['crew_other', 'Інші члени екіпажу', 'crew'],
    ['passengers', 'Пасажири', 'cargo'],
    ['cargo_kg', 'Вантаж, кг', 'cargo'],
    ['rsp_approaches', 'Заходи РСП', 'time'],
    ['note', 'Примітка', 'grade'],
  ].map(([key, label, group]) => ({ key, label, group }));

  const aircraft = [
    ['Мі-8', '11'], ['Мі-8', '12'], ['Мі-24', '13'], ['Ан-26', '14'],
    ['Мі-8', '15'], ['Мі-2', '17'], ['Мі-8', '18'], ['Мі-8', '19'],
  ];

  const rows = aircraft.map(([type, number], index) => ({
    list_number: index + 1,
    aircraft_type: type,
    aircraft_number: number,
    crew_ke_callsign: index === 2 ? 'Сокіл' : '—',
    day_night: index % 3 === 2 ? 'Ніч' : 'День',
    flight_shift_number: index < 5 ? 1 : 2,
    training_program_fuel: 'Програма-1',
    combat_training_exercise_number: 5,
    complex_exercise_number_1: 12,
    complex_exercise_number_2: 3,
    flight_count: index % 2 + 1,
    engine_test_time: '0,2',
    takeoff_time: `${String(8 + index).padStart(2, '0')}:15`,
    landing_time: `${String(9 + index).padStart(2, '0')}:05`,
    airborne_hours: (0.7 + index * 0.1).toFixed(1),
    total_hours: (1 + index * 0.1).toFixed(1),
    flight_altitude: 300 + index * 50,
    combat_application_grade: index % 2 ? 'Добре' : 'Відмінно',
    flight_grade: index % 3 ? 'Добре' : 'Відмінно',
    cloud_base_upper: 1200,
    cloud_base_lower: 600,
    cloud_cover: 4,
    visibility: 10,
    instrument_meteorological_conditions: index % 4 === 3 ? 'Так' : 'Ні',
    time_in_clouds: index % 4 === 3 ? '0,2' : '0',
    hood_time: index % 2 ? '0,1' : '0',
    fuel_consumption: 620 + index * 18,
    crew_ke: 1,
    crew_lsh: 1,
    crew_bt: 1,
    crew_other: index % 2,
    passengers: index % 3,
    cargo_kg: index % 2 ? 120 : 0,
    rsp_approaches: index % 2,
    note: index === 5 ? 'Навчальний виліт' : '—',
  }));

  function setView(name, updateHash = true) {
    const next = screens.find(screen => screen.dataset.screen === name) || screens[0];
    screens.forEach(screen => {
      const active = screen === next;
      screen.hidden = !active;
      screen.classList.toggle('is-active', active);
    });
    viewButtons.forEach(button => {
      const active = button.dataset.view === next.dataset.screen;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (updateHash) history.replaceState(null, '', `#${next.dataset.screen}`);
    document.title = `EasyWAR · ${next.dataset.screen === 'table' ? 'Таблиця польотів' : next.dataset.screen === 'review' ? 'Перевірка XLSX' : 'Створення модуля'}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleTheme() {
    const light = document.documentElement.dataset.theme !== 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    themeToggle.setAttribute('aria-label', light ? 'Увімкнути темну тему' : 'Увімкнути світлу тему');
  }

  function renderGroupFilters() {
    groupFilter.replaceChildren(...groups.map(group => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = group.label;
      button.dataset.group = group.id;
      button.classList.toggle('is-active', group.id === activeGroup);
      button.setAttribute('aria-pressed', String(group.id === activeGroup));
      return button;
    }));
  }

  function visibleFields() {
    return activeGroup === 'all' ? columns : columns.filter(column => column.group === activeGroup || ['aircraft_type', 'aircraft_number'].includes(column.key));
  }

  function filteredRows() {
    const query = tableSearch.value.trim().toLocaleLowerCase('uk');
    if (!query) return rows;
    return rows.filter(row => `${row.aircraft_type} ${row.aircraft_number}`.toLocaleLowerCase('uk').includes(query));
  }

  function cellClass(column) {
    if (column.key === 'aircraft_type') return 'sticky-col sticky-type';
    if (column.key === 'aircraft_number') return 'sticky-col sticky-number';
    return '';
  }

  function renderTable() {
    const fields = visibleFields();
    const headRow = document.createElement('tr');
    const indexHead = document.createElement('th');
    indexHead.className = 'sticky-col sticky-index';
    indexHead.textContent = '№';
    headRow.append(indexHead);
    fields.forEach(column => {
      const th = document.createElement('th');
      th.className = cellClass(column);
      th.textContent = column.label;
      const code = document.createElement('span');
      code.textContent = column.key;
      th.append(code);
      headRow.append(th);
    });
    const actionHead = document.createElement('th');
    actionHead.className = 'sticky-action';
    actionHead.textContent = 'Дія';
    headRow.append(actionHead);
    flightTable.tHead.replaceChildren(headRow);

    const bodyRows = filteredRows().map((row, index) => {
      const tr = document.createElement('tr');
      const rowIndex = document.createElement('td');
      rowIndex.className = 'sticky-col sticky-index row-index';
      rowIndex.textContent = String(index + 1);
      tr.append(rowIndex);
      fields.forEach(column => {
        const td = document.createElement('td');
        td.className = cellClass(column);
        td.textContent = String(row[column.key] ?? '—');
        td.title = `${column.label}: ${td.textContent}`;
        tr.append(td);
      });
      const action = document.createElement('td');
      action.className = 'sticky-action';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'edit-row';
      edit.textContent = 'Редагувати';
      edit.dataset.row = String(index);
      action.append(edit);
      tr.append(action);
      return tr;
    });
    flightTable.tBodies[0].replaceChildren(...bodyRows);
    visibleColumns.textContent = String(fields.length);
    dataFrame.scrollLeft = 0;
  }

  function openDrawer(mode = 'new') {
    drawerTitle.textContent = mode === 'edit' ? 'Редагування рядка' : 'Новий рядок';
    drawerBackdrop.hidden = false;
    editDrawer.classList.add('is-open');
    editDrawer.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => editDrawer.querySelector('input')?.focus());
  }

  function closeDrawer() {
    editDrawer.classList.remove('is-open');
    editDrawer.setAttribute('aria-hidden', 'true');
    setTimeout(() => { drawerBackdrop.hidden = true; }, 210);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2300);
  }

  viewButtons.forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('.next-view').forEach(button => button.addEventListener('click', () => setView(button.dataset.next)));
  document.querySelectorAll('.previous-view').forEach(button => button.addEventListener('click', () => setView(button.dataset.previous)));
  themeToggle.addEventListener('click', toggleTheme);

  technicalToggle.addEventListener('click', () => {
    const expanded = technicalToggle.getAttribute('aria-expanded') === 'true';
    technicalToggle.setAttribute('aria-expanded', String(!expanded));
    technicalToggle.textContent = expanded ? 'Технічні деталі' : 'Сховати деталі';
    technicalPanel.hidden = expanded;
  });

  issueSummary.addEventListener('click', () => {
    const expanded = issueSummary.getAttribute('aria-expanded') === 'true';
    issueSummary.setAttribute('aria-expanded', String(!expanded));
    issueDetails.hidden = expanded;
  });

  document.querySelectorAll('.choice-row').forEach(row => row.addEventListener('click', event => {
    const button = event.target.closest('.choice');
    if (!button) return;
    row.querySelectorAll('.choice').forEach(item => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
  }));

  document.querySelectorAll('.apply-fix').forEach(button => button.addEventListener('click', () => {
    const issue = button.closest('.issue-card');
    issue.classList.add('is-resolved');
    button.textContent = 'Виправлено';
    button.disabled = true;
    showToast('Виправлення застосовано до локальної чернетки');
  }));

  groupFilter.addEventListener('click', event => {
    const button = event.target.closest('[data-group]');
    if (!button) return;
    activeGroup = button.dataset.group;
    renderGroupFilters();
    renderTable();
  });
  tableSearch.addEventListener('input', renderTable);
  storageToggle.addEventListener('click', () => {
    const expanded = storageToggle.getAttribute('aria-expanded') === 'true';
    storageToggle.setAttribute('aria-expanded', String(!expanded));
    storageToggle.textContent = expanded
      ? 'Показати технічну назву'
      : 'dashboard_data_000000000000000000000001';
  });
  document.querySelector('.density-control').addEventListener('click', event => {
    const button = event.target.closest('[data-density]');
    if (!button) return;
    document.querySelectorAll('[data-density]').forEach(item => item.classList.toggle('is-active', item === button));
    dataFrame.classList.toggle('density-compact', button.dataset.density === 'compact');
    dataFrame.classList.toggle('density-comfortable', button.dataset.density === 'comfortable');
  });

  document.querySelector('#add-row').addEventListener('click', () => openDrawer('new'));
  flightTable.addEventListener('click', event => {
    if (event.target.closest('.edit-row')) openDrawer('edit');
  });
  document.querySelector('#close-drawer').addEventListener('click', closeDrawer);
  document.querySelector('#cancel-drawer').addEventListener('click', closeDrawer);
  drawerBackdrop.addEventListener('click', closeDrawer);
  document.querySelector('#save-row').addEventListener('click', () => {
    closeDrawer();
    showToast('Рядок збережено локально');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && editDrawer.classList.contains('is-open')) closeDrawer();
  });

  renderGroupFilters();
  renderTable();
  setView(location.hash.slice(1) || 'create', false);
})();
