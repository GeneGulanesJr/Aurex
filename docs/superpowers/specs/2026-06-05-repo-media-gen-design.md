# Repo Media Generator Extension — Design Spec

**Date:** 2026-06-05
**Status:** Approved
**Extension name:** `repo-media`
**Location:** `~/.pi/agent/extensions/repo-media/`

## Overview

A Pi extension that generates project media assets — videos, images, voiceovers, music — from repo context. Pi already knows the codebase; this extension turns that knowledge into polished visual and audio assets like video explainers, feature showcases, architecture diagrams, hero images, and narration.

MiniMax is the first provider. The architecture supports adding more providers (Replicate, Runway, ElevenLabs, etc.) without changing tool interfaces.

## Motivation

Generating media for a repo is tedious: figure out what to show, write prompts, call APIs, download files, organize output. Pi already has deep repo context — file structure, features, architecture, recent changes. The extension leverages that to auto-craft generation prompts and produce assets in one flow.

## Tools

### `generate_media` — Single Asset

Generates one media asset for the current repo.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt` | string | yes | — | Final generation-ready prompt (LLM crafts this from repo context before calling) |
| `asset_type` | enum | yes | — | `video_explainer`, `feature_showcase`, `architecture_diagram`, `screenshot_animation`, `voiceover`, `background_music`, `hero_image`, `social_asset`, `custom` |
| `model` | string | no | best quality | Provider model ID (e.g. `speech-2.8-hd`, `MiniMax-Hailuo-2.3`). Default: best quality per provider. |
| `target` | string | no | whole repo | What part of the repo (file, feature, module). Used for output subdirectory. |
| `provider` | string | no | auto | Provider name (default: first available) |
| `style` | enum | no | professional | `professional`, `playful`, `minimal`, `cinematic` |
| `duration` | number | no | auto | Seconds (video/audio). 6 or 10 for video |
| `resolution` | string | no | auto | `720p`, `768p`, `1080p` |
| `voice_id` | string | no | English_expressive_narrator | Voice for speech (default English; wizard offers full voice list) |
| `reference_image` | string | no | — | URL/path for image-to-video or subject reference |
| `output_name` | string | no | auto | Filename without extension |
| `output_dir` | string | no | `./repo-media/{target-slug}/` | Output directory |
| `confirm` | boolean | no | true | Show confirmation before generating (set false to skip) |

**Confirmation dialog (when `confirm: true`):** Shows `ctx.ui.confirm()` with:
```
Generate {asset_type}?
  Model: {model}
  {Duration: {duration}s, Resolution: {resolution} | Aspect: {aspect_ratio}}
  Output: {output_dir}{output_name}.{ext}
  [Confirm] [Cancel]
```
This gates credit-burning operations. Default is `true`.

**Asset type is always specified by the LLM.** No keyword auto-detection — the LLM reasons about what the user wants and picks the right `asset_type` before calling the tool. The `promptGuidelines` (below) help the LLM choose.

**Wizard trigger logic:**
- **Tool called by LLM** (normal flow) → all required params provided, skip straight to confirmation (if `confirm: true`), then generate. No wizard.
- **`/media` command** (user triggers directly) → full interactive wizard for all params.
- No `skip_wizard` param needed — the trigger source (tool vs command) determines the flow.

**Model defaults per capability (MiniMax):**
- Image: `image-01`
- Speech: `speech-2.8-hd`
- Music: `music-2.6`
- Video: `MiniMax-Hailuo-2.3`

**Asset type → provider capability mapping:**

| Asset Type | Capability | Notes |
|---|---|---|
| `video_explainer` | video | Text-to-video |
| `feature_showcase` | video | Text-to-video |
| `architecture_diagram` | image | Text-to-image |
| `screenshot_animation` | video | Image-to-video (requires `reference_image`) |
| `voiceover` | speech | Text-to-speech |
| `background_music` | music | Text-to-music |
| `hero_image` | image | Text-to-image |
| `social_asset` | image | Text-to-image |
| `custom` | (from `model`) | Requires explicit `model` param to determine capability |

**Resolution defaults by asset type:**
- Video: 768p (1080p for feature_showcase)
- Image: 16:9 aspect for hero/architecture, 1:1 for social

### `generate_media_suite` — Batch Generation

Generates multiple assets at once for a unified theme.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt` | string | yes | — | Overall theme/topic description |
| `prompts` | object | no | {} | Per-asset generation prompts. Keys are asset types, values are the final prompt strings. Missing assets use `prompt` + asset-type template as fallback. |
| `target` | string | no | whole repo | Feature, module, or "whole repo" |
| `assets` | string[] | no | all | Which assets to generate |
| `style` | enum | no | professional | Style for all assets |
| `output_dir` | string | no | `./repo-media/{target-slug}/` | Output directory |
| `confirm` | boolean | no | true | Show plan review before generating |

