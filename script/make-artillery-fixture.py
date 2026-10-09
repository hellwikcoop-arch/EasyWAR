#!/usr/bin/env python3
"""Створює синтетичну таблицю обліку артилерійських боєприпасів tests/fixtures/artillery-sample.xlsx.

Розкладка аркушів і шапок повторює робочу таблицю УДШВ (підрозділи парами «витрата / залишок», підсумкова пара «ВСЬОГО»,
службові аркуші), але назви підрозділів і всі числа вигадані. Потрібен лише для тестів розбору й запису.

    pip install openpyxl
    python3 script/make-artillery-fixture.py
"""
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter as L

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "artillery-sample.xlsx"
UNITS = ["11 одшбр", "12 одшбр", "13 ошп", "АГр, РУК 14 оабр", ""]      # назви вигадані; остання пара без назви в шапці
UNITS_ZAR = ["11 одшбр", "12 одшбр", "АГр 14 оабр", "99 омбр"]       # «99 омбр» немає в аркуші снарядів
FIRE_UNITS = ["11 одшбр", "12 одшбр", "13 ошп", "АГр 14 оабр", "21 омбр"]  # п'ята — назва вільної пари за формулами
# (підпис, [витрата, залишок] для кожного підрозділу) — None означає порожню комірку
HIGH = ["155 мм М982 Excalibur", "155 мм Bonus", "155 мм Vulcano", "155 мм DM702", "155 мм Coperhed"]
ITEMS = [
    ("60 мм міна ОФ", [(3, 120), (None, 80), (None, None), (None, None), (None, None)]),
    ("82 мм міна ОФ", [(10, 400), (4, 250), (None, 90), (None, None)]),
    ("120 мм міна ОФ", [(25, 900), (None, 640), (None, None), (None, None)]),
    ("122 мм постріли  РС 21ОФ", [(8, 60), (None, None), (None, None), (None, None)]),
    ("122 мм ВОФ-5", [(None, None), (12, 300), (None, None), (None, None)]),
    ("152 мм ВОФ-546", [(None, None), (None, None), (None, None), (5, 410)]),
    ("155 мм постріл М107/М1(ОФ)", [(None, 505), (7, 2640), (None, None), (14, 493)]),
    ("155 мм постріл М795 (ОФ)", [(None, None), (None, 80), (None, None), (6, 120)]),
    ("155 мм постріл М483  (КАС)", [(None, None), (None, 56), (None, None), (None, 142)]),
    ("155 мм постріл М741 (Д/М)", [(None, None), (None, 342), (None, None), (None, 985)]),
    ("155 мм постріл DM105 (ДИМ)", [(None, 30), (None, None), (None, None), (2, 18)]),
    ("155 мм постріл DM116 (ОСВ)", [(None, None), (None, 11), (None, None), (None, 24)]),
    ("203 мм постріл ОФ М650", [(None, None), (None, None), (None, None), (1, 16)]),
    ("227 мм М31А2 (ОФ)", [(None, None), (None, None), (None, None), (2, 40)]),
]
CHARGES = [("155мм М3А1", [(None, 87), (None, None), (4, 100), (None, None)]), ("М4А1", [(None, None), (3, 200), (None, None), (None, None)]),
           ("М119А1", [(None, None), (None, None), (None, 50), (2, 9)])]
LOSSES_UNITS = ["11 одшбр", "12 одшбр", "АГр 14 оабр"]   # «АГр 14 оабр» ≈ «АГр, РУК 14 оабр»


def pair_headers(ws, row, n_pairs, total=True):
    for i in range(n_pairs):
        ws.cell(row, 2 + 2 * i, "витрата б/п")
        ws.cell(row, 3 + 2 * i, "залишок б/п")
    if total:
        ws.cell(row, 2 + 2 * n_pairs, "витрата б/п")
        ws.cell(row, 3 + 2 * n_pairs, "залишок б/п")


