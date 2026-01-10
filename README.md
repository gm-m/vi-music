# VI Music

A minimal, VIM-style music player built with Tauri and vanilla JavaScript.

## Features

- **VIM-style keybindings** for efficient navigation and control
- **Supported formats**: MP3, WAV, FLAC
- **Minimal, dark UI** with a focus on keyboard-driven interaction
- **Command mode** for advanced operations
- **Filter/search** to quickly find tracks
- **Track duration display** in the playlist

## Keyboard Shortcuts

### Navigation
| Key | Action |
|-----|--------|
| `j` | Move selection down |
| `k` | Move selection up |
| `gg` | Go to first track |
| `G` | Go to last track |

### Playback
| Key | Action |
|-----|--------|
| `Enter` | Play selected track |
| `Space` | Toggle pause |
| `s` | Stop playback |
| `J` (Shift+j) | Next track |
| `K` (Shift+k) | Previous track |

### Volume
| Key | Action |
|-----|--------|
| `+` / `=` | Volume up |
| `-` | Volume down |
| `m` | Mute/Unmute |

### Seeking
| Key | Action |
|-----|--------|
| `l` | Seek forward 5 seconds |
| `h` | Seek backward 5 seconds |
| `L` (Shift+l) | Seek forward 30 seconds |
| `H` (Shift+h) | Seek backward 30 seconds |

### Repeat & Shuffle
| Key | Action |
|-----|--------|
| `r` | Toggle repeat mode (off → one → all) |
| `S` (Shift+s) | Toggle shuffle mode |

### Queue
| Key | Action |
|-----|--------|
| `a` | Add selected track to queue |
| `A` (Shift+a) | Add to queue (or play if stopped) |
| `q` | Open queue view |

#### Queue View Controls
| Key | Action |
|-----|--------|
| `j` / `k` | Navigate up/down |
| `gg` / `G` | Go to top/bottom |
| `dd` | Remove selected from queue |
| `Enter` | Play selected immediately |
| `c` | Clear entire queue |
| `q` / `Esc` | Close queue view |

### Filter/Search
| Key | Action |
|-----|--------|
| `/` | Enter filter mode |
| `n` | Jump to next match |
| `N` | Jump to previous match |
| `Enter` | Confirm filter |
| `Esc` | Clear filter and exit |

### General
| Key | Action |
|-----|--------|
| `o` | Open folder |
| `:` | Enter command mode |
| `?` | Toggle help |
| `Esc` | Close modals / Exit mode |

### Visual Mode
| Key | Action |
|-----|--------|
| `v` | Enter visual mode (multi-select) |
| `j` / `k` | Extend selection up/down |
| `gg` / `G` | Extend to top/bottom |
| `a` | Add selection to queue |
| `v` / `Esc` | Exit visual mode |

## Command Mode

Press `:` to enter command mode. Available commands:

- `:open` or `:o` - Open folder dialog
- `:play [n]` or `:p [n]` - Play track number n
- `:stop` - Stop playback
- `:next` or `:n` - Next track
- `:prev` - Previous track
- `:vol [0-100]` - Set volume
- `:setdefault` or `:sd` - Set current folder as default (auto-loads on startup)
- `:cleardefault` or `:cd` - Clear default folder
- `:help` or `:h` - Show help
- `:quit` or `:q` - Quit application

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (1.70+)
- [Node.js](https://nodejs.org/) (18+)
- Platform-specific dependencies for Tauri

### Windows
No additional dependencies required.

### macOS
```bash
xcode-select --install
```

### Linux (Debian/Ubuntu)
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev
```

## Installation

1. Clone or navigate to the project directory:
```bash
cd vi-music
```

2. Install dependencies:
```bash
npm install
```

3. Run in development mode:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## License

MIT
