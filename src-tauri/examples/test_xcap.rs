fn main() {
    println!("=== MONITORS ===");
    match xcap::Monitor::all() {
        Ok(monitors) => {
            println!("Found {} monitors", monitors.len());
            for (i, m) in monitors.iter().enumerate() {
                println!("Monitor {}: width={:?}, height={:?}", i, m.width(), m.height());
                match m.capture_image() {
                    Ok(img) => println!("  Captured image: {}x{}", img.width(), img.height()),
                    Err(e) => println!("  Capture error: {:?}", e),
                }
            }
        }
        Err(e) => println!("Error getting monitors: {:?}", e),
    }

    println!("=== WINDOWS ===");
    match xcap::Window::all() {
        Ok(windows) => {
            println!("Found {} total windows", windows.len());
            for (i, w) in windows.iter().enumerate() {
                let title = w.title().unwrap_or_default();
                let app = w.app_name().unwrap_or_default();
                let is_min = w.is_minimized().unwrap_or(false);
                let w_w = w.width().unwrap_or(0);
                let w_h = w.height().unwrap_or(0);
                if !title.is_empty() || !app.is_empty() {
                    println!("Window {}: title='{}', app='{}', min={}, size={}x{}", i, title, app, is_min, w_w, w_h);
                }
            }
        }
        Err(e) => println!("Error getting windows: {:?}", e),
    }
}
