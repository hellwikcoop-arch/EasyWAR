#!/usr/bin/env python3
"""Build the empty base tables shipped with EasyWAR from working tables.

    python3 script/make_base_tables.py --rvia <РВіА.xlsx> --pvk <ТАБЛ 2-3.xlsx>

Writes rvia-base.xlsx, air-base.xlsx (the ordinary Air Force table, derived from
the РВіА layout) and pvk-base.xlsx.

The sources are real working tables and must never be committed. Only the
outputs in src-tauri/resources/base-tables/ are, and they keep structure only:
- РВіА: the «Зведена» header row and the reference sheets («Довідник …»,
  «Результати»), with drop-down lists rebuilt against those sheets. Every data
  row is removed, and so are the unit names: the list on «Підрозділ» and the
  per-unit colours on «В інтересах» and «Підрозділ».
- ПС (звичайна): the РВіА layout with the Air Force module's headers («№ цілі
  (TS/KS)», «Тип ЛА»), without the РВіА-only columns and launcher list, and
  with the target types and failure causes the module recognises in reports.
- ПС рівня ПВК: the three sheets with their Excel tables, header styles and
  total rows, and PVK_EMPTY_ROWS unformatted rows to fill in. The working rows,
  their colour fills and anything outside the tables are dropped.
openpyxl writes a fresh package, so author names, the source path (absPath),
printer settings, Power Query parts (customXml) and unused shared strings are
not carried over. The script checks this before it writes anything.
"""
import argparse
import copy
import datetime
import re
import sys
import zipfile
from pathlib import Path

import openpyxl
from openpyxl.formatting.formatting import ConditionalFormattingList
from openpyxl.styles import PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

OUT = Path(__file__).resolve().parent.parent / 'src-tauri' / 'resources' / 'base-tables'
STAMP = datetime.datetime(2026, 9, 28)
LAST_ROW = 1011
# Columns whose drop-downs or colours name specific units.
UNIT_COLUMNS = ('E', 'P')
RESULTS = 'Результати!$A$2:$A$6'
# Empty rows in each ПВК table, about a month of daily lines.
PVK_EMPTY_ROWS = 31
# The names the Air Force module itself recognises in reports (TYPE_RULES and
# CAUSE_RULES in src/air.html), so the drop-downs offer what it fills in.
AIR_TYPES = [
    ('КСП', 'КСП, КП, командний пункт'),
    ('ПУ БПЛА', 'Пункт управління БПЛА, місце зльоту, оператори'),
    ('Укриття', 'Укриття, бліндаж, ДОТ, підвал'),
    ('Переправа', 'Переправа, міст, понтон'),
    ('Накопичення о/с / ШГ', 'Накопичення о/с, штурмова група, ППД'),
    ('ВОП/РОП', 'Опорний пункт'),
    ("Вузол зв'язку", "Вузол зв'язку, об'єкт зв'язку"),
    ('БК/склад', 'Склад, БК'),
    ('Вогнева позиція', 'Вогнева позиція, артилерія'),
    ('Інше', 'Інші цілі'),
]
AIR_CAUSES = [
    ('ППО', 'Збито в повітрі, перехоплено засобами ППО'),
    ('РЕБ', 'Вплив РЕБ'),
    ('Відмова АЗУ', 'Відмова системи скидання'),
    ('Несхід боєприпасу', 'Боєприпас не зійшов'),
    ('Нерозрив', 'Боєприпас не розірвався'),
    ('Детонація в повітрі', 'Боєприпас здетонував у повітрі'),
    ('Відбій / без роботи', 'Завдання скасовано'),
    ('Перехоплено авіацією', 'Перехоплено авіацією противника'),
    ('Засіб фіксації збитий', "Немає об'єктивного контролю"),
    ('Потребує дорозвідки', 'Результат уточнюється'),
]


def reset_views(wb):
    # The source remembers where its author last clicked; start at the top.
    for ws in wb.worksheets:
        for selection in ws.sheet_view.selection:
            selection.activeCell = selection.sqref = 'A2'