**`prompts` map example:**
```json
{
  "video_explainer": "Animated walkthrough showing data flowing from AGENTS.md through parser into session...",
  "voiceover": "Welcome to LaPis, the persistent memory extension for Pi. LaPis stores decisions, bugfixes...",
  "background_music": "Ambient electronic, subtle, professional, suitable for technical video",
  "hero_image": "Professional hero banner for LaPis GitHub README, dark theme, diamond icon...",
  "architecture_diagram": "Clean isometric architecture diagram showing memory.db at center..."
}
```
If a key is missing, the suite generates a fallback prompt from `prompt` (theme) + asset-type template.

**Social asset prompts in suite:**
The `prompts` map accepts:
- `"social_asset"` → one prompt used for all 3 aspect ratio variants (1:1, 16:9, 9:16)
- `"social_asset_1x1"`, `"social_asset_16x9"`, `"social_asset_9x16"` → individual prompts per variant (overrides `"social_asset"`)

**Default suite assets (when `assets` omitted) — 8 generations:**
1. Architecture diagram (image)
2. Hero image (image)
3. Voiceover narration (audio)
4. Background music (audio)
5. Video explainer (video)
6. Social asset — 1:1 (image)
7. Social asset — 16:9 (image)
8. Social asset — 9:16 (image)

## Provider Architecture

### Provider Interface

```typescript
interface MediaProvider {
  name: string;
  capabilities: ("image" | "speech" | "music" | "video")[];
  image?: ImageProvider;
  speech?: SpeechProvider;
  music?: MusicProvider;
  video?: VideoProvider;
}

interface ImageProvider {
  generate(params: ImageParams): Promise<MediaResult>;
  supportedModels(): string[];
}

interface SpeechProvider {
  generate(params: SpeechParams): Promise<MediaResult>;
  supportedModels(): string[];
  listVoices(): string[];
}

interface MusicProvider {
  generate(params: MusicParams): Promise<MediaResult>;
  supportedModels(): string[];
}

interface VideoProvider {
  submit(params: VideoParams): Promise<string>; // task_id
  poll(taskId: string): Promise<VideoStatus>;
  download(fileId: string): Promise<Buffer>;
  supportedModels(): string[];
}

interface MediaResult {
  data: Buffer;
  format: string; // "jpeg", "mp3", "mp4", etc.
  metadata?: Record<string, unknown>;
}

interface VideoStatus {
  status: "processing" | "success" | "failed";
  fileId?: string;
  error?: string;
}

// Provider params mirror tool params, excluding UI/confirmation fields.
// Each provider receives only the fields relevant to its capability.

interface ImageParams {
  prompt: string;
  model: string;
  aspectRatio?: string;    // "1:1", "16:9", "9:16", "4:3"
  subjectReference?: { type: string; image: string[] };
}

interface SpeechParams {
  text: string;            // The prompt IS the narration text for voiceover
  model: string;
  voiceId: string;
  speed?: number;          // 0.5–2.0
  pitch?: number;
  languageBoost?: string;
  format?: string;         // "mp3", "wav", "flac"
  pronunciationDict?: { tone: string[] };
}

interface MusicParams {
  prompt: string;
  model: string;
  lyrics?: string;
  lyricsOptimizer?: boolean;
  isInstrumental?: boolean;
  referenceAudioUrl?: string;
  format?: string;         // "mp3", "wav", "flac"
}

interface VideoParams {
  prompt: string;
  model: string;
  mode: "text" | "image" | "first_last" | "subject";
  duration: number;        // 6 or 10
  resolution: string;      // "720p", "768p", "1080p"
  firstFrameImage?: string;
  lastFrameImage?: string;
  subjectImage?: string;
  promptOptimizer?: boolean;
}
```

### Provider Selection

1. Explicit `provider` param → use that provider
2. Auto → find first provider with matching capability and valid API key
3. Multiple providers for same capability → wizard asks user to pick

### MiniMax Provider Details

**Image** (`POST /v1/image_generation`):
- Model: `image-01`
- Modes: text-to-image, image-with-subject-reference
- Output: base64 → decoded to Buffer
- Sync API

