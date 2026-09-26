use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordableApp {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub pid: Option<u32>,
    pub has_audio: bool,
    pub icon: Option<String>,
}

pub fn get_recordable_apps_list() -> Result<Vec<RecordableApp>> {
    let mut apps = Vec::new();

    // Use sysinfo to get running processes
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    // Get active audio session PIDs on Windows
    #[cfg(windows)]
    let audio_pids = get_windows_audio_session_pids();
    #[cfg(not(windows))]
    let audio_pids: std::collections::HashSet<u32> = std::collections::HashSet::new();

    let mut seen_executables = std::collections::HashSet::new();

    for (pid, process) in sys.processes() {
        let pid_u32 = pid.as_u32();
        let exe_name = process.name().to_string_lossy().to_string();
        let exe_lower = exe_name.to_lowercase();

        if is_system_process(&exe_lower) {
            continue;
        }

        let is_audio_active = audio_pids.contains(&pid_u32);
        let friendly_name = get_friendly_name(&exe_name);

        if !seen_executables.contains(&exe_lower) {
            seen_executables.insert(exe_lower.clone());
            apps.push(RecordableApp {
                id: exe_name.clone(),
                name: friendly_name,
                executable: exe_name,
                pid: Some(pid_u32),
                has_audio: is_audio_active,
                icon: None,
            });
        } else if is_audio_active {
            if let Some(existing) = apps.iter_mut().find(|a| a.executable.eq_ignore_ascii_case(&exe_name)) {
                existing.has_audio = true;
                existing.pid = Some(pid_u32);
            }
        }
    }

    // Sort: audio-active apps first, then alphabetical by name
    apps.sort_by(|a, b| {
        match (b.has_audio, a.has_audio) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(apps)
}

fn is_system_process(name: &str) -> bool {
    let lower = name.to_lowercase();
    let sys_names = [
        "system", "smss.exe", "csrss.exe", "wininit.exe", "services.exe",
        "lsass.exe", "svchost.exe", "fontdrvhost.exe", "dwm.exe", "sihost.exe",
        "taskhostw.exe", "searchhost.exe", "runtimebroker.exe", "startmenuexperiencehost.exe",
        "shellexperiencehost.exe", "lockapp.exe", "ctfmon.exe", "conhost.exe",
        "wlanext.exe", "spoolsv.exe", "audiodg.exe", "registry", "memory compression",
        "meetily.exe", "meetily-cuda.exe", "meetily-cpu.exe", "meetily-vulkan.exe",
        "llama-helper-x86_64-pc-windows-msvc.exe", "ffmpeg-x86_64-pc-windows-msvc.exe",
        "searchindexer.exe", "securityhealthservice.exe", "smartscreen.exe",
        // macOS system daemons
        "launchd", "kernel_task", "windowserver", "coreaudiod", "distnoted",
        "loginwindow", "finder", "dock", "systemuiserver", "controlcenter",
        "notificationcenter", "talagent", "tccd", "cfprefsd",
    ];

    sys_names.iter().any(|&s| lower == s || lower.strip_suffix(".exe").unwrap_or(&lower) == s)
}

fn get_friendly_name(exe_name: &str) -> String {
    let lower = exe_name.to_lowercase();
    let base = lower.strip_suffix(".exe").unwrap_or(&lower);

    match base {
        "zoom" | "zoomworkplace" => "Zoom Workplace".to_string(),
        "teams" | "ms-teams" => "Microsoft Teams".to_string(),
        "slack" => "Slack".to_string(),
        "chrome" => "Google Chrome".to_string(),
        "msedge" => "Microsoft Edge".to_string(),
        "firefox" => "Mozilla Firefox".to_string(),
        "spotify" => "Spotify".to_string(),
        "discord" => "Discord".to_string(),
        "skype" => "Skype".to_string(),
        "webex" | "atmgr" => "Cisco Webex".to_string(),
        "telegram" => "Telegram".to_string(),
        "whatsapp" => "WhatsApp".to_string(),
        "vlc" => "VLC Media Player".to_string(),
        "code" => "Visual Studio Code".to_string(),
        "devenv" => "Visual Studio".to_string(),
        "obs64" | "obs32" | "obs" => "OBS Studio".to_string(),
        "safari" => "Safari".to_string(),
        "facetime" => "FaceTime".to_string(),
        _ => {
            let mut chars = base.chars();
            match chars.next() {
                None => exe_name.to_string(),
                Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
            }
        }
    }
}

pub fn find_pid_for_app(target_app: &str) -> Option<u32> {
    let target_clean = std::path::Path::new(target_app)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(target_app)
        .to_lowercase();
    let target_base = target_clean.strip_suffix(".exe").unwrap_or(&target_clean);

    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    #[cfg(windows)]
    let audio_pids = get_windows_audio_session_pids();
    #[cfg(not(windows))]
    let audio_pids: std::collections::HashSet<u32> = std::collections::HashSet::new();

    let mut candidate_pids = Vec::new();
    let mut candidate_parents = std::collections::HashMap::new();

    for (pid, process) in sys.processes() {
        let exe_name = process.name().to_string_lossy().to_string().to_lowercase();
        let path_name = process
            .exe()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .map(|s| s.to_lowercase());

        let name_match = exe_name == target_clean
            || exe_name.strip_suffix(".exe").unwrap_or(&exe_name) == target_base
            || path_name.as_deref() == Some(&target_clean)
            || path_name.as_deref().and_then(|p| p.strip_suffix(".exe")) == Some(target_base);

        if name_match {
            let p = pid.as_u32();
            if audio_pids.contains(&p) {
                log::info!("🎯 Found active audio session PID {} for target app '{}'", p, target_app);
                return Some(p);
            }
            candidate_pids.push(p);
            if let Some(parent) = process.parent() {
                candidate_parents.insert(p, parent.as_u32());
            }
        }
    }

    // If an audio session pid wasn't found yet, prefer the root process of the tree
    // (a process whose parent is not also in candidate_pids), because targeting
    // the root with PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE captures
    // the entire process tree.
    for &pid in &candidate_pids {
        if let Some(&parent_pid) = candidate_parents.get(&pid) {
            if !candidate_pids.contains(&parent_pid) {
                log::info!("🎯 Selected root candidate PID {} for target app '{}'", pid, target_app);
                return Some(pid);
            }
        } else {
            log::info!("🎯 Selected candidate PID {} (no parent) for target app '{}'", pid, target_app);
            return Some(pid);
        }
    }

    let fallback = candidate_pids.first().copied();
    log::info!("🎯 Selected first candidate PID {:?} for target app '{}'", fallback, target_app);
    fallback
}

#[cfg(windows)]
fn get_windows_audio_session_pids() -> std::collections::HashSet<u32> {
    use std::collections::HashSet;
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    let mut pids = HashSet::new();

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let enumerator: Result<IMMDeviceEnumerator, _> =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
        if let Ok(enumerator) = enumerator {
            if let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) {
                if let Ok(session_manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) {
                    if let Ok(session_enum) = session_manager.GetSessionEnumerator() {
                        if let Ok(count) = session_enum.GetCount() {
                            for i in 0..count {
                                if let Ok(session_control) = session_enum.GetSession(i) {
                                    if let Ok(control2) = session_control.cast::<IAudioSessionControl2>() {
                                        if let Ok(pid) = control2.GetProcessId() {
                                            if pid != 0 {
                                                pids.insert(pid);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    pids
}

#[cfg(windows)]
pub mod windows_loopback {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use tokio::sync::mpsc;
    use windows::core::{implement, w, IUnknown, Interface, HRESULT};
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::Media::Audio::{
        ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
        IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
        IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
    };
    use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    #[link(name = "propsys")]
    extern "system" {
        fn InitPropVariantFromBuffer(
            pv: *const std::ffi::c_void,
            cb: u32,
            ppropvar: *mut windows::core::PROPVARIANT,
        ) -> windows::core::HRESULT;
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    #[allow(non_snake_case)]
    pub struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
        pub TargetProcessId: u32,
        pub ProcessLoopbackMode: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    #[allow(non_snake_case)]
    pub struct AUDIOCLIENT_ACTIVATION_PARAMS {
        pub ActivationType: u32,
        pub ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    }

    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct AudioActivationHandler {
        tx: std::sync::mpsc::Sender<Result<IUnknown, HRESULT>>,
    }

    impl IActivateAudioInterfaceCompletionHandler_Impl for AudioActivationHandler {
        fn ActivateCompleted(
            &self,
            operation: Option<&IActivateAudioInterfaceAsyncOperation>,
        ) -> windows::core::Result<()> {
            if let Some(op) = operation {
                let mut hr = HRESULT(0);
                let mut unk = None;
                unsafe {
                    let _ = op.GetActivateResult(&mut hr, &mut unk);
                }
                if hr.is_ok() {
                    if let Some(u) = unk {
                        let _ = self.tx.send(Ok(u));
                        return Ok(());
                    }
                }
                let _ = self.tx.send(Err(hr));
            }
            Ok(())
        }
    }

    pub fn start_process_loopback(
        device: Arc<crate::audio::devices::AudioDevice>,
        state: Arc<crate::audio::recording_state::RecordingState>,
        recording_sender: Option<mpsc::UnboundedSender<crate::audio::recording_state::AudioChunk>>,
        target_pid: u32,
        stop_flag: Arc<AtomicBool>,
    ) -> Result<std::thread::JoinHandle<()>> {
        let handle = std::thread::spawn(move || {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }

            let params = AUDIOCLIENT_ACTIVATION_PARAMS {
                ActivationType: 1, // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: target_pid,
                    ProcessLoopbackMode: 0, // PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                },
            };

            let mut prop = windows::core::PROPVARIANT::default();
            unsafe {
                let hr = InitPropVariantFromBuffer(
                    &params as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                    &mut prop,
                );
                if hr.is_err() {
                    log::error!("❌ Failed to initialize propvariant for loopback: {:?}", hr);
                    return;
                }
            }

            let (tx, rx) = std::sync::mpsc::channel();
            let handler: IActivateAudioInterfaceCompletionHandler =
                AudioActivationHandler { tx }.into();

            log::info!("🎙️ Activating process loopback for PID {}", target_pid);
            let async_op = unsafe {
                ActivateAudioInterfaceAsync(
                    w!("VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK"),
                    &IAudioClient::IID,
                    Some(&prop),
                    &handler,
                )
            };

            if let Err(e) = async_op {
                log::error!("❌ ActivateAudioInterfaceAsync failed: {}", e);
                let _ = unsafe { PropVariantClear(&mut prop) };
                return;
            }

            let audio_client_unk = match rx.recv_timeout(std::time::Duration::from_secs(5)) {
                Ok(Ok(unk)) => unk,
                Ok(Err(hr)) => {
                    log::error!("❌ Process loopback activation failed with HRESULT 0x{:08X}", hr.0);
                    let _ = unsafe { PropVariantClear(&mut prop) };
                    return;
                }
                Err(e) => {
                    log::error!("❌ Process loopback activation timed out: {}", e);
                    let _ = unsafe { PropVariantClear(&mut prop) };
                    return;
                }
            };

            // Clear activation parameters now that async activation is finished
            let _ = unsafe { PropVariantClear(&mut prop) };

            let audio_client: IAudioClient = match audio_client_unk.cast() {
                Ok(client) => client,
                Err(e) => {
                    log::error!("❌ Failed to cast activated interface to IAudioClient: {}", e);
                    return;
                }
            };

            let p_wfx = unsafe {
                match audio_client.GetMixFormat() {
                    Ok(f) => f,
                    Err(e) => {
                        log::error!("❌ Failed to get mix format: {}", e);
                        return;
                    }
                }
            };

            let wfx = unsafe { *p_wfx };
            let channels = wfx.nChannels;
            let sample_rate = wfx.nSamplesPerSec;
            let bits_per_sample = wfx.wBitsPerSample;

            log::info!(
                "🔊 Process loopback format: {} Hz, {} channels, {} bits/sample",
                sample_rate, channels, bits_per_sample
            );

            let processor = crate::audio::pipeline::AudioCapture::new(
                device,
                state,
                sample_rate,
                channels,
                crate::audio::recording_state::DeviceType::System,
                recording_sender,
            );

            let event = match unsafe { CreateEventW(None, false, false, None) } {
                Ok(e) => e,
                Err(e) => {
                    log::error!("❌ Failed to create event: {}", e);
                    return;
                }
            };

            let init_res = unsafe {
                audio_client.Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                    10_000_000, // 1 second buffer
                    0,
                    p_wfx,
                    None,
                )
            };

            if let Err(e) = init_res {
                log::error!("❌ Failed to initialize audio client: {}", e);
                let _ = unsafe { CloseHandle(event) };
                return;
            }

            if let Err(e) = unsafe { audio_client.SetEventHandle(event) } {
                log::error!("❌ Failed to set event handle: {}", e);
                let _ = unsafe { CloseHandle(event) };
                return;
            }

            let capture_client: IAudioCaptureClient = match unsafe { audio_client.GetService() } {
                Ok(client) => client,
                Err(e) => {
                    log::error!("❌ Failed to get IAudioCaptureClient: {}", e);
                    let _ = unsafe { CloseHandle(event) };
                    return;
                }
            };

            if let Err(e) = unsafe { audio_client.Start() } {
                log::error!("❌ Failed to start audio client: {}", e);
                let _ = unsafe { CloseHandle(event) };
                return;
            }

            log::info!("✅ Process loopback started successfully for PID {}", target_pid);

            let mut f32_buffer = Vec::new();

            while !stop_flag.load(Ordering::Relaxed) {
                let wait_res = unsafe { WaitForSingleObject(event, 200) };
                if wait_res == WAIT_OBJECT_0 {
                    loop {
                        let mut p_data = std::ptr::null_mut();
                        let mut num_frames = 0u32;
                        let mut flags = 0u32;

                        let get_res = unsafe {
                            capture_client.GetBuffer(
                                &mut p_data,
                                &mut num_frames,
                                &mut flags,
                                None,
                                None,
                            )
                        };

                        if get_res.is_err() || num_frames == 0 || p_data.is_null() {
                            break;
                        }

                        let is_silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
                        let total_samples = (num_frames * channels as u32) as usize;

                        f32_buffer.clear();
                        f32_buffer.resize(total_samples, 0.0);

                        if !is_silent {
                            if bits_per_sample == 32 {
                                let float_slice = unsafe {
                                    std::slice::from_raw_parts(p_data as *const f32, total_samples)
                                };
                                f32_buffer.copy_from_slice(float_slice);
                            } else if bits_per_sample == 16 {
                                let i16_slice = unsafe {
                                    std::slice::from_raw_parts(p_data as *const i16, total_samples)
                                };
                                for (i, &s) in i16_slice.iter().enumerate() {
                                    f32_buffer[i] = s as f32 / 32768.0;
                                }
                            }
                        }

                        processor.process_audio_data(&f32_buffer);

                        let _ = unsafe { capture_client.ReleaseBuffer(num_frames) };
                    }
                } else if wait_res == WAIT_TIMEOUT {
                    continue;
                } else {
                    break;
                }
            }

            let _ = unsafe { audio_client.Stop() };
            let _ = unsafe { CloseHandle(event) };
            log::info!("🛑 Process loopback stopped for PID {}", target_pid);
        });

        Ok(handle)
    }
}
