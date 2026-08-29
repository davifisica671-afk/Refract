Directory structure:
└── zackriya-solutions-meetily/
    ├── README.md
    ├── BLUETOOTH_PLAYBACK_NOTICE.md
    ├── Cargo.toml
    ├── CLAUDE.md
    ├── CONTRIBUTING.md
    ├── LICENSE.md
    ├── PRIVACY_POLICY.md
    ├── backend/
    │   ├── README.md
    │   ├── API_DOCUMENTATION.md
    │   ├── build-docker.ps1
    │   ├── build-docker.sh
    │   ├── build_whisper.cmd
    │   ├── build_whisper.sh
    │   ├── clean_start_backend.cmd
    │   ├── clean_start_backend.sh
    │   ├── debug_cors.py
    │   ├── docker-compose.yml
    │   ├── Dockerfile.app
    │   ├── Dockerfile.server-cpu
    │   ├── Dockerfile.server-gpu
    │   ├── Dockerfile.server-macos
    │   ├── download-ggml-model.cmd
    │   ├── download-ggml-model.sh
    │   ├── install_dependancies_for_windows.ps1
    │   ├── requirements.txt
    │   ├── SCRIPTS_DOCUMENTATION.md
    │   ├── set_env.sh
    │   ├── setup-db.ps1
    │   ├── setup-db.sh
    │   ├── start_python_backend.cmd
    │   ├── start_whisper_server.cmd
    │   ├── start_with_output.ps1
    │   ├── temp.env
    │   ├── app/
    │   │   ├── db.py
    │   │   ├── main.py
    │   │   ├── schema_validator.py
    │   │   └── transcript_processor.py
    │   ├── docker/
    │   │   └── entrypoint.sh
    │   ├── examples/
    │   │   └── run_summary_workflow.py
    │   └── whisper-custom/
    │       └── server/
    │           ├── README.md
    │           ├── CMakeLists.txt
    │           ├── server.cpp
    │           └── public/
    │               └── index.html
    ├── docs/
    │   ├── architecture.md
    │   ├── BUILDING.md
    │   ├── building_in_linux.md
    │   └── GPU_ACCELERATION.md
    ├── frontend/
    │   ├── README.md
    │   ├── API.md
    │   ├── build-gpu.bat
    │   ├── build-gpu.ps1
    │   ├── build-gpu.sh
    │   ├── build.bat
    │   ├── build.ps1
    │   ├── build_backup.bat
    │   ├── clean_build.sh
    │   ├── clean_build_windows.bat
    │   ├── clean_run.sh
    │   ├── clean_run_windows.bat
    │   ├── components.json
    │   ├── dev-gpu.bat
    │   ├── dev-gpu.ps1
    │   ├── dev-gpu.sh
    │   ├── eslint.config.mjs
    │   ├── next.config.js
    │   ├── package-app.sh
    │   ├── package.json
    │   ├── postcss.config.js
    │   ├── postcss.config.mjs
    │   ├── tailwind.config.js
    │   ├── tailwind.config.ts
    │   ├── tsconfig.json
    │   ├── .env.example
    │   ├── scripts/
    │   │   ├── auto-detect-gpu.js
    │   │   ├── load-env.ps1
    │   │   └── tauri-auto.js
    │   ├── src/
    │   │   ├── app/
    │   │   │   ├── globals.css
    │   │   │   ├── layout.tsx
    │   │   │   ├── metadata.ts
    │   │   │   ├── metadata.tsx
    │   │   │   ├── page.tsx
    │   │   │   ├── _components/
    │   │   │   │   ├── SettingsModal.tsx
    │   │   │   │   ├── StatusOverlays.tsx
    │   │   │   │   └── TranscriptPanel.tsx
    │   │   │   ├── meeting-details/
    │   │   │   │   ├── page-content.tsx
    │   │   │   │   └── page.tsx
    │   │   │   ├── notes/
    │   │   │   │   └── [id]/
    │   │   │   │       └── page.tsx
    │   │   │   └── settings/
    │   │   │       └── page.tsx
    │   │   ├── components/
    │   │   │   ├── About.tsx
    │   │   │   ├── AnalyticsConsentSwitch.tsx
    │   │   │   ├── AnalyticsDataModal.tsx
    │   │   │   ├── AnalyticsProvider.tsx
    │   │   │   ├── AudioBackendSelector.tsx
    │   │   │   ├── AudioLevelMeter.tsx
    │   │   │   ├── AudioPlayer.tsx
    │   │   │   ├── BetaSettings.tsx
    │   │   │   ├── BluetoothPlaybackWarning.tsx
    │   │   │   ├── BuiltInModelManager.tsx
    │   │   │   ├── ChunkProgressDisplay.tsx
    │   │   │   ├── ComplianceNotification.tsx
    │   │   │   ├── ConfidenceIndicator.tsx
    │   │   │   ├── ConsoleToggle.tsx
    │   │   │   ├── CustomDialog.tsx
    │   │   │   ├── DeviceSelection.tsx
    │   │   │   ├── EditableTitle.tsx
    │   │   │   ├── EmptyStateSummary.tsx
    │   │   │   ├── Info.tsx
    │   │   │   ├── LanguagePickerPopover.tsx
    │   │   │   ├── LanguageSelection.tsx
    │   │   │   ├── Logo.tsx
    │   │   │   ├── MessageToast.tsx
    │   │   │   ├── ModelDownloadProgress.tsx
    │   │   │   ├── ParakeetModelManager.tsx
    │   │   │   ├── PermissionWarning.tsx
    │   │   │   ├── PreferenceSettings.tsx
    │   │   │   ├── RecordingControls.tsx
    │   │   │   ├── RecordingSettings.tsx
    │   │   │   ├── RecordingStatusBar.tsx
    │   │   │   ├── SettingTabs.tsx
    │   │   │   ├── SummaryLanguageSettings.tsx
    │   │   │   ├── SummaryModelSettings.tsx
    │   │   │   ├── TranscriptSettings.tsx
    │   │   │   ├── TranscriptView.tsx
    │   │   │   ├── UpdateCheckProvider.tsx
    │   │   │   ├── UpdateDialog.tsx
    │   │   │   ├── UpdateNotification.tsx
    │   │   │   ├── VirtualizedTranscriptView.tsx
    │   │   │   ├── WhisperModelManager.tsx
    │   │   │   ├── AISummary/
    │   │   │   │   ├── Block.tsx
    │   │   │   │   ├── BlockNoteSummaryView.tsx
    │   │   │   │   ├── index.tsx
    │   │   │   │   └── Section.tsx
    │   │   │   ├── BlockNoteEditor/
    │   │   │   │   ├── BasicBlockNoteTest.tsx
    │   │   │   │   └── Editor.tsx
    │   │   │   ├── ConfirmationModel/
    │   │   │   │   └── confirmation-modal.tsx
    │   │   │   ├── DatabaseImport/
    │   │   │   │   ├── HomebrewDatabaseDetector.tsx
    │   │   │   │   └── LegacyDatabaseImport.tsx
    │   │   │   ├── ImportAudio/
    │   │   │   │   ├── ImportAudioDialog.tsx
    │   │   │   │   ├── ImportDropOverlay.tsx
    │   │   │   │   └── index.ts
    │   │   │   ├── MainContent/
    │   │   │   │   └── index.tsx
    │   │   │   ├── MainNav/
    │   │   │   │   └── index.tsx
    │   │   │   ├── MeetingDetails/
    │   │   │   │   ├── RetranscribeDialog.tsx
    │   │   │   │   ├── SummaryGeneratorButtonGroup.tsx
    │   │   │   │   ├── SummaryPanel.tsx
    │   │   │   │   ├── SummaryUpdaterButtonGroup.tsx
    │   │   │   │   ├── TranscriptButtonGroup.tsx
    │   │   │   │   └── TranscriptPanel.tsx
    │   │   │   ├── molecules/
    │   │   │   │   └── form-components/
    │   │   │   │       ├── form-input-item.tsx
    │   │   │   │       ├── form-input-switch.tsx
    │   │   │   │       └── form-select-item.tsx
    │   │   │   ├── onboarding/
    │   │   │   │   ├── index.ts
    │   │   │   │   ├── OnboardingContainer.tsx
    │   │   │   │   ├── OnboardingFlow.tsx
    │   │   │   │   ├── shared/
    │   │   │   │   │   ├── index.ts
    │   │   │   │   │   ├── PermissionRow.tsx
    │   │   │   │   │   ├── ProgressIndicator.tsx
    │   │   │   │   │   └── StatusIndicator.tsx
    │   │   │   │   └── steps/
    │   │   │   │       ├── DownloadProgressStep.tsx
    │   │   │   │       ├── index.ts
    │   │   │   │       ├── PermissionsStep.tsx
    │   │   │   │       ├── SetupOverviewStep.tsx
    │   │   │   │       └── WelcomeStep.tsx
    │   │   │   ├── shared/
    │   │   │   │   └── DownloadProgressToast.tsx
    │   │   │   ├── Sidebar/
    │   │   │   │   ├── index.tsx
    │   │   │   │   └── SidebarProvider.tsx
    │   │   │   ├── TranscriptRecovery/
    │   │   │   │   ├── index.ts
    │   │   │   │   └── TranscriptRecovery.tsx
    │   │   │   └── ui/
    │   │   │       ├── accordion.tsx
    │   │   │       ├── alert.tsx
    │   │   │       ├── button-group.tsx
    │   │   │       ├── button.tsx
    │   │   │       ├── command.tsx
    │   │   │       ├── dialog.tsx
    │   │   │       ├── dropdown-menu.tsx
    │   │   │       ├── form.tsx
    │   │   │       ├── input-group.tsx
    │   │   │       ├── input.tsx
    │   │   │       ├── label.tsx
    │   │   │       ├── popover.tsx
    │   │   │       ├── progress.tsx
    │   │   │       ├── scroll-area.tsx
    │   │   │       ├── select.tsx
    │   │   │       ├── separator.tsx
    │   │   │       ├── sheet.tsx
    │   │   │       ├── switch.tsx
    │   │   │       ├── tabs.tsx
    │   │   │       ├── textarea.tsx
    │   │   │       ├── tooltip.tsx
    │   │   │       └── visually-hidden.tsx
    │   │   ├── config/
    │   │   │   └── api.ts
    │   │   ├── constants/
    │   │   │   ├── audioFormats.ts
    │   │   │   ├── languages.ts
    │   │   │   └── modelDefaults.ts
    │   │   ├── contexts/
    │   │   │   ├── ConfigContext.tsx
    │   │   │   ├── ImportDialogContext.tsx
    │   │   │   ├── OllamaDownloadContext.tsx
    │   │   │   ├── OnboardingContext.tsx
    │   │   │   ├── RecordingPostProcessingProvider.tsx
    │   │   │   ├── RecordingStateContext.tsx
    │   │   │   └── TranscriptContext.tsx
    │   │   ├── hooks/
    │   │   │   ├── useAudioPlayer.ts
    │   │   │   ├── useAutoScroll.ts
    │   │   │   ├── useImportAudio.ts
    │   │   │   ├── useModalState.ts
    │   │   │   ├── useNavigation.ts
    │   │   │   ├── usePaginatedTranscripts.ts
    │   │   │   ├── usePermissionCheck.ts
    │   │   │   ├── usePlatform.ts
    │   │   │   ├── useProcessingProgress.ts
    │   │   │   ├── useRecentLanguages.ts
    │   │   │   ├── useRecordingStart.ts
    │   │   │   ├── useRecordingStateSync.ts
    │   │   │   ├── useRecordingStop.ts
    │   │   │   ├── useTranscriptionModels.ts
    │   │   │   ├── useTranscriptRecovery.ts
    │   │   │   ├── useTranscriptStreaming.ts
    │   │   │   ├── useUpdateCheck.ts
    │   │   │   └── meeting-details/
    │   │   │       ├── useCopyOperations.ts
    │   │   │       ├── useMeetingData.ts
    │   │   │       ├── useMeetingOperations.ts
    │   │   │       ├── useModelConfiguration.ts
    │   │   │       ├── useSummaryGeneration.ts
    │   │   │       └── useTemplates.ts
    │   │   ├── lib/
    │   │   │   ├── analytics.ts
    │   │   │   ├── blocknote-markdown.ts
    │   │   │   ├── builtin-ai.ts
    │   │   │   ├── onboarding-summary-model.ts
    │   │   │   ├── parakeet.ts
    │   │   │   ├── recordingNotification.tsx
    │   │   │   ├── summary-language-preferences.ts
    │   │   │   ├── summary-languages.ts
    │   │   │   ├── utils.ts
    │   │   │   └── whisper.ts
    │   │   ├── services/
    │   │   │   ├── configService.ts
    │   │   │   ├── indexedDBService.ts
    │   │   │   ├── recordingService.ts
    │   │   │   ├── storageService.ts
    │   │   │   ├── transcriptService.ts
    │   │   │   └── updateService.ts
    │   │   └── types/
    │   │       ├── betaFeatures.ts
    │   │       ├── index.ts
    │   │       ├── onboarding.ts
    │   │       └── summary.ts
    │   ├── src-tauri/
    │   │   ├── build.rs
    │   │   ├── Cargo.toml
    │   │   ├── check_screen_permission.swift
    │   │   ├── CLEANUP_PLAN.md
    │   │   ├── entitlements.plist
    │   │   ├── Info.plist
    │   │   ├── LOGGING_OPTIMIZATIONS.md
    │   │   ├── NOTIFICATION_TESTING.md
    │   │   ├── tauri.conf.json
    │   │   ├── config/
    │   │   │   └── backend_config.json
    │   │   ├── logs/
    │   │   │   └── meeting-minutes.log.2024-12-30
    │   │   ├── migrations/
    │   │   │   ├── 20250916100000_initial_schema.sql
    │   │   │   ├── 20250920155811_add_openrouter_api_key.sql
    │   │   │   ├── 20251006000000_add_audio_sync_fields.sql
    │   │   │   ├── 20251010153942_add_ollama_endpoint.sql
    │   │   │   ├── 20251101000000_add_summary_backup.sql
    │   │   │   ├── 20251105120000_add_pro_license_custom_openai.sql
    │   │   │   ├── 20251110000000_add_grace_period_to_licensing.sql
    │   │   │   ├── 20251110000001_add_speaker_field.sql
    │   │   │   ├── 20251223000000_add_meeting_notes.sql
    │   │   │   └── 20251229000000_add_gemini_api_key.sql
    │   │   ├── scripts/
    │   │   │   └── sign-windows.ps1
    │   │   ├── src/
    │   │   │   ├── config.rs
    │   │   │   ├── lib.rs
    │   │   │   ├── main.rs
    │   │   │   ├── onboarding.rs
    │   │   │   ├── state.rs
    │   │   │   ├── tray.rs
    │   │   │   ├── utils.rs
    │   │   │   ├── analytics/
    │   │   │   │   ├── analytics.rs
    │   │   │   │   ├── commands.rs
    │   │   │   │   └── mod.rs
    │   │   │   ├── anthropic/
    │   │   │   │   └── mod.rs
    │   │   │   ├── api/
    │   │   │   │   ├── api.rs
    │   │   │   │   ├── commands.rs
    │   │   │   │   └── mod.rs
    │   │   │   ├── audio/
    │   │   │   │   ├── async_logger.rs
    │   │   │   │   ├── audio_processing.rs
    │   │   │   │   ├── batch_processor.rs
    │   │   │   │   ├── buffer_pool.rs
    │   │   │   │   ├── common.rs
    │   │   │   │   ├── constants.rs
    │   │   │   │   ├── core-old.rs
    │   │   │   │   ├── decoder.rs
    │   │   │   │   ├── device_detection.rs
    │   │   │   │   ├── device_monitor.rs
    │   │   │   │   ├── diagnostics.rs
    │   │   │   │   ├── encode.rs
    │   │   │   │   ├── ffmpeg.rs
    │   │   │   │   ├── ffmpeg_mixer.rs
    │   │   │   │   ├── hardware_detector.rs
    │   │   │   │   ├── import.rs
    │   │   │   │   ├── incremental_saver.rs
    │   │   │   │   ├── level_monitor.rs
    │   │   │   │   ├── mod.rs
    │   │   │   │   ├── permissions.rs
    │   │   │   │   ├── pipeline.rs
    │   │   │   │   ├── playback_monitor.rs
    │   │   │   │   ├── post_processor.rs
    │   │   │   │   ├── recording_commands.rs
    │   │   │   │   ├── recording_manager.rs
    │   │   │   │   ├── recording_preferences.rs
    │   │   │   │   ├── recording_saver.rs
    │   │   │   │   ├── recording_saver_old.rs
    │   │   │   │   ├── recording_state.rs
    │   │   │   │   ├── retranscription.rs
    │   │   │   │   ├── simple_level_monitor.rs
    │   │   │   │   ├── stream.rs
    │   │   │   │   ├── stt.rs
    │   │   │   │   ├── system_audio_commands.rs
    │   │   │   │   ├── system_audio_stream.rs
    │   │   │   │   ├── system_audio_types.ts
    │   │   │   │   ├── system_detector.rs
    │   │   │   │   ├── vad.rs
    │   │   │   │   ├── capture/
    │   │   │   │   │   ├── backend_config.rs
    │   │   │   │   │   ├── core_audio.rs
    │   │   │   │   │   ├── microphone.rs
    │   │   │   │   │   ├── mod.rs
    │   │   │   │   │   └── system.rs
    │   │   │   │   ├── devices/
    │   │   │   │   │   ├── configuration.rs
    │   │   │   │   │   ├── discovery.rs
    │   │   │   │   │   ├── fallback.rs
    │   │   │   │   │   ├── microphone.rs
    │   │   │   │   │   ├── mod.rs
    │   │   │   │   │   ├── speakers.rs
    │   │   │   │   │   └── platform/
    │   │   │   │   │       ├── linux.rs
    │   │   │   │   │       ├── macos.rs
    │   │   │   │   │       ├── mod.rs
    │   │   │   │   │       └── windows.rs
    │   │   │   │   └── transcription/
    │   │   │   │       ├── engine.rs
    │   │   │   │       ├── mod.rs
    │   │   │   │       ├── parakeet_provider.rs
    │   │   │   │       ├── provider.rs
    │   │   │   │       ├── whisper_provider.rs
    │   │   │   │       └── worker.rs
    │   │   │   ├── audio_v2/
    │   │   │   │   ├── compatibility.rs
    │   │   │   │   ├── lib.rs
    │   │   │   │   ├── limiter.rs
    │   │   │   │   ├── mixer.rs
    │   │   │   │   ├── normalizer.rs
    │   │   │   │   ├── recorder.rs
    │   │   │   │   ├── resampler.rs
    │   │   │   │   ├── stream.rs
    │   │   │   │   └── sync.rs
    │   │   │   ├── console_utils/
    │   │   │   │   ├── commands.rs
    │   │   │   │   ├── console_utils.rs
    │   │   │   │   └── mod.rs
    │   │   │   ├── database/
    │   │   │   │   ├── commands.rs
    │   │   │   │   ├── manager.rs
    │   │   │   │   ├── mod.rs
    │   │   │   │   ├── models.rs
    │   │   │   │   ├── setup.rs
    │   │   │   │   └── repositories/
    │   │   │   │       ├── meeting.rs
    │   │   │   │       ├── mod.rs
    │   │   │   │       ├── setting.rs
    │   │   │   │       ├── transcript.rs
    │   │   │   │       └── transcript_chunk.rs
    │   │   │   ├── groq/
    │   │   │   │   └── mod.rs
    │   │   │   ├── notifications/
    │   │   │   │   ├── commands.rs
    │   │   │   │   ├── manager.rs
    │   │   │   │   ├── mod.rs
    │   │   │   │   ├── settings.rs
    │   │   │   │   ├── system.rs
    │   │   │   │   └── types.rs
    │   │   │   ├── ollama/
    │   │   │   │   ├── commands.rs
    │   │   │   │   └── mod.rs
    │   │   │   ├── openai/
    │   │   │   │   └── mod.rs
    │   │   │   ├── openrouter/
    │   │   │   │   ├── commands.rs
    │   │   │   │   └── mod.rs
    │   │   │   ├── parakeet_engine/
    │   │   │   │   ├── commands.rs
    │   │   │   │   ├── mod.rs
    │   │   │   │   ├── model.rs
    │   │   │   │   └── parakeet_engine.rs
    │   │   │   ├── summary/
    │   │   │   │   ├── mod.rs
    │   │   │   │   ├── summary_engine/
    │   │   │   │   │   └── mod.rs
    │   │   │   │   └── templates/
    │   │   │   │       └── mod.rs
    │   │   │   └── whisper_engine/
    │   │   │       ├── _stderr_suppressor.rs
    │   │   │       ├── acceleration.rs
    │   │   │       ├── commands.rs
    │   │   │       ├── mod.rs
    │   │   │       ├── parallel_commands.rs
    │   │   │       ├── parallel_processor.rs
    │   │   │       ├── system_monitor.rs
    │   │   │       └── whisper_engine.rs
    │   │   ├── templates/
    │   │   │   └── README.md
    │   │   └── .cargo/
    │   │       └── config.toml
    │   └── tests/
    │       └── lib/
    │           ├── blocknote-markdown.test.ts
    │           ├── onboarding-summary-model.test.mjs
    │           └── summary-language-preferences.test.js
    ├── llama-helper/
    │   └── Cargo.toml
    ├── scripts/
    │   ├── generate-update-manifest-github.js
    │   ├── inject_transcript.py
    │   └── test-update-locally.js
    └── .github/
        ├── issue_template.md
        ├── pull_request_template.md
        ├── ISSUE_TEMPLATE/
        │   ├── bug_report.md
        │   ├── documentation.md
        │   └── feature_request.md
        └── workflows/
            ├── ACCELERATION_GUIDE.md
            ├── build-devtest.yml
            ├── build-linux.yml
            ├── build-macos.yml
            ├── build-test.yml
            ├── build-windows.yml
            ├── build.yml
            ├── pr-main-check.yml
            ├── README_DEVTEST.md
            ├── release.yml
            └── WORKFLOWS_OVERVIEW.md


Files Content:

(Files content cropped to 300k characters, download full ingest to see more)
================================================
FILE: README.md
================================================
<div align="center" style="border-bottom: none">
    <h1>
        <img src="docs/Meetily-6.png" style="border-radius: 10px;" />
        <br>
        Privacy-First AI Meeting Assistant
    </h1>
    <a href="https://trendshift.io/repositories/21958" target="_blank"><img src="https://trendshift.io/api/badge/repositories/21958" alt="Zackriya-Solutions%2Fmeetily | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
    <br>
    <br>
    <a href="https://github.com/Zackriya-Solutions/meeting-minutes/releases/"><img src="https://img.shields.io/badge/Pre_Release-Link-brightgreen" alt="Pre-Release"></a>
    <a href="https://github.com/Zackriya-Solutions/meeting-minutes/releases"><img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/zackriya-solutions/meeting-minutes?style=flat">
</a>
 <a href="https://github.com/Zackriya-Solutions/meeting-minutes/releases"> <img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/zackriya-solutions/meeting-minutes/total?style=plastic"> </a>
    <a href="https://github.com/Zackriya-Solutions/meeting-minutes/releases"><img src="https://img.shields.io/badge/License-MIT-blue" alt="License"></a>
    <a href="https://github.com/Zackriya-Solutions/meeting-minutes/releases"><img src="https://img.shields.io/badge/Supported_OS-macOS,_Windows-white" alt="Supported OS"></a>
    <a href="https://github.com/Zackriya-Solutions/meeting-minutes/releases"><img alt="GitHub Tag" src="https://img.shields.io/github/v/tag/zackriya-solutions/meeting-minutes?include_prereleases&color=yellow">
</a>
    <br>
    <h3>
    <br>
    Open Source • Privacy-First • Enterprise-Ready
    </h3>
    <p align="center">
    Get latest <a href="https://www.zackriya.com/meetily-subscribe/"><b>Product updates</b></a> <br><br>
    <a href="https://meetily.ai"><b>Website</b></a> •
    <a href="https://www.linkedin.com/company/106363062/"><b>LinkedIn</b></a> •
    <a href="https://discord.gg/crRymMQBFH"><b>Meetily Discord</b></a> •
    <a href="https://discord.com/invite/vCFJvN4BwJ"><b>Privacy-First AI</b></a> •
    <a href="https://www.reddit.com/r/meetily/"><b>Reddit</b></a>
</p>
    <p align="center">

A privacy-first AI meeting assistant that captures, transcribes, and summarizes meetings entirely on your infrastructure. Built by expert AI engineers passionate about data sovereignty and open source solutions. Perfect for enterprises that need advanced meeting intelligence without compromising on privacy, compliance, or control.

</p>

<p align="center">
    <img src="docs/meetily_demo.gif" width="650" alt="Meetily Demo" />
    <br>
    <a href="https://youtu.be/6FnhSC_eSz8">View full Demo Video</a>
</p>

</div>

---

