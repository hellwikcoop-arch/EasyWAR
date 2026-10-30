#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Окремий режим сервера зустрічі для вступу за кодом (без вікна, бази й профілів).
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--relay-server") {
        let address = args.get(2).map(String::as_str).unwrap_or("127.0.0.1:7443");
        if let Err(error) = easywar_lib::pair_relay::run_server_blocking(address) {
            eprintln!("EasyWAR: {error}");
            std::process::exit(1);
        }
        return;
    }
    easywar_lib::run();
}
