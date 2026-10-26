use base64::Engine;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use windows::core::BOOL;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Dwm::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::Threading::*;
use windows::Win32::UI::WindowsAndMessaging::*;

use windows_capture::{
    capture::{Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
    window::Window,
};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DesktopSource {
    pub id: String,
    pub name: String,
    pub app_name: String,
    pub is_window: bool,
    pub width: u32,
    pub height: u32,
    pub thumbnail: Option<String>,
}

static CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);
static LATEST_FRAME: Mutex<Option<Vec<u8>>> = Mutex::new(None);
static AUDIO_CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);
static AUDIO_CHUNK_BUFFER: Mutex<Vec<u8>> = Mutex::new(Vec::new());

struct WgcCaptureHandler {
    target_res: u32,
    max_fps: u32,
    last_frame_instant: Instant,
}

impl GraphicsCaptureApiHandler for WgcCaptureHandler {
    type Flags = (u32, u32);
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            target_res: ctx.flags.0,
            max_fps: ctx.flags.1,
            last_frame_instant: Instant::now(),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if !CAPTURE_RUNNING.load(Ordering::SeqCst) {
            capture_control.stop();
            return Ok(());
        }

        let min_interval = Duration::from_millis(1000 / self.max_fps.max(1) as u64);
        if self.last_frame_instant.elapsed() < min_interval {
            return Ok(());
        }
        self.last_frame_instant = Instant::now();

        let buffer = frame.buffer()?;
        let width = buffer.width();
        let height = buffer.height();

        let mut nopad_vec = Vec::new();
        let raw_pixels = buffer.as_nopadding_buffer(&mut nopad_vec);

        let (target_w, target_h) = if self.target_res == 720 && width > 1280 {
            let w = 1280;
            let h = (1280.0 * height as f32 / width as f32) as u32;
            (w, h)
        } else if self.target_res == 1080 && width > 1920 {
            let w = 1920;
            let h = (1920.0 * height as f32 / width as f32) as u32;
            (w, h)
        } else {
            (width, height)
        };

        let mut buf = std::io::Cursor::new(Vec::with_capacity(128 * 1024));
        if target_w < width {
            if let Some(img) = image::RgbaImage::from_raw(width, height, raw_pixels.to_vec()) {
                let resized = image::imageops::resize(&img, target_w, target_h, image::imageops::FilterType::Nearest);
                let dyn_img = image::DynamicImage::ImageRgba8(resized);
                let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 70);
                let _ = encoder.encode_image(&dyn_img);
            }
        } else {
            if let Some(img) = image::RgbaImage::from_raw(width, height, raw_pixels.to_vec()) {
                let dyn_img = image::DynamicImage::ImageRgba8(img);
                let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 70);
                let _ = encoder.encode_image(&dyn_img);
            }
        }

        let jpeg_bytes = buf.into_inner();
        if !jpeg_bytes.is_empty() {
            if let Ok(mut lock) = LATEST_FRAME.lock() {
                *lock = Some(jpeg_bytes);
            }
        }

        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }
}

unsafe fn draw_cursor_onto_dc(hdc_mem: HDC, offset_x: i32, offset_y: i32) {
    let mut ci = CURSORINFO {
        cbSize: std::mem::size_of::<CURSORINFO>() as u32,
        ..Default::default()
    };
    if GetCursorInfo(&mut ci).is_ok() && (ci.flags.0 & CURSOR_SHOWING.0) != 0 {
        let x = ci.ptScreenPos.x - offset_x;
        let y = ci.ptScreenPos.y - offset_y;
        let _ = DrawIconEx(
            hdc_mem,
            x,
            y,
            ci.hCursor.into(),
            0,
            0,
            0,
            None,
            DI_NORMAL,
        );
    }
}

