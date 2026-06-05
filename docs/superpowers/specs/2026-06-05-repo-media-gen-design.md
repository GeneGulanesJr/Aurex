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
| `prompt` | string | yes | — | What to generate (free text) |
| `asset_type` | enum | no | auto | `video_explainer`, `feature_showcase`, `architecture_diagram`, `screenshot_animation`, `voiceover`, `background_music`, `hero_image`, `social_asset`, `custom` |
| `target` | string | no | whole repo | What part of the repo (file, feature, module) |
| `provider` | string | no | auto | Provider name (default: first available) |
| `style` | enum | no | professional | `professional`, `playful`, `minimal`, `cinematic` |
| `duration` | number | no | auto | Seconds (video/audio). 6 or 10 for video |
| `resolution` | string | no | auto | `720p`, `768p`, `1080p` |
| `voice_id` | string | no | English_expressive_narrator | Voice for speech |
| `reference_image` | string | no | — | URL/path for image-to-video or subject reference |
| `output_name` | string | no | auto | Filename without extension |
| `output_dir` | string | no | `./repo-media/` | Output directory |
| `auto_confirm` | boolean | no | false | Skip confirmation/wizard |

**Asset type auto-detection:** When `asset_type` isn't specified, infer from prompt keywords:
- "explain", "how it works", "walkthrough" → `video_explainer`
- "showcase", "demo", "feature" → `feature_showcase`
- "architecture", "diagram", "structure" → `architecture_diagram`
- "animate", "animate this", "screenshot" → `screenshot_animation`
- "narrate", "voiceover", "read" → `voiceover`
- "music", "background", "soundtrack" → `background_music`
- "hero", "banner", "cover" → `hero_image`
- "social", "twitter", "og image", "thumbnail" → `social_asset`
- Fallback → `custom` (raw prompt passthrough)

**Resolution defaults by asset type:**
- Video: 768p (1080p for feature_showcase)
- Image: 16:9 aspect for hero/architecture, 1:1 for social

### `generate_media_suite` — Batch Generation

Generates multiple assets at once for a unified theme.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt` | string | yes | — | Overall theme/topic |
| `target` | string | no | whole repo | Feature, module, or "whole repo" |
| `assets` | string[] | no | all | Which assets to generate |
| `style` | enum | no | professional | Style for all assets |
| `output_dir` | string | no | `./repo-media/{target}/` | Output directory |
| `auto_confirm` | boolean | no | false | Skip plan review |

**Default suite assets (when `assets` omitted):**
1. Architecture diagram (image)
2. Hero image (image)
3. Voiceover narration (audio)
4. Background music (audio)
5. Video explainer (video)
6. Social assets — 1:1, 16:9, 9:16 (images)

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

## Repo-Aware Prompt Enhancement

The LLM crafts generation-ready prompts using its repo knowledge. The extension provides style templates per asset type:

### Templates

**`video_explainer`:**
> "Clear, step-by-step animated walkthrough. Professional motion graphics style. Show data flowing through components with labeled connections. Smooth transitions between concepts. {style_modifier}"

**`feature_showcase`:**
> "Dynamic, fast-paced demonstration. Highlight key interactions with zoom-in effects. Modern tech aesthetic. Show before/after where applicable. {style_modifier}"

**`architecture_diagram`:**
> "Clean technical architecture diagram, isometric or top-down view. Dark theme. Labeled components with connection lines showing data flow. Professional software engineering style. {style_modifier}"

**`screenshot_animation`:**
> "Smooth pan and zoom animation revealing UI elements. Subtle motion effects bringing static screenshot to life. {style_modifier}"

**`voiceover`:**
> (Text generated from repo docs/README by the LLM, passed as-is to TTS)

**`background_music`:**
> "Ambient, {style_modifier}, suitable as background for a technical video. Not distracting. Subtle electronic or orchestral."

**`hero_image`:**
> "Professional hero banner image for a GitHub README. Clean, modern design. {style_modifier}. Aspect ratio 16:9."

**`social_asset`:**
> "Eye-catching social media preview image. Bold typography-friendly layout. {style_modifier}."

### Style Modifiers

- `professional` → "corporate, polished, trustworthy"
- `playful` → "vibrant, creative, approachable"
- `minimal` → "clean, whitespace, understated"
- `cinematic` → "dramatic lighting, depth of field, moody"

## Wizard Flow

Triggered when required params are missing. Starts at the first gap.

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

## Suite Batch Flow

1. **Plan phase:** Show what will be generated (wizard review or auto)
2. **Generate sequentially:** One asset at a time, progress via `onUpdate`
3. **Continue on failure:** If one asset fails, log error and continue to next
4. **Summary:** Return list of all generated files

Progress example:
```
[1/6] Generating architecture diagram... ✓ saved (architecture-diagram.jpeg)
[2/6] Generating hero image... ✓ saved (hero-image.jpeg)
[3/6] Generating voiceover... ✓ saved (voiceover.mp3)
[4/6] Generating background music... ✓ saved (background-music.mp3)
[5/6] Generating video explainer... (processing, polling every 10s)... ✓ saved (explainer.mp4)
[6/6] Generating social assets... ✓ saved (social-1x1.jpeg, social-16x9.jpeg, social-9x16.jpeg)

📁 All assets saved to ./repo-media/lapis-memory-layer/
```

## Commands

### `/media` — Quick Access

| Subcommand | Description |
|---|---|
| `/media` | Opens interactive wizard |
| `/media suite` | Generate full suite for current context |
| `/media list` | List all generated media in `./repo-media/` |
| `/media clean` | Delete all generated media (with confirm) |

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
Suite mode: `{target-slug}/{asset-type}.{ext}`.

## Authentication

1. Try `ctx.modelRegistry` to find a MiniMax provider and get its resolved API key
2. Fall back to `MINIMAX_API_KEY` environment variable
3. If neither available, error with clear message:
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
    ├── prompts/
    │   └── templates.ts      # Repo-aware prompt templates per asset type
    ├── wizard.ts             # Interactive wizard for missing params
    └── package.json          # No external deps — uses node: fetch, Buffer
```

No npm dependencies required. Uses Node.js built-in `fetch`, `Buffer`, `fs`, `path`.

## Future Extensions

- Additional providers (Replicate, Runway, ElevenLabs, OpenAI DALL-E)
- Compose suite assets into a single video (FFmpeg)
- README section generator (auto-insert hero image into README.md)
- Git commit hook (auto-generate assets on release)
- Template customization per repo (`.repo-media.json` config file)