**Speech** (`POST /v1/t2a_v2`):
- Models: `speech-2.8-hd`, `speech-2.8-turbo`, `speech-2.6-hd`, `speech-2.6-turbo`
- Output: hex-encoded audio → decoded to Buffer
- Supports: voice selection, speed, pitch, pronunciation, interjection tags
- Sync API

**Music** (`POST /v1/music_generation`):
- Models: `music-2.6`, `music-cover`
- Output: hex-encoded audio → decoded to Buffer
- Supports: lyrics with structure tags, lyrics auto-generation, instrumental mode
- Sync API

**Video** (`POST /v1/video_generation` + polling):
- Models: `MiniMax-Hailuo-2.3`, `MiniMax-Hailuo-2.3-Fast`, `MiniMax-Hailuo-02`
- Modes: text-to-video, image-to-video, first/last-frame, subject-reference
- Output: async → poll `/v1/query/video_generation` every 10s → download via `/v1/files/retrieve`
- Camera control via `[command]` syntax in prompts

## Repo-Aware Prompt Crafting

The `prompt` parameter is the **final generation-ready prompt** — the LLM writes it using repo context before calling the tool. The extension provides `promptGuidelines` per tool so the LLM knows how to write good prompts for each asset type.

### How It Works

1. User says: "Make a feature showcase for the context injection system"
2. LLM reads repo context (already in session) — knows the feature's purpose, components, data flow
3. LLM picks `asset_type: "feature_showcase"`
4. LLM writes a detailed prompt: "Dynamic demonstration of a context injection system. Show labeled modules connecting to a central injection pipeline. Camera zooms in on data flowing from AGENTS.md through a parser into session context..."
5. LLM calls `generate_media` with that prompt

The extension's `promptGuidelines` tell the LLM:

### Prompt Writing Guidelines (per asset type)

**`video_explainer`:**
Write prompts describing clear step-by-step animated walkthroughs. Show data flowing through components with labeled connections. Use camera commands like `[Pan left]`, `[Zoom in]` for directed motion. Describe smooth transitions between concepts.

**`feature_showcase`:**
Write prompts describing dynamic, fast-paced demonstrations. Highlight key interactions with zoom-in effects. Describe before/after states where applicable. Use `[Tracking shot]` for feature reveals.

**`architecture_diagram`:**
Write prompts describing clean technical architecture diagrams. Specify isometric or top-down view, dark theme, labeled components with connection lines showing data flow. Professional software engineering style.

**`screenshot_animation`:**
Write prompts describing smooth pan and zoom animations revealing UI elements. Describe subtle motion effects bringing static screenshots to life. Include `[Push in]` and `[Pan]` camera commands.

**`voiceover`:**
The prompt IS the narration text. Write clear, well-structured narration based on repo docs/README. Use interjection tags like `(sighs)`, `(breaths)` for natural delivery with speech-2.8 models. Mark pauses with `<#0.5#>` between sections.

**`background_music`:**
Write prompts describing style, mood, and instrumentation. Keep it suitable as background for a technical video — not distracting.

**`hero_image`:**
Write prompts describing professional hero banners for GitHub READMEs. Clean, modern design. Specify aspect ratio 16:9.

**`social_asset`:**
Write prompts describing eye-catching social media preview images. Bold, typography-friendly layout.

### Style Modifiers

When the user specifies a style, the LLM incorporates these cues into the prompt:
- `professional` → "corporate, polished, trustworthy"
- `playful` → "vibrant, creative, approachable"
- `minimal` → "clean, whitespace, understated"
- `cinematic` → "dramatic lighting, depth of field, moody"

## Wizard Flow

Only triggered by the `/media` command. When the LLM calls a tool, it provides all required params — no wizard.

```
Step 1: Asset type
  "What do you want to create?"
  [Video Explainer] [Feature Showcase] [Architecture Diagram]
  [Screenshot Animation] [Voiceover] [Background Music]
  [Hero Image] [Social Assets] [Custom]

Step 2: Target
  "What should it cover?"
  [Whole repo] [Specific feature (input)] [Recent changes]

Step 3: Style
  "What style?"
  [Professional] [Playful] [Minimal] [Cinematic]

Step 4: Asset-specific options
  Video: duration [6s] [10s], resolution [720p] [768p] [1080p]
  Image: aspect ratio [1:1] [16:9] [9:16] [4:3]
  Speech: voice selection, speed
  Music: instrumental? [Yes] [No], lyrics style

Step 5: Review & confirm
  Summary of all choices → [Generate!] [Edit] [Cancel]
```

When the wizard completes, it calls `generate_media` with the collected params.

