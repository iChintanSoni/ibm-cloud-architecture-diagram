use std::sync::Mutex;

use tauri::{Emitter, Manager};

/// A `.icad` path handed to this process via OS file association at launch,
/// consumed once by the frontend's `get_startup_file` command on mount. Kept
/// separate from `OPEN_FILE_EVENT` below because the frontend isn't listening
/// for events yet at the point this is first known (see module docs).
struct StartupFile(Mutex<Option<String>>);

/// Event emitted for a `.icad` path arriving *after* the frontend has already
/// mounted: a second launch caught by the single-instance plugin, or a macOS
/// "open with" request delivered as a `RunEvent::Opened` after startup.
const OPEN_FILE_EVENT: &str = "icad://open-file";

/// Picks the `.icad` path out of a process argv list, skipping the binary
/// name and any flag-shaped arguments a launcher may have prepended.
fn icad_path_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && arg.to_lowercase().ends_with(".icad"))
}

#[tauri::command]
fn get_startup_file(state: tauri::State<StartupFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin registered (Tauri requirement): a second
        // launch — e.g. double-clicking another .icad file while the app is
        // already open — is redirected here instead of spawning a new
        // process, so we forward the path into the running app and focus it.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = icad_path_from_args(argv) {
                let _ = app.emit(OPEN_FILE_EVENT, path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(StartupFile(Mutex::new(icad_path_from_args(
            std::env::args(),
        ))))
        .invoke_handler(tauri::generate_handler![get_startup_file])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS delivers "Open With" file requests as this run-loop event
            // (including for the very first cold launch) rather than argv —
            // Windows/Linux route the same case through process argv, which
            // `single_instance`/the initial `StartupFile` state already cover.
            // `RunEvent::Opened` only exists in tauri's macOS/iOS build of `RunEvent` at all
            // (confirmed by a real cross-platform CI run: referencing it unconditionally fails
            // to compile on Windows/Linux with "no variant named `Opened`"), so the match arm
            // itself must be cfg-gated, not just documented as macOS-only.
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            let is_icad = path
                                .extension()
                                .is_some_and(|ext| ext.eq_ignore_ascii_case("icad"));
                            if is_icad {
                                let _ = app_handle.emit(OPEN_FILE_EVENT, path.to_string_lossy());
                            }
                        }
                    }
                }
                _ => {}
            }
        });
}