> **Meetily PRO Upgrade Offer** - Meetily PRO is available for users who need enhanced accuracy, advanced exports, custom summary workflows, and team-ready features. Use coupon code **LAUNCH20** for **20% off** until the next Meetily Community Edition release. Speaker diarization is also planned for PRO in mid-June. [Explore Meetily PRO →](https://meetily.ai/pro/)

---

<details>
<summary>Table of Contents</summary>

- [Introduction](#introduction)
- [Why Meetily?](#why-meetily)
- [Features](#features)
- [Installation](#installation)
- [Key Features in Action](#key-features-in-action)
- [System Architecture](#system-architecture)
- [For Developers](#for-developers)
- [Meetily PRO](#meetily-pro)
- [Contributing](#contributing)
- [License](#license)

</details>

## Introduction

Meetily is a privacy-first AI meeting assistant that runs entirely on your local machine. It captures your meetings, transcribes them in real-time, and generates summaries, all without sending any data to the cloud. This makes it the perfect solution for professionals and enterprises who need to maintain complete control over their sensitive information.

## Why Meetily?

While there are many meeting transcription tools available, this solution stands out by offering:

- **Privacy First:** All processing happens locally on your device.
- **Cost-Effective:** Uses open-source AI models instead of expensive APIs.
- **Flexible:** Works offline and supports multiple meeting platforms.
- **Customizable:** Self-host and modify for your specific needs.

<details>
<summary>The Privacy Problem</summary>

Meeting AI tools create significant privacy and compliance risks across all sectors:

- **$4.4M average cost per data breach** (IBM 2024)
- **€5.88 billion in GDPR fines** issued by 2025
- **400+ unlawful recording cases** filed in California this year

Whether you're a defense consultant, enterprise executive, legal professional, or healthcare provider, your sensitive discussions shouldn't live on servers you don't control. Cloud meeting tools promise convenience but deliver privacy nightmares with unclear data storage practices and potential unauthorized access.

**Meetily solves this:** Complete data sovereignty on your infrastructure, zero vendor lock-in, and full control over your sensitive conversations.

</details>

## Features

- **Local First:** All processing is done on your machine. No data ever leaves your computer.
- **Real-time Transcription:** Get a live transcript of your meeting as it happens.
- **AI-Powered Summaries:** Generate summaries of your meetings using powerful language models.
- **Multi-Platform:** Works on macOS, Windows, and Linux.
- **Open Source:** Meetily is open source and free to use.
- **Flexible AI Provider Support:** Choose from Ollama (local), Claude, Groq, OpenRouter, or use your own OpenAI-compatible endpoint.

## Installation

### 🪟 **Windows**

1. Download the latest `x64-setup.exe` from [Releases](https://github.com/Zackriya-Solutions/meeting-minutes/releases/latest)
2. Run the installer

### 🍎 **macOS**

1. Download `meetily_0.4.0_aarch64.dmg` from [Releases](https://github.com/Zackriya-Solutions/meeting-minutes/releases/latest)
2. Open the downloaded `.dmg` file
3. Drag **Meetily** to your Applications folder
4. Open **Meetily** from Applications folder

### 🐧 **Linux**

Build from source following our detailed guides:

- [Building on Linux](docs/building_in_linux.md)
- [General Build Instructions](docs/BUILDING.md)

**Quick start:**

```bash
git clone https://github.com/Zackriya-Solutions/meeting-minutes
cd meeting-minutes/frontend
pnpm install
./build-gpu.sh
```

## Key Features in Action

### 🎯 Local Transcription

Transcribe meetings entirely on your device using **Whisper** or **Parakeet** models. No cloud required.

<p align="center">
    <img src="docs/home.png" width="650" style="border-radius: 10px;" alt="Meetily Demo" />
</p>

### 📥 Import & Enhance `Beta`

Import existing audio files to generate transcripts, or enhance to re-transcribe any recorded meeting with a different model or language, all processed locally.

> Contributed by [Jeremi Joslin](https://github.com/jeremi), improved by [Vishnu P S](https://github.com/p-s-vishnu) and [Mohammed Safvan](https://github.com/mohammedsafvan)

<p align="center">
    <img src="docs/meetily-export.gif" width="650" style="border-radius: 10px;" alt="Import and Enhance" />
</p>

### 🤖 AI-Powered Summaries

Generate meeting summaries with your choice of AI provider. **Ollama** (local) is recommended, with support for Claude, Groq, OpenRouter, and OpenAI.

<p align="center">
    <img src="docs/summary.png" width="650" style="border-radius: 10px;" alt="Summary generation" />
</p>

<p align="center">
    <img src="docs/editor1.png" width="650" style="border-radius: 10px;" alt="Editor Summary generation" />
</p>

### 🔒 Privacy-First Design

All data stays on your machine. Transcription models, recordings, and transcripts are stored locally.

<p align="center">
    <img src="docs/settings.png" width="650" style="border-radius: 10px;" alt="Local Transcription and storage" />
</p>

### 🌐 Custom OpenAI Endpoint Support

Use your own OpenAI-compatible endpoint for AI summaries. Perfect for organizations with custom AI infrastructure or preferred providers.

<p align="center">
    <img src="docs/custom.png" width="650" style="border-radius: 10px;" alt="Custom OpenAI Endpoint Configuration" />
</p>

### 🎙️ Professional Audio Mixing

Capture microphone and system audio simultaneously with intelligent ducking and clipping prevention.

<p align="center">
    <img src="docs/audio.png" width="650" style="border-radius: 10px;" alt="Device selection" />
</p>

### ⚡ GPU Acceleration

Built-in support for hardware acceleration across platforms:

- **macOS**: Apple Silicon (Metal) + CoreML
- **Windows/Linux**: NVIDIA (CUDA), AMD/Intel (Vulkan)

Automatically enabled at build time - no configuration needed.

## System Architecture

Meetily is a single, self-contained application built with [Tauri](https://tauri.app/). It uses a Rust-based backend to handle all the core logic, and a Next.js frontend for the user interface.

For more details, see the [Architecture documentation](docs/architecture.md).

## For Developers

If you want to contribute to Meetily or build it from source, you'll need to have Rust and Node.js installed. For detailed build instructions, please see the [Building from Source guide](docs/BUILDING.md).

## Meetily Pro

<p align="center">
    <img src="docs/pv2.1.png" width="650" style="border-radius: 10px;" alt="Upcoming version" />
</p>

**Meetily PRO** is a professional-grade solution with enhanced accuracy and advanced features for serious users and teams. Built on a different codebase with superior transcription models and enterprise-ready capabilities.

### Community Thank-You Offer

Meetily Community Edition will remain free and open source. PRO exists for users and teams who want a more advanced meeting workflow, including higher transcription accuracy, custom summary templates, advanced exports, auto-meeting detection, and self-hosted deployment options.

For the community that helped Meetily grow, we are making the upgrade easier: use coupon code **LAUNCH20** for **20% off Meetily PRO** until the next Meetily Community Edition release.

Speaker diarization is planned for mid-June, bringing automatic speaker separation to PRO meetings.

### Key Advantages Over Community Edition:

- **Enhanced Accuracy**: Superior transcription models for professional-grade accuracy
- **Custom Summary Templates**: Tailor summaries to your specific workflow and needs
- **Advanced Export Options**: PDF, DOCX, and Markdown exports with formatting
- **Auto-detect and Join Meetings**: Automatic meeting detection and joining
- **Speaker Identification**: Distinguish between speakers automatically *(Coming Soon)*
- **Chat with Meetings**: AI-powered meeting insights and queries *(Coming Soon)*
- **Calendar Integration**: Seamless integration with your calendar *(Coming Soon)*
- **Self-Hosted Deployment**: Deploy on your own infrastructure for teams
- **GDPR Compliance Built-In**: Privacy by design architecture with complete audit trails
- **Priority Support**: Dedicated support for PRO users

### Who is PRO for?

- **Professionals** who need the highest accuracy for critical meetings
- **Teams and organizations** (2-100 users) requiring self-hosted deployment
- **Power users** who need advanced export formats and custom workflows
- **Compliance-focused organizations** requiring GDPR readiness

> **Note:** Meetily Community Edition remains **free & open source forever** with local transcription, AI summaries, and core features. PRO is a separate professional solution for users who need enhanced accuracy and advanced capabilities.

For organizations needing 100+ users or managed compliance solutions, explore [Meetily Enterprise](https://meetily.ai/enterprise/).

**Learn more about pricing and features:** [https://meetily.ai/pro/](https://meetily.ai/pro/)

## Contributing

We welcome contributions from the community! If you have any questions or suggestions, please open an issue or submit a pull request. Please follow the established project structure and guidelines. For more details, refer to the [CONTRIBUTING.md](CONTRIBUTING.md) file.

Thanks for all the contributions. Our community is what makes this project possible.

## License

MIT License - Feel free to use this project for your own purposes.

## Acknowledgments

- We borrowed some code from [Whisper.cpp](https://github.com/ggerganov/whisper.cpp).
- We borrowed some code from [Screenpipe](https://github.com/mediar-ai/screenpipe).
- We borrowed some code from [transcribe-rs](https://crates.io/crates/transcribe-rs).
- Thanks to **NVIDIA** for developing the **Parakeet** model.
- Thanks to [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) for providing the **ONNX conversion** of the Parakeet model.

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=Zackriya-Solutions/meetily&type=date&legend=top-left)](https://www.star-history.com/?repos=Zackriya-Solutions%2Fmeetily&type=date&legend=bottom-right)



================================================
FILE: BLUETOOTH_PLAYBACK_NOTICE.md
================================================
# Bluetooth Headphone Playback Notice

## Important Information for Recording Review

When **reviewing recordings** in Meetily, we recommend using **computer speakers** or **wired headphones** rather than Bluetooth headphones for accurate playback.

---

## The Issue

Recordings may sound **distorted, sped up, or have clarity issues** when played through Bluetooth headphones, even though the recording file itself is perfectly fine.

### Symptoms
- Audio plays too fast or too slow
- Voice sounds higher/lower pitched than normal
- Quality seems degraded or "chipmunk-like"
- **Different Bluetooth devices cause different playback speeds**

### What's Actually Happening
**Your recording is fine!** The issue occurs during **playback**, not recording.

---

## Technical Explanation

### Why This Happens

1. **Meetily records at 48kHz** (professional audio standard)
2. **Bluetooth headphones use various sample rates**: 8kHz, 16kHz, 24kHz, 44.1kHz, or 48kHz
3. **macOS resamples audio** when sending 48kHz content to Bluetooth devices
4. **Resampling can fail** if macOS:
   - Negotiates the wrong Bluetooth codec (SBC vs AAC vs LDAC)
   - Misidentifies the device's playback capability
   - Uses low-quality resampling for power efficiency

### Device-Specific Behavior

Different Bluetooth headphones report different capabilities:

| Device Type | Typical Playback Rate | Result When Playing 48kHz |
|------------|----------------------|---------------------------|
| Sony WH-1000XM4 | 16-44.1kHz (varies) | May sound 1.5-3x faster |
| AirPods Pro | 24kHz or 48kHz | Usually OK, but can vary |
| Cheap BT Headset | 8-16kHz | Often sounds very fast |
| High-end BT (LDAC) | 44.1-48kHz | Usually works correctly |

The rate depends on:
- **Bluetooth profile** (A2DP for music vs HFP for calls)
- **Active codec** (SBC, AAC, aptX, LDAC)
- **Battery mode** (power-saving modes may reduce quality)
- **macOS version** and audio driver quirks

---

## Solution: Use Computer Speakers

### For Accurate Review

✅ **Computer speakers** (built-in or external)
✅ **Wired headphones** (3.5mm jack or USB)
✅ **High-quality DAC** (digital audio converter)

❌ **Bluetooth headphones** (for reviewing recordings)
❌ **Bluetooth speakers** (same resampling issues)

### Bluetooth Headphones Are Fine For

- ✅ **Recording** (microphone input) - We handle sample rate conversion correctly
- ✅ **Live monitoring** during recording - macOS handles real-time audio
- ✅ **General computer use** - Normal audio playback
- ❌ **Reviewing Meetily recordings** - Use wired/speakers instead

---

## Verification Steps

To confirm your recording is actually fine:

1. **Play recording through computer speakers**
   - If it sounds normal → Recording is good, BT playback is the issue ✅
   - If it still sounds wrong → May be a different issue ❌

2. **Check file properties**
   ```bash
   # In terminal:
   ffprobe path/to/recording/audio.mp4
   ```
   Should show:
   - `sample_rate=48000` ✅
   - `channels=1` ✅
   - `codec_name=aac` ✅

3. **Try different playback devices**
   - Computer speakers: Should sound normal
   - Wired headphones: Should sound normal
   - Bluetooth device A: Might sound wrong
   - Bluetooth device B: Might sound differently wrong

---

## Why We Don't "Fix" This

### This is Not a Meetily Bug

The issue is in **macOS's Bluetooth audio stack**, not in Meetily's recording engine.

**Evidence:**
- Recordings play perfectly on computer speakers
- File metadata shows correct 48kHz encoding
- Other professional audio apps have the same limitation
- Issue varies by Bluetooth device (different devices = different problems)

### Industry Standard Practice

Professional audio software **always** recommends:
- Monitor through studio monitors (speakers) or wired headphones
- Avoid Bluetooth for critical listening
- Use wired connections for audio work

Examples:
- **Logic Pro X**: Warns against BT monitoring
- **Audacity**: Recommends wired headphones
- **GarageBand**: Disables BT for recording/monitoring

---

## Workarounds

### Option 1: Use Computer Speakers (Recommended)
**Best**: Most accurate, no resampling issues

### Option 2: Export at Different Sample Rate
If you **must** use Bluetooth for playback:

1. **Export recording** at lower sample rate (future feature)
2. **Transcode manually** using ffmpeg:
   ```bash
   ffmpeg -i audio.mp4 -ar 44100 audio_44k.mp4
   ```
3. **Try 44.1kHz** (better BT compatibility than 48kHz)

### Option 3: Use High-Quality Bluetooth
Devices with **LDAC** or **aptX HD** codecs:
- Sony WH-1000XM5 (LDAC mode)
- Sennheiser Momentum 4
- Some high-end Bose models

These handle 48kHz better (but still not perfect).

---

## Technical Details for Developers

### Sample Rate Chain

```
Recording Pipeline:
  Microphone (16kHz) → Resample to 48kHz → Pipeline (48kHz)
  System Audio (48kHz) → No resampling → Pipeline (48kHz)
  Mixed Audio (48kHz) → Encode → File (48kHz AAC)

Playback (Computer Speakers):
  File (48kHz) → macOS CoreAudio → Speakers (48kHz) ✅

Playback (Bluetooth):
  File (48kHz) → macOS CoreAudio → Bluetooth Stack → Resample → BT Device (16-48kHz) ⚠️
                                                      ↑
                                                This step can fail!
```

### Why macOS Resampling Fails

1. **Codec negotiation**: BT device claims 48kHz support but actually uses 16kHz
2. **Profile switching**: Device switches from A2DP (music) to HFP (call) mid-playback
3. **Power management**: macOS downsamples to save battery
4. **Driver bugs**: CoreAudio → Bluetooth handoff has known issues

### Apple's Documentation

From [Apple Technical Note TN2321](https://developer.apple.com/library/archive/technotes/tn2321/):
> "Bluetooth audio devices may report supported sample rates that differ from
> their actual playback rates. Applications should not rely on Bluetooth
> devices for accurate audio monitoring."

---

## FAQ

### Q: Will this be fixed in a future update?
**A**: This is a macOS/Bluetooth limitation, not a Meetily bug. We've correctly recorded at 48kHz.

### Q: Why not record at 16kHz if that's what Bluetooth uses?
**A**: Because:
1. System audio is 48kHz (can't be changed)
2. 48kHz is professional quality (16kHz is phone-call quality)
3. Most users play back on computer speakers
4. Recording at 16kHz would degrade quality for 95% of users

### Q: Can you detect my Bluetooth device and warn me?
**A**: Yes! Meetily now shows a warning when Bluetooth headphones are active during playback.

### Q: Does this affect recording quality?
**A**: **No**. Recording quality is perfect. Only **playback** through Bluetooth has issues.

### Q: What about AirPods? They're supposed to be high quality.
**A**: AirPods handle 48kHz better than most BT devices, but can still have issues depending on:
- Codec negotiation (AAC vs SBC)
- Battery level (power-saving mode)
- Connection quality (Bluetooth interference)
- macOS audio driver quirks

---

## Summary

✅ **Recordings are perfect** - 48kHz, high quality
✅ **Computer playback works** - Use speakers or wired headphones
⚠️ **Bluetooth playback may sound wrong** - macOS resampling issue
✅ **Recording through BT mic works** - We handle resampling correctly

**Bottom line**: Review your recordings through computer speakers, not Bluetooth headphones.

---

## Related Documentation

- [AIRPODS_BLUETOOTH_FIX.md](AIRPODS_BLUETOOTH_FIX.md) - Bluetooth device reconnection handling
- [BLUETOOTH_SAMPLE_RATE_FIX.md](BLUETOOTH_SAMPLE_RATE_FIX.md) - Microphone sample rate resampling
- [Apple Technical Note TN2321](https://developer.apple.com/library/archive/technotes/tn2321/) - Bluetooth Audio Best Practices

---

**Last Updated**: October 10, 2025
**Applies To**: Meetily v0.0.5+ on macOS



================================================
FILE: Cargo.toml
================================================
[workspace]
resolver = "2"
members = [
    "frontend/src-tauri",
    "llama-helper"
]

# Shared workspace settings
[workspace.package]
edition = "2021"
rust-version = "1.77"

# Shared dependencies that can be inherited by workspace members
[workspace.dependencies]
anyhow = "1.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.32.0", features = ["full"] }



================================================
FILE: CLAUDE.md
================================================
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Meetily** is a privacy-first AI meeting assistant that captures, transcribes, and summarizes meetings entirely on local infrastructure. The supported application is the Tauri desktop app with a Rust core.

1. **Frontend**: Tauri-based desktop application (Rust + Next.js + TypeScript)
2. **Rust Backend**: Tauri commands, audio capture, transcription, storage, and summarization orchestration
3. **Legacy Backend Archive**: the old Python/FastAPI, Docker, and standalone whisper-server backend under `backend/` is archived and unsupported

### Key Technology Stack
- **Desktop App**: Tauri 2.x (Rust) + Next.js 14 + React 18
- **Audio Processing**: Rust (cpal, whisper-rs, professional audio mixing)
- **Transcription**: Whisper.cpp / whisper-rs and Parakeet paths in the Tauri app
- **App API Surface**: Tauri commands and events, not a separate FastAPI service
- **LLM Integration**: Ollama (local), Claude, Groq, OpenRouter

## Essential Development Commands

### Frontend Development (Tauri Desktop App)

**Location**: `/frontend`

```bash
# macOS Development
./clean_run.sh              # Clean build and run with info logging
./clean_run.sh debug        # Run with debug logging
./clean_build.sh            # Production build

# Windows Development
clean_run_windows.bat       # Clean build and run
clean_build_windows.bat     # Production build

# Manual Commands
pnpm install                # Install dependencies
pnpm run dev                # Next.js dev server (port 3118)
pnpm run tauri:dev          # Full Tauri development mode
pnpm run tauri:build        # Production build

# GPU-Specific Builds (for testing acceleration)
pnpm run tauri:dev:metal    # macOS Metal GPU
pnpm run tauri:dev:cuda     # NVIDIA CUDA
pnpm run tauri:dev:vulkan   # AMD/Intel Vulkan
pnpm run tauri:dev:cpu      # CPU-only (no GPU)
```

### Legacy Backend Archive

**Location**: `/backend`

The Python/FastAPI backend, Docker setup, and standalone whisper-server scripts are archived for historical reference and migration context only. Do not use them for current development, new installs, production deployments, or issue triage for the supported app.

The archived FastAPI service had unauthenticated, development-oriented CORS behavior. Treat that behavior as obsolete legacy context, not as a supported production API.

### Service Endpoints
- **Frontend Dev**: http://localhost:3118

## High-Level Architecture

### Tauri Desktop Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Tauri Desktop App)                  │
│  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │   Next.js UI     │  │  Rust Backend   │  │ Whisper Engine │ │
│  │  (React/TS)      │←→│  (Audio + IPC)  │←→│  (Local STT)   │ │
│  └──────────────────┘  └─────────────────┘  └────────────────┘ │
│         ↑ Tauri Events           ↑ Audio Pipeline               │
└─────────────────────────────────────────────────────────────────┘
```

The current app does not require a separate FastAPI tier. Meeting persistence, local transcription, and summary orchestration are handled through the Rust/Tauri core.

### Audio Processing Pipeline (Critical Understanding)

The audio system has **two parallel paths** with different purposes:

```
Raw Audio (Mic + System)
         ↓
┌────────────────────────────────────────────────────────────┐
│              Audio Pipeline Manager                         │
│  (frontend/src-tauri/src/audio/pipeline.rs)                │
└─────────────┬──────────────────────────┬───────────────────┘
              ↓                          ↓
    ┌─────────────────┐        ┌─────────────────────┐
    │ Recording Path  │        │ Transcription Path  │
    │ (Pre-mixed)     │        │ (VAD-filtered)      │
    └─────────────────┘        └─────────────────────┘
              ↓                          ↓
    RecordingSaver.save()      WhisperEngine.transcribe()
```

**Key Insight**: The pipeline performs **professional audio mixing** (RMS-based ducking, clipping prevention) for recording, while simultaneously applying **Voice Activity Detection (VAD)** to send only speech segments to Whisper for transcription.

### Audio Device Modularization (Recently Completed)

**Context**: The audio system was refactored from a monolithic 1028-line `core.rs` file into focused modules. See [AUDIO_MODULARIZATION_PLAN.md](AUDIO_MODULARIZATION_PLAN.md) for details.

```
audio/
├── devices/                    # Device discovery and configuration
│   ├── discovery.rs           # list_audio_devices, trigger_audio_permission
│   ├── microphone.rs          # default_input_device
│   ├── speakers.rs            # default_output_device
│   ├── configuration.rs       # AudioDevice types, parsing
│   └── platform/              # Platform-specific implementations
│       ├── windows.rs         # WASAPI logic (~200 lines)
│       ├── macos.rs           # ScreenCaptureKit logic
│       └── linux.rs           # ALSA/PulseAudio logic
├── capture/                   # Audio stream capture
│   ├── microphone.rs          # Microphone capture stream
│   ├── system.rs              # System audio capture stream
│   └── core_audio.rs          # macOS ScreenCaptureKit integration
├── pipeline.rs                # Audio mixing and VAD processing
├── recording_manager.rs       # High-level recording coordination
├── recording_commands.rs      # Tauri command interface
└── recording_saver.rs         # Audio file writing
```

**When working on audio features**:
- Device detection issues → `devices/discovery.rs` or `devices/platform/{windows,macos,linux}.rs`
- Microphone/speaker problems → `devices/microphone.rs` or `devices/speakers.rs`
- Audio capture issues → `capture/microphone.rs` or `capture/system.rs`
- Mixing/processing problems → `pipeline.rs`
- Recording workflow → `recording_manager.rs`

### Rust ↔ Frontend Communication (Tauri Architecture)

**Command Pattern** (Frontend → Rust):
```typescript
// Frontend: src/app/page.tsx
await invoke('start_recording', {
  mic_device_name: "Built-in Microphone",
  system_device_name: "BlackHole 2ch",
  meeting_name: "Team Standup"
});
```

```rust
// Rust: src/lib.rs
#[tauri::command]
async fn start_recording<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>
) -> Result<(), String> {
    // Implementation delegates to audio::recording_commands
}
```

**Event Pattern** (Rust → Frontend):
```rust
// Rust: Emit transcript updates
app.emit("transcript-update", TranscriptUpdate {
    text: "Hello world".to_string(),
    timestamp: chrono::Utc::now(),
    // ...
})?;
```

```typescript
// Frontend: Listen for events
await listen<TranscriptUpdate>('transcript-update', (event) => {
  setTranscripts(prev => [...prev, event.payload]);
});
```

### Whisper Model Management

**Model Storage Locations**:
- **Development**: `frontend/models/`
- **Production (macOS)**: `~/Library/Application Support/Meetily/models/`
- **Production (Windows)**: `%APPDATA%\Meetily\models\`

**Model Loading** (frontend/src-tauri/src/whisper_engine/whisper_engine.rs):
```rust
pub async fn load_model(&self, model_name: &str) -> Result<()> {
    // Automatically detects GPU capabilities (Metal/CUDA/Vulkan)
    // Falls back to CPU if GPU unavailable
}
```

**GPU Acceleration**:
- **macOS**: Metal + CoreML (automatically enabled)
- **Windows/Linux**: CUDA (NVIDIA), Vulkan (AMD/Intel), or CPU
- Configure via Cargo features: `--features cuda`, `--features vulkan`

## Critical Development Patterns

### 1. Audio Buffer Management

**Ring Buffer Mixing** (pipeline.rs):
- Mic and system audio arrive asynchronously at different rates
- Ring buffer accumulates samples until both streams have aligned windows (50ms)
- Professional mixing applies RMS-based ducking to prevent system audio from drowning out microphone
- Uses `VecDeque` for efficient windowed processing

### 2. Thread Safety and Async Boundaries

**Recording State** (recording_state.rs):
```rust
pub struct RecordingState {
    is_recording: Arc<AtomicBool>,
    audio_sender: Arc<RwLock<Option<mpsc::UnboundedSender<AudioChunk>>>>,
    // ...
}
```

**Key Pattern**: Use `Arc<RwLock<T>>` for shared state across async tasks, `Arc<AtomicBool>` for simple flags.

### 3. Error Handling and Logging

**Performance-Aware Logging** (lib.rs):
```rust
#[cfg(debug_assertions)]
macro_rules! perf_debug {
    ($($arg:tt)*) => { log::debug!($($arg)*) };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_debug {
    ($($arg:tt)*) => {};  // Zero overhead in release builds
}
```

**Usage**: Use `perf_debug!()` and `perf_trace!()` for hot-path logging that should be eliminated in production.

### 4. Frontend State Management

**Sidebar Context** (components/Sidebar/SidebarProvider.tsx):
- Global state for meetings list, current meeting, recording status
- Communicates with the Rust/Tauri core through Tauri commands and events
- Keeps React state synchronized with native recording, meeting, transcript, and summary state

**Pattern**: Tauri commands update Rust state → Emit events → Frontend listeners update React state → Context propagates to components

## Common Development Tasks

### Adding a New Audio Device Platform

1. Create platform file: `audio/devices/platform/{platform_name}.rs`
2. Implement device enumeration for the platform
3. Add platform-specific configuration in `audio/devices/configuration.rs`
4. Update `audio/devices/platform/mod.rs` to export new platform functions
5. Test with `cargo check` and platform-specific device tests

### Adding a New Tauri Command

1. Define command in `src/lib.rs`:
   ```rust
   #[tauri::command]
   async fn my_command(arg: String) -> Result<String, String> { /* ... */ }
   ```
2. Register in `tauri::Builder`:
   ```rust
   .invoke_handler(tauri::generate_handler![
       start_recording,
       my_command,  // Add here
   ])
   ```
3. Call from frontend:
   ```typescript
   const result = await invoke<string>('my_command', { arg: 'value' });
   ```

### Modifying Audio Pipeline Behavior

**Location**: `frontend/src-tauri/src/audio/pipeline.rs`

Key components:
- `AudioMixerRingBuffer`: Manages mic + system audio synchronization
- `ProfessionalAudioMixer`: RMS-based ducking and mixing
- `AudioPipelineManager`: Orchestrates VAD, mixing, and distribution

**Testing Audio Changes**:
```bash
# Enable verbose audio logging
RUST_LOG=app_lib::audio=debug ./clean_run.sh

# Monitor audio metrics in real-time
# Check Developer Console in the app (Cmd+Shift+I on macOS)
```

### Tauri Backend Development

Current app behavior should be implemented in the Rust/Tauri core, not in the archived Python backend. Add new frontend-facing behavior through Tauri commands/events and existing Rust services under `frontend/src-tauri/src`.

Do not add new endpoints to `backend/app/main.py`; that FastAPI code is legacy archive material only.

## Testing and Debugging

### Frontend Debugging

**Enable Rust Logging**:
```bash
# macOS
RUST_LOG=debug ./clean_run.sh

# Windows (PowerShell)
$env:RUST_LOG="debug"; ./clean_run_windows.bat
```

**Developer Tools**:
- Open DevTools: `Cmd+Shift+I` (macOS) or `Ctrl+Shift+I` (Windows)
- Console Toggle: Built into app UI (console icon)
- View Rust logs: Check terminal output

### Audio Pipeline Debugging

**Key Metrics** (emitted by pipeline):
- Buffer sizes (mic/system)
- Mixing window count
- VAD detection rate
- Dropped chunk warnings

**Monitor via Developer Console**: The app includes real-time metrics display when recording.

## Platform-Specific Notes

### macOS
- **Audio Capture**: Uses ScreenCaptureKit for system audio (macOS 13+)
- **GPU**: Metal + CoreML automatically enabled
- **Permissions**: Requires microphone + screen recording permissions
- **System Audio**: Requires virtual audio device (BlackHole) for system capture

### Windows
- **Audio Capture**: Uses WASAPI (Windows Audio Session API)
- **GPU**: CUDA (NVIDIA) or Vulkan (AMD/Intel) via Cargo features
- **Build Tools**: Requires Visual Studio Build Tools with C++ workload
- **System Audio**: Uses WASAPI loopback for system capture

### Linux
- **Audio Capture**: ALSA/PulseAudio
- **GPU**: CUDA (NVIDIA) or Vulkan via Cargo features
- **Dependencies**: Requires cmake, llvm, libomp

## Performance Optimization Guidelines

### Audio Processing
- Use `perf_debug!()` / `perf_trace!()` for hot-path logging (zero cost in release)
- Batch audio metrics using `AudioMetricsBatcher` (pipeline.rs)
- Pre-allocate buffers with `AudioBufferPool` (buffer_pool.rs)
- VAD filtering reduces Whisper load by ~70% (only processes speech)

### Whisper Transcription
- **Model Selection**: Balance accuracy vs speed
  - Development: `base` or `small` (fast iteration)
  - Production: `medium` or `large-v3` (best quality)
- **GPU Acceleration**: 5-10x faster than CPU
- **Parallel Processing**: Available in `whisper_engine/parallel_processor.rs` for batch workloads

### Frontend Performance
- React state updates batched via Sidebar context
- Transcript rendering virtualized for large meetings
- Audio level monitoring throttled to 60fps

## Important Constraints and Gotchas

1. **Audio Chunk Size**: Pipeline expects consistent 48kHz sample rate. Resampling happens at capture time.

2. **Platform Audio Quirks**:
   - macOS: ScreenCaptureKit requires macOS 13+, needs screen recording permission
   - Windows: WASAPI exclusive mode can conflict with other apps
   - System audio requires virtual device (BlackHole on macOS, WASAPI loopback on Windows)

3. **Whisper Model Loading**: Models are loaded once and cached. Changing models requires app restart or manual unload/reload.

4. **No Separate Backend Dependency**: Meeting persistence, transcription, and LLM features are handled by the Tauri app. Do not reintroduce the archived FastAPI backend as a supported requirement.

5. **Legacy FastAPI Security Context**: The archived FastAPI/CORS behavior is unsupported legacy code and must not be treated as a supported production API.

6. **File Paths**: Use Tauri's path APIs (`downloadDir`, etc.) for cross-platform compatibility. Never hardcode paths.

7. **Audio Permissions**: Request permissions early. macOS requires both microphone AND screen recording for system audio.

## Repository-Specific Conventions

- **Logging Format**: Rust logs should include enough module context to diagnose app behavior
- **Error Handling**: Rust uses `anyhow::Result`, frontend uses try-catch with user-friendly messages
- **Naming**: Audio devices use "microphone" and "system" consistently (not "input"/"output")
- **Git Branches**:
  - `main`: Stable releases
  - `fix/*`: Bug fixes
  - `enhance/*`: Feature enhancements
  - Current: `fix/audio-mixing` (working on audio pipeline improvements)

## Key Files Reference

**Core Coordination**:
- [frontend/src-tauri/src/lib.rs](frontend/src-tauri/src/lib.rs) - Main Tauri entry point, command registration
- [frontend/src-tauri/src/audio/mod.rs](frontend/src-tauri/src/audio/mod.rs) - Audio module exports
- [frontend/src-tauri/src/database/mod.rs](frontend/src-tauri/src/database/mod.rs) - Local database module

**Audio System**:
- [frontend/src-tauri/src/audio/recording_manager.rs](frontend/src-tauri/src/audio/recording_manager.rs) - Recording orchestration
- [frontend/src-tauri/src/audio/pipeline.rs](frontend/src-tauri/src/audio/pipeline.rs) - Audio mixing and VAD
- [frontend/src-tauri/src/audio/recording_saver.rs](frontend/src-tauri/src/audio/recording_saver.rs) - Audio file writing

**UI Components**:
- [frontend/src/app/page.tsx](frontend/src/app/page.tsx) - Main recording interface
- [frontend/src/components/Sidebar/SidebarProvider.tsx](frontend/src/components/Sidebar/SidebarProvider.tsx) - Global state management

**Whisper Integration**:
- [frontend/src-tauri/src/whisper_engine/whisper_engine.rs](frontend/src-tauri/src/whisper_engine/whisper_engine.rs) - Whisper model management and transcription



================================================
FILE: CONTRIBUTING.md
================================================
# Contributing to Meeting Minutes Updates

Thank you for your interest in contributing to Meetily! This document provides guidelines and instructions for contributing to this project.

## Development Workflow

### Branch Strategy

- `main` - Production branch
- `devtest` - Development and testing branch
- Feature branches should be created from `devtest`

### Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/meeting-minutes.git
   ```
3. Add the original repository as upstream:
   ```bash
   git remote add upstream https://github.com/Zackriya-Solutions/meeting-minutes.git
   ```
4. Create a new branch from `devtest`:
   ```bash
   git checkout devtest
   git pull upstream devtest
   git checkout -b feature/your-feature-name
   ```

### Development Process

1. Always start your work from the `devtest` branch
2. Create a new branch for each feature/fix
3. Make your changes
4. Write or update tests as needed
5. Ensure all tests pass
6. Update documentation if necessary

### Issue Creation

Before starting work on a new feature or bug fix:

1. Check if an issue already exists
2. If not, create a new issue with:
   - Clear title
   - Detailed description
   - Steps to reproduce (for bugs)
   - Expected behavior
   - Screenshots (if applicable)
   - Labels (bug, enhancement, etc.)

### Pull Request Process

1. Create a PR from your feature branch to `devtest`
2. Link the PR to the related issue using the issue number (e.g., "Fixes #123")
3. Fill out the PR template completely
4. Ensure CI checks pass
5. Request review from at least one maintainer
6. Address any review comments
7. Once approved, the PR will be merged into `devtest`

### PR Template

```markdown
## Description
[Describe your changes here]

## Related Issue
[Link to the issue this PR addresses]

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring
- [ ] Other (please describe)

## Testing
- [ ] Unit tests added/updated
- [ ] Manual testing performed
- [ ] All tests pass

## Documentation
- [ ] Documentation updated
- [ ] No documentation needed

## Checklist
- [ ] Code follows project style
- [ ] Self-reviewed the code
- [ ] Added comments for complex code
- [ ] Updated README if needed
```

## Code Style

- Follow the existing code style
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused
- Write clear commit messages

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
- style: Code style changes
- refactor: Code refactoring
- test: Adding/updating tests
- chore: Maintenance tasks

## Testing

- Write unit tests for new features
- Update existing tests when modifying code
- Ensure all tests pass before submitting PR
- Include integration tests for complex features

## Documentation

- Update documentation for new features
- Keep README up to date
- Document API changes
- Add comments for complex code

## Review Process

1. PRs require at least one review
2. Address all review comments
3. Keep the PR up to date with `devtest`
4. Squash commits if requested

## Getting Help

- Create an issue for questions
- Join our community chat
- Contact maintainers

## License

By contributing, you agree that your contributions will be licensed under the project's MIT License. 


================================================
FILE: LICENSE.md
================================================
MIT License

Copyright (c) 2024 Zackriya Solutions

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


================================================
FILE: PRIVACY_POLICY.md
================================================
# Meetily Privacy Policy

*Last updated: [Current Date]*

## Our Privacy-First Commitment

Meetily is built on the principle that your meeting data should remain private and under your control. This privacy policy explains how we handle data in our open-source meeting assistant.

## Data Processing Philosophy

### Local-First Processing
- **Meeting transcription**: Processed entirely on your device using local Whisper models
- **Audio recordings**: Never transmitted to external servers
- **Meeting content**: Remains on your infrastructure
- **AI summaries**: Generated locally or through your chosen LLM provider

### Your Data Ownership
- You own all meeting data, transcripts, and recordings
- Data is stored locally on your device
- No vendor lock-in - export your data anytime
- Complete control over data retention and deletion

## Usage Analytics

### What We Collect
Usage analytics is optional and off by default. When you choose to enable it, Meetily collects minimal, anonymized usage data:

**Application Usage:**
- Feature usage patterns (which tools you use most)
- Session duration and frequency
- Performance metrics (transcription success rates, error frequencies)
- UI interaction patterns (button clicks, navigation flows)

**Technical Metrics:**
- Application version and platform information
- Error logs and crash reports (anonymized)
- Performance benchmarks (processing times, resource usage)

### What We DON'T Collect
We never collect:
- ❌ Meeting content, transcripts, or recordings
- ❌ Personal information or identifiable data
- ❌ File names, meeting titles, or metadata
- ❌ Audio data or voice patterns
- ❌ Participant names or contact information
- ❌ LLM conversations or AI-generated content

### Why We Collect This Data
When enabled, analytics helps us with:
- **Product Quality**: Identifying and fixing bugs that impact user experience
- **Performance Optimization**: Understanding resource usage and system bottlenecks
- **Security**: Detecting potential security issues and vulnerabilities
- **Feature Development**: Making data-driven decisions about new features
- **Open Source Sustainability**: Ensuring the project meets user needs effectively

### Analytics Implementation
- **Provider**: PostHog (privacy-focused analytics platform)
- **Default**: Off by default; analytics starts only after you enable it in settings
- **Anonymization**: All data linked to generated user IDs only - no personal identification
- **Data retention**: 12 months maximum, then automatically deleted
- **Encryption**: All data encrypted in transit using industry-standard protocols
- **Location**: Data processed in accordance with PostHog's privacy policy
- **Access Control**: Strictly limited to core development team members

## Third-Party Services

### LLM Providers (Optional)
If you choose to use external LLM providers:
- **Anthropic Claude**: Subject to Anthropic's privacy policy
- **Groq**: Subject to Groq's privacy policy
- **Local Ollama**: Processed entirely on your device

### Analytics Service (Optional)
- **PostHog**: Used for usage analytics when enabled
- **Data**: Only anonymized usage patterns, no meeting content
- **Control**: Completely optional, off by default, and user-controlled

## Your Privacy Rights

### Data Control
- **Access**: View all data stored locally on your device
- **Export**: Export your data in standard formats
- **Delete**: Remove all data from your device


### Analytics Transparency
- **Open source**: Full analytics implementation available for review in our source code
- **Opt-in**: New and existing installs have analytics disabled until you turn it on
- **Questions**: Contact us for any analytics-related concerns

## Data Security

### Local Security
- Data encrypted at rest using your device's security features
- No transmission of sensitive meeting data
- Standard file system permissions protect your data

### Open Source Transparency
- Full source code available for security review
- Community-audited privacy implementations
- No hidden data collection or tracking

## Changes to This Policy

We will notify users of any material changes to this privacy policy through:
- Updates to this document in our GitHub repository
- Release notes for application updates
- In-app notifications for significant privacy changes

## Contact Us

For privacy-related questions or concerns:
- **GitHub Issues**: [Create an issue](https://github.com/Zackriya-Solutions/meeting-minutes/issues)
- **Email**: [Contact form](https://www.zackriya.com/service-interest-form/)
- **Community**: [Discord](https://discord.gg/crRymMQBFH)

## Open Source Commitment

As an open-source project under MIT license, you can:
- Review our complete privacy implementation
- Modify data handling to meet your requirements
- Deploy entirely on your own infrastructure
- Contribute to privacy improvements

---

*This privacy policy applies to Meetily v0.0.5 and later versions. For enterprise deployments, additional privacy controls may be available.*



================================================
FILE: backend/README.md
================================================
# Legacy Backend Archive

This directory contains the archived Python/FastAPI, Docker, and standalone
whisper-server backend implementation from older Meetily releases.

## Current Supported Architecture

Meetily no longer uses this backend as the supported application path. The
current app is a self-contained Tauri desktop application:

- Next.js provides the desktop UI from `frontend/src`.
- Rust/Tauri provides the local backend and native integration from
  `frontend/src-tauri`.
- Local transcription, meeting storage, and summary workflows are handled by
  the bundled desktop app rather than a separate FastAPI service.

Use these docs for supported setup and development:

- [Top-level README](../README.md)
- [Building from Source](../docs/BUILDING.md)
- [Architecture](../docs/architecture.md)

## Status of This Directory

The files under `backend/` are retained only for historical reference and
legacy migration context. They should not be used for new installs, production
deployments, security assessments of the supported app, or contributor setup.

The old FastAPI service, Docker compose flow, standalone whisper-server flow,
and related scripts are unsupported. The old unauthenticated FastAPI/CORS
behavior must not be treated as a supported production API.



================================================
FILE: backend/API_DOCUMENTATION.md
================================================
# Legacy Backend API Archive

This document previously described the Python/FastAPI API used by older
Meetily backend releases.

## Current Supported API Surface

Meetily no longer supports the standalone FastAPI backend as the active
application API. The supported application is the Tauri desktop app, where the
Next.js UI communicates with the Rust core through Tauri commands and events.

Use these docs for the supported architecture and build flow:

- [Top-level README](../README.md)
- [Building from Source](../docs/BUILDING.md)
- [Architecture](../docs/architecture.md)

## Security and Support Notice

The archived FastAPI API was unauthenticated and had development-oriented CORS
behavior. It must not be treated as a supported production API or used as the
basis for new deployments.

This file is retained only to explain why older references may exist in the
repository and to support migration research for users coming from legacy
installations.



================================================
FILE: backend/build-docker.ps1
================================================
# Multi-platform Docker build script for Whisper Server and Meeting App
# Supports both CPU-only and GPU-enabled builds across multiple architectures
#
# WARNING: AUDIO PROCESSING WARNING:
# Docker containers with insufficient resources will drop audio chunks when
# the processing queue becomes full (MAX_AUDIO_QUEUE_SIZE=10, lib.rs:54).
# Ensure containers have adequate memory (8GB+) and CPU allocation.
# Monitor logs for 'Dropped old audio chunk' messages (lib.rs:330).

param(
    [Parameter(Position=0)]
    [ValidateSet('cpu', 'gpu', 'macos', 'both', 'test-gpu')]
    [string]$BuildType = 'cpu',
    
    [Alias('r')]
    [string]$Registry = $env:REGISTRY,
    
    [Alias('p')]
    [switch]$Push,
    
    [Alias('t')]
    [string]$Tag,
    
    [string]$Platforms,
    
    [string]$BuildArgs = $env:BUILD_ARGS,
    
    [switch]$NoCache,
    
    [switch]$DryRun,
    
    [Alias('h')]
    [switch]$Help
)

# Set error action preference
$ErrorActionPreference = 'Stop'

# Configuration
$ScriptDir = $PSScriptRoot
$WhisperProjectName = 'whisper-server'
$AppProjectName = 'meetily-backend'

# Platform detection for cross-platform compatibility
$DetectedOS = [System.Environment]::OSVersion.Platform
$IsWindows = $IsWindows -or ($env:OS -eq 'Windows_NT') -or ($env:ComSpec -like '*cmd.exe')
$IsLinux = $IsLinux -or ($DetectedOS -eq [System.PlatformID]::Unix -and (Test-Path '/proc/version'))
$IsMacOS = $IsMacOS -or ($DetectedOS -eq [System.PlatformID]::Unix -and -not (Test-Path '/proc/version'))

# Multi-platform Docker build script for Whisper Server and Meeting App

# Color functions - Move these to the top before any other code uses them
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Handle-Error {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

# ...existing code for param block and other variables...

# Platform detection can now use Write-Info safely
if ($IsMacOS) {
    Write-Info "macOS detected via PowerShell - will support macOS-optimized configurations"
} elseif ($IsWindows) {
    Write-Info "Windows detected - optimizing for Windows Docker Desktop"
}

# ...rest of existing code...s
# ...existing code...

# Platform detection - remove duplicate block and fix string interpolation
if ($IsMacOS) {
    Write-Info "macOS detected - will support macOS-optimized configurations"
} elseif ($IsWindows) {
    Write-Info "Windows detected - optimizing for Windows Docker Desktop"
}

# Default to current platform for local builds, multi-platform for registry pushes
if (-not $Platforms) {
    # For Windows builds, always use linux/amd64 unless explicitly overridden
    if ($IsWindows) {
        $Platforms = "linux/amd64"  # Changed from "gpu"
    } else {
        $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::X64) { "amd64" } else { "arm64" }
        $Platforms = "linux/$arch"
    }
}

# Windows-specific GPU detection
function Test-WindowsGpuSupport {
    if (-not $IsWindows) {
        return $false
    }
    
    Write-Info 'Checking Windows GPU support...'
    
    # Check for NVIDIA GPU
    try {
        $nvidiaOutput = nvidia-smi --query-gpu=name --format=csv,noheader,nounits 2>$null
        if ($nvidiaOutput) {
            Write-Info 'NVIDIA GPU detected: $($nvidiaOutput -split '`n' | Select-Object -First 1)'
            
            # Check Docker GPU support
            try {
                Write-Info 'Testing Docker GPU support...'
                $dockerGpuTest = docker run --rm --gpus all nvidia/cuda:11.8-base-ubuntu20.04 nvidia-smi --query-gpu=name --format=csv,noheader,nounits 2>$null
                if ($dockerGpuTest) {
                    Write-Info '✓ Docker GPU support confirmed'
                    return $true
                } else {
                    Write-Warn '✗ Docker GPU support not available'
                    Write-Info '> Install nvidia-container-toolkit for GPU support'
                }
            } catch {
                Write-Warn '✗ Could not test Docker GPU support'
            }
        } else {
            Write-Info 'No NVIDIA GPU detected'
        }
    } catch {
        Write-Info 'NVIDIA drivers not installed or nvidia-smi not available'
    }
    
    return $false
}

function Show-Help {
    @'
Multi-platform Whisper Server and Meeting App Docker Builder

Usage: build-docker.ps1 [OPTIONS] [BUILD_TYPE]

BUILD_TYPE:
  cpu           Build whisper server CPU-only + meeting app (default)
  gpu           Build whisper server GPU-enabled + meeting app
  macos         Build whisper server macOS-optimized + meeting app (cross-platform compatibility)
  both          Build both whisper server versions + meeting app
  
OPTIONS:
  -Registry                 Docker registry (e.g. ghcr.io/user)
  -Push                     Push images to registry
  -Tag                      Custom tag (default: auto-generated)
  -Platforms PLATFORMS      Target platforms (default: current platform)
  -BuildArgs ARGS           Additional build arguments
  -NoCache                  Build without cache
  -DryRun                   Show commands without executing
  -Help                     Show this help

Examples:
  # Build whisper CPU version + meeting app for current platform
  .\build-docker.ps1 cpu
  
  # Build whisper GPU version + meeting app
  .\build-docker.ps1 gpu
  
  # Build whisper macOS-optimized version + meeting app
  .\build-docker.ps1 macos
  
  # Build both whisper versions + meeting app
  .\build-docker.ps1 both
  
  # Build GPU version for multiple platforms (requires -Push)
  .\build-docker.ps1 gpu -Platforms 'linux/amd64,linux/arm64' -Push
  
  # Build both versions and push to registry
  .\build-docker.ps1 both -Registry 'ghcr.io/myuser' -Push
  
  # Build with custom CUDA version
  .\build-docker.ps1 gpu -BuildArgs 'CUDA_VERSION=12.1.1'

Note: The meeting app is always built alongside the whisper server as they work as a package.

Environment Variables:
  REGISTRY      Docker registry prefix
  PUSH          Push to registry (true/false)
  PLATFORMS     Target platforms
  BUILD_ARGS    Additional build arguments
'@
}

# Function to check prerequisites
# Fix the prerequisites check
function Test-Prerequisites {
    Write-Info "Checking prerequisites..."
    
    # Check Docker
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Handle-Error "Docker is not installed or not in PATH"
    }
    
    # Check Docker Buildx
    try {
        docker buildx version | Out-Null
    } catch {
        Handle-Error "Docker Buildx is not available. Please install Docker Desktop or enable Buildx"
    }
    
    # Check if buildx builder exists
    $builderExists = docker buildx ls | Select-String 'whisper-builder'
    if (-not $builderExists) {
        Write-Info "Creating multi-platform builder..."
        docker buildx create --name whisper-builder --platform $Platforms --use
    } else {
        Write-Info "Using existing whisper-builder"
        docker buildx use whisper-builder
    }
    
    Write-Info "Prerequisites check passed"
}

# Fix the whisper.cpp directory handling
Write-Info "Changing to whisper.cpp directory..."
try {
    Write-Info "Current directory: $ScriptDir"
    $whisperPath = Join-Path $ScriptDir "whisper.cpp"
    
    if (-not (Test-Path $whisperPath -PathType Container)) {
        Handle-Error "whisper.cpp directory not found at: $whisperPath"
    }
    
    Set-Location -Path $whisperPath
    Write-Info "Changed to directory: $(Get-Location)"
    
    # Check for custom server directory
    $customServerPath = Join-Path $ScriptDir "whisper-custom\server"
    Write-Info "Checking for custom server directory: $customServerPath"
    
    if (-not (Test-Path $customServerPath -PathType Container)) {
        Handle-Error "Directory not found: $customServerPath"
    }
    
    # Copy custom server files
    Write-Info "Copying custom server files..."
    try {
        Copy-Item -Path "$customServerPath\*" -Destination "examples\server\" -Recurse -Force
        Write-Info "Custom server files copied successfully"
    } catch {
        Handle-Error "Failed to copy custom server files: $_"
    }
} catch {
    Handle-Error "Failed to setup whisper.cpp directory: $_"
}

Write-Info 'Verifying server files...'
Get-ChildItem 'examples/server/' | Out-Null

Write-Info 'Returning to original directory...'
Set-Location $ScriptDir

# Function to generate image tag
# Fix the New-Tag function
function New-Tag {
    param(
        [string]$BuildType,
        [string]$CustomTag
    )
    
    if ($CustomTag) {
        return $CustomTag
    }
    
    $timestamp = Get-Date -Format 'yyyyMMdd'
    
    # Get git commit hash if available
    $gitHash = ''
    try {
        $gitHash = "-$(git rev-parse --short HEAD 2>$null)"
    } catch {
        # Git not available or not in repo
    }
    
    # Fix string interpolation
    switch ($BuildType) {
        'cpu' { return "cpu-$timestamp$gitHash" }
        'gpu' { return "gpu-$timestamp$gitHash" }
        'macos' { return "macos-$timestamp$gitHash" }
        'app' { return "app-$timestamp$gitHash" }
        default { return "$BuildType-$timestamp$gitHash" }
    }
}

# Fix the Build-Image function
function Build-Image {
    param(
        [string]$BuildType,
        [string]$Tag
    )
    
    # Store original directory
    $originalDir = Get-Location
    
    try {
        # Set project name based on build type
        $projectName = if ($BuildType -eq 'app') { $AppProjectName } else { $WhisperProjectName }
        
        # Determine Dockerfile path based on the actual directory structure
        $dockerfile = switch ($BuildType) {
            'app' { Join-Path $ScriptDir "Dockerfile.app" }
            'cpu' { Join-Path $ScriptDir "Dockerfile.server-cpu" }
            'gpu' { Join-Path $ScriptDir "Dockerfile.server-gpu" }
            'macos' { Join-Path $ScriptDir "Dockerfile.server-macos" }
            default { throw "Invalid build type: $BuildType" }
        }
        
        # Verify Dockerfile exists
        if (-not (Test-Path $dockerfile -PathType Leaf)) {
            throw "Dockerfile not found at: $dockerfile"
        }
        
        # Construct full tag
        $fullTag = if ($Registry) { 
            "$Registry/$projectName`:$Tag" 
        } else { 
            "$projectName`:$Tag" 
        }
        
        Write-Info "Building $BuildType image: $fullTag"
        Write-Info "Platforms: $Platforms"
        Write-Info "Dockerfile: $dockerfile"
        Write-Info "Build context: $ScriptDir"
        
        # Set working directory to backend root for build context
        Set-Location $ScriptDir
        
        # Build command array
        $buildCmd = @(
            'buildx'
            'build'
            '--platform'
            $Platforms
            '--file'
            $dockerfile
            '--tag'
            $fullTag
        )
        
        if ($Push) {
            $buildCmd += '--push'
        } else {
            $buildCmd += '--load'
        }
        
        if ($BuildArgs) {
            $buildCmd += '--build-arg'
            $buildCmd += $BuildArgs
        }
        
        $buildCmd += '.'
        
        # Convert array to space-separated string for display
        $cmdDisplay = $buildCmd -join ' '
        
        if ($DryRun) {
            Write-Info "DRY RUN - Command would be:"
            Write-Info "docker $cmdDisplay"
            return $true
        }
        
        try {
            Write-Info "Executing: docker $cmdDisplay"
            $process = Start-Process -FilePath 'docker' -ArgumentList $buildCmd -Wait -PassThru -NoNewWindow
            
            if ($process.ExitCode -eq 0) {
                Write-Info "Successfully built: $fullTag"
                
                # Also tag with generic tag for docker-compose compatibility
                if (-not $Push) {
                    $genericTag = if ($Registry) { 
                        "$Registry/$projectName`:$BuildType" 
                    } else { 
                        "$projectName`:$BuildType" 
                    }
                    
                    Write-Info "Tagging as generic: $genericTag"
                    docker tag $fullTag $genericTag
                    
                    # For meetily-backend, also tag as 'latest'
                    if ($BuildType -eq 'app') {
                        $latestTag = if ($Registry) { 
                            "$Registry/$projectName`:latest" 
                        } else { 
                            "$projectName`:latest" 
                        }
                        Write-Info "Tagging as latest: $latestTag"
                        docker tag $fullTag $latestTag
                    }
                }
                
                return $true
            } else {
                throw "Docker build failed with exit code: $($process.ExitCode)"
            }
        } catch {
            Write-Error "Failed to build: $fullTag"
            Write-Error $_.Exception.Message
            return $false
        }
    } finally {
        # Always return to original directory
        Set-Location $originalDir
    }
}

# Main function
function Main {
    Write-Info "=== Whisper Server Docker Builder ==="
    Write-Info "Build type: $BuildType"
    if ($Registry) {
        Write-Info "Registry: $Registry"
    } else {
        Write-Info "Registry: None"
    }
    Write-Info "Platforms: $Platforms"
    Write-Info "Push: $($Push.ToString())"

    # Windows-specific optimizations
    if ($IsWindows) {
        Write-Info 'Windows environment detected'
        
        # Auto-detect optimal build type if not explicitly set
        if ($BuildType -eq 'cpu' -and $PSBoundParameters.Count -eq 0) {
            $hasGpu = Test-WindowsGpuSupport
            if ($hasGpu) {
                Write-Info 'GPU support detected - consider using: .\build-docker.ps1 gpu'
                Write-Info 'Continuing with CPU build as requested'
            }
        } elseif ($BuildType -eq 'gpu') {
            $hasGpu = Test-WindowsGpuSupport
            if (-not $hasGpu) {
                Write-Warn 'GPU build requested but GPU support not available'
                Write-Info 'Building GPU image anyway (may fallback to CPU at runtime)'
            }
        }
    }
    
    # Auto-detect macOS and adjust build type if needed
    if ($IsMacOS -and $BuildType -eq 'cpu') {
        Write-Info 'macOS detected - switching from CPU to macOS-optimized build'
        $BuildType = 'macos'
    } elseif ($IsMacOS -and $BuildType -eq 'gpu') {
        Write-Warn 'GPU build requested on macOS - switching to macOS-optimized (CPU-only) build'
        $BuildType = 'macos'
    }
    
    # Check prerequisites
    Test-Prerequisites
    
    # Build images - always build meeting app alongside whisper server
    switch ($BuildType) {
        'cpu' {
            $whisperTag = New-Tag 'cpu' $Tag
            $appTag = New-Tag 'app' $Tag
            
            Write-Info 'Building whisper server (CPU) + meeting app...'
            $success1 = Build-Image 'cpu' $whisperTag
            $success2 = Build-Image 'app' $appTag
            
            if (-not ($success1 -and $success2)) {
                exit 1
            }
        }
        'gpu' {
            $whisperTag = New-Tag 'gpu' $Tag
            $appTag = New-Tag 'app' $Tag
            
            Write-Info 'Building whisper server (GPU) + meeting app...'
            $success1 = Build-Image 'gpu' $whisperTag
            $success2 = Build-Image 'app' $appTag
            
            if (-not ($success1 -and $success2)) {
                exit 1
            }
        }
        'macos' {
            $whisperTag = New-Tag 'macos' $Tag
            $appTag = New-Tag 'app' $Tag
            
            Write-Info 'Building whisper server (macOS-optimized) + meeting app...'
            $success1 = Build-Image 'macos' $whisperTag
            $success2 = Build-Image 'app' $appTag
            
            if (-not ($success1 -and $success2)) {
                exit 1
            }
        }
        'both' {
            $cpuTag = New-Tag 'cpu' $Tag
            $gpuTag = New-Tag 'gpu' $Tag
            $appTag = New-Tag 'app' $Tag
            
            Write-Info 'Building both whisper server versions + meeting app...'
            $success1 = Build-Image 'cpu' $cpuTag
            $success2 = Build-Image 'gpu' $gpuTag
            $success3 = Build-Image 'app' $appTag
            
            if (-not ($success1 -and $success2 -and $success3)) {
                exit 1
            }
        }
        'test-gpu' {
            Write-Info '=== GPU Support Test ==='
            if ($IsWindows) {
                Test-WindowsGpuSupport
            } else {
                Write-Info 'GPU test is currently Windows-specific'
            }
            exit 0
        }
        default {
            Handle-Error 'Invalid build type: $BuildType'
        }
    }
    
    Write-Info '=== Build Complete ==='
    
    # Show built images
    if (-not $DryRun -and -not $Push) {
        Write-Info 'Built images:'
        try {
            docker images $WhisperProjectName --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}'
            docker images $AppProjectName --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}'
        } catch {
            # Ignore errors if images command fails
        }
        
        # Automatically run containers after successful build
        Write-Info ''
        Write-Info '=== Starting Containers ==='
        Write-Info 'Launching whisper server and meeting app...'
        
        # Call run-docker.ps1 with appropriate build type
        $runScriptPath = Join-Path $ScriptDir 'run-docker.ps1'
        if (Test-Path $runScriptPath) {
            # Determine which GPU mode to use based on what was built
            $runArgs = @('start', '-d')  # Start in foreground mode
            # Note: NOT passing -d (detach) to keep containers in foreground
            # If GPU was built, use GPU mode
            if ($BuildType -eq 'gpu' -or $BuildType -eq 'both') {
                $runArgs += '-Gpu'
            } elseif ($BuildType -eq 'cpu') {
                $runArgs += '-Cpu'
            }
            # For 'macos' and 'app' types, let run-docker.ps1 auto-detect
            
            # Display comprehensive configuration that will be executed
            Write-Info ''
            Write-Info '=== Container Configuration Preview ==='
            Write-Info ''
            Write-Info '> Build Configuration:'
            Write-Info "   Script to execute: $runScriptPath"
            Write-Info "   Arguments: $($runArgs -join ' ')"
            Write-Info "   Build type: $BuildType"
            Write-Info "   Platforms: $Platforms"
            if ($Registry) {
                Write-Info "   Registry: $Registry"
            }
            if ($Tag) {
                Write-Info "   Custom tag: $Tag"
            }
            if ($BuildArgs) {
                Write-Info "   Build args: $BuildArgs"
            }
            Write-Info ''
            
            Write-Info ' Whisper Server Configuration:'
            # Get default model based on build type
            $defaultModel = switch ($BuildType) {
                'gpu' { 'models/ggml-base.en.bin' }
                'cpu' { 'models/ggml-base.en.bin' }
                'macos' { 'models/ggml-base.en.bin' }
                'both' { 'models/ggml-base.en.bin (CPU) / models/ggml-base.en.bin (GPU)' }
                default { 'models/ggml-base.en.bin' }
            }
            Write-Info "   Model: $(if ($env:WHISPER_MODEL) { $env:WHISPER_MODEL } else { $defaultModel })"
            Write-Info "   Host: $(if ($env:WHISPER_HOST) { $env:WHISPER_HOST } else { '0.0.0.0' })"
            Write-Info "   Port: $(if ($env:WHISPER_PORT) { $env:WHISPER_PORT } else { '8178' })"
            Write-Info "   Threads: $(if ($env:WHISPER_THREADS) { $env:WHISPER_THREADS } else { '0 (auto-detect)' })"
            Write-Info "   GPU Enabled: $(if ($env:WHISPER_USE_GPU) { $env:WHISPER_USE_GPU } else { 'true' })"
            Write-Info "   Language: $(if ($env:WHISPER_LANGUAGE) { $env:WHISPER_LANGUAGE } else { 'en' })"
            Write-Info "   Translation: $(if ($env:WHISPER_TRANSLATE) { $env:WHISPER_TRANSLATE } else { 'false' })"
            Write-Info "   Diarization: $(if ($env:WHISPER_DIARIZE) { $env:WHISPER_DIARIZE } else { 'false' })"
            Write-Info "   Show Progress: $(if ($env:WHISPER_PRINT_PROGRESS) { $env:WHISPER_PRINT_PROGRESS } else { 'true' })"
            Write-Info ''
            
            Write-Info '> Service Endpoints:'
            Write-Info "   Whisper Server: http://localhost:$(if ($env:WHISPER_PORT) { $env:WHISPER_PORT } else { '8178' })"
            Write-Info "   Meeting App: http://localhost:5167"
            Write-Info "   Health Check: http://localhost:$(if ($env:WHISPER_PORT) { $env:WHISPER_PORT } else { '8178' })/"
            Write-Info ''
            
            Write-Info '> Runtime Configuration:'
            Write-Info "   Container mode: $($BuildType.ToUpper())"
            Write-Info "   Resource allocation: 8GB+ memory recommended"
            Write-Info "   Audio queue size: 10 (MAX_AUDIO_QUEUE_SIZE)"
            if ($BuildType -eq 'gpu' -or $BuildType -eq 'both') {
                Write-Info "   GPU passthrough: Enabled (--gpus all)"
            }
            Write-Info ''
            
            # Check if user approves to run the config or they want to run it manually
            $response = Read-Host "Do you want to start the containers with this configuration? (Y/n)"
            if ($response -match "^(n|no)$") {
                Write-Info "Container startup cancelled by user."
                Write-Info "You can start them manually later with: .\run-docker.ps1 start"
                Write-Info ''
                Write-Info 'Available commands:'
                Write-Host '  Start containers interactive : .\run-docker.ps1 start -Interactive' -ForegroundColor Blue
                Write-Info "  Start with CPU:   .\run-docker.ps1 start -Cpu"

                
                if ($BuildType -eq 'gpu' -or $BuildType -eq 'both') {
                    Write-Info "  Start with GPU:   .\run-docker.ps1 start -Gpu"
                }
                Write-Info "  View logs:        .\run-docker.ps1 logs"
                Write-Info "  Check status:     .\run-docker.ps1 status"
                return
            }
            
            Write-Info "Starting containers..."
            Write-Info "Executing: .\run-docker.ps1 $($runArgs -join ' ')"
            & $runScriptPath @runArgs
            
            if ($LASTEXITCODE -eq 0) {
                Write-Info ''
                Write-Info ' Containers started successfully!'
                Write-Info ''
                Write-Info 'Service URLs:'
                Write-Info '  Whisper Server: http://localhost:8178'
                Write-Info '  Meeting App: http://localhost:5167'
                Write-Info ''
                Write-Info 'Commands:'
                Write-Info '  View logs:     .\run-docker.ps1 logs'
                Write-Info '  Check status:  .\run-docker.ps1 status'
                Write-Info '  Stop services: .\run-docker.ps1 stop'
            } else {
                Write-Warn 'Failed to start containers automatically'
                Write-Info 'You can start them manually with: .\run-docker.ps1 start'
            }
        } else {
            Write-Warn 'run-docker.ps1 not found - cannot auto-start containers'
        }
    }
}

# Execute main function
Main


================================================
FILE: backend/build-docker.sh
================================================
#!/bin/bash

# Multi-platform Docker build script for Whisper Server and Meeting App
# Supports both CPU-only and GPU-enabled builds across multiple architectures
#
# ⚠️  AUDIO PROCESSING WARNING:
# Docker containers with insufficient resources will drop audio chunks when
# the processing queue becomes full (MAX_AUDIO_QUEUE_SIZE=10, lib.rs:54).
# Ensure containers have adequate memory (8GB+) and CPU allocation.
# Monitor logs for "Dropped old audio chunk" messages (lib.rs:330).

set -e

# Configuration
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WHISPER_PROJECT_NAME="whisper-server"
APP_PROJECT_NAME="meetily-backend"
REGISTRY=${REGISTRY:-""}
PUSH=${PUSH:-false}
# Default to current platform for local builds, multi-platform for registry pushes
DEFAULT_PLATFORMS="linux/$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')"
PLATFORMS=${PLATFORMS:-$DEFAULT_PLATFORMS}
BUILD_ARGS=${BUILD_ARGS:-""}

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Ensure required directories exist
ensure_directories() {
    # Create data directory for database if it doesn't exist
    if [ ! -d "$SCRIPT_DIR/data" ]; then
        log_info "Creating data directory for database..."
        mkdir -p "$SCRIPT_DIR/data"
        chmod 755 "$SCRIPT_DIR/data"
        log_info "✓ Data directory created"
    fi
    
    # Create models directory if it doesn't exist
    if [ ! -d "$SCRIPT_DIR/models" ]; then
        log_info "Creating models directory..."
        mkdir -p "$SCRIPT_DIR/models"
        chmod 755 "$SCRIPT_DIR/models"
        log_info "✓ Models directory created"
    fi
    
    # Create config directory if it doesn't exist
    if [ ! -d "$SCRIPT_DIR/config" ]; then
        mkdir -p "$SCRIPT_DIR/config"
        chmod 755 "$SCRIPT_DIR/config"
    fi
}

# Ensure directories exist on script start
ensure_directories

# Platform detection for macOS support
DETECTED_OS=$(uname -s)
IS_MACOS=false
if [[ "$DETECTED_OS" == "Darwin" ]]; then
    IS_MACOS=true
    log_info "macOS detected - will use macOS-optimized configurations"
fi

# Error handling
handle_error() {
    log_error "$1"
    exit 1
}

show_help() {
    cat << EOF
Multi-platform Whisper Server and Meeting App Docker Builder

Usage: $0 [OPTIONS] [BUILD_TYPE]

BUILD_TYPE:
  cpu           Build whisper server CPU-only + meeting app (default)
  gpu           Build whisper server GPU-enabled + meeting app
  macos         Build whisper server macOS-optimized + meeting app (auto-selected on macOS)
  both          Build both whisper server versions + meeting app
  
OPTIONS:
  -r, --registry REGISTRY    Docker registry (e.g., ghcr.io/user)
  -p, --push                 Push images to registry
  -t, --tag TAG              Custom tag (default: auto-generated)
  --platforms PLATFORMS      Target platforms (default: current platform)
  --build-args ARGS          Additional build arguments
  --no-cache                 Build without cache
  --dry-run                  Show commands without executing
  -h, --help                 Show this help

Examples:
  # Build whisper CPU version + meeting app for current platform
  $0 cpu
  
  # Build whisper GPU version + meeting app
  $0 gpu
  
  # Build both whisper versions + meeting app
  $0 both
  
  # Build GPU version for multiple platforms (requires --push)
  $0 gpu --platforms linux/amd64,linux/arm64 --push
  
  # Build both versions and push to registry
  $0 both --registry ghcr.io/myuser --push
  
  # Build with custom CUDA version
  $0 gpu --build-args "CUDA_VERSION=12.1.1"

Note: The meeting app is always built alongside the whisper server as they work as a package.

Environment Variables:
  REGISTRY      Docker registry prefix
  PUSH          Push to registry (true/false)
  PLATFORMS     Target platforms
  BUILD_ARGS    Additional build arguments

EOF
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    # Check Docker Buildx
    if ! docker buildx version >/dev/null 2>&1; then
        log_error "Docker Buildx is not available"
        log_error "Please install Docker Desktop or enable Buildx"
        exit 1
    fi
    
    # Check if buildx builder exists
    if ! docker buildx ls | grep -q "whisper-builder"; then
        log_info "Creating multi-platform builder..."
        docker buildx create --name whisper-builder --platform "$PLATFORMS" --use
    else
        log_info "Using existing whisper-builder"
        docker buildx use whisper-builder
    fi
    
    # Check whisper.cpp directory
    if [ ! -d "$SCRIPT_DIR/whisper.cpp" ]; then
        log_error "whisper.cpp directory not found"
        log_error "Please ensure whisper.cpp is cloned in the current directory"
        exit 1
    fi
    
    log_info "Prerequisites check passed"
}


# log_info "Updating git submodules..."
# git submodule update --init --recursive || handle_error "Failed to update git submodules"


log_info "Changing to whisper.cpp directory..."
cd whisper.cpp || handle_error "Failed to change to whisper.cpp directory"

log_info "Checking for custom server directory..."
if [ ! -d "../whisper-custom/server" ]; then
    handle_error "Directory '../whisper-custom/server' not found. Please make sure the custom server files exist"
fi

log_info "Updating git submodules..."
git submodule update --init --recursive || handle_error "Failed to update git submodules"


log_info "Copying custom server files..."
cp -r ../whisper-custom/server/* "examples/server/" || handle_error "Failed to copy custom server files"
log_info "Custom server files copied successfully"

log_info "Verifying server files..."
ls "examples/server/" || handle_error "Failed to list server files"

log_info "Returning to original directory..."
cd "$SCRIPT_DIR" || handle_error "Failed to return to original directory"

# Function to generate image tag
generate_tag() {
    local build_type="$1"
    local custom_tag="$2"
    
    if [ -n "$custom_tag" ]; then
        echo "$custom_tag"
        return
    fi
    
    local tag=""
    local timestamp=$(date +%Y%m%d)
    
    # Get git commit hash if available
    local git_hash=""
    if git rev-parse --short HEAD >/dev/null 2>&1; then
        git_hash="-$(git rev-parse --short HEAD)"
    fi
    
    case "$build_type" in
        "cpu")
            tag="cpu-${timestamp}${git_hash}"
            ;;
        "gpu")
            tag="gpu-${timestamp}${git_hash}"
            ;;
        *)
            tag="${build_type}-${timestamp}${git_hash}"
            ;;
    esac
    
    echo "$tag"
}

# Function to build Docker image
build_image() {
    local build_type="$1"
    local tag="$2"
    local dockerfile=""
    local full_tag=""
    local project_name=""
    local build_args_array=()
    
    # Determine dockerfile and project name
    case "$build_type" in
        "cpu")
            dockerfile="Dockerfile.server-cpu"
            project_name="$WHISPER_PROJECT_NAME"
            ;;
        "gpu")
            dockerfile="Dockerfile.server-gpu"
            project_name="$WHISPER_PROJECT_NAME"
            ;;
        "macos")
            dockerfile="Dockerfile.server-macos"
            project_name="$WHISPER_PROJECT_NAME"
            ;;
        "app")
            dockerfile="Dockerfile.app"
            project_name="$APP_PROJECT_NAME"
            ;;
        *)
            log_error "Unknown build type: $build_type"
            return 1
            ;;
    esac
    
    # Construct full tag
    if [ -n "$REGISTRY" ]; then
        full_tag="${REGISTRY}/${project_name}:${tag}"
    else
        full_tag="${project_name}:${tag}"
    fi
    
    # Parse build arguments
    if [ -n "$BUILD_ARGS" ]; then
        IFS=' ' read -ra ADDR <<< "$BUILD_ARGS"
        for arg in "${ADDR[@]}"; do
            build_args_array+=("--build-arg" "$arg")
        done
    fi
    
    # Build command
    local build_cmd=(
        "docker" "buildx" "build"
        "--platform" "$PLATFORMS"
        "--file" "$dockerfile"
        "--tag" "$full_tag"
        "${build_args_array[@]}"
    )
    
    # Add cache options
    if [ "$NO_CACHE" = "true" ]; then
        build_cmd+=("--no-cache")
    fi
    
    # Add push/load option - only use --load for single platform builds
    if [ "$PUSH" = "true" ]; then
        build_cmd+=("--push")
    else
        # Check if building for multiple platforms
        if [[ "$PLATFORMS" == *","* ]]; then
            log_warn "Multi-platform build detected without --push"
            log_warn "Multi-platform builds cannot be loaded locally"
            log_warn "Either use --push or specify single platform with --platforms"
            return 1
        else
            build_cmd+=("--load")
        fi
    fi
    
    # Add context
    build_cmd+=(".")
    
    log_info "Building $build_type image: $full_tag"
    log_info "Platforms: $PLATFORMS"
    log_info "Dockerfile: $dockerfile"
    
    if [ "$DRY_RUN" = "true" ]; then
        log_info "DRY RUN - Command would be:"
        echo "${build_cmd[@]}"
        return 0
    fi
    
    # Execute build
    if "${build_cmd[@]}"; then
        log_info "✓ Successfully built: $full_tag"
        
        # Also tag as latest for this build type
        local latest_tag=""
        if [ -n "$REGISTRY" ]; then
            latest_tag="${REGISTRY}/${project_name}:${build_type}"
        else
            latest_tag="${project_name}:${build_type}"
        fi
        
        if [ "$PUSH" = "true" ]; then
            log_info "Tagging as latest: $latest_tag"
            docker buildx build \
                --platform "$PLATFORMS" \
                --file "$dockerfile" \
                --tag "$latest_tag" \
                "${build_args_array[@]}" \
                --push \
                .
        else
            # For local builds, create a simple tag without timestamp
            log_info "Tagging locally: $latest_tag"
            docker tag "$full_tag" "$latest_tag"
        fi
        
        return 0
    else
        log_error "✗ Failed to build: $full_tag"
        return 1
    fi
}

# Main function
main() {
    local build_type="cpu"
    local custom_tag=""
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -r|--registry)
                REGISTRY="$2"
                shift 2
                ;;
            -p|--push)
                PUSH=true
                shift
                ;;
            -t|--tag)
                custom_tag="$2"
                shift 2
                ;;
            --platforms)
                PLATFORMS="$2"
                shift 2
                ;;
            --build-args)
                BUILD_ARGS="$2"
                shift 2
                ;;
            --no-cache)
                NO_CACHE=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            cpu|gpu|macos|both)
                build_type="$1"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # Auto-detect macOS and adjust build type if needed
    if [[ "$IS_MACOS" == "true" && "$build_type" == "cpu" ]]; then
        log_info "macOS detected - switching from CPU to macOS-optimized build"
        build_type="macos"
    elif [[ "$IS_MACOS" == "true" && "$build_type" == "gpu" ]]; then
        log_warn "GPU build requested on macOS - switching to macOS-optimized (CPU-only) build"
        build_type="macos"
    fi
    
    log_info "=== Whisper Server Docker Builder ==="
    log_info "Build type: $build_type"
    log_info "Registry: ${REGISTRY:-<none>}"
    log_info "Platforms: $PLATFORMS"
    log_info "Push: $PUSH"
    
    # Check prerequisites
    check_prerequisites
    
    # Build images - always build meeting app alongside whisper server
    case "$build_type" in
        "cpu")
            local whisper_tag=$(generate_tag "cpu" "$custom_tag")
            local app_tag=$(generate_tag "app" "$custom_tag")
            
            log_info "Building whisper server (CPU) + meeting app..."
            build_image "cpu" "$whisper_tag"
            build_image "app" "$app_tag"
            ;;
        "gpu")
            local whisper_tag=$(generate_tag "gpu" "$custom_tag")
            local app_tag=$(generate_tag "app" "$custom_tag")
            
            log_info "Building whisper server (GPU) + meeting app..."
            build_image "gpu" "$whisper_tag"
            build_image "app" "$app_tag"
            ;;
        "macos")
            local whisper_tag=$(generate_tag "macos" "$custom_tag")
            local app_tag=$(generate_tag "app" "$custom_tag")
            
            log_info "Building whisper server (macOS-optimized) + meeting app..."
            build_image "macos" "$whisper_tag"
            build_image "app" "$app_tag"
            ;;
        "both")
            local cpu_tag=$(generate_tag "cpu" "$custom_tag")
            local gpu_tag=$(generate_tag "gpu" "$custom_tag")
            local app_tag=$(generate_tag "app" "$custom_tag")
            
            log_info "Building both whisper server versions + meeting app..."
            build_image "cpu" "$cpu_tag"
            build_image "gpu" "$gpu_tag"
            build_image "app" "$app_tag"
            ;;
        *)
            log_error "Invalid build type: $build_type"
            show_help
            exit 1
            ;;
    esac
    
    log_info "=== Build Complete ==="
    
    # Show built images
    if [ "$DRY_RUN" != "true" ] && [ "$PUSH" != "true" ]; then
        log_info "Built images:"
        # Always show both whisper and app images since they're built together
        docker images "${WHISPER_PROJECT_NAME}" --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" 2>/dev/null || true
        docker images "${APP_PROJECT_NAME}" --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" 2>/dev/null || true
    fi
}

# Execute main function
main "$@"


================================================
FILE: backend/build_whisper.cmd
================================================
@echo off
setlocal enabledelayedexpansion

echo === Starting Whisper.cpp Build Process ===
echo.

echo Updating git submodules...
git submodule update --init --recursive
if %ERRORLEVEL% neq 0 (
    echo Failed to update git submodules
    goto :eof
)

echo Checking for whisper.cpp directory...
if not exist "whisper.cpp" (
    echo Directory 'whisper.cpp' not found. Please make sure you're in the correct directory and the submodule is initialized
    goto :eof
)

echo Changing to whisper.cpp directory...
cd whisper.cpp

echo Checking for whisper.cpp repository...
if not exist ".git" (
    echo Repository not found. Please make sure the whisper.cpp repository is properly cloned
    cd ..
    goto :eof
)

echo "List all files in the whisper.cpp examples directory"
dir /b examples\server

echo "Copying the all the server files from ../whisper-custom/server to examples/server"
xcopy /E /Y /I ..\whisper-custom\server examples\server

echo Checking for server directory...
if not exist "examples\server" (
    echo Server directory not found. Please make sure the whisper.cpp repository is properly cloned
    cd ..
    goto :eof
)

echo Checking for server source files...
if not exist "examples\server\server.cpp" (
    echo Server source files not found. Please make sure the whisper.cpp repository is properly cloned
    cd ..
    goto :eof
)

echo Building whisper.cpp server...
mkdir build 2>nul
cd build

echo Running CMake...
cmake .. -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=ON
if %ERRORLEVEL% neq 0 (
    echo Failed to run CMake
    cd ..\..
    goto :eof
)

echo Building with CMake...
cmake --build . --config Release
if %ERRORLEVEL% neq 0 (
    echo Failed to build with CMake
    cd ..\..
    goto :eof
)

echo Checking for server executable...
if not exist "bin\Release\whisper-server.exe" (
    if not exist "bin\whisper-server.exe" (
        echo Server executable not found. Build may have failed
        cd ..\..
        goto :eof
    )
)

echo Creating package directory...
cd ..\..

set "PACKAGE_NAME=whisper-server-package"
set "MODEL_DIR=models"

echo Checking for models directory...
if not exist "whisper.cpp\%MODEL_DIR%" (
    echo Creating models directory...
    mkdir "whisper.cpp\%MODEL_DIR%"
)

echo === Model Selection ===
echo.

set models=tiny.en tiny base.en base small.en small medium.en medium large-v1 large-v2 large-v3 large-v3-turbo tiny-q5_1 tiny.en-q5_1 tiny-q8_0 base-q5_1 base.en-q5_1 base-q8_0 small.en-tdrz small-q5_1 small.en-q5_1 small-q8_0 medium-q5_0 medium.en-q5_0 medium-q8_0 large-v2-q5_0 large-v2-q8_0 large-v3-q5_0 large-v3-turbo-q5_0 large-v3-turbo-q8_0

if "%~1"=="" (
    echo Available models:
    for %%m in (%models%) do (
        echo  %%m
    )
    echo.
    set /p MODEL_SHORT_NAME="Enter a model name (e.g. small): "
) else (
    set "MODEL_SHORT_NAME=%~1"
)

set "MODEL_VALID=0"
for %%m in (%models%) do (
    if "%%m"=="%MODEL_SHORT_NAME%" set "MODEL_VALID=1"
)

if "%MODEL_VALID%"=="0" (
    echo Invalid model: %MODEL_SHORT_NAME%
    goto :eof
)

set "MODEL_NAME=ggml-%MODEL_SHORT_NAME%.bin"
echo Selected model: %MODEL_NAME%

REM Check if the modelname exists in directory
if exist "whisper.cpp\%MODEL_DIR%\%MODEL_NAME%" (
    echo Model file exists: whisper.cpp\%MODEL_DIR%\%MODEL_NAME%
) else (
    echo Model file does not exist: whisper.cpp\%MODEL_DIR%\%MODEL_NAME%
    echo Trying to download model...
    
    REM Run the download script
    call download-ggml-model.cmd %MODEL_SHORT_NAME%
    if %ERRORLEVEL% neq 0 (
        echo Failed to download model
        goto :eof
    )
)

echo Creating run script...
if not exist "%PACKAGE_NAME%" (
    mkdir "%PACKAGE_NAME%"
    if %ERRORLEVEL% neq 0 (
        echo Failed to create package directory
        goto :eof
    )
)

if not exist "%PACKAGE_NAME%\models" (
    mkdir "%PACKAGE_NAME%\models"
)

(
    echo @echo off
    echo REM Default configuration
    echo set "HOST=127.0.0.1"
    echo set "PORT=8178"
    echo set "MODEL=models\%MODEL_NAME%"
    echo.
    echo REM Parse command line arguments
    echo :parse_args
    echo if "%%~1"=="" goto run
    echo if "%%~1"=="--host" (
    echo     set "HOST=%%~2"
    echo     shift /2
    echo     goto parse_args
    echo )
    echo if "%%~1"=="--port" (
    echo     set "PORT=%%~2"
    echo     shift /2
    echo     goto parse_args
    echo )
    echo if "%%~1"=="--model" (
    echo     set "MODEL=%%~2"
    echo     shift /2
    echo     goto parse_args
    echo )
    echo if "%%~1"=="--language" (
    echo     set "LANGUAGE=%%~2"
    echo     shift /2
    echo     goto parse_args
    echo )
    echo echo Unknown option: %%~1
    echo exit /b 1
    echo.
    echo :run
    echo REM Run the server
    echo whisper-server.exe ^
    echo     --model "%%MODEL%%" ^
    echo     --host "%%HOST%%" ^
    echo     --port "%%PORT%%" ^
    echo     --diarize ^
    echo     --language "%%LANGUAGE%%" ^
    echo     --print-progress
) > "%PACKAGE_NAME%\run-server.cmd"

echo Run script created successfully

REM Copy files to package directory
echo Copying files to package directory...

echo Waiting for 5 seconds...
timeout /t 5 /nobreak >nul

if not exist "%PACKAGE_NAME%" (
    mkdir "%PACKAGE_NAME%"
)

echo Waiting for 5 seconds...
timeout /t 2 /nobreak >nul

if not exist "%PACKAGE_NAME%\models" (
    mkdir "%PACKAGE_NAME%\models"
)

echo Waiting for 5 seconds...
timeout /t 5 /nobreak >nul

if exist "whisper.cpp\build\bin\Release\whisper-server.exe" (
    copy "whisper.cpp\build\bin\Release\whisper-server.exe" "%PACKAGE_NAME%\"
) else if exist "whisper.cpp\build\bin\whisper-server.exe" (
    copy "whisper.cpp\build\bin\whisper-server.exe" "%PACKAGE_NAME%\"
)

echo Waiting for 5 seconds...
timeout /t 5 /nobreak >nul

if %ERRORLEVEL% neq 0 (
    echo Failed to copy whisper-server.exe
    goto :eof
)

echo Waiting for 5 seconds...
timeout /t 5 /nobreak >nul

copy "whisper.cpp\%MODEL_DIR%\%MODEL_NAME%" "%PACKAGE_NAME%\models\"
if %ERRORLEVEL% neq 0 (
    echo Failed to copy model
    goto :eof
)

echo Waiting for 5 seconds...
timeout /t 5 /nobreak >nul

if exist "whisper.cpp\examples\server\public" (
    xcopy /E /Y /I "whisper.cpp\examples\server\public" "%PACKAGE_NAME%\public\"
)

echo Waiting for 5 seconds...
timeout /t 5 /nobreak >nul

echo === Environment Setup ===
echo.

echo Setting up environment variables...
if exist "temp.env" (
    if not exist ".env" (
        copy temp.env .env
        echo Environment variables copied
    else (
        echo .env already exists. Skipping copy...
    )
)

echo If you want to use Models hosted on Anthropic, OpenAi or GROQ, add the API keys to the .env file.

echo === Installing Python Dependencies ===
echo.

echo Waiting for 5 seconds...
timeout /t 5 /nobreak >nul

REM Create virtual environment only if it doesn't exist
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
    if %ERRORLEVEL% neq 0 (
        echo Failed to create virtual environment
        goto :eof
    )
    
    call venv\Scripts\activate.bat
    if %ERRORLEVEL% neq 0 (
        echo Failed to activate virtual environment
        goto :eof
    )
    
    pip install -r requirements.txt
    if %ERRORLEVEL% neq 0 (
        echo Failed to install dependencies
        goto :eof
    )
) else (
    echo Virtual environment already exists
    call venv\Scripts\activate.bat
    if %ERRORLEVEL% neq 0 (
        echo Failed to activate virtual environment
        goto :eof
    )
    
    pip install -r requirements.txt
    if %ERRORLEVEL% neq 0 (
        echo Failed to install dependencies
        goto :eof
    )
)

echo Dependencies installed successfully

echo === Build Process Complete ===
echo You can now proceed with running the server by running 'start_with_output.ps1'

goto :eof



================================================
FILE: backend/build_whisper.sh
================================================
#!/bin/bash

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Helper functions for logging
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    return 1
}

log_section() {
    echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

# Error handling
handle_error() {
    log_error "$1"
    exit 1
}

# Main script
log_section "Starting Whisper.cpp Build Process"

log_info "Updating git submodules..."
git submodule update --init --recursive || handle_error "Failed to update git submodules"

log_info "Checking for whisper.cpp directory..."
if [ ! -d "whisper.cpp" ]; then
    handle_error "Directory 'whisper.cpp' not found. Please make sure you're in the correct directory and the submodule is initialized"
fi

log_info "Changing to whisper.cpp directory..."
cd whisper.cpp || handle_error "Failed to change to whisper.cpp directory"

log_info "Checking for custom server directory..."
if [ ! -d "../whisper-custom/server" ]; then
    handle_error "Directory '../whisper-custom/server' not found. Please make sure the custom server files exist"
fi

log_info "Copying custom server files..."
cp -r ../whisper-custom/server/* "examples/server/" || handle_error "Failed to copy custom server files"
log_success "Custom server files copied successfully"

log_info "Verifying server files..."
ls "examples/server/" || handle_error "Failed to list server files"

log_section "Building Whisper Server"
log_info "Installing required dependencies..."
brew install libomp llvm cmake || handle_error "Failed to install dependencies"

log_info "Building whisper.cpp..."
rm -rf build
mkdir build && cd build || handle_error "Failed to create build directory"

# Configure CMake with simple warning suppression
log_info "Configuring CMake..."
cmake -DCMAKE_C_FLAGS="-w" -DCMAKE_CXX_FLAGS="-w" .. || handle_error "CMake configuration failed"

make -j4 || handle_error "Make failed"
cd ..
log_success "Build completed successfully"

# Configuration
PACKAGE_NAME="whisper-server-package"
MODEL_NAME="ggml-small.bin"
MODEL_DIR="$PACKAGE_NAME/models"

log_section "Package Configuration"
log_info "Package name: $PACKAGE_NAME"
log_info "Model name: $MODEL_NAME"
log_info "Model directory: $MODEL_DIR"

# Create necessary directories
log_info "Creating package directories..."
mkdir -p "$PACKAGE_NAME" || handle_error "Failed to create package directory"
mkdir -p "$MODEL_DIR" || handle_error "Failed to create models directory"
log_success "Package directories created successfully"

# Copy server binary
log_info "Copying server binary..."
cp build/bin/whisper-server "$PACKAGE_NAME/" || handle_error "Failed to copy server binary"
log_success "Server binary copied successfully"

# Copy model file

# Check for existing models
log_section "Model Management"
log_info "Checking for existing Whisper models..."

EXISTING_MODELS=$(find "$MODEL_DIR" -name "ggml-*.bin" -type f)

if [ -n "$EXISTING_MODELS" ]; then
    log_info "Found existing models:"
    echo -e "${BLUE}$EXISTING_MODELS${NC}"
else
    log_warning "No existing models found"
fi

# Whisper models
models="tiny
tiny.en
tiny-q5_1
tiny.en-q5_1
tiny-q8_0
base
base.en
base-q5_1
base.en-q5_1
base-q8_0
small
small.en
small.en-tdrz
small-q5_1
small.en-q5_1
small-q8_0
medium
medium.en
medium-q5_0
medium.en-q5_0
medium-q8_0
large-v1
large-v2
large-v2-q5_0
large-v2-q8_0
large-v3
large-v3-q5_0
large-v3-turbo
large-v3-turbo-q5_0
large-v3-turbo-q8_0"

# Ask user which model to use if the argument is not provided
if [ -z "$1" ]; then
    # Let user interactively select a model name
    log_info "Available models: $models"
    read -p "Enter a model name (e.g. small): " MODEL_SHORT_NAME
else
    MODEL_SHORT_NAME=$1
fi

# Check if the model is valid
if ! echo "$models" | grep -qw "$MODEL_SHORT_NAME"; then
    handle_error "Invalid model: $MODEL_SHORT_NAME"
fi

MODEL_NAME="ggml-$MODEL_SHORT_NAME.bin"

# Check if the modelname exists in directory
if [ -f "$MODEL_DIR/$MODEL_NAME" ]; then
    log_info "Model file exists: $MODEL_DIR/$MODEL_NAME"
else
    log_warning "Model file does not exist: $MODEL_DIR/$MODEL_NAME"
    log_info "Trying to download model..."
    ./models/download-ggml-model.sh $MODEL_SHORT_NAME || handle_error "Failed to download model"
    # Move model to models directory
    mv "./models/$MODEL_NAME" "$MODEL_DIR/" || handle_error "Failed to move model to models directory"
fi

# Create run script
log_info "Creating run script..."
cat > "$PACKAGE_NAME/run-server.sh" << 'EOL'
#!/bin/bash

# Default configuration
HOST="127.0.0.1"
PORT="8178"
MODEL="models/ggml-large-v3.bin"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --host)
            HOST="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --model)
            MODEL="$2"
            shift 2
            ;;
        --language)
            LANGUAGE="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Run the server
./whisper-server \
    --model "$MODEL" \
    --host "$HOST" \
    --port "$PORT" \
    --diarize \
    --language "$LANGUAGE"\
    --print-progress

EOL
log_success "Run script created successfully"

log_info "Making script executable: $PACKAGE_NAME/run-server.sh"
# Make run script executable
chmod +x "$PACKAGE_NAME/run-server.sh" || handle_error "Failed to make script executable"

log_info "Listing files..."
ls || handle_error "Failed to list files"

# Check if package directory already exists
if [ -d "../$PACKAGE_NAME" ]; then
    log_info "Listing parent directory..."
    log_warning "Package directory already exists: ../$PACKAGE_NAME"
    log_info "Listing package directory..."
else
    log_info "Creating package directory: ../$PACKAGE_NAME"
    mkdir "../$PACKAGE_NAME" || handle_error "Failed to create package directory"
    log_success "Package directory created successfully"
fi

# Move whisper-server package out of whisper.cpp to ../PACKAGE_NAME

# If package directory already exists outside whisper.cpp, copy just whisper-server and model to it. Replace
# the contents of the directory with the new files
if [ -d "../$PACKAGE_NAME" ]; then
    log_info "Copying package contents to existing directory..."
    cp -r "$PACKAGE_NAME/"* "../$PACKAGE_NAME" || handle_error "Failed to copy package contents"
    
else
   
   log_info "Copying whisper-server and model to ../$PACKAGE_NAME"
    cp "$MODEL_DIR/$MODEL_NAME" "../$PACKAGE_NAME/models/" || handle_error "Failed to copy model"
    cp "$PACKAGE_NAME/run-server.sh" "../$PACKAGE_NAME" || handle_error "Failed to copy run script"
    cp -r "$PACKAGE_NAME/public" "../$PACKAGE_NAME" || handle_error "Failed to copy public directory"
    cp "$PACKAGE_NAME/whisper-server" "../$PACKAGE_NAME" || handle_error "Failed to copy whisper-server"
    # rm -r "$PACKAGE_NAME"
fi

log_section "Environment Setup"
log_info "Setting up environment variables..."
cd ../.. && cp backend/temp.env backend/.env || handle_error "Failed to copy environment variables"

log_info "If you want to use Models hosted on Anthropic, OpenAi or GROQ, add the API keys to the .env file."

log_section "Build Process Complete"
log_success "Whisper.cpp server build and setup completed successfully!"

log_section "Script Permissions"
log_info "Making script executable: clean_start_backend.sh"
chmod +x backend/clean_start_backend.sh || handle_error "Failed to make script executable"

log_success "Permission set successfully!"

log_success "Whisper.cpp server build and setup completed successfully!"

log_section "Installing python dependencies"

# Tell user to create a virtual environment in the backend directory and activate it, install dependencies and check if FastAPI is installed

log_info "Installing python dependencies..."
cd backend || handle_error "Failed to change to backend directory"
# Create virtual environment only if it doesn't exist
if [ ! -d "venv" ]; then
    log_info "Creating virtual environment..."
    python3 -m venv venv || handle_error "Failed to create virtual environment"
    source venv/bin/activate || handle_error "Failed to activate virtual environment"
    pip install -r requirements.txt || handle_error "Failed to install dependencies"
else
    log_info "Virtual environment already exists"
    source venv/bin/activate || handle_error "Failed to activate virtual environment"
    pip install -r requirements.txt || handle_error "Failed to install dependencies"
fi

log_success "Dependencies installed successfully"

echo -e "${GREEN}You can now proceed with running the server by running './clean_start_backend.sh'${NC} "



================================================
FILE: backend/clean_start_backend.cmd
================================================
@echo off
setlocal enabledelayedexpansion

REM Configuration
set "PACKAGE_NAME=whisper-server-package"
set "MODEL_DIR=%PACKAGE_NAME%\models"
set "PORT=5167"

echo === Environment Check ===
echo.

if not exist "%PACKAGE_NAME%" (
    echo Whisper server directory not found. Please run build_whisper.cmd first
    goto :eof
)

if not exist "app" (
    echo Python backend directory not found. Please check your installation
    goto :eof
)

if not exist "app\main.py" (
    echo Python backend main.py not found. Please check your installation
    goto :eof
)

if not exist "venv" (
    echo Virtual environment not found. Please run build_whisper.cmd first
    goto :eof
)

echo === Initial Cleanup ===
echo.

echo Checking for existing whisper servers...
taskkill /F /FI "IMAGENAME eq whisper-server.exe" 2>nul
if %ERRORLEVEL% equ 0 (
    echo Existing whisper servers terminated
) else (
    echo No existing whisper servers found
)
timeout /t 1 >nul

echo === Backend App Check ===
echo.

echo Checking for processes on port 5167...
set "PORT_IN_USE="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5167.*LISTENING"') do (
    set "PORT_IN_USE=%%a"
)

if defined PORT_IN_USE (
    echo Backend app is running on port %PORT%
    set /p REPLY="Kill it? (y/N) "
    if /i not "!REPLY!"=="y" (
        echo User chose not to terminate existing backend app
        goto :eof
    )
    
    echo Terminating backend app...
    taskkill /F /PID !PORT_IN_USE! 2>nul
    if !ERRORLEVEL! equ 0 (
        echo Backend app terminated
    ) else (
        echo Failed to terminate backend app
        goto :eof
    )
    timeout /t 1 >nul
)

echo === Model Check ===
echo.

if not exist "%MODEL_DIR%" (
    echo Models directory not found. Please run build_whisper.cmd first
    goto :eof
)

echo Checking for Whisper models...
set "EXISTING_MODELS="
for /f "delims=" %%a in ('dir /b /s "%MODEL_DIR%\ggml-*.bin" 2^>nul') do (
    set "EXISTING_MODELS=!EXISTING_MODELS!%%a
"
)

if defined EXISTING_MODELS (
    echo Found existing models:
    echo %EXISTING_MODELS%
) else (
    echo No existing models found
)

REM Whisper models
set "models=tiny.en tiny base.en base small.en small medium.en medium large-v1 large-v2 large-v3 large-v3-turbo tiny-q5_1 tiny.en-q5_1 tiny-q8_0 base-q5_1 base.en-q5_1 base-q8_0 small.en-tdrz small-q5_1 small.en-q5_1 small-q8_0 medium-q5_0 medium.en-q5_0 medium-q8_0 large-v2-q5_0 large-v2-q8_0 large-v3-q5_0 large-v3-turbo-q5_0 large-v3-turbo-q8_0"

REM Ask user which model to use if the argument is not provided
set "MODEL_SHORT_NAME="
if "%~1"=="" (
    echo === Model Selection ===
    echo.
    echo Available models:
    for %%m in (%models%) do (
        echo %%m
    )
    echo.
    set /p MODEL_SHORT_NAME="Enter a model name (e.g. small): "
) else (
    set "MODEL_SHORT_NAME=%~1"
)

REM Check if the model is valid
set "MODEL_VALID=0"
for %%m in (%models%) do (
    if "%%m"=="%MODEL_SHORT_NAME%" set "MODEL_VALID=1"
)

if "%MODEL_VALID%"=="0" (
    echo Invalid model: %MODEL_SHORT_NAME%
    goto :eof
)

set "MODEL_NAME=ggml-%MODEL_SHORT_NAME%.bin"
echo Selected model: %MODEL_NAME%

REM Check if the modelname exists in directory
if exist "%MODEL_DIR%\%MODEL_NAME%" (
    echo Model file exists: %MODEL_DIR%\%MODEL_NAME%
) else (
    echo Model file does not exist: %MODEL_DIR%\%MODEL_NAME%
    echo Downloading model...
    
    call download-ggml-model.cmd %MODEL_SHORT_NAME%
    if %ERRORLEVEL% neq 0 (
        echo Failed to download model
        goto :eof
    )
    
    REM Move model to models directory
    move "whisper.cpp\models\%MODEL_NAME%" "%MODEL_DIR%\"
    if %ERRORLEVEL% neq 0 (
        echo Failed to move model to models directory
        goto :eof
    )
)

echo === Starting Services ===
echo.

REM Start the whisper server in background
echo Starting Whisper server...
cd "%PACKAGE_NAME%" || (
    echo Failed to change to whisper-server directory
    goto :eof
)

REM Start the server and capture its PID
echo Running whisper-server.exe with model %MODEL_NAME%...

REM Start the server without redirecting output
start "Whisper Server" cmd /k "whisper-server.exe --model models\%MODEL_NAME% --host 127.0.0.1 --port 8178 --diarize --print-progress"

REM Give the server a moment to start
echo Waiting for server to start...
timeout /t 5 >nul

REM Check if the process is running
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq whisper-server.exe" /fo list ^| findstr "PID:"') do (
    set "WHISPER_PID=%%a"
)

if not defined WHISPER_PID (
    echo Whisper server failed to start. Check whisper-server.log for details.
    cd ..
    goto :eof
)

echo Whisper server started with PID: %WHISPER_PID%

REM Check if the server is listening on port 8178
netstat -ano | findstr ":8178.*LISTENING" >nul
if %ERRORLEVEL% neq 0 (
    echo Whisper server is not listening on port 8178. Waiting a bit longer...
    timeout /t 10 >nul
    
    netstat -ano | findstr ":8178.*LISTENING" >nul
    if %ERRORLEVEL% neq 0 (
        echo Whisper server still not listening. Check whisper-server.log for details.
        taskkill /F /PID %WHISPER_PID% 2>nul
        cd ..
        goto :eof
    )
)

echo Whisper server is running and listening on port 8178.
cd ..

REM Start the Python backend in background
echo Starting Python backend...

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat
if %ERRORLEVEL% neq 0 (
    echo Failed to activate virtual environment
    goto :eof
)

REM Check if required Python packages are installed
pip show fastapi >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo FastAPI not found. Please run build_whisper.cmd to install dependencies
    goto :eof
)

REM Start the Python backend and capture its PID
echo Running Python backend on port %PORT%...

REM Start the Python backend without redirecting output
start "Python Backend" cmd /k "call venv\Scripts\activate.bat && python app\main.py"

REM Give the backend a moment to start
echo Waiting for Python backend to start...
timeout /t 5 >nul

REM Get the Python PID
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq python.exe" /fo list ^| findstr "PID:"') do (
    set "PYTHON_PID=%%a"
)

if not defined PYTHON_PID (
    echo Python backend failed to start. Check python-backend.log for details.
    goto :eof
)

echo Python backend started with PID: %PYTHON_PID%

REM Wait for backend to start and check if it's listening
echo Waiting for Python backend to be ready...
timeout /t 5 >nul

REM Check if the port is actually listening
netstat -ano | findstr ":%PORT%.*LISTENING" >nul
if %ERRORLEVEL% neq 0 (
    echo Python backend is not listening on port %PORT%. Waiting a bit longer...
    timeout /t 10 >nul
    
    netstat -ano | findstr ":%PORT%.*LISTENING" >nul
    if %ERRORLEVEL% neq 0 (
        echo Python backend still not listening on port %PORT%. Check python-backend.log for details.
        taskkill /F /PID %PYTHON_PID% 2>nul
        goto :eof
    )
)

echo Python backend is running and listening on port %PORT%.

echo ===================================
echo All services started successfully!
echo ===================================
echo Whisper Server (PID: %WHISPER_PID%) - Port: 8178
echo Python Backend (PID: %PYTHON_PID%) - Port: %PORT%
echo.
echo Press Ctrl+C to stop all services

REM Keep the script running
echo.
echo Servers are running. Press Ctrl+C to stop...
pause >nul

REM Cleanup on exit
echo === Cleanup ===
echo.

if defined WHISPER_PID (
    echo Stopping Whisper server...
    taskkill /F /PID !WHISPER_PID! 2>nul
    if !ERRORLEVEL! equ 0 (
        echo Whisper server stopped
    ) else (
        echo Failed to kill Whisper server process
    )
    
    taskkill /F /FI "IMAGENAME eq whisper-server.exe" 2>nul
    if !ERRORLEVEL! equ 0 (
        echo All whisper-server processes stopped
    )
)

if defined PYTHON_PID (
    echo Stopping Python backend...
    taskkill /F /PID !PYTHON_PID! 2>nul
    if !ERRORLEVEL! equ 0 (
        echo Python backend stopped
    ) else (
        echo Failed to kill Python backend process
    )
)

goto :eof



================================================
FILE: backend/clean_start_backend.sh
================================================
#!/bin/bash

# Exit on error
set -e

# Color codes and emojis
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
PACKAGE_NAME="whisper-server-package"
MODEL_DIR="$PACKAGE_NAME/models"

# Helper functions for logging
log_info() {
    echo -e "${BLUE}ℹ️  [INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}✅ [SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠️  [WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}❌ [ERROR]${NC} $1"
    return 1
}

log_section() {
    echo -e "\n${PURPLE}🔄 === $1 ===${NC}\n"
}

# Error handling function
handle_error() {
    local error_msg="$1"
    log_error "$error_msg"
    cleanup
    exit 1
}

# Cleanup function
cleanup() {
    log_section "Cleanup"
    if [ -n "$WHISPER_PID" ]; then
        log_info "Stopping Whisper server..."
        if kill -0 $WHISPER_PID 2>/dev/null; then
            kill -9 $WHISPER_PID 2>/dev/null || log_warning "Failed to kill Whisper server process"
            pkill -9 -f "whisper-server" 2>/dev/null || log_warning "Failed to kill remaining whisper-server processes"
        fi
        log_success "Whisper server stopped"
    fi
    if [ -n "$PYTHON_PID" ]; then
        log_info "Stopping Python backend..."
        if kill -0 $PYTHON_PID 2>/dev/null; then
            kill -9 $PYTHON_PID 2>/dev/null || log_warning "Failed to kill Python backend process"
        fi
        log_success "Python backend stopped"
    fi
}

# Set up trap for cleanup on script exit, interrupt, or termination
trap cleanup EXIT INT TERM

# Check if required directories and files exist
log_section "Environment Check"

if [ ! -d "$PACKAGE_NAME" ]; then
    handle_error "Whisper server directory not found. Please run build_whisper.sh first"
fi

if [ ! -d "app" ]; then
    handle_error "Python backend directory not found. Please check your installation"
fi

if [ ! -f "app/main.py" ]; then
    handle_error "Python backend main.py not found. Please check your installation"
fi

if [ ! -d "venv" ]; then
    handle_error "Virtual environment not found. Please run build_whisper.sh first"
fi

# Kill any existing whisper-server processes
log_section "Initial Cleanup"

log_info "Checking for existing whisper servers..."
if pkill -f "whisper-server" 2>/dev/null; then
    log_success "Existing whisper servers terminated"
else
    log_warning "No existing whisper servers found"
fi
sleep 1  # Give processes time to terminate

# Check and kill if backend app in port 5167 is running
log_section "Backend App Check"

log_info "Checking for processes on port 5167..."
PORT=5167
if lsof -i :$PORT | grep -q LISTEN; then
    log_warning "Backend app is running on port $PORT"
    read -p "$(echo -e "${YELLOW}🤔 Kill it? (y/N)${NC} ")" -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        handle_error "User chose not to terminate existing backend app"
    fi

    log_info "Terminating backend app..."
    if ! kill -9 $(lsof -t -i :$PORT) 2>/dev/null; then
        handle_error "Failed to terminate backend app"
    fi
    log_success "Backend app terminated"
    sleep 1  # Give processes time to terminate
fi



# Check for existing model
log_section "Model Check"

if [ ! -d "$MODEL_DIR" ]; then
    handle_error "Models directory not found. Please run build_whisper.sh first"
fi

log_info "Checking for Whisper models..."
EXISTING_MODELS=$(find "$MODEL_DIR" -name "ggml-*.bin" -type f)

if [ -n "$EXISTING_MODELS" ]; then
    log_success "Found existing models:"
    echo -e "${BLUE}$EXISTING_MODELS${NC}"
else
    log_warning "No existing models found"
fi

# Whisper models
models="tiny
tiny.en
tiny-q5_1
base
base.en
base-q5_1
small
small.en
small-q5_1
medium
medium.en
medium-q5_1
large-v1
large-v2
large-v3
large-v1-q5_1
large-v2-q5_1
large-v3-q5_1
large-v1-turbo
large-v2-turbo
large-v3-turbo
large-v1-turbo-q5_0
large-v2-turbo-q5_0
large-v3-turbo-q5_0
large-v1-turbo-q8_0
large-v2-turbo-q8_0
large-v3-turbo-q8_0"

# Ask user which model to use if the argument is not provided
if [ -z "$1" ]; then
    log_section "Model Selection"
    log_info "Available models:"
    echo -e "${BLUE}$models${NC}"
    read -p "$(echo -e "${YELLOW}🎯 Enter a model name (e.g. small):${NC} ")" MODEL_SHORT_NAME
else
    MODEL_SHORT_NAME=$1
fi

# Check if the model is valid
if ! echo "$models" | grep -qw "$MODEL_SHORT_NAME"; then
    handle_error "Invalid model: $MODEL_SHORT_NAME"
fi

MODEL_NAME="ggml-$MODEL_SHORT_NAME.bin"
log_success "Selected model: $MODEL_NAME"

# Check if the modelname exists in directory
if [ -f "$MODEL_DIR/$MODEL_NAME" ]; then
    log_success "Model file exists: $MODEL_DIR/$MODEL_NAME"
else
    log_warning "Model file does not exist: $MODEL_DIR/$MODEL_NAME"
    log_info "Downloading model... 📥"
    if ! ./download-ggml-model.sh $MODEL_SHORT_NAME; then
        handle_error "Failed to download model"
    fi

    # Move model to models directory
    mv "$MODEL_NAME" "$MODEL_DIR/" || handle_error "Failed to move model to models directory"
fi

log_section "Starting Services"

# Start the whisper server in background
log_info "Starting Whisper server... 🎙️"

# Start whisper server in background
WHISPER_PORT=8178

# Ask user to change the whisper server port if needed
read -p "$(echo -e "${YELLOW}🎯 Enter the Whisper server port (default: 8178):${NC} ")" -n 1 -r
if [[ ! $REPLY =~ ^[0-9]+$ ]]; then
    WHISPER_PORT=8178
else
    # Check if port is valid 4 numbers that is already not in use and is not part of standard ports
    if [[ $REPLY =~ ^[0-9]{4}$ ]]; then
        if lsof -i :$REPLY | grep -q LISTEN; then
            log_warning "Port $REPLY is already in use"
            read -p "$(echo -e "${YELLOW}🤔 Kill it? (y/N)${NC} ")" -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                handle_error "User chose not to terminate existing backend app"
            fi

            log_info "Terminating backend app..."
            if ! kill -9 $(lsof -t -i :$    REPLY) 2>/dev/null; then
                handle_error "Failed to terminate backend app"
            fi
            log_success "Backend app terminated"
            sleep 1  # Give processes time to terminate
        fi
        WHISPER_PORT=$REPLY
    else
        log_warning "Invalid port number. Using default port 8178"
        WHISPER_PORT=8178
    fi
fi

# Enter language
read -p "$(echo -e "${YELLOW}🎯 Enter the language (default: en):${NC} ")" -n 2 -r
if [[ ! $REPLY =~ ^[a-zA-Z]+$ ]]; then
    LANGUAGE="en"
else
    LANGUAGE=$REPLY
fi

cd "$PACKAGE_NAME" || handle_error "Failed to change to whisper-server directory"
./run-server.sh --model "models/$MODEL_NAME" --host "0.0.0.0" --port $WHISPER_PORT --language $LANGUAGE &
WHISPER_PID=$!
cd .. || handle_error "Failed to return to root directory"

# Wait for server to start and check if it's running
sleep 2
if ! kill -0 $WHISPER_PID 2>/dev/null; then
    handle_error "Whisper server failed to start"
fi

# Start the Python backend in background
log_info "Starting Python backend... 🚀"
# Start venv if not active
if [ -z "$VIRTUAL_ENV" ]; then
    log_info "Activating virtual environment..."
    if ! source venv/bin/activate; then
        handle_error "Failed to activate virtual environment"
    fi
fi

# Check if required Python packages are installed
if ! pip show fastapi >/dev/null 2>&1; then
    handle_error "FastAPI not found. Please run build_whisper.sh to install dependencies"
fi

source venv/bin/activate && python app/main.py &
PYTHON_PID=$!

# Wait for backend to start and check if it's running
sleep 10
if ! kill -0 $PYTHON_PID 2>/dev/null; then
    handle_error "Python backend failed to start"
fi

# Check if the port is actually listening
if ! lsof -i :$WHISPER_PORT | grep -q LISTEN; then
    handle_error "Python backend is not listening on port $WHISPER_PORT"
fi

log_success "🎉 All services started successfully!"
echo -e "${GREEN}🔍 Whisper Server (PID: $WHISPER_PID)${NC}"
echo -e "${GREEN}🐍 Python Backend (PID: $PYTHON_PID)${NC}"
echo -e "${BLUE}Press Ctrl+C to stop all services${NC}"

# Show whisper server port and python backend port
echo -e "${BLUE}Whisper Server Port: $WHISPER_PORT${NC}"
echo -e "${BLUE}Python Backend Port: $PORT${NC}"

# Keep the script running and wait for both processes
wait $WHISPER_PID $PYTHON_PID || handle_error "One of the services crashed"


================================================
FILE: backend/debug_cors.py
================================================
"""
Debug script to test the /process-transcript endpoint
"""
import requests
import json
import sys

def test_process_transcript(text="This is a test transcript"):
    """Test the process-transcript endpoint"""
    url = "http://localhost:5167/process-transcript"
    
    payload = {
        "text": text,
        "model": "claude",
        "model_name": "claude-3-5-sonnet-latest",
        "chunk_size": 5000,
        "overlap": 1000
    }
    
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    
    print(f"Sending request to {url}")
    print(f"Headers: {json.dumps(headers, indent=2)}")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        print(f"Status Code: {response.status_code}")
        print(f"Response Headers: {json.dumps(dict(response.headers), indent=2)}")
        
        if response.status_code == 200:
            print(f"Response: {json.dumps(response.json(), indent=2)}")
        else:
            print(f"Error Response: {response.text}")
            
    except Exception as e:
        print(f"Error: {str(e)}")

if __name__ == "__main__":
    text = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "This is a test transcript"
    test_process_transcript(text)



================================================
FILE: backend/docker-compose.yml
================================================
version: '3.8'

# ⚠️  AUDIO PROCESSING WARNING:
# Docker containers with insufficient resources will drop audio chunks when
# the processing queue becomes full (MAX_AUDIO_QUEUE_SIZE=10, lib.rs:54).
# Symptoms: "Dropped old audio chunk" in logs (lib.rs:330-333).
# 
# RECOMMENDED RESOURCE ALLOCATION:
# - Memory: 8GB minimum per service (16GB total recommended)
# - CPU: 2+ cores per service
# - Monitor logs for audio drop warnings during operation

services:
  # Original whisper-server service (Windows/Linux compatibility)
  whisper-server:
    build:
      context: .
      dockerfile: ${DOCKERFILE:-Dockerfile.server-cpu}
      args:
        CUDA_VERSION: ${CUDA_VERSION:-12.3.1}
        UBUNTU_VERSION: ${UBUNTU_VERSION:-22.04}
    image: whisper-server:${TAG:-cpu}
    container_name: whisper-server
    restart: unless-stopped
    
    # Port mapping
    ports:
      - "${WHISPER_PORT:-8178}:8178"
    
    # Environment variables
    environment:
      - WHISPER_HOST=0.0.0.0
      - WHISPER_PORT=8178
      - WHISPER_MODEL=${WHISPER_MODEL:-models/ggml-base.en.bin}
      - WHISPER_THREADS=${WHISPER_THREADS:-0}
      - WHISPER_USE_GPU=${WHISPER_USE_GPU:-true}
      - WHISPER_LANGUAGE=${WHISPER_LANGUAGE:-en}
      - WHISPER_TRANSLATE=${WHISPER_TRANSLATE:-false}
      - WHISPER_DIARIZE=${WHISPER_DIARIZE:-false}
      - WHISPER_PRINT_PROGRESS=${WHISPER_PRINT_PROGRESS:-true}
    
    # Volume mounts
    volumes:
      # Model storage - persistent across container restarts
      - whisper_models:/app/models
      # Upload directory for temporary files
      - whisper_uploads:/app/uploads
      # Optional: mount local models directory
      - ${LOCAL_MODELS_DIR:-./models}:/app/local_models:ro
      # Optional: mount custom configuration
      - ${CONFIG_DIR:-./config}:/app/config:ro
    
    # Exclude from macOS profile
    profiles:
      - default

  # macOS-optimized whisper-server service
  whisper-server-macos:
    build:
      context: .
      dockerfile: Dockerfile.server-macos
    image: whisper-server:macos
    container_name: whisper-server
    restart: unless-stopped
    
    # Port mapping
    ports:
      - "${WHISPER_PORT:-8178}:8178"
    
    # Environment variables (GPU disabled for macOS)
    environment:
      - WHISPER_HOST=0.0.0.0
      - WHISPER_PORT=8178
      - WHISPER_MODEL=${WHISPER_MODEL:-models/ggml-large-v3.bin}
      - WHISPER_THREADS=${WHISPER_THREADS:-0}
      - WHISPER_USE_GPU=false
      - WHISPER_LANGUAGE=${WHISPER_LANGUAGE:-en}
      - WHISPER_TRANSLATE=${WHISPER_TRANSLATE:-false}
      - WHISPER_DIARIZE=${WHISPER_DIARIZE:-false}
      - WHISPER_PRINT_PROGRESS=${WHISPER_PRINT_PROGRESS:-true}
      - WHISPER_PLATFORM=macos
    
    # Volume mounts for macOS (using actual models directory)
    volumes:
      # Map to actual model location on macOS
      - ./models:/app/models
      # Upload directory for temporary files
      - whisper_uploads:/app/uploads
      # Optional: mount custom configuration
      - ${CONFIG_DIR:-./config}:/app/config:ro
    
    # macOS profile only
    profiles:
      - macos
    
    # GPU support (uncomment for GPU version)
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]
    
    # Health check
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8178/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    
    # Resource limits (optional)
    mem_limit: 4g
    mem_reservation: 1g
    
    # Logging configuration
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # Model downloader service - ensures models are downloaded before whisper server starts
  model-downloader:
    image: alpine/curl:latest
    container_name: whisper-model-downloader
    volumes:
      - whisper_models:/models
    environment:
      - MODEL_NAME=${MODEL_NAME:-base.en}
    command: |
      sh -c "
        echo '🔍 Checking for model: ggml-\${MODEL_NAME}.bin'
        if [ ! -f /models/ggml-\${MODEL_NAME}.bin ] || [ ! -s /models/ggml-\${MODEL_NAME}.bin ]; then
          echo '📦 Downloading model: \${MODEL_NAME}...'
          echo '📋 This may take a few minutes depending on model size and connection speed'
          # Create temp file to avoid partial downloads
          curl -L -f --progress-bar \
            --connect-timeout 30 \
            --max-time 3600 \
            --retry 3 \
            --retry-delay 5 \
            --retry-connrefused \
            -o /models/ggml-\${MODEL_NAME}.bin.tmp \
            https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-\${MODEL_NAME}.bin
          
          # Verify download completed successfully  
          if [ -s /models/ggml-\${MODEL_NAME}.bin.tmp ]; then
            mv /models/ggml-\${MODEL_NAME}.bin.tmp /models/ggml-\${MODEL_NAME}.bin
            echo '✅ Model downloaded successfully: \${MODEL_NAME}'
            ls -lh /models/ggml-\${MODEL_NAME}.bin
          else
            echo '❌ Download failed or file is empty'
            rm -f /models/ggml-\${MODEL_NAME}.bin.tmp
            exit 1
          fi
        else
          echo '✅ Model already exists: \${MODEL_NAME}'
          ls -lh /models/ggml-\${MODEL_NAME}.bin
        fi
        echo '🎉 Model preparation complete'
      "
    healthcheck:
      test: ["CMD", "test", "-f", "/models/ggml-${MODEL_NAME:-base.en}.bin"]
      interval: 10s
      timeout: 5s
      retries: 1
    profiles:
      - download

  # Meeting Summarizer Python App (Windows/Linux)
  meetily-backend:
    build:
      context: .
      dockerfile: Dockerfile.app
    image: meetily-backend:latest
    container_name: meetily-backend
    restart: unless-stopped
    
    # Port mapping
    ports:
      - "${APP_PORT:-5167}:5167"
    
    # Environment variables
    environment:
      - PYTHONUNBUFFERED=1
      - PYTHONPATH=/app
      - DATABASE_PATH=/app/data/meeting_minutes.db
      - OLLAMA_HOST=${OLLAMA_HOST:-http://host.docker.internal:11434}
    
    # Add extra host for Docker Desktop compatibility
    extra_hosts:
      - "host.docker.internal:host-gateway"
    
    # Volume mounts
    volumes:
      # Local database directory (created by setup-db.sh)
      - ./data:/app/data
      # Logs directory
      - meeting_app_logs:/app/logs
      # Optional: mount local .env file
      - ${LOCAL_ENV_FILE:-./app/.env}:/app/.env:ro
    
    # Health check
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5167/get-meetings"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    
    # Resource limits (optional)
    mem_limit: 2g
    mem_reservation: 512m
    
    # Logging configuration
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    
    # Depends on whisper server for transcription
    depends_on:
      whisper-server:
        condition: service_healthy
    
    # Exclude from macOS profile
    profiles:
      - default

  # Meeting Summarizer Python App (macOS)
  meetily-backend-macos:
    build:
      context: .
      dockerfile: Dockerfile.app
    image: meetily-backend:latest
    container_name: meetily-backend
    restart: unless-stopped
    
    # Port mapping
    ports:
      - "${APP_PORT:-5167}:5167"
    
    # Environment variables
    environment:
      - PYTHONUNBUFFERED=1
      - PYTHONPATH=/app
      - DATABASE_PATH=/app/data/meeting_minutes.db
      - OLLAMA_HOST=${OLLAMA_HOST:-http://host.docker.internal:11434}
    
    # Add extra host for Docker Desktop compatibility
    extra_hosts:
      - "host.docker.internal:host-gateway"
    
    # Volume mounts
    volumes:
      # Local database directory (created by setup-db.sh)
      - ./data:/app/data
      # Logs directory
      - meeting_app_logs:/app/logs
      # Optional: mount local .env file
      - ${LOCAL_ENV_FILE:-./app/.env}:/app/.env:ro
    
    # Health check
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5167/get-meetings"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    
    # Resource limits (optional)
    mem_limit: 2g
    mem_reservation: 512m
    
    # Logging configuration
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    
    # Depends on macOS whisper server for transcription
    depends_on:
      whisper-server-macos:
        condition: service_healthy
    
    # macOS profile only
    profiles:
      - macos

  # Optional: Web UI service (if you want a separate frontend)
  web-ui:
    image: nginx:alpine
    container_name: whisper-web-ui
    ports:
      - "${WEB_PORT:-80}:80"
    volumes:
      - ./web:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - whisper-server
      - meetily-backend
    profiles:
      - web

# Named volumes for persistent data
volumes:
  whisper_models:
    driver: local
  whisper_uploads:
    driver: local
  meeting_app_logs:
    driver: local

# Networks (optional)
networks:
  default:
    name: whisper-network


================================================
FILE: backend/Dockerfile.app
================================================
# Use Python 3.11 slim image as base
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ .

# Create directory for database and logs
RUN mkdir -p /app/data /app/logs

# Set environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
ENV DATABASE_PATH=/app/data/meeting_minutes.db

# Expose the port the app runs on
EXPOSE 5167

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5167/get-meetings || exit 1

# Create non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app

# Install gosu for safe user switching
RUN apt-get update && apt-get install -y gosu && rm -rf /var/lib/apt/lists/*

# Create entrypoint script to fix permissions at runtime
RUN echo '#!/bin/bash\n\
# Fix permissions for mounted data directory\n\
chown -R appuser:appuser /app/data 2>/dev/null || true\n\
# Switch to appuser and run the application\n\
exec gosu appuser "$@"' > /entrypoint.sh && chmod +x /entrypoint.sh

# Run the application via entrypoint
ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5167"]


================================================
FILE: backend/Dockerfile.server-cpu
================================================
# Multi-stage build for Whisper Server (CPU-only)
# This version provides maximum compatibility across all systems

FROM ubuntu:22.04 AS builder

# Set build arguments
ARG WHISPER_VERSION=master
ARG DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    wget \
    pkg-config \
    libsdl2-dev \
    && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

# Copy source code (exclude build directory to avoid cache conflicts)
COPY whisper.cpp/ ./whisper.cpp/
RUN rm -rf ./whisper.cpp/build

# Build whisper server with CPU-only optimizations
WORKDIR /app/whisper.cpp
RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DWHISPER_BUILD_SERVER=ON \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DWHISPER_BUILD_TESTS=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_STATIC=ON \
    -DGGML_NATIVE=OFF \
    -DGGML_CUDA=OFF \
    -DGGML_METAL=OFF \
    -DGGML_OPENCL=OFF \
    -DGGML_ACCELERATE=OFF

RUN cmake --build build --config Release --target whisper-server -j$(nproc)

# Runtime stage - minimal image
FROM ubuntu:22.04 AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN useradd -m -u 1000 whisper && \
    mkdir -p /app/models /app/uploads /app/public && \
    chown -R whisper:whisper /app

# Copy server binary and web interface
COPY --from=builder /app/whisper.cpp/build/bin/whisper-server /app/
COPY --from=builder /app/whisper.cpp/examples/server/public/ /app/public/

# Copy entrypoint script
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && \
    sed -i 's/\r$//' /app/entrypoint.sh

# Set ownership
RUN chown -R whisper:whisper /app

# Switch to non-root user
USER whisper
WORKDIR /app

# Expose server port
EXPOSE 8178

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8178/ || exit 1

# Default environment variables
ENV WHISPER_MODEL=models/ggml-base.en.bin
ENV WHISPER_HOST=0.0.0.0
ENV WHISPER_PORT=8178
ENV WHISPER_THREADS=0
ENV WHISPER_USE_GPU=true

# Set entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["server"]


================================================
FILE: backend/Dockerfile.server-gpu
================================================
# Multi-stage build for Whisper Server (GPU-enabled)
# This version includes CUDA support for NVIDIA GPUs with CPU fallback

ARG CUDA_VERSION=12.3.1
ARG UBUNTU_VERSION=22.04

FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu${UBUNTU_VERSION} AS builder

# Set build arguments
ARG WHISPER_VERSION=master
ARG DEBIAN_FRONTEND=noninteractive
ARG CUDA_DOCKER_ARCH=all

# Set CUDA environment
ENV CUDA_DOCKER_ARCH=${CUDA_DOCKER_ARCH}
ENV GGML_CUDA=1

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    wget \
    pkg-config \
    libsdl2-dev \
    && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

# Copy source code
COPY whisper.cpp/ ./whisper.cpp/

# Build whisper server with CUDA support
WORKDIR /app/whisper.cpp
RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DWHISPER_BUILD_SERVER=ON \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DWHISPER_BUILD_TESTS=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_STATIC=ON \
    -DGGML_CUDA=ON \
    -DGGML_NATIVE=OFF

RUN cmake --build build --config Release --target whisper-server -j$(nproc)

# Runtime stage - CUDA runtime image
FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu${UBUNTU_VERSION} AS runtime

# Set CUDA environment for runtime
ARG CUDA_MAIN_VERSION=12.3
ENV CUDA_MAIN_VERSION=${CUDA_MAIN_VERSION}
ENV LD_LIBRARY_PATH=/usr/local/cuda-${CUDA_MAIN_VERSION}/compat:$LD_LIBRARY_PATH

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN useradd -m -u 1000 whisper && \
    mkdir -p /app/models /app/uploads /app/public && \
    chown -R whisper:whisper /app

# Copy server binary and web interface
COPY --from=builder /app/whisper.cpp/build/bin/whisper-server /app/
COPY --from=builder /app/whisper.cpp/examples/server/public/ /app/public/

# Copy entrypoint script
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && \
    sed -i 's/\r$//' /app/entrypoint.sh

# Set ownership
RUN chown -R whisper:whisper /app

# Switch to non-root user
USER whisper
WORKDIR /app

# Expose server port
EXPOSE 8178

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8178/ || exit 1

# Default environment variables
ENV WHISPER_MODEL=models/ggml-base.en.bin
ENV WHISPER_HOST=0.0.0.0
ENV WHISPER_PORT=8178
ENV WHISPER_THREADS=0
ENV WHISPER_USE_GPU=true

# Set entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["server"]


================================================
FILE: backend/Dockerfile.server-macos
================================================
# Multi-stage build for Whisper Server (macOS Apple Silicon optimized)
# This version provides CPU-only compatibility for Apple Silicon Macs

FROM ubuntu:22.04 AS builder

# Set build arguments
ARG WHISPER_VERSION=master
ARG DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    wget \
    pkg-config \
    libsdl2-dev \
    && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

# Copy source code (exclude build directory to avoid cache conflicts)
COPY whisper.cpp/ ./whisper.cpp/
RUN rm -rf ./whisper.cpp/build

# Build whisper server with CPU-only optimizations for macOS compatibility
WORKDIR /app/whisper.cpp
RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DWHISPER_BUILD_SERVER=ON \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DWHISPER_BUILD_TESTS=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_STATIC=ON \
    -DGGML_NATIVE=OFF \
    -DGGML_CUDA=OFF \
    -DGGML_METAL=OFF \
    -DGGML_OPENCL=OFF \
    -DGGML_ACCELERATE=OFF \
    -DGGML_BLAS=OFF

RUN cmake --build build --config Release --target whisper-server -j$(nproc)

# Runtime stage - minimal image
FROM ubuntu:22.04 AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN useradd -m -u 1000 whisper && \
    mkdir -p /app/models /app/uploads /app/public && \
    chown -R whisper:whisper /app

# Copy server binary and web interface
COPY --from=builder /app/whisper.cpp/build/bin/whisper-server /app/
COPY --from=builder /app/whisper.cpp/examples/server/public/ /app/public/

# Copy entrypoint script
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Set ownership
RUN chown -R whisper:whisper /app

# Switch to non-root user
USER whisper
WORKDIR /app

# Expose server port
EXPOSE 8178

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8178/ || exit 1

# Default environment variables for macOS
ENV WHISPER_MODEL=models/ggml-base.en.bin
ENV WHISPER_HOST=0.0.0.0
ENV WHISPER_PORT=8178
ENV WHISPER_THREADS=0
ENV WHISPER_USE_GPU=false
ENV WHISPER_PLATFORM=macos

# Set entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["server"]


================================================
FILE: backend/download-ggml-model.cmd
================================================
@echo off

pushd %~dp0
set models_path=%CD%
for %%d in (%~dp0..) do set root_path=%%~fd
popd

set models=tiny.en tiny base.en base small.en small medium.en medium large-v1 large-v2 large-v3 large-v3-turbo tiny-q5_1 tiny.en-q5_1 tiny-q8_0 base-q5_1 base.en-q5_1 base-q8_0 small.en-tdrz small-q5_1 small.en-q5_1 small-q8_0 medium-q5_0 medium.en-q5_0 medium-q8_0 large-v2-q5_0 large-v2-q8_0 large-v3-q5_0 large-v3-turbo-q5_0 large-v3-turbo-q8_0

set argc=0
for %%x in (%*) do set /A argc+=1

if %argc% neq 1 (
  echo.
  echo Usage: download-ggml-model.cmd model
  CALL :list_models
  goto :eof
)

set model=%1

for %%b in (%models%) do (
  if "%%b"=="%model%" (
    CALL :download_model
    goto :eof
  )
)

echo Invalid model: %model%
CALL :list_models
goto :eof

:download_model
echo Downloading ggml model %model%...

cd "%models_path%"

if exist "whisper.cpp\models" (
    cd whisper.cpp\models
) else if exist "models" (
    cd models
) else (
    mkdir models
    cd models
)

if exist "ggml-%model%.bin" (
  echo Model %model% already exists in current directory. Skipping download.
  goto :eof
)

REM Also check if model exists in target directory
set target_model=%models_path%\whisper-server-package\models\ggml-%model%.bin
if exist "%target_model%" (
  echo Model %model% already exists in whisper-server-package\models. Skipping download.
  goto :eof
)

REM Check if model contains `tdrz` and update the src accordingly
echo %model% | findstr /C:"tdrz" >nul
if %ERRORLEVEL% equ 0 (
    set "src=https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/main"
) else (
    set "src=https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
)

PowerShell -NoProfile -ExecutionPolicy Bypass -Command "Start-BitsTransfer -Source %src%/ggml-%model%.bin -Destination ggml-%model%.bin"

if %ERRORLEVEL% neq 0 (
  echo Failed to download ggml model %model%
  echo Please try again later or download the original Whisper model files and convert them yourself.
  goto :eof
)

set current_dir=%CD%
set source_file=%current_dir%\ggml-%model%.bin
echo Done! Model %model% saved in %source_file%

REM Set target directory for whisper-server-package
set target_dir=%models_path%\whisper-server-package\models

REM Debug output
echo.
echo Checking if model needs to be moved...
echo Current directory: %current_dir%
echo Target directory: %target_dir%
echo.

REM Check if we're already in the target directory
if "%current_dir%"=="%target_dir%" (
    echo Model is already in the correct location.
) else (
    REM Check if target directory exists
    if exist "%target_dir%" (
        echo Target directory exists. Copying model...
        
        REM Ensure target directory exists
        if not exist "%target_dir%" mkdir "%target_dir%"
        
        REM Copy the model to the target directory
        copy /Y "%source_file%" "%target_dir%\ggml-%model%.bin"
        
        if %ERRORLEVEL% equ 0 (
            REM Verify the copy was successful by checking file size
            if exist "%target_dir%\ggml-%model%.bin" (
                echo Model successfully copied to whisper-server-package\models
                
                REM Delete the source file to save space
                echo Removing model from temporary location: %source_file%
                del /F /Q "%source_file%"
                
                if exist "%source_file%" (
                    echo Warning: Could not remove temporary model file.
                    echo The file may be in use or you may not have permission.
                ) else (
                    echo Cleanup completed successfully.
                    echo Model removed from: %current_dir%
                )
            ) else (
                echo Warning: Copy verification failed. Keeping source file.
            )
        ) else (
            echo Warning: Failed to copy model to whisper-server-package\models
            echo Model remains in: %source_file%
        )
    ) else (
        echo Target directory does not exist: %target_dir%
        
        REM Try to create it
        echo Attempting to create target directory...
        mkdir "%target_dir%" 2>nul
        
        if exist "%target_dir%" (
            echo Directory created. Copying model...
            copy /Y "%source_file%" "%target_dir%\ggml-%model%.bin"
            
            if %ERRORLEVEL% equ 0 (
                if exist "%target_dir%\ggml-%model%.bin" (
                    echo Model successfully copied.
                    del /F /Q "%source_file%"
                    if not exist "%source_file%" (
                        echo Cleanup completed successfully.
                    )
                )
            )
        ) else (
            echo Could not create target directory.
            echo Model saved in: %source_file%
        )
    )
)

echo.
echo You can now use the model with the Whisper server.

goto :eof

:list_models
  echo.
  echo Available models:
  (for %%a in (%models%) do (
    echo %%a
  ))
  echo.
  goto :eof



================================================
FILE: backend/download-ggml-model.sh
================================================
#!/bin/sh

# This script downloads Whisper model files that have already been converted to ggml format.
# This way you don't have to convert them yourself.

#src="https://ggml.ggerganov.com"
#pfx="ggml-model-whisper"

src="https://huggingface.co/ggerganov/whisper.cpp"
pfx="resolve/main/ggml"

BOLD="\033[1m"
RESET='\033[0m'

# get the path of this script
get_script_path() {
    if [ -x "$(command -v realpath)" ]; then
        dirname "$(realpath "$0")"
    else
        _ret="$(cd -- "$(dirname "$0")" >/dev/null 2>&1 || exit ; pwd -P)"
        echo "$_ret"
    fi
}

models_path="${2:-$(get_script_path)}"

# Whisper models
models="tiny
tiny.en
tiny-q5_1
tiny.en-q5_1
tiny-q8_0
base
base.en
base-q5_1
base.en-q5_1
base-q8_0
small
small.en
small.en-tdrz
small-q5_1
small.en-q5_1
small-q8_0
medium
medium.en
medium-q5_0
medium.en-q5_0
medium-q8_0
large-v1
large-v2
large-v2-q5_0
large-v2-q8_0
large-v3
large-v3-q5_0
large-v3-turbo
large-v3-turbo-q5_0
large-v3-turbo-q8_0"

# list available models
list_models() {
    printf "\n"
    printf "Available models:"
    model_class=""
    for model in $models; do
        this_model_class="${model%%[.-]*}"
        if [ "$this_model_class" != "$model_class" ]; then
            printf "\n "
            model_class=$this_model_class
        fi
        printf " %s" "$model"
    done
    printf "\n\n"
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
    printf "Usage: %s <model> [models_path]\n" "$0"
    list_models
    printf "___________________________________________________________\n"
    printf "${BOLD}.en${RESET} = english-only ${BOLD}-q5_[01]${RESET} = quantized ${BOLD}-tdrz${RESET} = tinydiarize\n"

    exit 1
fi

model=$1

if ! echo "$models" | grep -q -w "$model"; then
    printf "Invalid model: %s\n" "$model"
    list_models

    exit 1
fi

# check if model contains `tdrz` and update the src and pfx accordingly
if echo "$model" | grep -q "tdrz"; then
    src="https://huggingface.co/akashmjn/tinydiarize-whisper.cpp"
    pfx="resolve/main/ggml"
fi

echo "$model" | grep -q '^"tdrz"*$'

# download ggml model

printf "Downloading ggml model %s from '%s' ...\n" "$model" "$src"

cd "$models_path" || exit

if [ -f "ggml-$model.bin" ]; then
    printf "Model %s already exists. Skipping download.\n" "$model"
    exit 0
fi

if [ -x "$(command -v wget2)" ]; then
    wget2 --no-config --progress bar -O ggml-"$model".bin $src/$pfx-"$model".bin
elif [ -x "$(command -v wget)" ]; then
    wget --no-config --quiet --show-progress -O ggml-"$model".bin $src/$pfx-"$model".bin
elif [ -x "$(command -v curl)" ]; then
    curl -L --output ggml-"$model".bin $src/$pfx-"$model".bin
else
    printf "Either wget or curl is required to download models.\n"
    exit 1
fi

if [ $? -ne 0 ]; then
    printf "Failed to download ggml model %s \n" "$model"
    printf "Please try again later or download the original Whisper model files and convert them yourself.\n"
    exit 1
fi

printf "Done! Model '%s' saved in '%s/ggml-%s.bin'\n" "$model" "$models_path" "$model"
printf "You can now use it like this:\n\n"
printf "  $ ./build/bin/whisper-cli -m %s/ggml-%s.bin -f samples/jfk.wav\n" "$models_path" "$model"
printf "\n"



================================================
FILE: backend/install_dependancies_for_windows.ps1
================================================
Write-Host "Installing dependencies..."

try {

    # Install Chocolatey if not already installed
    if (!(Test-Path "$env:ProgramData\chocolatey\choco.exe")) {
        Write-Host "Installing Chocolatey..."
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
        refreshenv
    } else {
        Write-Host "Chocolatey is already installed"
    }


    # Check Python installation
    Write-Host "Checking Python installation..."
    
    # List of possible Python installation paths
    $pythonPaths = @(
        "C:\Program Files\Python311\python.exe",
        "C:\Python311\python.exe",
        "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python311\python.exe",
        "C:\ProgramData\chocolatey\bin\python.exe"
    )
    
    $pythonExe = $null
    foreach ($path in $pythonPaths) {
        if (Test-Path $path) {
            $pythonExe = $path
            Write-Host "Found Python at: $pythonExe"
            break
        }
    }
    
    if ($pythonExe -eq $null) {
        Write-Host "Python not found. Installing Python 3.11..."
        choco install python311 -y --params "/InstallDir:C:\Program Files\Python311 /InstallAllUsers"
        refreshenv
        Start-Sleep -Seconds 5  # Give time for installation to complete
        
        # Check again after installation
        foreach ($path in $pythonPaths) {
            if (Test-Path $path) {
                $pythonExe = $path
                Write-Host "Found Python at: $pythonExe"
                break
            }
        }
        
        if ($pythonExe -eq $null) {
            Write-Host "Python installation failed. Please install Python 3.11 manually."
            exit 1
        }
    }
    
    # Add Python directories to PATH
    $pythonDir = Split-Path -Parent $pythonExe
    $pythonScriptsDir = Join-Path $pythonDir "Scripts"
    
    $currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $currentPath.Contains($pythonDir)) {
        Write-Host "Adding Python to PATH..."
        $newPath = "$pythonDir;$pythonScriptsDir;" + $currentPath
        [System.Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        $env:Path = "$pythonDir;$pythonScriptsDir;" + $env:Path
    }
    
    # Verify Python is working
    try {
        $pythonVersion = & $pythonExe --version 2>&1
        Write-Host "Python is available: $pythonVersion"
    } catch {
        Write-Host "Error verifying Python installation. Please restart your terminal and try again."
        exit 1
    }
    
    # Check pip installation
    Write-Host "Checking pip installation..."
    $pipPath = Join-Path $pythonScriptsDir "pip.exe"
    if (-not (Test-Path $pipPath)) {
        Write-Host "pip not found. Installing pip..."
        & $pythonExe -m ensurepip --upgrade
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Failed to install pip. Please install pip manually."
            exit 1
        }
        Write-Host "pip installed successfully"
        refreshenv
    } else {
        $pipVersion = & $pipPath --version 2>&1
        Write-Host "pip is available: $pipVersion"
    }
    
    # Install Git if not present
    if (!(Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Host "Installing Git..."
        choco install git -y
        refreshenv
    } else {
        Write-Host "Git is already installed"
    }

    # Install CMake if not present
    if (!(Get-Command cmake -ErrorAction SilentlyContinue)) {
        Write-Host "Installing CMake..."
        choco install cmake --installargs 'ADD_CMAKE_TO_PATH=System' -y
        refreshenv
    } else {
        Write-Host "CMake is already installed"
    }

    # Install Visual Studio Build Tools if not present
    $vswhereExe = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (!(Test-Path $vswhereExe) -or !(& $vswhereExe -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64)) {
        Write-Host "Installing Visual Studio Build Tools..."
        choco install visualstudio2022buildtools -y --package-parameters "--add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22000"
        refreshenv
    } else {
        Write-Host "Visual Studio Build Tools are already installed"
    }

    # Setup Visual Studio environment
    Write-Host "Setting up Visual Studio environment..."
    $vsDevCmd = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
    if (Test-Path $vsDevCmd) {
        & cmd /c "call `"$vsDevCmd`" -arch=x64 && set" | foreach-object {
            if ($_ -match '^([^=]+)=(.*)') {
                [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
            }
        }
    } else {
        Write-Host "Warning: Visual Studio environment setup failed. You may need to run from a Developer Command Prompt."
    }

    # Install Visual Studio Redistributables
    Write-Host "Installing Visual Studio Redistributables..."
    Write-Host "The script requires administrative privileges. You will be prompted to allow this action."
    $installScript = @"
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://vcredist.com/install.ps1'))
"@
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"$installScript`""

    # Check if bun is installed
    $bunInstalled = $false
    $bunVersion = ""
    try {
        $bunVersion = (bun --version 2>$null) -replace "[^\d\.]", ""
        if ($bunVersion -as [version] -ge [version]"1.1.43") {
            $bunInstalled = $true
        }
    } catch {}

    if ($bunInstalled) {
        Write-Host "Bun is already installed and meets version requirements"
    } else {
        Write-Host "Installing bun..."
        Invoke-Expression (Invoke-RestMethod -Uri "https://bun.sh/install.ps1")
    }

    Write-Host "Installation Complete"
    Write-Host ""
    Write-Host "to get started:"
    Write-Host "1. restart your terminal"
    Write-Host "2. Run the following commands:"
    Write-Host "cd Documents"
    Write-Host "git clone https://github.com/zackriya-solutions/meeting-minutes.git"
    Write-Host "cd meeting-minutes/backend"
    Write-Host "./build_whisper.cmd"
    Write-Host ""
   
    try {
        $postHogData = @{
            api_key    = ""
            event      = "cli_install"
            properties = @{
                distinct_id = $env:COMPUTERNAME
                version     = $latestRelease.tag_name
                os          = "windows"
                arch        = "x86_64"
            }
        } | ConvertTo-Json

        Write-Host "Tracking installation..."
        Write-Host $postHogData
    } catch {
        # Silently continue if tracking fails
    }

} catch {
    Write-Host "Installation failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}



================================================
FILE: backend/requirements.txt
================================================
pydantic-ai==0.2.15
pydantic==2.11.5
pandas==2.2.3
devtools==0.12.2
python-dotenv==1.1.0
fastapi==0.115.9
uvicorn==0.34.0
python-multipart==0.0.20
aiosqlite==0.21.0
ollama==0.5.2


================================================
FILE: backend/SCRIPTS_DOCUMENTATION.md
================================================
# Legacy Backend Scripts Archive

This document previously described the scripts used to build and run the old
Python/FastAPI, Docker, and standalone whisper-server backend.

## Current Supported Development Flow

Meetily no longer uses these backend scripts for supported development or user
setup. The supported app is the Tauri desktop application under `frontend/`,
with Rust backend code in `frontend/src-tauri`.

Use these docs instead:

- [Top-level README](../README.md)
- [Building from Source](../docs/BUILDING.md)
- [Architecture](../docs/architecture.md)

## Archived Script Status

The legacy scripts in this directory are retained only for historical reference
and migration context. Do not use them for new installs, production
deployments, or contributor setup.

The old Docker deployment, FastAPI server, standalone whisper-server startup,
and unauthenticated/CORS behavior are unsupported and must not be treated as the
current Meetily backend.



================================================
FILE: backend/set_env.sh
================================================
#!/bin/bash

# This script sets up environment variables for API keys

# Copy template environment file
echo "Setting up environment variables..."
cp temp.env .env

# Function to update API key in .env file
update_api_key() {
    local key_name=$1
    local key_value=$2
    sed -i "" "s|$key_name=.*|$key_name=$key_value|g" .env
}

# Function to check if key needs update
needs_update() {
    local value=$1
    [[ -z "$value" || "$value" == "api_key_here" || "$value" == "gapi_key_here" ]]
}

# Update API keys in .env file
for key in ANTHROPIC_API_KEY GROQ_API_KEY OPENAI_API_KEY; do
    # Get current value from environment
    current_value="${!key}"
    
    # Check if key needs to be updated
    if needs_update "$current_value"; then
        echo "$key is not set. Press Enter to skip or enter your API key:"
        read -p "Enter $key (or press Enter to skip): " new_value
        if [ -n "$new_value" ]; then
            update_api_key "$key" "$new_value"
        fi
    else
        update_api_key "$key" "$current_value"
    fi
done

# Print final environment variables
echo "Final API Keys:"
grep -E "^(ANTHROPIC|GROQ|OPENAI)_API_KEY=" .env
echo "Environment setup complete!"


================================================
FILE: backend/setup-db.ps1
================================================
# Database Setup Script for Meeting App
# Handles existing database discovery and migration

param(
    [string]$DbPath,
    [switch]$Fresh,
    [switch]$Auto,
    [Alias("h")]
    [switch]$Help
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Configuration
$ScriptDir = $PSScriptRoot
$DefaultDbPath = "./meeting_minutes.db"
$DockerDbDir = Join-Path $ScriptDir "data"
$DockerDbPath = Join-Path $DockerDbDir "meeting_minutes.db"

# Color functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Show-Help {
    @"
Meeting App Database Setup Script

This script helps you set up the database for the Meeting App by:
1. Checking for existing database from previous installations
2. Copying/migrating existing database if found
3. Setting up fresh database for first-time installations

Usage: setup-db.ps1 [OPTIONS]

OPTIONS:
  -DbPath PATH       Specify custom database path to migrate from
  -Fresh             Skip existing database search, create fresh database
  -Auto              Auto-detect and migrate without prompts (if found)
  -Help, -h          Show this help

Examples:
  # Interactive setup (recommended)
  .\setup-db.ps1
  
  # Migrate from custom path
  .\setup-db.ps1 -DbPath "C:\path\to\meeting_minutes.db"
  
  # Fresh installation
  .\setup-db.ps1 -Fresh
  
  # Auto-detect and migrate
  .\setup-db.ps1 -Auto
"@
}

# Function to check if database exists and is valid
function Test-Database {
    param([string]$DbPath)
    
    if (-not (Test-Path $DbPath -PathType Leaf)) {
        return $false
    }
    
    # Simple file validation - just check if it's a .db file and not empty
    $fileInfo = Get-Item $DbPath
    return ($fileInfo.Extension -eq '.db' -and $fileInfo.Length -gt 0)
}

# Function to get database info
function Get-DatabaseInfo {
    param([string]$DbPath)
    
    Write-Info "Database Information:"
    $fileInfo = Get-Item $DbPath
    $sizeKB = [math]::Round($fileInfo.Length / 1KB, 1)
    $sizeMB = [math]::Round($fileInfo.Length / 1MB, 1)
    $sizeDisplay = if ($sizeMB -gt 1) { "${sizeMB} MB" } else { "${sizeKB} KB" }
    
    Write-Host "  Path: $DbPath"
    Write-Host "  Size: $sizeDisplay"
    Write-Host "  Modified: $($fileInfo.LastWriteTime)"
    Write-Host "  Type: SQLite Database (.db file)"
}

# Function to copy database
function Copy-Database {
    param(
        [string]$SourcePath,
        [string]$DestPath
    )
    
    Write-Info "Copying database from $SourcePath to $DestPath"
    
    # Create destination directory if it doesn't exist
    $destDir = Split-Path $DestPath -Parent
    if (-not (Test-Path $destDir -PathType Container)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    
    # Copy the database file
    Copy-Item -Path $SourcePath -Destination $DestPath -Force
    
    Write-Info " Database copied successfully"
}

# Function to find existing databases
function Find-ExistingDatabases {
    $foundDbs = @()
    
    # Check default location
    if (Test-Database $DefaultDbPath) {
        $foundDbs += $DefaultDbPath
    }
    
    # Check other common locations (Windows/cross-platform paths)
    $commonPaths = @(
        "$env:USERPROFILE\.meetily\meeting_minutes.db",
        "$env:USERPROFILE\Documents\meetily\meeting_minutes.db",
        "$env:USERPROFILE\Desktop\meeting_minutes.db",
        ".\meeting_minutes.db"
    )
    
    # Add potential HomeBrew paths if on macOS/Linux
    if ($env:HOMEBREW_PREFIX) {
        $commonPaths += "$env:HOMEBREW_PREFIX/Cellar/meetily-backend/*/backend/meeting_minutes.db"
    }
    
    foreach ($pattern in $commonPaths) {
        if ($pattern -contains "*") {
            # Handle wildcard patterns
            try {
                $matches = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
                foreach ($match in $matches) {
                    if ($match.FullName -ne $DefaultDbPath -and (Test-Database $match.FullName)) {
                        $foundDbs += $match.FullName
                    }
                }
            } catch {
                # Ignore errors for wildcard patterns
            }
        } else {
            if ($pattern -ne $DefaultDbPath -and (Test-Database $pattern)) {
                $foundDbs += $pattern
            }
        }
    }
    
    return $foundDbs | Select-Object -Unique
}

# Interactive database selection
function Start-InteractiveSetup {
    Write-Host ""
    Write-Info "=== Meeting App Database Setup ==="
    Write-Host ""
    
    Write-Info "Searching for existing databases..."
    $foundDbs = Find-ExistingDatabases
    
    if ($foundDbs.Count -eq 0) {
        Write-Info "No existing databases found."
        Write-Host ""
        Write-Host "Options:"
        Write-Host "1 First-time installation - create fresh database"
        Write-Host "2 I have an existing database at a custom location"
        Write-Host "3 Exit"
        Write-Host ""
        $choice = Read-Host "Please choose an option (1-3)"
        
        switch ($choice) {
            "1" {
                Write-Info "Setting up fresh database for first-time installation"
                New-FreshDatabase
            }
            "2" {
                $customPath = Read-Host "Enter the full path to your existing database"
                if (Test-Database $customPath) {
                    Get-DatabaseInfo $customPath
                    Write-Host ""
                    $confirm = Read-Host "Use this database? (y/N)"
                    if ($confirm -match "^[Yy]$") {
                        Copy-Database $customPath $DockerDbPath
                    } else {
                        Write-Info "Database setup cancelled"
                        exit 0
                    }
                } else {
                    Write-Error "Invalid database file: $customPath"
                    exit 1
                }
            }
            "3" {
                Write-Info "Setup cancelled"
                exit 0
            }
            default {
                Write-Error "Invalid choice"
                exit 1
            }
        }
    } else {
        Write-Info "Found $($foundDbs.Count) existing database(s):"
        Write-Host ""
        
        for ($i = 0; $i -lt $foundDbs.Count; $i++) {
            Write-Host "$($i+1)) $($foundDbs[$i])"
        }
        Write-Host "$($foundDbs.Count+1)) Use custom path"
        Write-Host "$($foundDbs.Count+2)) Fresh installation"
        Write-Host "$($foundDbs.Count+3)) Exit"
        Write-Host ""
        
        $choice = Read-Host "Please choose an option"
        $choiceNum = [int]$choice
        
        if ($choiceNum -ge 1 -and $choiceNum -le $foundDbs.Count) {
            $selectedDb = $foundDbs[$choiceNum-1]
            Write-Host ""
            Get-DatabaseInfo $selectedDb
            Write-Host ""
            $confirm = Read-Host "Use this database? (Y/n)"
            if ($confirm -notmatch "^[Nn]$") {
                Copy-Database $selectedDb $DockerDbPath
            } else {
                Write-Info "Database setup cancelled"
                exit 0
            }
        } elseif ($choiceNum -eq ($foundDbs.Count+1)) {
            $customPath = Read-Host "Enter the full path to your existing database"
            if (Test-Database $customPath) {
                Get-DatabaseInfo $customPath
                Write-Host ""
                $confirm = Read-Host "Use this database? (y/N)"
                if ($confirm -match "^[Yy]$") {
                    Copy-Database $customPath $DockerDbPath
                } else {
                    Write-Info "Database setup cancelled"
                    exit 0
                }
            } else {
                Write-Error "Invalid database file: $customPath"
                exit 1
            }
        } elseif ($choiceNum -eq ($foundDbs.Count+2)) {
            Write-Info "Setting up fresh database for first-time installation"
            New-FreshDatabase
        } elseif ($choiceNum -eq ($foundDbs.Count+3)) {
            Write-Info "Setup cancelled"
            exit 0
        } else {
            Write-Error "Invalid choice"
            exit 1
        }
    }
}

# Function to setup fresh database
function New-FreshDatabase {
    # Create data directory
    if (-not (Test-Path $DockerDbDir -PathType Container)) {
        New-Item -ItemType Directory -Path $DockerDbDir -Force | Out-Null
    }
    
    # Remove existing database if any
    if (Test-Path $DockerDbPath) {
        Remove-Item $DockerDbPath -Force
    }
    
    Write-Info "Fresh database setup complete"
    Write-Info "The application will create a new database on first run"
}

# Auto setup function
function Start-AutoSetup {
    Write-Info "Auto-detecting existing databases..."
    
    if (Test-Database $DefaultDbPath) {
        Write-Info "Found database at default location: $DefaultDbPath"
        Get-DatabaseInfo $DefaultDbPath
        Copy-Database $DefaultDbPath $DockerDbPath
    } else {
        $foundDbs = Find-ExistingDatabases
        if ($foundDbs.Count -gt 0) {
            Write-Info "Found database: $($foundDbs[0])"
            Get-DatabaseInfo $foundDbs[0]
            Copy-Database $foundDbs[0] $DockerDbPath
        } else {
            Write-Info "No existing databases found, setting up fresh installation"
            New-FreshDatabase
        }
    }
}

# Main function
function Main {
    if ($Help) {
        Show-Help
        exit 0
    }
    
    # No sqlite3 required - using simple file-based validation
    
    if ($Fresh) {
        New-FreshDatabase
    } elseif ($DbPath) {
        if (Test-Database $DbPath) {
            Get-DatabaseInfo $DbPath
            Copy-Database $DbPath $DockerDbPath
        } else {
            Write-Error "Invalid database file: $DbPath"
            exit 1
        }
    } elseif ($Auto) {
        Start-AutoSetup
    } else {
        Start-InteractiveSetup
    }
    
    Write-Info '=== Database Setup Complete ==='
    Write-Host "Database location: $DockerDbPath"
    Write-Info 'You can now start the services with: .\run-docker.ps1 compose up -d'
}

# Execute main function
Main


================================================
FILE: backend/setup-db.sh
================================================
#!/bin/bash

# Database Setup Script for Meeting App
# Handles existing database discovery and migration

set -e

# Configuration
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEFAULT_DB_PATH="/opt/homebrew/Cellar/meetily-backend/0.0.4/backend/meeting_minutes.db"
DOCKER_DB_DIR="$SCRIPT_DIR/data"
DOCKER_DB_PATH="$DOCKER_DB_DIR/meeting_minutes.db"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Ensure data directory exists
ensure_data_directory() {
    if [ ! -d "$DOCKER_DB_DIR" ]; then
        log_info "Creating data directory..."
        mkdir -p "$DOCKER_DB_DIR"
        chmod 755 "$DOCKER_DB_DIR"
        log_info "✓ Data directory created at: $DOCKER_DB_DIR"
    fi
}

show_help() {
    cat << EOF
Meeting App Database Setup Script

This script helps you set up the database for the Meeting App by:
1. Checking for existing database from previous installations
2. Copying/migrating existing database if found
3. Setting up fresh database for first-time installations

Usage: $0 [OPTIONS]

OPTIONS:
  --db-path PATH       Specify custom database path to migrate from
  --fresh              Skip existing database search, create fresh database
  --auto               Auto-detect and migrate without prompts (if found)
  -h, --help           Show this help

Examples:
  # Interactive setup (recommended)
  $0
  
  # Migrate from custom path
  $0 --db-path /path/to/meeting_minutes.db
  
  # Fresh installation
  $0 --fresh
  
  # Auto-detect and migrate
  $0 --auto

EOF
}

# Function to check if database exists and is valid
check_database() {
    local db_path="$1"
    
    if [ ! -f "$db_path" ]; then
        return 1
    fi
    
    # Check if it's a valid SQLite database
    if ! sqlite3 "$db_path" "SELECT name FROM sqlite_master WHERE type='table' LIMIT 1;" >/dev/null 2>&1; then
        return 1
    fi
    
    return 0
}

# Function to get database info
get_database_info() {
    local db_path="$1"
    
    log_info "Database Information:"
    echo "  Path: $db_path"
    echo "  Size: $(du -h "$db_path" | cut -f1)"
    echo "  Modified: $(stat -f "%Sm" "$db_path" 2>/dev/null || stat -c "%y" "$db_path" 2>/dev/null || echo "Unknown")"
    
    # Try to get table counts
    local meetings_count=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM meetings;" 2>/dev/null || echo "0")
    local transcripts_count=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM transcripts;" 2>/dev/null || echo "0")
    
    echo "  Meetings: $meetings_count"
    echo "  Transcripts: $transcripts_count"
}

# Function to copy database
copy_database() {
    local source_path="$1"
    local dest_path="$2"
    
    log_info "Copying database from $source_path to $dest_path"
    
    # Create destination directory if it doesn't exist
    mkdir -p "$(dirname "$dest_path")"
    
    # Copy the database file
    cp "$source_path" "$dest_path"
    
    # Set proper permissions
    chmod 644 "$dest_path"
    
    log_info "✓ Database copied successfully"
}

# Function to find existing databases
find_existing_databases() {
    local found_dbs=()
    
    # Check default location
    if check_database "$DEFAULT_DB_PATH"; then
        found_dbs+=("$DEFAULT_DB_PATH")
    fi
    
    # Check other common locations
    local common_paths=(
        "/opt/homebrew/Cellar/meetily-backend/*/backend/meeting_minutes.db"
        "$HOME/.meetily/meeting_minutes.db"
        "$HOME/Documents/meetily/meeting_minutes.db"
        "$HOME/Desktop/meeting_minutes.db"
        "./meeting_minutes.db"
    )
    
    for pattern in "${common_paths[@]}"; do
        for path in $pattern; do
            if [[ "$path" != "$DEFAULT_DB_PATH" ]] && check_database "$path"; then
                found_dbs+=("$path")
            fi
        done
    done
    
    printf '%s\n' "${found_dbs[@]}"
}

# Interactive database selection
interactive_setup() {
    echo
    log_info "=== Meeting App Database Setup ==="
    echo
    
    log_info "Searching for existing databases..."
    local found_dbs=($(find_existing_databases))
    
    if [ ${#found_dbs[@]} -eq 0 ]; then
        log_info "No existing databases found."
        echo
        echo "Options:"
        echo "1) First-time installation (create fresh database)"
        echo "2) I have an existing database at a custom location"
        echo "3) Exit"
        echo
        read -p "Please choose an option (1-3): " choice
        
        case $choice in
            1)
                log_info "Setting up fresh database for first-time installation"
                setup_fresh_database
                ;;
            2)
                read -p "Enter the full path to your existing database: " custom_path
                if check_database "$custom_path"; then
                    get_database_info "$custom_path"
                    echo
                    read -p "Use this database? (y/N): " confirm
                    if [[ $confirm =~ ^[Yy]$ ]]; then
                        copy_database "$custom_path" "$DOCKER_DB_PATH"
                    else
                        log_info "Database setup cancelled"
                        exit 0
                    fi
                else
                    log_error "Invalid database file: $custom_path"
                    exit 1
                fi
                ;;
            3)
                log_info "Setup cancelled"
                exit 0
                ;;
            *)
                log_error "Invalid choice"
                exit 1
                ;;
        esac
    else
        log_info "Found ${#found_dbs[@]} existing database(s):"
        echo
        
        for i in "${!found_dbs[@]}"; do
            echo "$((i+1))) ${found_dbs[i]}"
        done
        echo "$((${#found_dbs[@]}+1))) Use custom path"
        echo "$((${#found_dbs[@]}+2))) Fresh installation"
        echo "$((${#found_dbs[@]}+3))) Exit"
        echo
        
        read -p "Please choose an option: " choice
        
        if [[ $choice -ge 1 && $choice -le ${#found_dbs[@]} ]]; then
            local selected_db="${found_dbs[$((choice-1))]}"
            echo
            get_database_info "$selected_db"
            echo
            read -p "Use this database? (Y/n): " confirm
            if [[ ! $confirm =~ ^[Nn]$ ]]; then
                copy_database "$selected_db" "$DOCKER_DB_PATH"
            else
                log_info "Database setup cancelled"
                exit 0
            fi
        elif [[ $choice -eq $((${#found_dbs[@]}+1)) ]]; then
            read -p "Enter the full path to your existing database: " custom_path
            if check_database "$custom_path"; then
                get_database_info "$custom_path"
                echo
                read -p "Use this database? (y/N): " confirm
                if [[ $confirm =~ ^[Yy]$ ]]; then
                    copy_database "$custom_path" "$DOCKER_DB_PATH"
                else
                    log_info "Database setup cancelled"
                    exit 0
                fi
            else
                log_error "Invalid database file: $custom_path"
                exit 1
            fi
        elif [[ $choice -eq $((${#found_dbs[@]}+2)) ]]; then
            log_info "Setting up fresh database for first-time installation"
            setup_fresh_database
        elif [[ $choice -eq $((${#found_dbs[@]}+3)) ]]; then
            log_info "Setup cancelled"
            exit 0
        else
            log_error "Invalid choice"
            exit 1
        fi
    fi
}

# Function to setup fresh database
setup_fresh_database() {
    # Create data directory
    mkdir -p "$DOCKER_DB_DIR"
    
    # Remove existing database if any
    if [ -f "$DOCKER_DB_PATH" ]; then
        rm "$DOCKER_DB_PATH"
    fi
    
    # Create empty database file with proper permissions
    touch "$DOCKER_DB_PATH"
    chmod 644 "$DOCKER_DB_PATH"
    
    log_info "✓ Fresh database created at: $DOCKER_DB_PATH"
    log_info "The application will initialize the database schema on first run"
}

# Auto setup function
auto_setup() {
    log_info "Auto-detecting existing databases..."
    
    if check_database "$DEFAULT_DB_PATH"; then
        log_info "Found database at default location: $DEFAULT_DB_PATH"
        get_database_info "$DEFAULT_DB_PATH"
        copy_database "$DEFAULT_DB_PATH" "$DOCKER_DB_PATH"
    else
        local found_dbs=($(find_existing_databases))
        if [ ${#found_dbs[@]} -gt 0 ]; then
            log_info "Found database: ${found_dbs[0]}"
            get_database_info "${found_dbs[0]}"
            copy_database "${found_dbs[0]}" "$DOCKER_DB_PATH"
        else
            log_info "No existing databases found, setting up fresh installation"
            setup_fresh_database
        fi
    fi
}

# Main function
main() {
    # Ensure data directory exists first
    ensure_data_directory
    
    local custom_db_path=""
    local fresh_install=false
    local auto_mode=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --db-path)
                custom_db_path="$2"
                shift 2
                ;;
            --fresh)
                fresh_install=true
                shift
                ;;
            --auto)
                auto_mode=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # For fresh install, sqlite3 is not required
    if [ "$fresh_install" = true ]; then
        setup_fresh_database
    else
        # Check if sqlite3 is available for database operations
        if ! command -v sqlite3 >/dev/null 2>&1; then
            log_error "sqlite3 is required for database operations but not installed"
            log_error "Please install sqlite3 or use --fresh for a fresh installation"
            exit 1
        fi
    fi
    
    if [ -n "$custom_db_path" ]; then
        if check_database "$custom_db_path"; then
            get_database_info "$custom_db_path"
            copy_database "$custom_db_path" "$DOCKER_DB_PATH"
        else
            log_error "Invalid database file: $custom_db_path"
            exit 1
        fi
    elif [ "$auto_mode" = true ]; then
        auto_setup
    else
        interactive_setup
    fi
    
    log_info "=== Database Setup Complete ==="
    log_info "Database location: $DOCKER_DB_PATH"
    log_info "You can now start the services with: ./run-docker.sh compose up -d"
}

# Execute main function
main "$@"


================================================
FILE: backend/start_python_backend.cmd
================================================
@echo off
setlocal enabledelayedexpansion

set "PORT=5167"
if "%~1" neq "" (
    set "PORT=%~1"
)

echo Starting Python backend on port %PORT%...

if not exist "venv" (
    echo Error: Virtual environment not found
    echo Please run build_whisper.cmd first
    goto :eof
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to activate virtual environment
    goto :eof
)

REM Check if required Python packages are installed
pip show fastapi >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: FastAPI not found. Please run build_whisper.cmd to install dependencies
    goto :eof
)

REM Check if app directory exists
if not exist "app" (
    echo Error: app directory not found
    echo Please run build_whisper.cmd first
    goto :eof
)

REM Check if main.py exists
if not exist "app\main.py" (
    echo Error: app\main.py not found
    echo Please run build_whisper.cmd first
    goto :eof
)

echo Running: python app\main.py
echo.
echo Output will be displayed in this window
echo Press Ctrl+C to stop the Python backend
echo.

REM Set environment variable for port
set "PORT=%PORT%"

REM Run the Python backend in the current window to see output
python app\main.py

goto :eof



================================================
FILE: backend/start_whisper_server.cmd
================================================
@echo off
setlocal enabledelayedexpansion

set "PACKAGE_NAME=whisper-server-package"
set "MODEL_NAME=ggml-small.bin"

if "%~1" neq "" (
    set "MODEL_NAME=ggml-%~1.bin"
)

echo Starting Whisper server with model: %MODEL_NAME%

if not exist "%PACKAGE_NAME%" (
    echo Error: %PACKAGE_NAME% directory not found
    echo Please run build_whisper.cmd first
    goto :eof
)

if not exist "%PACKAGE_NAME%\whisper-server.exe" (
    echo Error: whisper-server.exe not found in %PACKAGE_NAME% directory
    echo Please run build_whisper.cmd first
    goto :eof
)

if not exist "%PACKAGE_NAME%\models\%MODEL_NAME%" (
    echo Error: Model %MODEL_NAME% not found in %PACKAGE_NAME%\models directory
    echo Available models:
    dir /b "%PACKAGE_NAME%\models" 2>nul
    echo.
    echo Please run build_whisper.cmd with the correct model name
    goto :eof
)

cd "%PACKAGE_NAME%" || (
    echo Error: Failed to change to %PACKAGE_NAME% directory
    goto :eof
)

echo Running: whisper-server.exe --model models\%MODEL_NAME% --host 127.0.0.1 --port 8178 --diarize --print-progress
echo.
echo Output will be displayed in this window
echo Press Ctrl+C to stop the server
echo.

REM Run the server in the current window to see output
whisper-server.exe --model models\%MODEL_NAME% --host 127.0.0.1 --port 8178 --diarize --print-progress

cd ..
goto :eof



================================================
FILE: backend/start_with_output.ps1
================================================
# PowerShell script to start both Whisper server and Python backend with visible output
# This script uses PowerShell's Start-Process to run both servers and show their output

# Set the port for Python backend (default: 5167)
$portPython = 5167
if ($args.Count -gt 0) {
    $portPython = $args[0]
}

# Set the port for Whisper server (default: 8178)
$portWhisper = 8178
if ($args.Count -gt 1) {
    $portWhisper = $args[1]
}

Write-Host "====================================="
Write-Host "Meetily Backend Startup"
Write-Host "====================================="
Write-Host "Python Backend Port: $portPython"
Write-Host "Whisper Server Port: $portWhisper"
Write-Host "====================================="
Write-Host ""

# Kill any existing whisper-server.exe processes
$whisperProcesses = Get-Process -Name "whisper-server" -ErrorAction SilentlyContinue
if ($whisperProcesses) {
    Write-Host "Stopping existing Whisper server processes..."
    $whisperProcesses | ForEach-Object { $_.Kill() }
    Start-Sleep -Seconds 1
}

# Kill any existing python.exe processes
$pythonProcesses = Get-Process -Name "python" -ErrorAction SilentlyContinue
if ($pythonProcesses) {
    Write-Host "Stopping existing Python processes..."
    $pythonProcesses | ForEach-Object { $_.Kill() }
    Start-Sleep -Seconds 1
}

# Check if whisper-server-package exists, create if not
if (-not (Test-Path "whisper-server-package")) {
    Write-Host "whisper-server-package directory not found."
    
    # Check if whisper-custom exists and has a public folder to copy
    if (Test-Path "whisper-custom\public") {
        Write-Host "Found whisper-custom\public folder. Creating whisper-server-package and copying public folder..."
        New-Item -ItemType Directory -Path "whisper-server-package" -Force | Out-Null
        
        # Copy public folder from whisper-custom
        Write-Host "Copying public folder from whisper-custom..."
        Copy-Item -Path "whisper-custom\public" -Destination "whisper-server-package\public" -Recurse -Force
        Write-Host "Public folder copied successfully."
    } else {
        Write-Host "Creating whisper-server-package directory..."
        New-Item -ItemType Directory -Path "whisper-server-package" -Force | Out-Null
        
        # Create public folder with basic index.html
        Write-Host "Creating public folder with default index.html..."
        New-Item -ItemType Directory -Path "whisper-server-package\public" -Force | Out-Null
        
        # Create a simple index.html file
        $indexContent = @"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Whisper Server</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
        }
        .container {
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            max-width: 600px;
        }
        h1 {
            font-size: 2.5em;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        }
        p {
            font-size: 1.2em;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        .status {
            display: inline-block;
            padding: 10px 20px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50px;
            font-weight: bold;
        }
        .status.running {
            background: rgba(72, 187, 120, 0.8);
        }
        .info {
            margin-top: 30px;
            padding: 20px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 10px;
        }
        .info h2 {
            font-size: 1.3em;
            margin-bottom: 15px;
        }
        .endpoint {
            background: rgba(255, 255, 255, 0.1);
            padding: 8px 15px;
            border-radius: 5px;
            margin: 5px 0;
            font-family: 'Courier New', monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎙️ Whisper Server</h1>
        <p>Speech-to-Text Service</p>
        <div class="status running">Server Running</div>
        
        <div class="info">
            <h2>API Endpoints</h2>
            <div class="endpoint">POST /inference - Transcribe audio</div>
            <div class="endpoint">GET /load - Load model</div>
            <div class="endpoint">GET /models - List available models</div>
        </div>
        
        <div class="info">
            <h2>Service Information</h2>
            <p style="margin: 10px 0;">This is the Whisper speech recognition server.<br>
            It provides real-time transcription services for audio files.</p>
        </div>
    </div>
</body>
</html>
"@
        Set-Content -Path "whisper-server-package\public\index.html" -Value $indexContent
        Write-Host "Default index.html created successfully."
    }
} else {
    # whisper-server-package exists, but check if it has a public folder
    if (-not (Test-Path "whisper-server-package\public")) {
        # Check if whisper-custom has a public folder to copy
        if (Test-Path "whisper-custom\public") {
            Write-Host "Copying public folder from whisper-custom to existing whisper-server-package..."
            Copy-Item -Path "whisper-custom\public" -Destination "whisper-server-package\public" -Recurse -Force
            Write-Host "Public folder copied successfully."
        } else {
            # Create default public folder
            Write-Host "Creating public folder with default index.html..."
            New-Item -ItemType Directory -Path "whisper-server-package\public" -Force | Out-Null
            
            # Create a simple index.html file
            $indexContent = @"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Whisper Server</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
        }
        .container {
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            max-width: 600px;
        }
        h1 {
            font-size: 2.5em;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        }
        p {
            font-size: 1.2em;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        .status {
            display: inline-block;
            padding: 10px 20px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50px;
            font-weight: bold;
        }
        .status.running {
            background: rgba(72, 187, 120, 0.8);
        }
        .info {
            margin-top: 30px;
            padding: 20px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 10px;
        }
        .info h2 {
            font-size: 1.3em;
            margin-bottom: 15px;
        }
        .endpoint {
            background: rgba(255, 255, 255, 0.1);
            padding: 8px 15px;
            border-radius: 5px;
            margin: 5px 0;
            font-family: 'Courier New', monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎙️ Whisper Server</h1>
        <p>Speech-to-Text Service</p>
        <div class="status running">Server Running</div>
        
        <div class="info">
            <h2>API Endpoints</h2>
            <div class="endpoint">POST /inference - Transcribe audio</div>
            <div class="endpoint">GET /load - Load model</div>
            <div class="endpoint">GET /models - List available models</div>
        </div>
        
        <div class="info">
            <h2>Service Information</h2>
            <p style="margin: 10px 0;">This is the Whisper speech recognition server.<br>
            It provides real-time transcription services for audio files.</p>
        </div>
    </div>
</body>
</html>
"@
            Set-Content -Path "whisper-server-package\public\index.html" -Value $indexContent
            Write-Host "Default index.html created successfully."
        }
    }
}

# Check if whisper-server.exe exists, download if not
if (-not (Test-Path "whisper-server-package\whisper-server.exe")) {
    Write-Host "whisper-server.exe not found. Fetching latest release..."
    
    try {
        # Fetch the latest release information from GitHub API
        Write-Host "Getting latest release information from GitHub..."
        $headers = @{}
        # Add User-Agent header to avoid API rate limiting
        $headers["User-Agent"] = "PowerShell-Script"
        
        $apiUrl = "https://api.github.com/repos/Zackriya-Solutions/meeting-minutes/releases/latest"
        $releaseInfo = Invoke-RestMethod -Uri $apiUrl -Headers $headers -UseBasicParsing
        
        $tagName = $releaseInfo.tag_name
        Write-Host "Latest release tag: $tagName"
        
        # Construct the download URL with the actual tag
        $downloadUrl = "https://github.com/Zackriya-Solutions/meeting-minutes/releases/download/$tagName/whisper-server.exe"
        $destinationPath = "whisper-server-package\whisper-server.exe"
        
        # Download the file
        Write-Host "Downloading whisper-server.exe from release $tagName..."
        Invoke-WebRequest -Uri $downloadUrl -OutFile $destinationPath -UseBasicParsing
        
        # Unblock the downloaded file (Windows security feature)
        Write-Host "Unblocking downloaded file..."
        Unblock-File -Path $destinationPath
        
        Write-Host "whisper-server.exe downloaded and unblocked successfully from release $tagName."
    } catch {
        Write-Host "Error: Failed to download whisper-server.exe"
        Write-Host "Error details: $_"
        
        # Try alternative method - look for any recent release
        Write-Host "Attempting alternative download method..."
        try {
            $allReleasesUrl = "https://api.github.com/repos/Zackriya-Solutions/meeting-minutes/releases"
            $headers = @{"User-Agent" = "PowerShell-Script"}
            $releases = Invoke-RestMethod -Uri $allReleasesUrl -Headers $headers -UseBasicParsing
            
            if ($releases.Count -gt 0) {
                $latestTag = $releases[0].tag_name
                Write-Host "Found release: $latestTag"
                $altDownloadUrl = "https://github.com/Zackriya-Solutions/meeting-minutes/releases/download/$latestTag/whisper-server.exe"
                
                Write-Host "Downloading from: $altDownloadUrl"
                Invoke-WebRequest -Uri $altDownloadUrl -OutFile "whisper-server-package\whisper-server.exe" -UseBasicParsing
                Unblock-File -Path "whisper-server-package\whisper-server.exe"
                Write-Host "whisper-server.exe downloaded successfully from release $latestTag."
            } else {
                throw "No releases found"
            }
        } catch {
            Write-Host "Alternative method also failed."
            Write-Host "Please download whisper-server.exe manually from:"
            Write-Host "https://github.com/Zackriya-Solutions/meeting-minutes/releases"
            Write-Host "And place it in: whisper-server-package\whisper-server.exe"
            exit 1
        }
    }
}

# Check if models directory exists
if (-not (Test-Path "whisper-server-package\models")) {
    Write-Host "Creating models directory..."
    New-Item -ItemType Directory -Path "whisper-server-package\models" -Force | Out-Null
}

# Define available models
$validModels = @(
    "tiny.en", "tiny", "base.en", "base", "small.en", "small", "medium.en", "medium", 
    "large-v1", "large-v2", "large-v3", "large-v3-turbo", 
    "tiny-q5_1", "tiny.en-q5_1", "tiny-q8_0", 
    "base-q5_1", "base.en-q5_1", "base-q8_0", 
    "small.en-tdrz", "small-q5_1", "small.en-q5_1", "small-q8_0", 
    "medium-q5_0", "medium.en-q5_0", "medium-q8_0", 
    "large-v2-q5_0", "large-v2-q8_0", "large-v3-q5_0", 
    "large-v3-turbo-q5_0", "large-v3-turbo-q8_0"
)

# Define available languages
$validLanguages = @(
    "en", "ar", "bg", "bn", "bs", "ca", "cs", "da", "de", "el", "es", "et", "fa", "fi", "fr", "he", "hi", "hr", "hu", "id", "it", "ja", "ko", "lt", "lv", "mk", "ml", "mr", "ms", "mt", "nl", "no", "pl", "pt", "ro", "ru", "sk", "sl", "so", "sq", "sr", "sv", "ta", "te", "th", "tr", "uk", "ur", "vi", "zh"
)

# Select language
if ($args.Count -gt 2) {
    $language = $args[2]
    if ($validLanguages -notcontains $language) {
        Write-Host "Invalid language: $language"
        Write-Host "Available languages: $($validLanguages -join ", ")"
        exit 1
    }
}

# Get available models
$availableModels = @()
if (Test-Path "whisper-server-package\models") {
    $modelFiles = Get-ChildItem "whisper-server-package\models" -Filter "ggml-*.bin" | ForEach-Object { $_.Name }
    foreach ($file in $modelFiles) {
        if ($file -match "ggml-(.*?)\.bin") {
            $availableModels += $matches[1]
        }
    }
}

# Display available models
Write-Host "====================================="
Write-Host "Model Selection"
Write-Host "====================================="
if ($availableModels.Count -gt 0) {
    Write-Host "Available models in models directory:"
    for ($i = 0; $i -lt $availableModels.Count; $i++) {
        Write-Host "  $($i+1). $($availableModels[$i])"
    }
} else {
    Write-Host "No models found in models directory."
}

Write-Host ""
Write-Host "Default model: small"
Write-Host "Default language: en"
$modelInput = Read-Host "Select a model (1-$($availableModels.Count)) or type model name or press Enter for default (small)"
$languageInput = Read-Host "Select a language (1-$($validLanguages.Count)) or type language name or press Enter for default (en)"

# Process the model selection
$modelName = "small"  # Default model
if (-not [string]::IsNullOrWhiteSpace($modelInput)) {
    if ([int]::TryParse($modelInput, [ref]$null)) {
        $index = [int]$modelInput - 1
        if ($index -ge 0 -and $index -lt $availableModels.Count) {
            $modelName = $availableModels[$index]
        } else {
            Write-Host "Invalid selection. Using default model (small)."
        }
    } else {
        # Check if the input is a valid model name
        if ($validModels -contains $modelInput) {
            $modelName = $modelInput
        } else {
            Write-Host "Invalid model name. Using default model (small)."
        }
    }
}

# Process the language selection
$languageName = "en"  # Default language
if (-not [string]::IsNullOrWhiteSpace($languageInput)) {
    if ([int]::TryParse($languageInput, [ref]$null)) {
        $index = [int]$languageInput - 1
        if ($index -ge 0 -and $index -lt $validLanguages.Count) {
            $languageName = $validLanguages[$index]
        } else {
            Write-Host "Invalid selection. Using default language (en)."
        }
    } else {
        # Check if the input is a valid language name
        if ($validLanguages -contains $languageInput) {
            $languageName = $languageInput
        } else {
            Write-Host "Invalid language name. Using default language (en)."
        }
    }
}

Write-Host "Selected language: $languageName"

# Get port number from user
$portInput = Read-Host "Enter Whisper server port number (default: 8178)"
$portWhisper = 8178
if (-not [string]::IsNullOrWhiteSpace($portInput)) {
    if ([int]::TryParse($portInput, [ref]$null)) {
        $portWhisper = [int]$portInput
    } else {
        Write-Host "Invalid port number. Using default port (8178)."
    }
}

Write-Host "Selected port: $portWhisper"

# Check if the model file exists
$modelFile = "whisper-server-package\models\ggml-$modelName.bin"
if (-not (Test-Path $modelFile)) {
    Write-Host "Model file not found: $modelFile"
    Write-Host "Attempting to download model $modelName..."
    
    # Change to backend directory to run download script
    Push-Location $PSScriptRoot
    
    # Download the model using download-ggml-model.cmd
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c download-ggml-model.cmd $modelName" -NoNewWindow -Wait -PassThru
    
    if ($process.ExitCode -eq 0) {
        Write-Host "Model download completed. Checking for downloaded file..."
        
        # Check multiple possible locations for the downloaded model
        $possibleLocations = @(
            "whisper.cpp\models\ggml-$modelName.bin",
            "models\ggml-$modelName.bin",
            "whisper-server-package\models\ggml-$modelName.bin"
        )
        
        $modelFound = $false
        foreach ($location in $possibleLocations) {
            if (Test-Path $location) {
                Write-Host "Found model at: $location"
                
                # Ensure target directory exists
                if (-not (Test-Path "whisper-server-package\models")) {
                    New-Item -ItemType Directory -Path "whisper-server-package\models" -Force | Out-Null
                }
                
                # Copy to target location if not already there
                if ($location -ne "whisper-server-package\models\ggml-$modelName.bin") {
                    Copy-Item $location "whisper-server-package\models\ggml-$modelName.bin" -Force
                    Write-Host "Model copied to whisper-server-package\models directory."
                }
                $modelFound = $true
                break
            }
        }
        
        if (-not $modelFound) {
            Write-Host "Warning: Model download succeeded but file not found in expected locations."
            Write-Host "Falling back to small model..."
            $modelName = "small"
        }
    } else {
        Write-Host "Failed to download model $modelName. Falling back to small model..."
        $modelName = "small"
    }
    
    # If we're falling back to small model, ensure it exists
    if ($modelName -eq "small" -and -not (Test-Path "whisper-server-package\models\ggml-small.bin")) {
        Write-Host "Downloading fallback small model..."
        $smallProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c download-ggml-model.cmd small" -NoNewWindow -Wait -PassThru
        
        if ($smallProcess.ExitCode -eq 0) {
            # Check for downloaded small model in possible locations
            $smallLocations = @(
                "whisper.cpp\models\ggml-small.bin",
                "models\ggml-small.bin"
            )
            
            foreach ($location in $smallLocations) {
                if (Test-Path $location) {
                    Copy-Item $location "whisper-server-package\models\ggml-small.bin" -Force
                    Write-Host "Small model downloaded and copied successfully."
                    break
                }
            }
        } else {
            Write-Host "Error: Failed to download fallback small model."
            Write-Host "Please download the model manually and place it in whisper-server-package\models\"
            Pop-Location
            exit 1
        }
    }
    
    Pop-Location
}

Write-Host "====================================="
Write-Host "Starting Meetily Backend"
Write-Host "====================================="
Write-Host "Model: $modelName"
Write-Host "Python Backend Port: $portPython"
Write-Host "Whisper Server Port: $portWhisper"
Write-Host "Language: $languageName"
Write-Host "====================================="
Write-Host ""

# Change to script directory to ensure we're in the right location
Push-Location $PSScriptRoot

# Check if virtual environment exists, create if not found
if (-not (Test-Path "venv")) {
    Write-Host "Virtual environment not found in: $PSScriptRoot"
    Write-Host "Creating new virtual environment..."
    
    # Create virtual environment
    $createVenvProcess = Start-Process -FilePath "python" -ArgumentList "-m venv venv" -NoNewWindow -Wait -PassThru
    if ($createVenvProcess.ExitCode -ne 0) {
        Write-Host "Error: Failed to create virtual environment"
        Write-Host "Please ensure Python is installed and accessible from PATH"
        exit 1
    }
    
    Write-Host "Virtual environment created successfully."
    
    # Upgrade pip first
    Write-Host "Upgrading pip..."
    $upgradePipProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c venv\Scripts\python.exe -m pip install --upgrade pip" -NoNewWindow -Wait -PassThru
    if ($upgradePipProcess.ExitCode -ne 0) {
        Write-Host "Warning: Failed to upgrade pip, continuing with existing version"
    }
    
    Write-Host "Installing dependencies from requirements.txt..."
    
    # Check if requirements.txt exists
    $requirementsPath = Join-Path $PSScriptRoot "requirements.txt"
    if (Test-Path $requirementsPath) {
        # Install dependencies using the venv's python directly
        Write-Host "Installing packages from: $requirementsPath"
        Write-Host "Installing packages: fastapi, uvicorn, and other dependencies..."
        $installDepsProcess = Start-Process -FilePath "venv\Scripts\python.exe" -ArgumentList "-m pip install -r `"$requirementsPath`"" -NoNewWindow -Wait -PassThru
        if ($installDepsProcess.ExitCode -ne 0) {
            Write-Host "Warning: Failed to install some dependencies from requirements.txt"
            Write-Host "Attempting to install core dependencies individually..."
            
            # Try installing core dependencies one by one
            $coreDeps = @("fastapi", "uvicorn", "python-multipart", "pydantic", "python-dotenv")
            foreach ($dep in $coreDeps) {
                Write-Host "Installing $dep..."
                Start-Process -FilePath "venv\Scripts\python.exe" -ArgumentList "-m pip install $dep" -NoNewWindow -Wait
            }
        } else {
            Write-Host "Dependencies installed successfully."
        }
    } else {
        Write-Host "Warning: requirements.txt not found. Installing core dependencies..."
        # Install minimal required dependencies
        $coreDeps = @("fastapi", "uvicorn[standard]", "python-multipart", "pydantic", "python-dotenv")
        foreach ($dep in $coreDeps) {
            Write-Host "Installing $dep..."
            Start-Process -FilePath "venv\Scripts\python.exe" -ArgumentList "-m pip install $dep" -NoNewWindow -Wait
        }
    }
    
    # Verify FastAPI installation
    Write-Host "Verifying FastAPI installation..."
    $verifyProcess = Start-Process -FilePath "venv\Scripts\python.exe" -ArgumentList "-c `"import fastapi; print('FastAPI installed successfully')`"" -NoNewWindow -Wait -PassThru
    if ($verifyProcess.ExitCode -ne 0) {
        Write-Host "Error: FastAPI installation verification failed"
        Write-Host "Please manually install dependencies using: venv\Scripts\pip.exe install -r requirements.txt"
        exit 1
    }
}

# Check if Python app exists
if (-not (Test-Path "app\main.py")) {
    Write-Host "Error: app\main.py not found"
    Write-Host "Please ensure app\main.py exists in: $PSScriptRoot\app"
    Pop-Location
    exit 1
}

# Restore original directory
Pop-Location

# Start Whisper server in a new window
Write-Host "Starting Whisper server..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/k cd whisper-server-package && whisper-server.exe --model models\ggml-$modelName.bin --host 127.0.0.1 --port $portWhisper --diarize --print-progress --language $languageName" -WindowStyle Normal

# Wait for Whisper server to start
Write-Host "Waiting for Whisper server to start..."
Start-Sleep -Seconds 5

# Check if Whisper server is running
$whisperRunning = $false
try {
    $whisperProcesses = Get-Process -Name "whisper-server" -ErrorAction Stop
    $whisperRunning = $true
    Write-Host "Whisper server started with PID: $($whisperProcesses.Id)"
} catch {
    Write-Host "Error: Whisper server failed to start"
    exit 1
}

# Start Python backend in a new window
Write-Host "Starting Python backend..."
Write-Host "Using virtual environment at: $PSScriptRoot\venv"
Write-Host "Starting with PORT=$portPython"

# Create a batch command that changes to the correct directory first
$pythonCommand = "/k cd /d `"$PSScriptRoot`" && call venv\Scripts\activate.bat && set PORT=$portPython && echo Activated virtual environment && python --version && python app\main.py"
Start-Process -FilePath "cmd.exe" -ArgumentList $pythonCommand -WindowStyle Normal

# Wait for Python backend to start
Write-Host "Waiting for Python backend to start..."
Start-Sleep -Seconds 5

# Check if Python backend is running
$pythonRunning = $false
try {
    $pythonProcesses = Get-Process -Name "python" -ErrorAction Stop
    $pythonRunning = $true
    Write-Host "Python backend started with PID: $($pythonProcesses.Id)"
} catch {
    Write-Host "Error: Python backend failed to start"
    exit 1
}

# Check if services are listening on their ports
Write-Host "Checking if services are listening on their ports..."
$whisperListening = $false
$pythonListening = $false

# Wait a bit longer for services to start listening
Start-Sleep -Seconds 5

# Check Whisper server port
$netstatWhisper = netstat -ano | Select-String -Pattern ":$portWhisper.*LISTENING"
if ($netstatWhisper) {
    $whisperListening = $true
    Write-Host "Whisper server is listening on port $portWhisper"
} else {
    Write-Host "Warning: Whisper server is not listening on port $portWhisper"
}

# Check Python backend port
$netstatPython = netstat -ano | Select-String -Pattern ":$portPython.*LISTENING"
if ($netstatPython) {
    $pythonListening = $true
    Write-Host "Python backend is listening on port $portPython"
} else {
    Write-Host "Warning: Python backend is not listening on port $portPython"
}

# Final status
Write-Host ""
Write-Host "====================================="
Write-Host "Backend Status"
Write-Host "====================================="
Write-Host "Whisper Server: $(if ($whisperRunning) { "RUNNING" } else { "NOT RUNNING" })"
Write-Host "Whisper Server Port: $(if ($whisperListening) { "LISTENING on $portWhisper" } else { "NOT LISTENING on $portWhisper" })"
Write-Host "Python Backend: $(if ($pythonRunning) { "RUNNING" } else { "NOT RUNNING" })"
Write-Host "Python Backend Port: $(if ($pythonListening) { "LISTENING on $portPython" } else { "NOT LISTENING on $portPython" })"
Write-Host ""
Write-Host "The backend services are now running in separate windows."
Write-Host "You can close those windows to stop the services."
Write-Host "====================================="

# Check for frontend installation
Write-Host ""
Write-Host "====================================="
Write-Host "Frontend Application Check"
Write-Host "====================================="

# Check if meetily-frontend is installed
$frontendInstalled = $false
$frontendPath = $null

# Check common installation paths for meetily-frontend
$possiblePaths = @(
    "$env:LOCALAPPDATA\Programs\meetily-frontend\meetily-frontend.exe",
    "$env:LOCALAPPDATA\Programs\meetily\meetily-frontend.exe",
    "$env:ProgramFiles\meetily-frontend\meetily-frontend.exe",
    "${env:ProgramFiles(x86)}\meetily-frontend\meetily-frontend.exe",
    "$env:APPDATA\meetily-frontend\meetily-frontend.exe"
)

foreach ($path in $possiblePaths) {
    if (Test-Path $path) {
        $frontendInstalled = $true
        $frontendPath = $path
        break
    }
}

# Also check if meetily is in the registry (properly installed)
try {
    $regPath = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue | 
               Where-Object { $_.DisplayName -like "*meetily*" }
    if (-not $regPath) {
        $regPath = Get-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue | 
                   Where-Object { $_.DisplayName -like "*meetily*" }
    }
    if ($regPath) {
        $frontendInstalled = $true
        if (-not $frontendPath -and $regPath.InstallLocation) {
            # Clean up the install location path (remove quotes if present)
            $installLocation = $regPath.InstallLocation -replace '^"(.+)"$', '$1'
            
            # Try to find the executable in the install location
            $possibleExeNames = @("meetily-frontend.exe", "meetily.exe")
            foreach ($exeName in $possibleExeNames) {
                $testPath = Join-Path $installLocation $exeName
                if (Test-Path $testPath) {
                    $frontendPath = $testPath
                    break
                }
            }
        }
    }
} catch {
    # Registry check failed, continue with file system check
}

if ($frontendInstalled) {
    Write-Host "Meetily frontend application is installed."
    if ($frontendPath) {
        Write-Host "Location: $frontendPath"
        
        # Ask if user wants to launch the frontend
        $launchFrontend = Read-Host "Do you want to launch the Meetily frontend application? (Y/N)"
        if ($launchFrontend -eq 'Y' -or $launchFrontend -eq 'y') {
            Write-Host "Launching Meetily frontend..."
            Start-Process -FilePath $frontendPath
            Write-Host "Meetily frontend launched successfully."
        }
    }
} else {
    Write-Host "Meetily frontend application is not installed."
    Write-Host ""
    $installFrontend = Read-Host "Would you like to download and install the Meetily frontend application? (Y/N)"
    
    if ($installFrontend -eq 'Y' -or $installFrontend -eq 'y') {
        Write-Host "Fetching latest release information..."
        
        try {
            # Fetch the latest release information
            $headers = @{"User-Agent" = "PowerShell-Script"}
            $apiUrl = "https://api.github.com/repos/Zackriya-Solutions/meeting-minutes/releases/latest"
            $releaseInfo = Invoke-RestMethod -Uri $apiUrl -Headers $headers -UseBasicParsing
            
            # Find the setup.exe asset - looking for files ending with _x64-setup.exe or similar
            $setupAsset = $releaseInfo.assets | Where-Object { 
                $_.name -like "*setup.exe" -or 
                $_.name -like "*Setup.exe" -or 
                $_.name -like "*_x64-setup.exe" -or
                $_.name -like "*_x64_en-US.msi"
            }
            
            if ($setupAsset) {
                $downloadUrl = $setupAsset.browser_download_url
                $setupFileName = $setupAsset.name
                $tempPath = Join-Path $env:TEMP $setupFileName
                
                Write-Host "Found frontend installer: $setupFileName"
                Write-Host "Downloading from: $downloadUrl"
                Write-Host "This may take a few minutes..."
                
                # Download the installer with progress
                $ProgressPreference = 'SilentlyContinue'
                Invoke-WebRequest -Uri $downloadUrl -OutFile $tempPath -UseBasicParsing
                $ProgressPreference = 'Continue'
                
                # Unblock the downloaded file
                Unblock-File -Path $tempPath
                
                Write-Host "Download completed. Starting installation..."
                Write-Host ""
                Write-Host "IMPORTANT: The installer may require administrator privileges."
                Write-Host "Please follow the installation prompts in the installer window."
                Write-Host ""
                
                # Start the installer
                # The installer will handle UAC elevation if needed
                if ($setupFileName -like "*.msi") {
                    # For MSI files, use msiexec
                    $installerProcess = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$tempPath`"" -PassThru -Wait
                } else {
                    # For EXE files
                    $installerProcess = Start-Process -FilePath $tempPath -PassThru -Wait
                }
                
                if ($installerProcess.ExitCode -eq 0) {
                    Write-Host "Installation completed successfully!"
                    
                    # Check if meetily is now installed and launch it
                    Start-Sleep -Seconds 2  # Give the system a moment to register the installation
                    foreach ($path in $possiblePaths) {
                        if (Test-Path $path) {
                            Write-Host "Launching Meetily frontend..."
                            Start-Process -FilePath $path
                            break
                        }
                    }
                } elseif ($installerProcess.ExitCode -eq 1602) {
                    Write-Host "Installation was cancelled by the user."
                } else {
                    Write-Host "Installation completed with exit code: $($installerProcess.ExitCode)"
                }
                
                # Clean up temp file
                if (Test-Path $tempPath) {
                    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
                }
                
            } else {
                Write-Host "Could not find frontend installer in the latest release."
                Write-Host "Available assets in the release:"
                foreach ($asset in $releaseInfo.assets) {
                    Write-Host "  - $($asset.name)"
                }
                Write-Host ""
                Write-Host "Please download the installer manually from:"
                Write-Host "https://github.com/Zackriya-Solutions/meeting-minutes/releases"
            }
            
        } catch {
            Write-Host "Error downloading or installing frontend: $_"
            
            # Try alternative method - look for any recent release
            try {
                Write-Host "Attempting alternative download method..."
                $allReleasesUrl = "https://api.github.com/repos/Zackriya-Solutions/meeting-minutes/releases"
                $releases = Invoke-RestMethod -Uri $allReleasesUrl -Headers @{"User-Agent" = "PowerShell-Script"} -UseBasicParsing
                
                if ($releases.Count -gt 0) {
                    foreach ($release in $releases) {
                        $setupAsset = $release.assets | Where-Object { 
                            $_.name -like "*setup.exe" -or 
                            $_.name -like "*Setup.exe" -or 
                            $_.name -like "*_x64-setup.exe" -or
                            $_.name -like "*_x64_en-US.msi"
                        }
                        if ($setupAsset) {
                            $downloadUrl = $setupAsset.browser_download_url
                            $setupFileName = $setupAsset.name
                            $tempPath = Join-Path $env:TEMP $setupFileName
                            
                            Write-Host "Found frontend installer in release $($release.tag_name): $setupFileName"
                            Write-Host "Downloading..."
                            
                            $ProgressPreference = 'SilentlyContinue'
                            Invoke-WebRequest -Uri $downloadUrl -OutFile $tempPath -UseBasicParsing
                            $ProgressPreference = 'Continue'
                            Unblock-File -Path $tempPath
                            
                            Write-Host "Starting installation..."
                            if ($setupFileName -like "*.msi") {
                                $installerProcess = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$tempPath`"" -PassThru -Wait
                            } else {
                                $installerProcess = Start-Process -FilePath $tempPath -PassThru -Wait
                            }
                            
                            if ($installerProcess.ExitCode -eq 0) {
                                Write-Host "Installation completed successfully!"
                            }
                            
                            # Clean up
                            if (Test-Path $tempPath) {
                                Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
                            }
                            break
                        }
                    }
                    
                    if (-not $setupAsset) {
                        Write-Host "No installer found in any recent releases."
                        Write-Host "Please download the frontend installer manually from:"
                        Write-Host "https://github.com/Zackriya-Solutions/meeting-minutes/releases"
                    }
                }
            } catch {
                Write-Host "Alternative method also failed."
                Write-Host "Please download the frontend installer manually from:"
                Write-Host "https://github.com/Zackriya-Solutions/meeting-minutes/releases"
            }
        }
    }
}

Write-Host ""
Write-Host "====================================="
Write-Host "Setup Complete"
Write-Host "====================================="



================================================
FILE: backend/temp.env
================================================
ANTHROPIC_API_KEY=api_key_here
GROQ_API_KEY=gapi_key_here
OPENAI_API_KEY=api_key_here


================================================
FILE: backend/app/db.py
================================================
import aiosqlite
import json
import os
from datetime import datetime
from typing import Optional, Dict
import logging
from contextlib import asynccontextmanager
import sqlite3
try:
    from .schema_validator import SchemaValidator
except ImportError:
    # Handle case when running as script directly
    import sys
    import os
    sys.path.append(os.path.dirname(__file__))
    from schema_validator import SchemaValidator

logger = logging.getLogger(__name__)

class DatabaseManager:
    def __init__(self, db_path: str = None):
        if db_path is None:
            db_path = os.getenv('DATABASE_PATH', 'meeting_minutes.db')
        self.db_path = db_path
        self.schema_validator = SchemaValidator(self.db_path)
        self._init_db()

    def _init_db(self):
        """Initialize the database with legacy approach"""
        try:
            # Run legacy initialization (handles all table creation)
            logger.info("Initializing database tables...")
            self._legacy_init_db()
            
            # Validate schema integrity
            logger.info("Validating schema integrity...")
            self.schema_validator.validate_schema()
            
        except Exception as e:
            logger.error(f"Database initialization failed: {str(e)}")
            raise



    def _legacy_init_db(self):
        """Legacy database initialization (for backward compatibility)"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Create meetings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meetings (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    folder_path TEXT
                )
            """)

            # Migration: Add folder_path column to existing meetings table
            try:
                cursor.execute("ALTER TABLE meetings ADD COLUMN folder_path TEXT")
                logger.info("Added folder_path column to meetings table")
            except sqlite3.OperationalError:
                pass  # Column already exists
            
            # Create transcripts table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS transcripts (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    transcript TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    summary TEXT,
                    action_items TEXT,
                    key_points TEXT,
                    audio_start_time REAL,
                    audio_end_time REAL,
                    duration REAL,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
                )
            """)

            # Add new columns to existing transcripts table (migration for old databases)
            try:
                cursor.execute("ALTER TABLE transcripts ADD COLUMN audio_start_time REAL")
            except sqlite3.OperationalError:
                pass  # Column already exists
            try:
                cursor.execute("ALTER TABLE transcripts ADD COLUMN audio_end_time REAL")
            except sqlite3.OperationalError:
                pass  # Column already exists
            try:
                cursor.execute("ALTER TABLE transcripts ADD COLUMN duration REAL")
            except sqlite3.OperationalError:
                pass  # Column already exists
            
            # Create summary_processes table (keeping existing functionality)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS summary_processes (
                    meeting_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    error TEXT,
                    result TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    chunk_count INTEGER DEFAULT 0,
                    processing_time REAL DEFAULT 0.0,
                    metadata TEXT,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS transcript_chunks (
                    meeting_id TEXT PRIMARY KEY,
                    meeting_name TEXT,
                    transcript_text TEXT NOT NULL,
                    model TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    chunk_size INTEGER,
                    overlap INTEGER,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
                )
            """)

            # Create settings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    whisperModel TEXT NOT NULL,
                    groqApiKey TEXT,
                    openaiApiKey TEXT,
                    anthropicApiKey TEXT,
                    ollamaApiKey TEXT
                )
            """)

            # Create transcript_settings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS transcript_settings (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    whisperApiKey TEXT,
                    deepgramApiKey TEXT,
                    elevenLabsApiKey TEXT,
                    groqApiKey TEXT,
                    openaiApiKey TEXT
                )
            """)

            conn.commit()

    @asynccontextmanager
    async def _get_connection(self):
        """Get a new database connection"""
        conn = await aiosqlite.connect(self.db_path)
        try:
            yield conn
        finally:
            await conn.close()

    async def create_process(self, meeting_id: str) -> str:
        """Create a new process entry or update existing one and return its ID"""
        now = datetime.utcnow().isoformat()
        
        try:
            async with self._get_connection() as conn:
                # Begin transaction
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # First try to update existing process
                    await conn.execute(
                        """
                        UPDATE summary_processes 
                        SET status = ?, updated_at = ?, start_time = ?, error = NULL, result = NULL
                        WHERE meeting_id = ?
                        """,
                        ("PENDING", now, now, meeting_id)
                    )
                    
                    # If no rows were updated, insert a new one
                    if conn.total_changes == 0:
                        await conn.execute(
                            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, start_time) VALUES (?, ?, ?, ?, ?)",
                            (meeting_id, "PENDING", now, now, now)
                        )
                    
                    await conn.commit()
                    logger.info(f"Successfully created/updated process for meeting_id: {meeting_id}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to create process for meeting_id {meeting_id}: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in create_process: {str(e)}", exc_info=True)
            raise
        
        return meeting_id

    async def update_process(self, meeting_id: str, status: str, result: Optional[Dict] = None, error: Optional[str] = None, 
                           chunk_count: Optional[int] = None, processing_time: Optional[float] = None, 
                           metadata: Optional[Dict] = None):
        """Update a process status and result"""
        now = datetime.utcnow().isoformat()
        
        try:
            async with self._get_connection() as conn:
                # Begin transaction
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    update_fields = ["status = ?", "updated_at = ?"]
                    params = [status, now]
                    
                    if result:
                        # Validate result can be JSON serialized
                        try:
                            result_json = json.dumps(result)
                            update_fields.append("result = ?")
                            params.append(result_json)
                        except (TypeError, ValueError) as e:
                            logger.error(f"Failed to serialize result for meeting_id {meeting_id}: {str(e)}")
                            raise ValueError("Result data cannot be JSON serialized")
                            
                    if error:
                        # Sanitize error message to prevent log injection
                        sanitized_error = str(error).replace('\n', ' ').replace('\r', '')[:1000]
                        update_fields.append("error = ?")
                        params.append(sanitized_error)
                        
                    if chunk_count is not None:
                        update_fields.append("chunk_count = ?")
                        params.append(chunk_count)
                        
                    if processing_time is not None:
                        update_fields.append("processing_time = ?")
                        params.append(processing_time)
                        
                    if metadata:
                        # Validate metadata can be JSON serialized
                        try:
                            metadata_json = json.dumps(metadata)
                            update_fields.append("metadata = ?")
                            params.append(metadata_json)
                        except (TypeError, ValueError) as e:
                            logger.error(f"Failed to serialize metadata for meeting_id {meeting_id}: {str(e)}")
                            # Don't fail the whole operation for metadata serialization issues
                            
                    if status.upper() in ['COMPLETED', 'FAILED']:
                        update_fields.append("end_time = ?")
                        params.append(now)
                        
                    params.append(meeting_id)
                    query = f"UPDATE summary_processes SET {', '.join(update_fields)} WHERE meeting_id = ?"
                    
                    cursor = await conn.execute(query, params)
                    if cursor.rowcount == 0:
                        logger.warning(f"No process found to update for meeting_id: {meeting_id}")
                        
                    await conn.commit()
                    logger.debug(f"Successfully updated process status to {status} for meeting_id: {meeting_id}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to update process for meeting_id {meeting_id}: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in update_process: {str(e)}", exc_info=True)
            raise

    async def save_transcript(self, meeting_id: str, transcript_text: str, model: str, model_name: str, 
                            chunk_size: int, overlap: int):
        """Save transcript data"""
        # Input validation
        if not meeting_id or not meeting_id.strip():
            raise ValueError("meeting_id cannot be empty")
        if not transcript_text or not transcript_text.strip():
            raise ValueError("transcript_text cannot be empty")
        if chunk_size <= 0 or overlap < 0:
            raise ValueError("Invalid chunk_size or overlap values")
        if len(transcript_text) > 10_000_000:  # 10MB limit
            raise ValueError("Transcript text too large (>10MB)")
            
        now = datetime.utcnow().isoformat()
        
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # First try to update existing transcript
                    await conn.execute("""
                        UPDATE transcript_chunks 
                        SET transcript_text = ?, model = ?, model_name = ?, chunk_size = ?, overlap = ?, created_at = ?
                        WHERE meeting_id = ?
                    """, (transcript_text, model, model_name, chunk_size, overlap, now, meeting_id))
                    
                    # If no rows were updated, insert a new one
                    if conn.total_changes == 0:
                        await conn.execute("""
                            INSERT INTO transcript_chunks (meeting_id, transcript_text, model, model_name, chunk_size, overlap, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (meeting_id, transcript_text, model, model_name, chunk_size, overlap, now))
                    
                    await conn.commit()
                    logger.info(f"Successfully saved transcript for meeting_id: {meeting_id} (size: {len(transcript_text)} chars)")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save transcript for meeting_id {meeting_id}: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in save_transcript: {str(e)}", exc_info=True)
            raise

    async def update_meeting_name(self, meeting_id: str, meeting_name: str):
        """Update meeting name in both meetings and transcript_chunks tables"""
        now = datetime.utcnow().isoformat()
        async with self._get_connection() as conn:
            # Update meetings table
            await conn.execute("""
                UPDATE meetings
                SET title = ?, updated_at = ?
                WHERE id = ?
            """, (meeting_name, now, meeting_id))
            
            # Update transcript_chunks table
            await conn.execute("""
                UPDATE transcript_chunks
                SET meeting_name = ?
                WHERE meeting_id = ?
            """, (meeting_name, meeting_id))
            
            await conn.commit()

    async def get_transcript_data(self, meeting_id: str):
        """Get transcript data for a meeting"""
        async with self._get_connection() as conn:
            async with conn.execute("""
                SELECT t.*, p.status, p.result, p.error 
                FROM transcript_chunks t 
                JOIN summary_processes p ON t.meeting_id = p.meeting_id 
                WHERE t.meeting_id = ?
            """, (meeting_id,)) as cursor:
                row = await cursor.fetchone()
                if row:
                    return dict(zip([col[0] for col in cursor.description], row))
                return None

    async def save_meeting(self, meeting_id: str, title: str, folder_path: str = None):
        """Save or update a meeting"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                # Check if meeting exists
                cursor.execute("SELECT id FROM meetings WHERE id = ? OR title = ?", (meeting_id, title))
                existing_meeting = cursor.fetchone()

                if not existing_meeting:
                    # Create new meeting with local timestamp and folder path
                    cursor.execute("""
                        INSERT INTO meetings (id, title, created_at, updated_at, folder_path)
                        VALUES (?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'), ?)
                    """, (meeting_id, title, folder_path))
                    logger.info(f"Saved meeting {meeting_id} with folder_path: {folder_path}")
                else:
                    # If we get here and meeting exists, throw error since we don't want duplicates
                    raise Exception(f"Meeting with ID {meeting_id} already exists")
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error saving meeting: {str(e)}")
            raise

    async def save_meeting_transcript(self, meeting_id: str, transcript: str, timestamp: str,
                                     summary: str = "", action_items: str = "", key_points: str = "",
                                     audio_start_time: float = None, audio_end_time: float = None, duration: float = None):
        """Save a transcript for a meeting with optional recording-relative timestamps"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                # Save transcript with NEW timestamp fields for playback sync
                cursor.execute("""
                    INSERT INTO transcripts (
                        meeting_id, transcript, timestamp, summary, action_items, key_points,
                        audio_start_time, audio_end_time, duration
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (meeting_id, transcript, timestamp, summary, action_items, key_points,
                      audio_start_time, audio_end_time, duration))

                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error saving transcript: {str(e)}")
            raise

    async def get_meeting(self, meeting_id: str):
        """Get a meeting by ID with all its transcripts"""
        try:
            async with self._get_connection() as conn:
                # Get meeting details
                cursor = await conn.execute("""
                    SELECT id, title, created_at, updated_at
                    FROM meetings
                    WHERE id = ?
                """, (meeting_id,))
                meeting = await cursor.fetchone()
                
                if not meeting:
                    return None
                
                # Get all transcripts for this meeting with NEW timestamp fields
                cursor = await conn.execute("""
                    SELECT transcript, timestamp, audio_start_time, audio_end_time, duration
                    FROM transcripts
                    WHERE meeting_id = ?
                """, (meeting_id,))
                transcripts = await cursor.fetchall()

                return {
                    'id': meeting[0],
                    'title': meeting[1],
                    'created_at': meeting[2],
                    'updated_at': meeting[3],
                    'transcripts': [{
                        'id': meeting_id,
                        'text': transcript[0],
                        'timestamp': transcript[1],
                        # NEW: Recording-relative timestamps for playback sync
                        'audio_start_time': transcript[2],
                        'audio_end_time': transcript[3],
                        'duration': transcript[4]
                    } for transcript in transcripts]
                }
        except Exception as e:
            logger.error(f"Error getting meeting: {str(e)}")
            raise

    async def update_meeting_title(self, meeting_id: str, new_title: str):
        """Update a meeting's title"""
        now = datetime.utcnow().isoformat()
        async with self._get_connection() as conn:
            await conn.execute("""
                UPDATE meetings
                SET title = ?, updated_at = ?
                WHERE id = ?
            """, (new_title, now, meeting_id))
            await conn.commit()

    async def get_all_meetings(self):
        """Get all meetings with basic information"""
        async with self._get_connection() as conn:
            cursor = await conn.execute("""
                SELECT id, title, created_at
                FROM meetings
                ORDER BY created_at DESC
            """)
            rows = await cursor.fetchall()
            return [{
                'id': row[0],
                'title': row[1],
                'created_at': row[2]
            } for row in rows]

    async def delete_meeting(self, meeting_id: str):
        """Delete a meeting and all its associated data"""
        if not meeting_id or not meeting_id.strip():
            raise ValueError("meeting_id cannot be empty")
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # Check if meeting exists before deletion
                    cursor = await conn.execute("SELECT id FROM meetings WHERE id = ?", (meeting_id,))
                    meeting = await cursor.fetchone()
                    
                    if not meeting:
                        logger.warning(f"Meeting {meeting_id} not found for deletion")
                        await conn.rollback()
                        return False
                    
                    # Delete in proper order to respect foreign key constraints
                    # Delete from transcript_chunks
                    await conn.execute("DELETE FROM transcript_chunks WHERE meeting_id = ?", (meeting_id,))
                    
                    # Delete from summary_processes
                    await conn.execute("DELETE FROM summary_processes WHERE meeting_id = ?", (meeting_id,))
                    
                    # Delete from transcripts
                    await conn.execute("DELETE FROM transcripts WHERE meeting_id = ?", (meeting_id,))
                    
                    # Delete from meetings
                    cursor = await conn.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
                    
                    if cursor.rowcount == 0:
                        logger.error(f"Failed to delete meeting {meeting_id} - no rows affected")
                        await conn.rollback()
                        return False
                    
                    await conn.commit()
                    logger.info(f"Successfully deleted meeting {meeting_id} and all associated data")
                    return True
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to delete meeting {meeting_id}: {str(e)}", exc_info=True)
                    return False
                    
        except Exception as e:
            logger.error(f"Database connection error in delete_meeting: {str(e)}", exc_info=True)
            return False

    async def get_model_config(self):
        """Get the current model configuration"""
        async with self._get_connection() as conn:
            cursor = await conn.execute("SELECT provider, model, whisperModel FROM settings")
            row = await cursor.fetchone()
            return dict(zip([col[0] for col in cursor.description], row)) if row else None

    async def save_model_config(self, provider: str, model: str, whisperModel: str):
        """Save the model configuration"""
        # Input validation
        if not provider or not provider.strip():
            raise ValueError("Provider cannot be empty")
        if not model or not model.strip():
            raise ValueError("Model cannot be empty")
        if not whisperModel or not whisperModel.strip():
            raise ValueError("Whisper model cannot be empty")
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # Check if the configuration already exists
                    cursor = await conn.execute("SELECT id FROM settings")
                    existing_config = await cursor.fetchone()
                    if existing_config:
                        # Update existing configuration
                        await conn.execute("""
                            UPDATE settings 
                            SET provider = ?, model = ?, whisperModel = ?
                            WHERE id = '1'    
                        """, (provider, model, whisperModel))
                    else:
                        # Insert new configuration
                        await conn.execute("""
                            INSERT INTO settings (id, provider, model, whisperModel)
                            VALUES (?, ?, ?, ?)
                        """, ('1', provider, model, whisperModel))
                    
                    await conn.commit()
                    logger.info(f"Successfully saved model configuration: {provider}/{model}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save model configuration: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in save_model_config: {str(e)}", exc_info=True)
            raise


    async def save_api_key(self, api_key: str, provider: str):
        """Save the API key"""
        provider_list = ["openai", "claude", "groq", "ollama"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "openai":
            api_key_name = "openaiApiKey"
        elif provider == "claude":
            api_key_name = "anthropicApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "ollama":
            api_key_name = "ollamaApiKey"
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # Check if settings row exists
                    cursor = await conn.execute("SELECT id FROM settings WHERE id = '1'")
                    existing_config = await cursor.fetchone()
                    
                    if existing_config:
                        # Update existing configuration
                        await conn.execute(f"UPDATE settings SET {api_key_name} = ? WHERE id = '1'", (api_key,))
                    else:
                        # Insert new configuration with default values and the API key
                        await conn.execute(f"""
                            INSERT INTO settings (id, provider, model, whisperModel, {api_key_name})
                            VALUES (?, ?, ?, ?, ?)
                        """, ('1', 'openai', 'gpt-4o-2024-11-20', 'large-v3', api_key))
                        
                    await conn.commit()
                    logger.info(f"Successfully saved API key for provider: {provider}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save API key for provider {provider}: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in save_api_key: {str(e)}", exc_info=True)
            raise

    async def get_api_key(self, provider: str):
        """Get the API key"""
        provider_list = ["openai", "claude", "groq", "ollama"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "openai":
            api_key_name = "openaiApiKey"
        elif provider == "claude":
            api_key_name = "anthropicApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "ollama":
            api_key_name = "ollamaApiKey"
        async with self._get_connection() as conn:
            cursor = await conn.execute(f"SELECT {api_key_name} FROM settings WHERE id = '1'")
            row = await cursor.fetchone()
            return row[0] if row and row[0] else ""

    async def get_transcript_config(self):
        """Get the current transcript configuration"""
        async with self._get_connection() as conn:
            cursor = await conn.execute("SELECT provider, model FROM transcript_settings")
            row = await cursor.fetchone()
            if row:
                return dict(zip([col[0] for col in cursor.description], row))
            else:
                # Return default configuration if no transcript settings exist
                return {
                    "provider": "localWhisper",
                    "model": "large-v3"
                }

    async def save_transcript_config(self, provider: str, model: str):
        """Save the transcript settings"""
        # Input validation
        if not provider or not provider.strip():
            raise ValueError("Provider cannot be empty")
        if not model or not model.strip():
            raise ValueError("Model cannot be empty")
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # Check if the configuration already exists
                    cursor = await conn.execute("SELECT id FROM transcript_settings")
                    existing_config = await cursor.fetchone()
                    if existing_config:
                        # Update existing configuration
                        await conn.execute("""
                            UPDATE transcript_settings 
                            SET provider = ?, model = ?
                            WHERE id = '1'
                        """, (provider, model))
                    else:
                        # Insert new configuration
                        await conn.execute("""
                            INSERT INTO transcript_settings (id, provider, model)
                            VALUES (?, ?, ?)
                        """, ('1', provider, model))
                    
                    await conn.commit()
                    logger.info(f"Successfully saved transcript configuration: {provider}/{model}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save transcript configuration: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in save_transcript_config: {str(e)}", exc_info=True)
            raise

    async def save_transcript_api_key(self, api_key: str, provider: str):
        """Save the transcript API key"""
        provider_list = ["localWhisper","deepgram","elevenLabs","groq","openai"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "localWhisper":
            api_key_name = "whisperApiKey"
        elif provider == "deepgram":
            api_key_name = "deepgramApiKey"
        elif provider == "elevenLabs":
            api_key_name = "elevenLabsApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "openai":
            api_key_name = "openaiApiKey"
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # Check if transcript settings row exists
                    cursor = await conn.execute("SELECT id FROM transcript_settings WHERE id = '1'")
                    existing_config = await cursor.fetchone()
                    
                    if existing_config:
                        # Update existing configuration
                        await conn.execute(f"UPDATE transcript_settings SET {api_key_name} = ? WHERE id = '1'", (api_key,))
                    else:
                        # Insert new configuration with default values and the API key
                        await conn.execute(f"""
                            INSERT INTO transcript_settings (id, provider, model, {api_key_name})
                            VALUES (?, ?, ?, ?)
                        """, ('1', 'localWhisper', 'large-v3', api_key))
                        
                    await conn.commit()
                    logger.info(f"Successfully saved transcript API key for provider: {provider}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save transcript API key for provider {provider}: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in save_transcript_api_key: {str(e)}", exc_info=True)
            raise


    async def get_transcript_api_key(self, provider: str):
        """Get the transcript API key"""
        provider_list = ["localWhisper","deepgram","elevenLabs","groq","openai"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "localWhisper":
            api_key_name = "whisperApiKey"
        elif provider == "deepgram":
            api_key_name = "deepgramApiKey"
        elif provider == "elevenLabs":
            api_key_name = "elevenLabsApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "openai":
            api_key_name = "openaiApiKey"
        async with self._get_connection() as conn:
            cursor = await conn.execute(f"SELECT {api_key_name} FROM transcript_settings WHERE id = '1'")
            row = await cursor.fetchone()
            return row[0] if row and row[0] else ""

    async def search_transcripts(self, query: str):
        """Search through meeting transcripts for the given query"""
        if not query or query.strip() == "":
            return []
            
        # Convert query to lowercase for case-insensitive search
        search_query = f"%{query.lower()}%"
        
        try:
            async with self._get_connection() as conn:
                # Search in transcripts table
                cursor = await conn.execute("""
                    SELECT m.id, m.title, t.transcript, t.timestamp
                    FROM meetings m
                    JOIN transcripts t ON m.id = t.meeting_id
                    WHERE LOWER(t.transcript) LIKE ?
                    ORDER BY m.created_at DESC
                """, (search_query,))
                
                rows = await cursor.fetchall()
                
                # Also search in transcript_chunks for full transcripts
                cursor2 = await conn.execute("""
                    SELECT m.id, m.title, tc.transcript_text
                    FROM meetings m
                    JOIN transcript_chunks tc ON m.id = tc.meeting_id
                    WHERE LOWER(tc.transcript_text) LIKE ?
                    AND m.id NOT IN (SELECT DISTINCT meeting_id FROM transcripts WHERE LOWER(transcript) LIKE ?)
                    ORDER BY m.created_at DESC
                """, (search_query, search_query))
                
                chunk_rows = await cursor2.fetchall()
                
                # Format the results
                results = []
                
                # Process transcript matches
                for row in rows:
                    meeting_id, title, transcript, timestamp = row
                    
                    # Find the matching context (snippet around the match)
                    transcript_lower = transcript.lower()
                    match_index = transcript_lower.find(query.lower())
                    
                    # Extract context around the match (100 chars before and after)
                    start_index = max(0, match_index - 100)
                    end_index = min(len(transcript), match_index + len(query) + 100)
                    context = transcript[start_index:end_index]
                    
                    # Add ellipsis if we truncated the text
                    if start_index > 0:
                        context = "..." + context
                    if end_index < len(transcript):
                        context += "..."
                    
                    results.append({
                        'id': meeting_id,
                        'title': title,
                        'matchContext': context,
                        'timestamp': timestamp
                    })
                
                # Process transcript_chunks matches
                for row in chunk_rows:
                    meeting_id, title, transcript_text = row
                    
                    # Find the matching context (snippet around the match)
                    transcript_lower = transcript_text.lower()
                    match_index = transcript_lower.find(query.lower())
                    
                    # Extract context around the match (100 chars before and after)
                    start_index = max(0, match_index - 100)
                    end_index = min(len(transcript_text), match_index + len(query) + 100)
                    context = transcript_text[start_index:end_index]
                    
                    # Add ellipsis if we truncated the text
                    if start_index > 0:
                        context = "..." + context
                    if end_index < len(transcript_text):
                        context += "..."
                    
                    results.append({
                        'id': meeting_id,
                        'title': title,
                        'matchContext': context,
                        'timestamp': datetime.utcnow().isoformat()  # Use current time as fallback
                    })
                
                return results
                
        except Exception as e:
            logger.error(f"Error searching transcripts: {str(e)}")
            raise
        
    async def delete_api_key(self, provider: str):
        """Delete the API key"""
        provider_list = ["openai", "claude", "groq", "ollama"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "openai":
            api_key_name = "openaiApiKey"
        elif provider == "claude":
            api_key_name = "anthropicApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "ollama":
            api_key_name = "ollamaApiKey"
        async with self._get_connection() as conn:
            await conn.execute(f"UPDATE settings SET {api_key_name} = NULL WHERE id = '1'")
            await conn.commit()
    
    async def update_meeting_summary(self, meeting_id: str, summary: dict):
        """Update a meeting's summary"""
        now = datetime.utcnow().isoformat()
        try:
            async with self._get_connection() as conn:
                # Check if the meeting exists
                cursor = await conn.execute("SELECT id FROM meetings WHERE id = ?", (meeting_id,))
                meeting = await cursor.fetchone()
                
                if not meeting:
                    raise ValueError(f"Meeting with ID {meeting_id} not found")
                
                # Update the summary in the summary_processes table
                await conn.execute("""
                    UPDATE summary_processes
                    SET result = ?, updated_at = ?
                    WHERE meeting_id = ?
                """, (json.dumps(summary), now, meeting_id))
                
                # Update the meeting's updated_at timestamp
                await conn.execute("""
                    UPDATE meetings
                    SET updated_at = ?
                    WHERE id = ?
                """, (now, meeting_id))
                
                await conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error updating meeting summary: {str(e)}")
            raise

   




================================================
FILE: backend/app/main.py
================================================
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn
from typing import Optional, List
import logging
from dotenv import load_dotenv
from db import DatabaseManager
import json
from threading import Lock
from transcript_processor import TranscriptProcessor
import time

# Load environment variables
load_dotenv()

# Configure logger with line numbers and function names
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Create console handler with formatting
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.DEBUG)

# Create formatter with line numbers and function names
formatter = logging.Formatter(
    '%(asctime)s - %(levelname)s - [%(filename)s:%(lineno)d - %(funcName)s()] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
console_handler.setFormatter(formatter)

# Add handler to logger if not already added
if not logger.handlers:
    logger.addHandler(console_handler)

app = FastAPI(
    title="Meeting Summarizer API",
    description="API for processing and summarizing meeting transcripts",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],     # Allow all origins for testing
    allow_credentials=True,
    allow_methods=["*"],     # Allow all methods
    allow_headers=["*"],     # Allow all headers
    max_age=3600,            # Cache preflight requests for 1 hour
)

# Global database manager instance for meeting management endpoints
db = DatabaseManager()

# New Pydantic models for meeting management
class Transcript(BaseModel):
    id: str
    text: str
    timestamp: str
    # Recording-relative timestamps for audio-transcript synchronization
    audio_start_time: Optional[float] = None
    audio_end_time: Optional[float] = None
    duration: Optional[float] = None

class MeetingResponse(BaseModel):
    id: str
    title: str

class MeetingDetailsResponse(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    transcripts: List[Transcript]

class MeetingTitleUpdate(BaseModel):
    meeting_id: str
    title: str

class DeleteMeetingRequest(BaseModel):
    meeting_id: str

class SaveTranscriptRequest(BaseModel):
    meeting_title: str
    transcripts: List[Transcript]
    folder_path: Optional[str] = None  # NEW: Path to meeting folder (for new folder structure)

class SaveModelConfigRequest(BaseModel):
    provider: str
    model: str
    whisperModel: str
    apiKey: Optional[str] = None

class SaveTranscriptConfigRequest(BaseModel):
    provider: str
    model: str
    apiKey: Optional[str] = None

class TranscriptRequest(BaseModel):
    """Request model for transcript text, updated with meeting_id"""
    text: str
    model: str
    model_name: str
    meeting_id: str
    chunk_size: Optional[int] = 5000
    overlap: Optional[int] = 1000
    custom_prompt: Optional[str] = "Generate a summary of the meeting transcript."

class SummaryProcessor:
    """Handles the processing of summaries in a thread-safe way"""
    def __init__(self):
        try:
            self.db = DatabaseManager()

            logger.info("Initializing SummaryProcessor components")
            self.transcript_processor = TranscriptProcessor()
            logger.info("SummaryProcessor initialized successfully (core components)")
        except Exception as e:
            logger.error(f"Failed to initialize SummaryProcessor: {str(e)}", exc_info=True)
            raise

    async def process_transcript(self, text: str, model: str, model_name: str, chunk_size: int = 5000, overlap: int = 1000, custom_prompt: str = "Generate a summary of the meeting transcript.") -> tuple:
        """Process a transcript text"""
        try:
            if not text:
                raise ValueError("Empty transcript text provided")

            # Validate chunk_size and overlap
            if chunk_size <= 0:
                raise ValueError("chunk_size must be positive")
            if overlap < 0:
                raise ValueError("overlap must be non-negative")
            if overlap >= chunk_size:
                overlap = chunk_size - 1  # Ensure overlap is less than chunk_size

            # Ensure step size is positive
            step_size = chunk_size - overlap
            if step_size <= 0:
                chunk_size = overlap + 1  # Adjust chunk_size to ensure positive step

            logger.info(f"Processing transcript of length {len(text)} with chunk_size={chunk_size}, overlap={overlap}")
            num_chunks, all_json_data = await self.transcript_processor.process_transcript(
                text=text,
                model=model,
                model_name=model_name,
                chunk_size=chunk_size,
                overlap=overlap,
                custom_prompt=custom_prompt
            )
            logger.info(f"Successfully processed transcript into {num_chunks} chunks")

            return num_chunks, all_json_data
        except Exception as e:
            logger.error(f"Error processing transcript: {str(e)}", exc_info=True)
            raise

    def cleanup(self):
        """Cleanup resources"""
        try:
            logger.info("Cleaning up resources")
            if hasattr(self, 'transcript_processor'):
                self.transcript_processor.cleanup()
            logger.info("Cleanup completed successfully")
        except Exception as e:
            logger.error(f"Error during cleanup: {str(e)}", exc_info=True)

# Initialize processor
processor = SummaryProcessor()

# New meeting management endpoints
@app.get("/get-meetings", response_model=List[MeetingResponse])
async def get_meetings():
    """Get all meetings with their basic information"""
    try:
        meetings = await db.get_all_meetings()
        return [{"id": meeting["id"], "title": meeting["title"]} for meeting in meetings]
    except Exception as e:
        logger.error(f"Error getting meetings: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-meeting/{meeting_id}", response_model=MeetingDetailsResponse)
async def get_meeting(meeting_id: str):
    """Get a specific meeting by ID with all its details"""
    try:
        meeting = await db.get_meeting(meeting_id)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        return meeting
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting meeting: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/save-meeting-title")
async def save_meeting_title(data: MeetingTitleUpdate):
    """Save a meeting title"""
    try:
        await db.update_meeting_title(data.meeting_id, data.title)
        return {"message": "Meeting title saved successfully"}
    except Exception as e:
        logger.error(f"Error saving meeting title: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/delete-meeting")
async def delete_meeting(data: DeleteMeetingRequest):
    """Delete a meeting and all its associated data"""
    try:
        success = await db.delete_meeting(data.meeting_id)
        if success:
            return {"message": "Meeting deleted successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to delete meeting")
    except Exception as e:
        logger.error(f"Error deleting meeting: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

async def process_transcript_background(process_id: str, transcript: TranscriptRequest, custom_prompt: str):
    """Background task to process transcript"""
    try:
        logger.info(f"Starting background processing for process_id: {process_id}")
        
        # Early validation for common issues
        if not transcript.text or not transcript.text.strip():
            raise ValueError("Empty transcript text provided")
        
        if transcript.model in ["claude", "groq", "openai"]:
            # Check if API key is available for cloud providers
            api_key = await processor.db.get_api_key(transcript.model)
            if not api_key:
                provider_names = {"claude": "Anthropic", "groq": "Groq", "openai": "OpenAI"}
                raise ValueError(f"{provider_names.get(transcript.model, transcript.model)} API key not configured. Please set your API key in the model settings.")

        _, all_json_data = await processor.process_transcript(
            text=transcript.text,
            model=transcript.model,
            model_name=transcript.model_name,
            chunk_size=transcript.chunk_size,
            overlap=transcript.overlap,
            custom_prompt=custom_prompt
        )

        # Create final summary structure by aggregating chunk results
        final_summary = {
            "MeetingName": "",
            "People": {"title": "People", "blocks": []},
            "SessionSummary": {"title": "Session Summary", "blocks": []},
            "CriticalDeadlines": {"title": "Critical Deadlines", "blocks": []},
            "KeyItemsDecisions": {"title": "Key Items & Decisions", "blocks": []},
            "ImmediateActionItems": {"title": "Immediate Action Items", "blocks": []},
            "NextSteps": {"title": "Next Steps", "blocks": []},
            # "OtherImportantPoints": {"title": "Other Important Points", "blocks": []},
            # "ClosingRemarks": {"title": "Closing Remarks", "blocks": []},
            "MeetingNotes": {
                "meeting_name": "",
                "sections": []
            }
        }

        # Process each chunk's data
        for json_str in all_json_data:
            try:
                json_dict = json.loads(json_str)
                if "MeetingName" in json_dict and json_dict["MeetingName"]:
                    final_summary["MeetingName"] = json_dict["MeetingName"]
                for key in final_summary:
                    if key == "MeetingNotes" and key in json_dict:
                        # Handle MeetingNotes sections
                        if isinstance(json_dict[key].get("sections"), list):
                            # Ensure each section has blocks array
                            for section in json_dict[key]["sections"]:
                                if not section.get("blocks"):
                                    section["blocks"] = []
                            final_summary[key]["sections"].extend(json_dict[key]["sections"])
                        if json_dict[key].get("meeting_name"):
                            final_summary[key]["meeting_name"] = json_dict[key]["meeting_name"]
                    elif key != "MeetingName" and key in json_dict and isinstance(json_dict[key], dict) and "blocks" in json_dict[key]:
                        if isinstance(json_dict[key]["blocks"], list):
                            final_summary[key]["blocks"].extend(json_dict[key]["blocks"])
                            # Also add as a new section in MeetingNotes if not already present
                            section_exists = False
                            for section in final_summary["MeetingNotes"]["sections"]:
                                if section["title"] == json_dict[key]["title"]:
                                    section["blocks"].extend(json_dict[key]["blocks"])
                                    section_exists = True
                                    break
                            
                            if not section_exists:
                                final_summary["MeetingNotes"]["sections"].append({
                                    "title": json_dict[key]["title"],
                                    "blocks": json_dict[key]["blocks"].copy() if json_dict[key]["blocks"] else []
                                })
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON chunk for {process_id}: {e}. Chunk: {json_str[:100]}...")
            except Exception as e:
                logger.error(f"Error processing chunk data for {process_id}: {e}. Chunk: {json_str[:100]}...")

        # Update database with meeting name using meeting_id
        if final_summary["MeetingName"]:
            await processor.db.update_meeting_name(transcript.meeting_id, final_summary["MeetingName"])

        # Save final result
        if all_json_data:
            await processor.db.update_process(process_id, status="completed", result=json.dumps(final_summary))
            logger.info(f"Background processing completed for process_id: {process_id}")
        else:
            error_msg = "Summary generation failed: No chunks were processed successfully. Check logs for specific errors."
            await processor.db.update_process(process_id, status="failed", error=error_msg)
            logger.error(f"Background processing failed for process_id: {process_id} - {error_msg}")

    except ValueError as e:
        # Handle specific value errors (like API key issues)
        error_msg = str(e)
        logger.error(f"Configuration error in background processing for {process_id}: {error_msg}", exc_info=True)
        try:
            await processor.db.update_process(process_id, status="failed", error=error_msg)
        except Exception as db_e:
            logger.error(f"Failed to update DB status to failed for {process_id}: {db_e}", exc_info=True)
    except Exception as e:
        # Handle all other exceptions
        error_msg = f"Processing error: {str(e)}"
        logger.error(f"Error in background processing for {process_id}: {error_msg}", exc_info=True)
        try:
            await processor.db.update_process(process_id, status="failed", error=error_msg)
        except Exception as db_e:
            logger.error(f"Failed to update DB status to failed for {process_id}: {db_e}", exc_info=True)

@app.post("/process-transcript")
async def process_transcript_api(
    transcript: TranscriptRequest,
    background_tasks: BackgroundTasks
):
    """Process a transcript text with background processing"""
    try:
        # Create new process linked to meeting_id
        process_id = await processor.db.create_process(transcript.meeting_id)

        # Save transcript data associated with meeting_id
        await processor.db.save_transcript(
            transcript.meeting_id,
            transcript.text,
            transcript.model,
            transcript.model_name,
            transcript.chunk_size,
            transcript.overlap
        )

        custom_prompt = transcript.custom_prompt

        # Start background processing
        background_tasks.add_task(
            process_transcript_background,
            process_id,
            transcript,
            custom_prompt
        )

        return JSONResponse({
            "message": "Processing started",
            "process_id": process_id
        })

    except Exception as e:
        logger.error(f"Error in process_transcript_api: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-summary/{meeting_id}")
async def get_summary(meeting_id: str):
    """Get the summary for a given meeting ID"""
    try:
        result = await processor.db.get_transcript_data(meeting_id)
        if not result:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "meetingName": None,
                    "meeting_id": meeting_id,
                    "data": None,
                    "start": None,
                    "end": None,
                    "error": "Meeting ID not found"
                }
            )

        status = result.get("status", "unknown").lower()
        logger.debug(f"Summary status for meeting {meeting_id}: {status}, error: {result.get('error')}")

        # Parse result data if available
        summary_data = None
        if result.get("result"):
            try:
                parsed_result = json.loads(result["result"])
                if isinstance(parsed_result, str):
                    summary_data = json.loads(parsed_result)
                else:
                    summary_data = parsed_result
                if not isinstance(summary_data, dict):
                    logger.error(f"Parsed summary data is not a dictionary for meeting {meeting_id}")
                    summary_data = None
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON data for meeting {meeting_id}: {str(e)}")
                status = "failed"
                result["error"] = f"Invalid summary data format: {str(e)}"
            except Exception as e:
                logger.error(f"Unexpected error parsing summary data for {meeting_id}: {str(e)}")
                status = "failed"
                result["error"] = f"Error processing summary data: {str(e)}"

        # Transform summary data into frontend format if available - PRESERVE ORDER
        transformed_data = {}
        if isinstance(summary_data, dict) and status == "completed":
            # Add MeetingName to transformed data
            transformed_data["MeetingName"] = summary_data.get("MeetingName", "")

            # Map backend sections to frontend sections
            section_mapping = {
                # "SessionSummary": "key_points",
                # "ImmediateActionItems": "action_items",
                # "KeyItemsDecisions": "decisions",
                # "NextSteps": "next_steps",
                # "CriticalDeadlines": "critical_deadlines",
                # "People": "people"
            }

            # Add each section to transformed data
            for backend_key, frontend_key in section_mapping.items():
                if backend_key in summary_data and isinstance(summary_data[backend_key], dict):
                    transformed_data[frontend_key] = summary_data[backend_key]
            
            # Add meeting notes sections if available - PRESERVE ORDER AND HANDLE DUPLICATES
            if "MeetingNotes" in summary_data and isinstance(summary_data["MeetingNotes"], dict):
                meeting_notes = summary_data["MeetingNotes"]
                if isinstance(meeting_notes.get("sections"), list):
                    # Add section order array to maintain order
                    transformed_data["_section_order"] = []
                    used_keys = set()
                    
                    for index, section in enumerate(meeting_notes["sections"]):
                        if isinstance(section, dict) and "title" in section and "blocks" in section:
                            # Ensure blocks is a list to prevent frontend errors
                            if not isinstance(section.get("blocks"), list):
                                section["blocks"] = []
                                
                            # Convert title to snake_case key
                            base_key = section["title"].lower().replace(" & ", "_").replace(" ", "_")
                            
                            # Handle duplicate section names by adding index
                            key = base_key
                            if key in used_keys:
                                key = f"{base_key}_{index}"
                            
                            used_keys.add(key)
                            transformed_data[key] = section
                            # Only add to _section_order if the section was successfully added
                            transformed_data["_section_order"].append(key)

        response = {
            "status": "processing" if status in ["processing", "pending", "started"] else status,
            "meetingName": summary_data.get("MeetingName") if isinstance(summary_data, dict) else None,
            "meeting_id": meeting_id,
            "start": result.get("start_time"),
            "end": result.get("end_time"),
            "data": transformed_data if status == "completed" else None
        }

        if status == "failed":
            response["status"] = "error"
            response["error"] = result.get("error", "Unknown processing error")
            response["data"] = None
            response["meetingName"] = None
            logger.info(f"Returning failed status with error: {response['error']}")
            return JSONResponse(status_code=400, content=response)

        elif status in ["processing", "pending", "started"]:
            response["data"] = None
            return JSONResponse(status_code=202, content=response)

        elif status == "completed":
            if not summary_data:
                response["status"] = "error"
                response["error"] = "Completed but summary data is missing or invalid"
                response["data"] = None
                response["meetingName"] = None
                return JSONResponse(status_code=500, content=response)
            return JSONResponse(status_code=200, content=response)

        else:
            response["status"] = "error"
            response["error"] = f"Unknown or unexpected status: {status}"
            response["data"] = None
            response["meetingName"] = None
            return JSONResponse(status_code=500, content=response)

    except Exception as e:
        logger.error(f"Error getting summary for {meeting_id}: {str(e)}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "meetingName": None,
                "meeting_id": meeting_id,
                "data": None,
                "start": None,
                "end": None,
                "error": f"Internal server error: {str(e)}"
            }
        )

@app.post("/save-transcript")
async def save_transcript(request: SaveTranscriptRequest):
    """Save transcript segments for a meeting without processing"""
    try:
        logger.info(f"Received save-transcript request for meeting: {request.meeting_title}")
        logger.info(f"Number of transcripts to save: {len(request.transcripts)}")

        # Log first transcript timestamps for debugging
        if request.transcripts:
            first = request.transcripts[0]
            logger.debug(f"First transcript: audio_start_time={first.audio_start_time}, audio_end_time={first.audio_end_time}, duration={first.duration}")

        # Generate a unique meeting ID
        meeting_id = f"meeting-{int(time.time() * 1000)}"

        # Save the meeting with folder path (if provided)
        await db.save_meeting(meeting_id, request.meeting_title, folder_path=request.folder_path)

        # Save each transcript segment with NEW timestamp fields for playback sync
        for transcript in request.transcripts:
            await db.save_meeting_transcript(
                meeting_id=meeting_id,
                transcript=transcript.text,
                timestamp=transcript.timestamp,
                summary="",
                action_items="",
                key_points="",
                # NEW: Recording-relative timestamps for audio-transcript synchronization
                audio_start_time=transcript.audio_start_time,
                audio_end_time=transcript.audio_end_time,
                duration=transcript.duration
            )

        logger.info("Transcripts saved successfully")
        return {"status": "success", "message": "Transcript saved successfully", "meeting_id": meeting_id}
    except Exception as e:
        logger.error(f"Error saving transcript: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-model-config")
async def get_model_config():
    """Get the current model configuration"""
    model_config = await db.get_model_config()
    if model_config:
        api_key = await db.get_api_key(model_config["provider"])
        if api_key != None:
            model_config["apiKey"] = api_key
    return model_config

@app.post("/save-model-config")
async def save_model_config(request: SaveModelConfigRequest):
    """Save the model configuration"""
    await db.save_model_config(request.provider, request.model, request.whisperModel)
    if request.apiKey != None:
        await db.save_api_key(request.apiKey, request.provider)
    return {"status": "success", "message": "Model configuration saved successfully"}  

@app.get("/get-transcript-config")
async def get_transcript_config():
    """Get the current transcript configuration"""
    transcript_config = await db.get_transcript_config()
    if transcript_config:
        transcript_api_key = await db.get_transcript_api_key(transcript_config["provider"])
        if transcript_api_key != None:
            transcript_config["apiKey"] = transcript_api_key
    return transcript_config

@app.post("/save-transcript-config")
async def save_transcript_config(request: SaveTranscriptConfigRequest):
    """Save the transcript configuration"""
    await db.save_transcript_config(request.provider, request.model)
    if request.apiKey != None:
        await db.save_transcript_api_key(request.apiKey, request.provider)
    return {"status": "success", "message": "Transcript configuration saved successfully"}

class GetApiKeyRequest(BaseModel):
    provider: str

@app.post("/get-api-key")
async def get_api_key(request: GetApiKeyRequest):
    try:
        return await db.get_api_key(request.provider)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/get-transcript-api-key")
async def get_transcript_api_key(request: GetApiKeyRequest):
    try:
        return await db.get_transcript_api_key(request.provider)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class MeetingSummaryUpdate(BaseModel):
    meeting_id: str
    summary: dict

@app.post("/save-meeting-summary")
async def save_meeting_summary(data: MeetingSummaryUpdate):
    """Save a meeting summary"""
    try:
        await db.update_meeting_summary(data.meeting_id, data.summary)
        return {"message": "Meeting summary saved successfully"}
    except ValueError as ve:
        logger.error(f"Value error saving meeting summary: {str(ve)}")
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Error saving meeting summary: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

class SearchRequest(BaseModel):
    query: str

@app.post("/search-transcripts")
async def search_transcripts(request: SearchRequest):
    """Search through meeting transcripts for the given query"""
    try:
        results = await db.search_transcripts(request.query)
        return JSONResponse(content=results)
    except Exception as e:
        logger.error(f"Error searching transcripts: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on API shutdown"""
    logger.info("API shutting down, cleaning up resources")
    try:
        processor.cleanup()
        logger.info("Successfully cleaned up resources")
    except Exception as e:
        logger.error(f"Error during cleanup: {str(e)}", exc_info=True)

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    uvicorn.run("main:app", host="0.0.0.0", port=5167, reload=True)



================================================
FILE: backend/app/schema_validator.py
================================================
import sqlite3
import logging
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

class SchemaValidator:
    """Handles database schema validation and automatic fixes"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def validate_schema(self):
        """Validate that actual schema matches expected schema"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Get expected schema from the code
                expected_schema = self._get_expected_schema()
                
                # Validate each table
                for table_name, expected_columns in expected_schema.items():
                    self._validate_table_schema(cursor, table_name, expected_columns)
                    
        except Exception as e:
            logger.error(f"Schema validation failed: {str(e)}")
            raise

    def _get_expected_schema(self):
        """Get the expected schema from the code"""
        # This represents the schema defined in _legacy_init_db method
        return {
            'meetings': [
                ('id', 'TEXT', 'PRIMARY KEY'),
                ('title', 'TEXT', 'NOT NULL'),
                ('created_at', 'TEXT', 'NOT NULL'),
                ('updated_at', 'TEXT', 'NOT NULL')
            ],
            'transcripts': [
                ('id', 'TEXT', 'PRIMARY KEY'),
                ('meeting_id', 'TEXT', 'NOT NULL'),
                ('transcript', 'TEXT', 'NOT NULL'),
                ('timestamp', 'TEXT', 'NOT NULL'),
                ('summary', 'TEXT', ''),
                ('action_items', 'TEXT', ''),
                ('key_points', 'TEXT', '')
            ],
            'summary_processes': [
                ('meeting_id', 'TEXT', 'PRIMARY KEY'),
                ('status', 'TEXT', 'NOT NULL'),
                ('created_at', 'TEXT', 'NOT NULL'),
                ('updated_at', 'TEXT', 'NOT NULL'),
                ('error', 'TEXT', ''),
                ('result', 'TEXT', ''),
                ('start_time', 'TEXT', ''),
                ('end_time', 'TEXT', ''),
                ('chunk_count', 'INTEGER', 'DEFAULT 0'),
                ('processing_time', 'REAL', 'DEFAULT 0.0'),
                ('metadata', 'TEXT', '')
            ],
            'transcript_chunks': [
                ('meeting_id', 'TEXT', 'PRIMARY KEY'),
                ('meeting_name', 'TEXT', ''),
                ('transcript_text', 'TEXT', 'NOT NULL'),
                ('model', 'TEXT', 'NOT NULL'),
                ('model_name', 'TEXT', 'NOT NULL'),
                ('chunk_size', 'INTEGER', ''),
                ('overlap', 'INTEGER', ''),
                ('created_at', 'TEXT', 'NOT NULL')
            ],
            'settings': [
                ('id', 'TEXT', 'PRIMARY KEY'),
                ('provider', 'TEXT', 'NOT NULL'),
                ('model', 'TEXT', 'NOT NULL'),
                ('whisperModel', 'TEXT', 'NOT NULL'),
                ('groqApiKey', 'TEXT', ''),
                ('openaiApiKey', 'TEXT', ''),
                ('anthropicApiKey', 'TEXT', ''),
                ('ollamaApiKey', 'TEXT', '')
            ],
            'transcript_settings': [
                ('id', 'TEXT', 'PRIMARY KEY'),
                ('provider', 'TEXT', 'NOT NULL'),
                ('model', 'TEXT', 'NOT NULL'),
                ('whisperApiKey', 'TEXT', ''),
                ('deepgramApiKey', 'TEXT', ''),
                ('elevenLabsApiKey', 'TEXT', ''),
                ('groqApiKey', 'TEXT', ''),
                ('openaiApiKey', 'TEXT', '')
            ]
        }

    def _validate_table_schema(self, cursor, table_name: str, expected_columns: List[Tuple[str, str, str]]):
        """Validate and fix a single table's schema"""
        try:
            # Check if table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
            if not cursor.fetchone():
                logger.warning(f"Table {table_name} does not exist - will be created by legacy init")
                return
            
            # Get actual columns
            cursor.execute(f"PRAGMA table_info({table_name})")
            actual_columns = {row[1]: row[2] for row in cursor.fetchall()}
            
            missing_columns = []
            
            # Check each expected column
            for col_name, col_type, col_constraints in expected_columns:
                if col_name not in actual_columns:
                    missing_columns.append((col_name, col_type))
            
            if missing_columns:
                logger.warning(f"Schema validation failed for {table_name}: missing columns {[col[0] for col in missing_columns]}")
                logger.info(f"Adding missing columns to {table_name}...")
                
                # Add each missing column
                for col_name, col_type in missing_columns:
                    cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}")
                    logger.info(f"✅ Added missing {col_name} column to {table_name}")
            else:
                logger.info(f"✅ Schema validation passed for {table_name}")
                
        except Exception as e:
            logger.error(f"Error validating table {table_name}: {str(e)}")
            raise



================================================
FILE: backend/app/transcript_processor.py
================================================
from pydantic import BaseModel
from typing import List, Tuple, Literal
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.providers.groq import GroqProvider
from pydantic_ai.providers.anthropic import AnthropicProvider

import logging
import os
from dotenv import load_dotenv
from db import DatabaseManager
from ollama import chat
import asyncio
from ollama import AsyncClient





# Set up logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()  # Load environment variables from .env file

db = DatabaseManager()

class Block(BaseModel):
    """Represents a block of content in a section.
    
    Block types must align with frontend rendering capabilities:
    - 'text': Plain text content
    - 'bullet': Bulleted list item
    - 'heading1': Large section heading
    - 'heading2': Medium section heading
    
    Colors currently supported:
    - 'gray': Gray text color
    - '' or any other value: Default text color
    """
    id: str
    type: Literal['bullet', 'heading1', 'he