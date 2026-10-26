use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::WindowsAndMessaging::*;

fn main() {
    println!("=== TESTING CURSOR DRAWING ===");
    unsafe {
        let width = 400;
        let height = 300;
        let hdc_screen = GetDC(None);
        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        let hbm = CreateCompatibleBitmap(hdc_screen, width, height);
        let old_bm = SelectObject(hdc_mem, hbm.into());

        let mut ci = CURSORINFO {
            cbSize: std::mem::size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        if GetCursorInfo(&mut ci).is_ok() {
            println!("Cursor flags: {:?}, pos: ({}, {})", ci.flags, ci.ptScreenPos.x, ci.ptScreenPos.y);
            if (ci.flags.0 & CURSOR_SHOWING.0) != 0 {
                let res = DrawIconEx(
                    hdc_mem,
                    10,
                    10,
                    ci.hCursor.into(),
                    0,
                    0,
                    0,
                    None,
                    DI_NORMAL,
                );
                println!("DrawIconEx result: {:?}", res);
            }
        }

        SelectObject(hdc_mem, old_bm);
        let _ = DeleteObject(hbm.into());
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(None, hdc_screen);
        println!("Cursor test succeeded!");
    }
}
