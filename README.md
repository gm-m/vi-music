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

### Speed
| Key | Action |
|-----|--------|
| `]` | Increase speed (+0.25x) |
| `[` | Decrease speed (-0.25x) |
| `\` | Reset speed to 1.0x |

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
| `J` / `K` | Move item down/up (reorder) |
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
| `Tab` | Toggle list/folder view |
| `Backspace` | Go up folder (in folder view) |
| `:` | Enter command mode |
| `?` | Toggle help |
| `Esc` | Close modals / Exit mode |

### Folder View
In folder view, you can browse the folder structure with a breadcrumb showing your current path:
- **`j`/`k`** - Navigate items
- **`Enter`** - Open folder or play track
- **`Backspace`** - Go to parent folder
- **`Tab`** - Switch back to list view
- **`A`** - Load all tracks from current folder as playlist
- **`v`** - Enter visual mode for multi-select
- **`p`** - Add selected file(s) to playlist

### Visual Mode
| Key | Action |
|-----|--------|
| `v` | Enter visual mode (multi-select) |
| `j` / `k` | Extend selection up/down |
| `gg` / `G` | Extend to top/bottom |
| `a` | Add selection to queue |
| `p` | Add selection to playlist |
| `v` / `Esc` | Exit visual mode |

### Playlists
| Key | Action |
|-----|--------|
| `p` | Add current track to playlist |

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
- `:save <name>` or `:w <name>` - Save current playlist
- `:load <name>` or `:e <name>` - Load a saved playlist
- `:playlists` or `:pl` - Open playlist manager
- `:delplaylist <name>` or `:dp <name>` - Delete a playlist
- `:sleep <minutes>` - Set sleep timer (0 to cancel)
- `:sleep` - Show remaining sleep timer
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