def unit_names(ws, row, names, total_label="ВСЬОГО"):
    ws.cell(row, 1, "Сили (засоби)")
    for i, name in enumerate(names):
        c = 2 + 2 * i
        if name:
            ws.cell(row, c, name)
        ws.merge_cells(start_row=row, start_column=c, end_row=row, end_column=c + 1)
    c = 2 + 2 * len(names)
    ws.cell(row, c, total_label)
    ws.merge_cells(start_row=row, start_column=c, end_row=row, end_column=c + 1)


def total_formulas(ws, row, n_pairs):
    tc = 2 + 2 * n_pairs
    ws.cell(row, tc, "=" + "+".join(f"{L(2 + 2 * i)}{row}" for i in range(n_pairs)))
    ws.cell(row, tc + 1, "=" + "+".join(f"{L(3 + 2 * i)}{row}" for i in range(n_pairs)))


def main():
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    sc = wb.create_sheet("Сц")
    sc.sheet_state = "hidden"
    sc["A1"] = "Список виконаних вогневих завдань"
    sc.append([])
    sc.append([])
    sc.append(["№ з/п", "Час", "Артилерійська система", "Координати цілі (MGRS)", "Район", "Характер цілі", "Підрозділ який виконував в/з",
               "Калібр снаряду", "К-сть б-сів", "Результат ураження", "Марка снаряду"])

    # ---- витр.залиш.-СН
    ws = wb.create_sheet("витр.залиш.-СН")
    n = len(UNITS)
    ws["A1"] = "Витрата та залишок боєприпасів в підрозділах артилерії УДШВ"
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=2 + 2 * n + 1)
    unit_names(ws, 2, UNITS)
    ws["A3"] = "Витрата високоточних боєприпасів"
    ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=2 + 2 * n + 1)
    pair_headers(ws, 4, n)
    for i, label in enumerate(HIGH):
        r = 5 + i
        ws.cell(r, 1, label)
        if label.endswith("Excalibur"):
            ws.cell(r, 5, 8)
        if label.endswith("Coperhed"):
            ws.cell(r, 3, 7)
        total_formulas(ws, r, n)
    r_hi_total = 5 + len(HIGH)
    ws.cell(r_hi_total, 1, "ВСЬОГО: ")
    for c in range(2, 4 + 2 * n):
        ws.cell(r_hi_total, c, f"=SUM({L(c)}5:{L(c)}{r_hi_total - 1})")
    r = r_hi_total + 1
    ws.cell(r, 1, "Кількість витрати боєприпасів")
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2 + 2 * n + 1)
    pair_headers(ws, r + 1, n)
    first = r + 2
    for i, (label, vals) in enumerate(ITEMS):
        rr = first + i
        ws.cell(rr, 1, label)
        for j, (spent, left) in enumerate(list(vals) + [(None, None)] * (n - len(vals))):
            if spent is not None:
                ws.cell(rr, 2 + 2 * j, spent)
            if left is not None:
                ws.cell(rr, 3 + 2 * j, left)
        total_formulas(ws, rr, n)
    last = first + len(ITEMS) - 1
    r_total = last + 1
    ws.cell(r_total, 1, "ВСЬОГО: ")
    for c in range(2, 4 + 2 * n):
        ws.cell(r_total, c, f"=SUM({L(c)}{first}:{L(c)}{last})")
    # друга таблиця: за калібрами (формули від першої)
    r2 = r_total + 2
    ws.cell(r2, 1, "Витрата та залишок боєприпасів в підрозділах артилерії УДШВ")
    unit_names(ws, r2 + 1, UNITS)
    ws.cell(r2 + 2, 1, "Кількість витрати боєприпасів")
    for k, (name, rows) in enumerate((("60 мм", [first]), ("82 мм", [first + 1]), ("155 мм ОФ", [first + 6, first + 7]))):
        rr = r2 + 3 + k
        ws.cell(rr, 1, name)
        for c in range(2, 4 + 2 * n):
            ws.cell(rr, c, "=" + "+".join(f"{L(c)}{x}" for x in rows))

    # ---- витр.залиш.-ЗАР
    wz = wb.create_sheet("витр.залиш.-ЗАР")
    nz = len(UNITS_ZAR)
    wz["A1"] = "Витрата та залишок порохових зарядів"
    unit_names(wz, 2, UNITS_ZAR, "ВСЬОГО:")
    wz["A3"] = "Кількість зарядів "
    wz["A4"] = "ЗАРЯДИ"
    pair_headers(wz, 4, nz)
    for i, (label, vals) in enumerate(CHARGES):
        rr = 5 + i
        wz.cell(rr, 1, label)
        for j, (spent, left) in enumerate(list(vals) + [(None, None)] * (nz - len(vals))):
            if spent is not None:
                wz.cell(rr, 2 + 2 * j, spent)
            if left is not None:
                wz.cell(rr, 3 + 2 * j, left)
        total_formulas(wz, rr, nz)
    rt = 5 + len(CHARGES)
    wz.cell(rt, 1, "ВСЬОГО:  ")
    for c in range(2, 4 + 2 * nz):
        wz.cell(rt, c, f"=SUM({L(c)}5:{L(c)}{rt - 1})")

    # ---- втр.прот!
    wl = wb.create_sheet("втр.прот!")
    wl["A1"] = "втрати противника за ДОБУ"
    heads = [("О\\С", ["200", "300"]), ("ПУ, КП, КСП", ["знищ"]), ("танки", ["знищ", "пошк"]), ("артилерія", ["знищ", "пошк"])]
    c = 2
    for name, subs in heads:
        wl.cell(2, c, name)
        for k, sub in enumerate(subs):
            wl.cell(3, c + k, sub)
        c += len(subs)
    for i, unit in enumerate(LOSSES_UNITS):
        wl.cell(4 + i, 1, unit)
    wl["B4"], wl["C4"], wl["F4"], wl["G4"] = 1, 3, 2, 1
    wl.cell(4 + len(LOSSES_UNITS) + 1, 1, "ВСЬОГО")
    for cc in range(2, c):
        wl.cell(4 + len(LOSSES_UNITS) + 1, cc, f"=SUM({L(cc)}4:{L(cc)}{3 + len(LOSSES_UNITS)})")

    # ---- Витрата снарядів
    wv = wb.create_sheet("Витрата снарядів")
    wv["A1"], wv["B1"], wv["C1"], wv["D1"] = "Артилерійські підрозділи ", " Всього виконано ВгЗ", "З  них КББ", "Витрата "
    for k, cal in enumerate(["155 мм", "152", "122 мм", "122 мм РС", "105 мм", "120 мм", "82 мм", "60 мм"]):
        wv.cell(2, 4 + k, cal)
    wv.cell(2, 12, "ВСЬОГО")
    for i, unit in enumerate(FIRE_UNITS):
        rr = 3 + i
        col = L(2 + 2 * i)                   # колонка «витрата» цього підрозділу в аркуші снарядів
        wv.cell(rr, 1, unit)
        if i < 4:
            wv.cell(rr, 2, 10 + i)
            wv.cell(rr, 3, 4 + i)
        for k in range(8):
            wv.cell(rr, 4 + k, f"='витр.залиш.-СН'!{col}{first + k}")
        wv.cell(rr, 12, f"=SUM(D{rr}:K{rr})")

    # ---- службові приховані аркуші
    wn = wb.create_sheet("потреба")
    wn.sheet_state = "hidden"
    wn["A3"] = "Сили (засоби)"
    wn["B34"] = 3
    wh = wb.create_sheet("Заявка")
    wh.sheet_state = "hidden"
    wh["B7"], wh["C7"], wh["D7"], wh["E7"], wh["F7"] = "№ п/п", "Калібр", "Витрата", "Залишок", "Потреба"
    wb.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
