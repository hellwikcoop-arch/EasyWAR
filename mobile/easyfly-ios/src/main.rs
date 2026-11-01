// Настільний запуск тієї самої оболонки (для перевірки на Mac/Linux без телефона).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    easyfly_ios_lib::run()
}
