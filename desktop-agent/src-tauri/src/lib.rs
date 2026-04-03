use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

mod agent;

#[tauri::command]
fn get_config() -> serde_json::Value {
    serde_json::json!({
        "api_url": std::env::var("API_URL").unwrap_or_else(|_| "http://localhost:3001".into()),
        "agent_key": std::env::var("AGENT_KEY").unwrap_or_default(),
        "poll_interval": std::env::var("POLL_INTERVAL").unwrap_or_else(|_| "5000".into()),
        "simulate": std::env::var("SIMULATE").unwrap_or_else(|_| "false".into()),
    })
}

#[tauri::command]
fn save_config(api_url: String, agent_key: String) {
    std::env::set_var("API_URL", &api_url);
    std::env::set_var("AGENT_KEY", &agent_key);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Build tray menu
            let quit = MenuItem::with_id(app, "quit", "Quit PrintDrop", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Dashboard", true, None::<&str>)?;
            let status = MenuItem::with_id(app, "status", "Status: Polling...", false, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status, &show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("PrintDrop Agent")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, save_config])
        .run(tauri::generate_context!())
        .expect("error while running PrintDrop Agent");
}
