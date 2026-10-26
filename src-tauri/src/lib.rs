pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
    .invoke_handler(tauri::generate_handler![
      commands::get_desktop_sources,
      commands::start_desktop_capture,
      commands::get_latest_desktop_frame,
      commands::get_desktop_audio_chunk,
      commands::stop_desktop_capture
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