unsafe fn capture_dc_to_image(hdc_src: HDC, x: i32, y: i32, width: i32, height: i32) -> Option<image::RgbaImage> {
    if width <= 0 || height <= 0 {
        return None;
    }
    let hdc_mem = CreateCompatibleDC(Some(hdc_src));
    let hbm = CreateCompatibleBitmap(hdc_src, width, height);
    let old_bm = SelectObject(hdc_mem, hbm.into());

    let _ = BitBlt(hdc_mem, 0, 0, width, height, Some(hdc_src), x, y, SRCCOPY);
    draw_cursor_onto_dc(hdc_mem, x, y);

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut raw_pixels = vec![0u8; (width * height * 4) as usize];
    let lines = GetDIBits(
        hdc_mem,
        hbm,
        0,
        height as u32,
        Some(raw_pixels.as_mut_ptr() as *mut _),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    SelectObject(hdc_mem, old_bm);
    let _ = DeleteObject(hbm.into());
    let _ = DeleteDC(hdc_mem);

    if lines == 0 {
        return None;
    }

    // Convert BGRA to RGBA
    for chunk in raw_pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2);
        chunk[3] = 255;
    }

    image::RgbaImage::from_raw(width as u32, height as u32, raw_pixels)
}

unsafe fn capture_window_to_image(hwnd: HWND) -> Option<image::RgbaImage> {
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_err() {
        return None;
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return None;
    }

    let hdc_screen = GetDC(None);
    if hdc_screen.0.is_null() {
        return None;
    }
    let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
    let hbm = CreateCompatibleBitmap(hdc_screen, width, height);
    let old_bm = SelectObject(hdc_mem, hbm.into());

    // Try modern hardware DWM surface render via user32.dll PrintWindow (PW_RENDERFULLCONTENT = 2)
    // This allows capturing hardware accelerated windows even when occluded
    type PrintWindowFn = unsafe extern "system" fn(HWND, HDC, u32) -> BOOL;
    let mut rendered = false;
    if let Ok(user32) = windows::Win32::System::LibraryLoader::LoadLibraryA(windows::core::s!("user32.dll")) {
        if let Some(pw_ptr) = windows::Win32::System::LibraryLoader::GetProcAddress(user32, windows::core::s!("PrintWindow")) {
            let pw: PrintWindowFn = std::mem::transmute(pw_ptr);
            rendered = pw(hwnd, hdc_mem, 2).as_bool();
        }
        let _ = windows::Win32::Foundation::FreeLibrary(user32);
    }

    if !rendered {
        // Fallback to direct screen BitBlt
        let _ = BitBlt(hdc_mem, 0, 0, width, height, Some(hdc_screen), rect.left, rect.top, SRCCOPY);
    }
    draw_cursor_onto_dc(hdc_mem, rect.left, rect.top);

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut raw_pixels = vec![0u8; (width * height * 4) as usize];
    let lines = GetDIBits(
        hdc_mem,
        hbm,
        0,
        height as u32,
        Some(raw_pixels.as_mut_ptr() as *mut _),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    SelectObject(hdc_mem, old_bm);
    let _ = DeleteObject(hbm.into());
    let _ = DeleteDC(hdc_mem);
    ReleaseDC(None, hdc_screen);

    if lines == 0 {
        return None;
    }

    for chunk in raw_pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2);
        chunk[3] = 255;
    }

    image::RgbaImage::from_raw(width as u32, height as u32, raw_pixels)
}

fn image_to_jpeg_base64(img: &image::RgbaImage, thumb_w: u32, thumb_h: u32) -> Option<String> {
    let resized = if img.width() > thumb_w || img.height() > thumb_h {
        image::imageops::thumbnail(img, thumb_w, thumb_h)
    } else {
        img.clone()
    };
    let mut buf = std::io::Cursor::new(Vec::new());
    let dyn_img = image::DynamicImage::ImageRgba8(resized);
    if dyn_img.write_to(&mut buf, image::ImageFormat::Jpeg).is_ok() {
        Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(buf.into_inner())))
    } else {
        None
    }
}