def scrub_properties(wb, title):
    props = wb.properties
    props.creator = 'EasyWAR'
    props.lastModifiedBy = 'EasyWAR'
    props.title = title
    props.subject = props.description = props.keywords = props.category = None
    props.company = props.manager = None
    props.created = props.modified = STAMP
    props.lastPrinted = None


def keep_colours(ws, columns):
    """Keeps the conditional colours of `columns`, stretched over the data rows."""
    rules = ws.conditional_formatting
    ws.conditional_formatting = ConditionalFormattingList()
    for cf_range, cf_rules in rules._cf_rules.items():
        column = str(cf_range.sqref).split(':')[0].rstrip('0123456789')
        if column not in columns:
            continue
        for rule in cf_rules:
            ws.conditional_formatting.add(f'{column}2:{column}{LAST_ROW}', rule)


def set_lists(ws, lists):
    ws.data_validations.dataValidation = []
    for column, formula in lists.items():
        validation = DataValidation(type='list', formula1=formula, allow_blank=True)
        validation.add(f'{column}2:{column}{LAST_ROW}')
        ws.add_data_validation(validation)


def fill_dictionary(ws, rows):
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.value = None
    for index, values in enumerate(rows, start=2):
        for column, value in enumerate(values, start=1):
            ws.cell(index, column, value)


def build_rvia(source):
    wb = openpyxl.load_workbook(source)
    ws = wb['Зведена']
    ws.delete_rows(2, ws.max_row)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:{ws.cell(1, ws.max_column).column_letter}1'
    ws.auto_filter.sortState = None
    keep_colours(ws, {'H', 'K', 'M'})
    set_lists(ws, {
        'H': "'Довідник типів'!$A$2:$A$13",
        'J': '"М142,М270"',
        'K': "'Довідник ПУ та БП'!$A$4:$A$10",
        'M': RESULTS,
        'N': "'Довідник причин'!$A$2:$A$12",
    })
    reset_views(wb)
    scrub_properties(wb, 'EasyWAR — базова таблиця РВіА')
    return wb


def build_air(rvia_base):
    """The ordinary Air Force table: the РВіА base with the Air Force module's columns."""
    wb = openpyxl.load_workbook(rvia_base)
    ws = wb['Зведена']
    ws['D1'] = '№ цілі (TS/KS)'
    ws['J1'] = 'Тип ЛА'
    # «Підрозділ (від кого машина)» and «Вогнева бригада» belong to РВіА.
    ws.delete_cols(16, 2)
    for letter in ('P', 'Q'):
        ws.column_dimensions.pop(letter, None)
    ws.auto_filter.ref = 'A1:O1'
    del wb['Довідник ПУ та БП']
    fill_dictionary(wb['Довідник типів'], AIR_TYPES)
    fill_dictionary(wb['Довідник причин'], AIR_CAUSES)
    # Colours on «Тип боєприпасу» name rocket munitions.
    keep_colours(ws, {'H', 'M'})
    set_lists(ws, {
        'H': f"'Довідник типів'!$A$2:$A${1 + len(AIR_TYPES)}",
        'M': RESULTS,
        'N': f"'Довідник причин'!$A$2:$A${1 + len(AIR_CAUSES)}",
    })
    reset_views(wb)
    scrub_properties(wb, 'EasyWAR — базова таблиця ПС')
    return wb


