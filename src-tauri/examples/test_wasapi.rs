fn main() {
    println!("=== TESTING WASAPI LOOPBACK AUDIO CAPTURE ===");
    wasapi::initialize_mta().ok();

    let enumerator = wasapi::DeviceEnumerator::new().expect("DeviceEnumerator::new");
    let dev = enumerator.get_default_device(&wasapi::Direction::Render).expect("default render device");
    let name = dev.get_friendlyname().unwrap_or_default();
    println!("Default render device: {}", name);

    let mut client = dev.get_iaudioclient().expect("get_iaudioclient");
    let format = client.get_mixformat().expect("mixformat");
    println!("Format: channels={}, samplerate={}, bits={}", 
        format.get_nchannels(), format.get_samplespersec(), format.get_bitspersample());

    let stream_mode = wasapi::StreamMode::PollingShared {
        autoconvert: true,
        buffer_duration_hns: 0,
    };

    client.initialize_client(
        &format,
        &wasapi::Direction::Capture,
        &stream_mode,
    ).expect("initialize_client loopback");

    println!("Loopback initialized successfully!");

    let capture_client = client.get_audiocaptureclient().expect("get_audiocaptureclient");
    client.start_stream().expect("start_stream");
    println!("Stream started! Reading 10 packets...");

    let mut samples_read = 0;
    let mut buf = vec![0u8; 1024 * 16];
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(50));
        if let Ok((frames, info)) = capture_client.read_from_device(&mut buf) {
            if frames > 0 {
                samples_read += frames;
                println!("Read {} frames (total: {}), flags: {:?}", frames, samples_read, info.flags);
            }
        }
    }

    client.stop_stream().expect("stop_stream");
    println!("Stream stopped successfully! Total frames read: {}", samples_read);
}