#[tauri::command]
pub fn get_desktop_sources() -> Result<Vec<DesktopSource>, String> {
    let mut sources = Vec::new();

    unsafe {
        // 1. Monitors
        let screen_w = GetSystemMetrics(SM_CXSCREEN);
        let screen_h = GetSystemMetrics(SM_CYSCREEN);
        let hdc_screen = GetDC(None);

        let thumb = if !hdc_screen.0.is_null() {
            let t = capture_dc_to_image(hdc_screen, 0, 0, screen_w, screen_h)
                .and_then(|img| image_to_jpeg_base64(&img, 320, 180));
            ReleaseDC(None, hdc_screen);
            t
        } else {
            None
        };

        sources.push(DesktopSource {
            id: "monitor:0".to_string(),
            name: format!("Main Display ({}x{})", screen_w, screen_h),
            app_name: "Screen 1".to_string(),
            is_window: false,
            width: screen_w as u32,
            height: screen_h as u32,
            thumbnail: thumb,
        });

        // 2. Windows via EnumWindows
        struct EnumData {
            windows: Vec<DesktopSource>,
        }
        let mut data = EnumData { windows: Vec::new() };

        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let data = &mut *(lparam.0 as *mut EnumData);

            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                return BOOL(1);
            }

            let mut title_buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut title_buf);
            if len <= 0 {
                return BOOL(1);
            }
            let title = String::from_utf16_lossy(&title_buf[..len as usize]).trim().to_string();
            if title.is_empty() || title == "Program Manager" || title == "Settings" || title == "Windows Input Experience" {
                return BOOL(1);
            }

            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_err() {
                return BOOL(1);
            }
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            if width < 160 || height < 120 {
                return BOOL(1);
            }

            // Check if cloaked by DWM (Windows 10/11 virtual desktops/suspended UWP apps)
            let mut cloaked: u32 = 0;
            let _ = DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut _ as *mut _,
                std::mem::size_of::<u32>() as u32,
            );
            if cloaked != 0 {
                return BOOL(1);
            }

            // App name from process
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let mut app_name = "Application".to_string();
            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut proc_buf = [0u16; 260];
                let mut size = proc_buf.len() as u32;
                if QueryFullProcessImageNameW(handle, PROCESS_NAME_FORMAT(0), windows::core::PWSTR(proc_buf.as_mut_ptr()), &mut size).is_ok() {
                    let full_path = String::from_utf16_lossy(&proc_buf[..size as usize]);
                    if let Some(fname) = std::path::Path::new(&full_path).file_name() {
                        app_name = fname.to_string_lossy().to_string();
                    }
                }
                let _ = CloseHandle(handle);
            }

            let thumb = capture_window_to_image(hwnd).and_then(|img| image_to_jpeg_base64(&img, 320, 180));

            data.windows.push(DesktopSource {
                id: format!("window:{}", hwnd.0 as usize),
                name: title,
                app_name,
                is_window: true,
                width: width as u32,
                height: height as u32,
                thumbnail: thumb,
            });

            BOOL(1)
        }

        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut data as *mut _ as isize));
        sources.extend(data.windows);
    }

    Ok(sources)
}