def build_pvk(source):
    """Each sheet keeps its header, PVK_EMPTY_ROWS plain rows and the total row.
    The working rows go with their per-cell fills, and so does anything right
    of the table: which rows were highlighted, and how many rows there were,
    say something about the reports even with the values removed."""
    wb = openpyxl.load_workbook(source)
    for ws in wb.worksheets:
        (table,) = ws.tables.values()
        first_col, first_row, last_col, last_row = openpyxl.utils.cell.range_boundaries(table.ref)
        assert first_col == 1 and first_row == 1 and table.totalsRowCount == 1, ws.title
        totals = [(cell.value, copy.copy(cell._style)) for cell in ws[last_row][:last_col]]
        date_style = copy.copy(ws.cell(2, 1)._style)
        ws.delete_rows(2, ws.max_row)
        if ws.max_column > last_col:
            ws.delete_cols(last_col + 1, ws.max_column - last_col)
        for letter in [key for key in ws.column_dimensions
                       if openpyxl.utils.column_index_from_string(key) > last_col]:
            del ws.column_dimensions[letter]
        for index in [key for key in ws.row_dimensions if key > 1]:
            del ws.row_dimensions[index]
        for row in range(2, 2 + PVK_EMPTY_ROWS):
            ws.cell(row, 1)._style = copy.copy(date_style)
            ws.cell(row, 1).fill = PatternFill()
        totals_row = 2 + PVK_EMPTY_ROWS
        for column, (value, style) in enumerate(totals, start=1):
            cell = ws.cell(totals_row, column, value)
            cell._style = style
        last = openpyxl.utils.get_column_letter(last_col)
        table.ref = f'A1:{last}{totals_row}'
        table.autoFilter.ref = f'A1:{last}{totals_row - 1}'
    reset_views(wb)
    scrub_properties(wb, 'EasyWAR — базова таблиця ПС рівня ПВК')
    return wb


def normalize(path):
    """openpyxl stamps the save time into core.xml and the zip entries; pin both
    so the committed tables only change when their content does."""
    with zipfile.ZipFile(path) as package:
        entries = [(info.filename, package.read(info)) for info in package.infolist()]
    stamp = STAMP.strftime('%Y-%m-%dT%H:%M:%SZ').encode()
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as package:
        for name, data in entries:
            if name == 'docProps/core.xml':
                data = re.sub(rb'(<dcterms:modified[^>]*>)[^<]*', rb'\g<1>' + stamp, data)
            package.writestr(zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0)), data,
                             compress_type=zipfile.ZIP_DEFLATED)


def check(path, forbidden):
    with zipfile.ZipFile(path) as package:
        names = package.namelist()
        bad = [n for n in names if n.startswith(('customXml/', 'xl/printerSettings/'))]
        blob = b''.join(package.read(n) for n in names)
    bad += [f'text {text!r}' for text in forbidden if text.encode() in blob]
    if b'absPath' in blob:
        bad.append('absPath')
    if bad:
        sys.exit(f'{path.name}: не очищено: {bad}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--rvia', type=Path, required=True)
    parser.add_argument('--pvk', type=Path, required=True)
    args = parser.parse_args()

    source_book = openpyxl.load_workbook(args.rvia)
    # Text from the records must be gone from the output package, except words
    # that the kept reference sheets and header legitimately contain.
    kept = {str(c.value) for ws in source_book.worksheets if ws.title != 'Зведена'
            for row in ws.iter_rows() for c in row if c.value is not None}
    kept |= {str(c.value) for c in source_book['Зведена'][1] if c.value is not None}
    kept |= {'Командний пункт', 'НЕВІДОМО'}  # generic colour rules on «Тип цілі» / «Результат»
    rvia_data = {c.value for row in source_book['Зведена'].iter_rows(min_row=2) for c in row
                 if isinstance(c.value, str) and len(c.value) > 2} - kept
    authors = {openpyxl.load_workbook(p).properties.lastModifiedBy for p in (args.rvia, args.pvk)} - {None, ''}

    OUT.mkdir(parents=True, exist_ok=True)
    rvia_forbidden = rvia_data | authors | {'РУК,ГРВ'}
    targets = {
        'rvia-base.xlsx': (lambda: build_rvia(args.rvia), rvia_forbidden),
        'air-base.xlsx': (lambda: build_air(OUT / 'rvia-base.xlsx'), rvia_forbidden | {'М142,М270'}),
        'pvk-base.xlsx': (lambda: build_pvk(args.pvk), authors),
    }
    for name, (build, forbidden) in targets.items():
        wb = build()
        path = OUT / name
        wb.save(path)
        normalize(path)
        check(path, forbidden)
        print(f'{path.relative_to(OUT.parent.parent.parent)}: {path.stat().st_size} байт, аркуші {wb.sheetnames}')


if __name__ == '__main__':
    main()
