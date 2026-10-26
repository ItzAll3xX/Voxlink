use windows_capture::window::Window;
use windows_capture::monitor::Monitor;

fn main() {
    println!("=== TESTING WINDOWS-CAPTURE ENUMERATION ===");
    match Monitor::enumerate() {
        Ok(monitors) => {
            println!("Found {} monitors:", monitors.len());
            for (i, m) in monitors.iter().enumerate() {
                println!("  Monitor {}: name={:?}", i, m.name());
            }
        }
        Err(e) => println!("Error getting monitors: {:?}", e),
    }

    match Window::enumerate() {
        Ok(windows) => {
            println!("Found {} windows:", windows.len());
            for (i, w) in windows.iter().enumerate() {
                let title = w.title().unwrap_or_default();
                let app = w.process_name().unwrap_or_default();
                println!("  Window {}: title='{}', process='{}'", i, title, app);
            }
        }
        Err(e) => println!("Error getting windows: {:?}", e),
    }
}