fn start_wasapi_audio_capture() {
    AUDIO_CAPTURE_RUNNING.store(true, Ordering::SeqCst);
    thread::spawn(|| {
        let _ = wasapi::initialize_mta().ok();

        let enumerator = match wasapi::DeviceEnumerator::new() {
            Ok(e) => e,
            Err(e) => {
                log::warn!("WASAPI: Failed to create DeviceEnumerator: {:?}", e);
                return;
            }
        };

        let dev = match enumerator.get_default_device(&wasapi::Direction::Render) {
            Ok(d) => d,
            Err(e) => {
                log::warn!("WASAPI: Failed to get default render device: {:?}", e);
                return;
            }
        };

        let mut client = match dev.get_iaudioclient() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("WASAPI: Failed to get IAudioClient: {:?}", e);
                return;
            }
        };

        let format = match client.get_mixformat() {
            Ok(f) => f,
            Err(e) => {
                log::warn!("WASAPI: Failed to get mixformat: {:?}", e);
                return;
            }
        };

        let stream_mode = wasapi::StreamMode::PollingShared {
            autoconvert: true,
            buffer_duration_hns: 0,
        };

        if let Err(e) = client.initialize_client(&format, &wasapi::Direction::Capture, &stream_mode) {
            log::warn!("WASAPI: Failed to initialize loopback client: {:?}", e);
            return;
        }

        let capture_client = match client.get_audiocaptureclient() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("WASAPI: Failed to get AudioCaptureClient: {:?}", e);
                return;
            }
        };

        if let Err(e) = client.start_stream() {
            log::warn!("WASAPI: Failed to start audio stream: {:?}", e);
            return;
        }

        log::info!(
            "WASAPI loopback audio stream active (channels={}, rate={})",
            format.get_nchannels(),
            format.get_samplespersec()
        );

        let channels = format.get_nchannels() as usize;
        let bits_per_sample = format.get_bitspersample() as usize;
        let is_float = matches!(format.get_subformat(), Ok(wasapi::SampleType::Float));
        let bytes_per_frame = channels * (bits_per_sample / 8);

        let mut raw_buf = vec![0u8; 1024 * 64];

        while AUDIO_CAPTURE_RUNNING.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(20));
            if !AUDIO_CAPTURE_RUNNING.load(Ordering::SeqCst) {
                break;
            }

            let mut pcm_floats: Vec<f32> = Vec::new();

            while let Ok((frames, info)) = capture_client.read_from_device(&mut raw_buf) {
                if frames == 0 {
                    break;
                }
                if info.flags.silent {
                    continue;
                }

                let total_bytes = frames as usize * bytes_per_frame;
                let slice = &raw_buf[..total_bytes.min(raw_buf.len())];

                if is_float && bits_per_sample == 32 {
                    for frame_chunk in slice.chunks_exact(bytes_per_frame) {
                        let left = f32::from_le_bytes([frame_chunk[0], frame_chunk[1], frame_chunk[2], frame_chunk[3]]);
                        let right = if channels >= 2 {
                            f32::from_le_bytes([frame_chunk[4], frame_chunk[5], frame_chunk[6], frame_chunk[7]])
                        } else {
                            left
                        };
                        pcm_floats.push(left);
                        pcm_floats.push(right);
                    }
                } else if bits_per_sample == 16 {
                    for frame_chunk in slice.chunks_exact(bytes_per_frame) {
                        let left = i16::from_le_bytes([frame_chunk[0], frame_chunk[1]]) as f32 / 32768.0;
                        let right = if channels >= 2 {
                            i16::from_le_bytes([frame_chunk[2], frame_chunk[3]]) as f32 / 32768.0
                        } else {
                            left
                        };
                        pcm_floats.push(left);
                        pcm_floats.push(right);
                    }
                }
            }

            if !pcm_floats.is_empty() {
                let byte_slice: &[u8] = unsafe {
                    std::slice::from_raw_parts(
                        pcm_floats.as_ptr() as *const u8,
                        pcm_floats.len() * std::mem::size_of::<f32>(),
                    )
                };
                if let Ok(mut lock) = AUDIO_CHUNK_BUFFER.lock() {
                    if lock.len() < 1024 * 512 {
                        lock.extend_from_slice(byte_slice);
                    }
                }
            }
        }

        let _ = client.stop_stream().ok();
        log::info!("WASAPI loopback audio stream stopped");
    });
}