## Suite Batch Flow

1. **Plan phase:** Show what will be generated (wizard review or auto)
2. **Generate sequentially:** One asset at a time, progress via `onUpdate`
3. **Continue on failure:** If one asset fails, log error and continue to next
4. **Summary:** Return list of all generated files

Progress example (8 individual generations):
```
[1/8] Generating architecture diagram... ✓ saved (architecture-diagram.jpeg)
[2/8] Generating hero image... ✓ saved (hero-image.jpeg)
[3/8] Generating voiceover... ✓ saved (voiceover.mp3)
[4/8] Generating background music... ✓ saved (background-music.mp3)
[5/8] Generating video explainer... (processing, polling every 10s)... ✓ saved (explainer.mp4)
[6/8] Generating social 1:1... ✓ saved (social-1x1.jpeg)
[7/8] Generating social 16:9... ✓ saved (social-16x9.jpeg)
[8/8] Generating social 9:16... ✓ saved (social-9x16.jpeg)

📁 All assets saved to ./repo-media/lapis-memory-layer/
```

## Commands

### `/media` — Quick Access

| Subcommand | Description |
|---|---|
| `/media` | Opens interactive wizard |
| `/media suite` | Generate full suite for current context |
| `/media list` | List all generated media in table format: filename, type, size, date. Recursively scans `./repo-media/`. |
| `/media clean` | Delete generated media — asks which subdirectory or `[All]` in confirm dialog |

## Output Structure

```
./repo-media/
├── lapis-memory-layer/
│   ├── architecture-diagram.jpeg
│   ├── hero-image.jpeg
│   ├── social-1x1.jpeg
│   ├── social-16x9.jpeg
│   ├── social-9x16.jpeg
│   ├── voiceover.mp3
│   ├── background-music.mp3
│   └── feature-showcase.mp4
├── context-injection/
│   └── explainer.mp4
└── ...
```

Auto-naming: `{asset-type}-{timestamp}.{ext}` when no `output_name` specified.
Both single and suite mode: `./repo-media/{target-slug}/{asset-type}.{ext}`.
No target specified → `./repo-media/{asset-type}-{timestamp}.{ext}`.

## Authentication

Each provider defines its own key resolution:

**Primary — Environment variables (provider-specific):**
- MiniMax: `MINIMAX_API_KEY`
- Future Replicate: `REPLICATE_API_TOKEN`
- Future ElevenLabs: `ELEVENLABS_API_KEY`
- etc.

**Secondary — models.json lookup:**
Providers can optionally check `ctx.modelRegistry` for a provider with a matching baseUrl (e.g., any provider whose baseUrl contains `minimax.io`). This is a nicety, not the primary path.

**Error when no key found:**
> "No MiniMax API key found. Set MINIMAX_API_KEY env var or add a MiniMax provider to models.json."

## Error Handling

- **API errors:** Surface HTTP status + error message from MiniMax
- **Video quota exceeded:** "Video generation requires Max plan ($50/mo) or higher. Skipping video assets. Other assets will continue."
- **Suite partial failure:** Continue generating remaining assets, report failures in summary
- **Cancellation:** `ctx.signal` respected at every await point (API calls, polling, wizard)
- **Invalid params:** Schema validation errors surfaced clearly
- **Network errors:** Retry once with backoff, then fail with clear message

## File Structure

```
~/.pi/agent/extensions/
└── repo-media/
    ├── index.ts              # Entry — registers tools, commands, loads providers
    ├── providers/
    │   ├── types.ts          # Provider interface contracts
    │   └── minimax.ts        # MiniMax provider implementation
    ├── tools/
    │   ├── generate.ts       # generate_media tool
    │   └── generate_suite.ts # generate_media_suite tool
    ├── wizard.ts             # Interactive wizard (for /media command)
    └── package.json          # Pi extension metadata only — zero runtime dependencies
```

No npm dependencies required. Uses Node.js built-in `fetch`, `Buffer`, `fs`, `path`.

## Future Extensions

- Additional providers (Replicate, Runway, ElevenLabs, OpenAI DALL-E)
- Compose suite assets into a single video (FFmpeg)
- README section generator (auto-insert hero image into README.md)
- Git commit hook (auto-generate assets on release)
- Template customization per repo (`.repo-media.json` config file)

## Git Considerations

The extension does **NOT** modify `.gitignore`. Generated media (especially videos) can be large. Users should decide whether to commit `./repo-media/` or add it to `.gitignore`. The `/media list` command helps audit what's been generated before deciding.
