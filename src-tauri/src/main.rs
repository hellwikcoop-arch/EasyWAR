#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Окремий режим сервера зустрічі й EasyWAR Relay (без вікна, бази й профілів).
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--relay-server") {
        let result = easywar_lib::pair_relay::ServerOptions::parse(&args[2..])
            .and_then(easywar_lib::pair_relay::run_server_blocking);
        if let Err(error) = result {
            eprintln!("EasyWAR: {error}");
            std::process::exit(1);
        }
        return;
    }
    easywar_lib::run();
}