#[tauri::command]
pub fn start_desktop_capture(source_id: String, fps: u32, res: u32, capture_audio: Option<bool>) -> Result<u16, String> {
    CAPTURE_RUNNING.store(true, Ordering::SeqCst);
    let fps = if fps == 0 || fps > 60 { 30 } else { fps };

    if capture_audio.unwrap_or(true) {
        start_wasapi_audio_capture();
    }

    let is_monitor = source_id.starts_with("monitor:");
    let hwnd_val: usize = if is_monitor {
        0
    } else {
        source_id.split(':').nth(1).unwrap_or("0").parse().unwrap_or(0)
    };

    thread::spawn(move || {
        let mut wgc_started = false;

        if is_monitor {
            if let Ok(monitor) = Monitor::primary() {
                let settings = Settings::new(
                    monitor,
                    CursorCaptureSettings::WithCursor,
                    DrawBorderSettings::WithoutBorder,
                    SecondaryWindowSettings::Default,
                    MinimumUpdateIntervalSettings::Custom(Duration::from_millis(1000 / fps as u64)),
                    DirtyRegionSettings::Default,
                    ColorFormat::Rgba8,
                    (res, fps),
                );
                if let Ok(control) = WgcCaptureHandler::start_free_threaded(settings) {
                    wgc_started = true;
                    log::info!("WGC hardware monitor capture started successfully");
                    while CAPTURE_RUNNING.load(Ordering::SeqCst) && !control.is_finished() {
                        thread::sleep(Duration::from_millis(50));
                    }
                    let _ = control.stop();
                }
            }
        } else {
            if let Ok(windows_list) = Window::enumerate() {
                if let Some(target_window) = windows_list.into_iter().find(|w| w.as_raw_hwnd() as usize == hwnd_val) {
                    let settings = Settings::new(
                        target_window,
                        CursorCaptureSettings::WithCursor,
                        DrawBorderSettings::WithoutBorder,
                        SecondaryWindowSettings::Default,
                        MinimumUpdateIntervalSettings::Custom(Duration::from_millis(1000 / fps as u64)),
                        DirtyRegionSettings::Default,
                        ColorFormat::Rgba8,
                        (res, fps),
                    );
                    if let Ok(control) = WgcCaptureHandler::start_free_threaded(settings) {
                        wgc_started = true;
                        log::info!("WGC hardware window capture started successfully");
                        while CAPTURE_RUNNING.load(Ordering::SeqCst) && !control.is_finished() {
                            thread::sleep(Duration::from_millis(50));
                        }
                        let _ = control.stop();
                    }
                }
            }
        }

        // If WGC succeeded and completed, exit
        if wgc_started {
            return;
        }

        // Fallback to GDI capture loop only if WGC could not start
        log::warn!("WGC capture could not start; falling back to GDI capture");
        let interval = Duration::from_millis((1000 / fps) as u64);
        while CAPTURE_RUNNING.load(Ordering::SeqCst) {
            let start = Instant::now();

            let maybe_img = unsafe {
                if is_monitor {
                    let screen_w = GetSystemMetrics(SM_CXSCREEN);
                    let screen_h = GetSystemMetrics(SM_CYSCREEN);
                    let hdc_screen = GetDC(None);
                    if !hdc_screen.0.is_null() {
                        let img = capture_dc_to_image(hdc_screen, 0, 0, screen_w, screen_h);
                        ReleaseDC(None, hdc_screen);
                        img
                    } else {
                        None
                    }
                } else {
                    capture_window_to_image(HWND(hwnd_val as *mut _))
                }
            };

            if let Some(img) = maybe_img {
                let (target_w, target_h) = if res == 720 && img.width() > 1280 {
                    let w = 1280;
                    let h = (1280.0 * img.height() as f32 / img.width() as f32) as u32;
                    (w, h)
                } else if res == 1080 && img.width() > 1920 {
                    let w = 1920;
                    let h = (1920.0 * img.height() as f32 / img.width() as f32) as u32;
                    (w, h)
                } else {
                    (img.width(), img.height())
                };

                let final_img = if target_w < img.width() {
                    image::imageops::resize(&img, target_w, target_h, image::imageops::FilterType::Nearest)
                } else {
                    img
                };

                let mut buf = std::io::Cursor::new(Vec::with_capacity(128 * 1024));
                let dyn_img = image::DynamicImage::ImageRgba8(final_img);
                let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 70);
                if encoder.encode_image(&dyn_img).is_ok() {
                    if let Ok(mut lock) = LATEST_FRAME.lock() {
                        *lock = Some(buf.into_inner());
                    }
                }
            }

            let elapsed = start.elapsed();
            if elapsed < interval {
                thread::sleep(interval - elapsed);
            }
        }
    });

    Ok(8766)
}

#[tauri::command]
pub fn get_latest_desktop_frame() -> tauri::ipc::Response {
    if let Ok(lock) = LATEST_FRAME.lock() {
        if let Some(bytes) = lock.as_ref() {
            return tauri::ipc::Response::new(bytes.clone());
        }
    }
    tauri::ipc::Response::new(Vec::<u8>::new())
}

#[tauri::command]
pub fn get_desktop_audio_chunk() -> Option<String> {
    if let Ok(mut lock) = AUDIO_CHUNK_BUFFER.lock() {
        if lock.is_empty() {
            None
        } else {
            let bytes = std::mem::take(&mut *lock);
            Some(base64::engine::general_purpose::STANDARD.encode(bytes))
        }
    } else {
        None
    }
}

#[tauri::command]
pub fn stop_desktop_capture() -> Result<(), String> {
    CAPTURE_RUNNING.store(false, Ordering::SeqCst);
    AUDIO_CAPTURE_RUNNING.store(false, Ordering::SeqCst);
    if let Ok(mut lock) = LATEST_FRAME.lock() {
        *lock = None;
    }
    if let Ok(mut lock) = AUDIO_CHUNK_BUFFER.lock() {
        lock.clear();
    }
    Ok(())
}
