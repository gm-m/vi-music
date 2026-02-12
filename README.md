# VI Music

A minimal, VIM-style music player built with Tauri and vanilla JavaScript.

## Features

- **VIM-style keybindings** for efficient navigation and control
- **Supported formats**: MP3, WAV, FLAC, AIF, AIFF, OGG, M4A
- **Minimal, dark UI** with a focus on keyboard-driven interaction
- **Command mode** for advanced operations
- **Regex-based, incremental search** to quickly find tracks as you type
- **Track duration display** in the playlist

## Keyboard Shortcuts

### Navigation
| Key | Action |
|-----|--------|
| `j` | Move selection down |
| `k` | Move selection up |
| `3j` / `5k` | Move N lines (count prefix) |
| `gg` | Go to first track |
| `5gg` | Go to line 5 |
| `G` | Go to last track |
| `5G` | Go to line 5 |

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
| `+` / `=` | Volume up (configurable: `volumestep`) |
| `-` | Volume down (configurable: `volumestep`) |
| `M` (Shift+m) | Mute/Unmute |

### Seeking
| Key | Action |
|-----|--------|
| `l` | Seek forward (configurable: `seektime`, default 5s) |
| `h` | Seek backward (configurable: `seektime`, default 5s) |
| `L` (Shift+l) | Seek forward large (configurable: `seektimelarge`, default 30s) |
| `H` (Shift+h) | Seek backward large (configurable: `seektimelarge`, default 30s) |

### Repeat & Shuffle
| Key | Action |
|-----|--------|
| `r` | Toggle repeat mode (off → one → all) |
| `S` (Shift+s) | Toggle shuffle mode |

### Speed
| Key | Action |
|-----|--------|
| `]` | Increase speed (configurable: `speedstep`, default +0.25x) |
| `[` | Decrease speed (configurable: `speedstep`, default -0.25x) |
| `\` | Reset speed to 1.0x |

### A-B Loop
| Key | Action |
|-----|--------|
| `b` | Set loop point A (start) |
| `B` (Shift+b) | Set loop point B (end) |
| `C` (Shift+c) | Clear loop |

### Bookmarks
| Key | Action |
|-----|--------|
| `m` + `a-z` | Set bookmark at current position |
| `'` + `a-z` | Jump to bookmark |

### Track Deletion
| Key | Action |
|-----|--------|
| `dd` | Delete selected track(s) from playlist |

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
| `R` (Shift+r) | Reload folder content |
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

### Artist View
Browse your library by artist. Use `:artists` to enter this view.
- **`j`/`k`** - Navigate artists or tracks
- **`Enter`** - Open artist's tracks / Play track
- **`Backspace`** - Go back to artist list / Exit artist view
- **`Tab`/`Esc`** - Return to playlist view
- Metadata is cached after first scan for instant loading

### Visual Mode
| Key | Action |
|-----|--------|
| `v` | Enter visual mode (multi-select) |
| `j` / `k` | Extend selection up/down |
| `gg` / `G` | Extend to top/bottom |
| `a` | Add selection to queue |
| `d` | Delete selected tracks from playlist |
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
- `:rename <old> > <new>` or `:rn` - Rename a playlist
- `:delplaylist <name>` or `:dp <name>` - Delete a playlist
- `:reload` or `:r` - Reload folder content
- `:jump <0-100>` or `:j <0-100>` - Jump to percentage of track
- `:jump m:ss` or `:j m:ss` - Jump to specific time (e.g., `:j 1:23`)
- `:jump h:mm:ss` - Jump to time for longer tracks (e.g., `:j 1:05:30`)
- `:addlib` or `:al` - Add folder to music library
- `:libs` or `:library` - Show library folders
- `:removelib <n>` or `:rl <n>` - Remove library folder by number
- `:scanlib` or `:scan` - Scan all library folders (recursive)
- `:back` or `:b` - Go back to previous folder/library
- `:artists` or `:ar` - Browse tracks by artist
- `:devices` or `:dev` - List available audio output devices
- `:device <n>` or `:d <n>` - Switch to audio device by number
- `:sleep <minutes>` - Set sleep timer (0 to cancel)
- `:sleep +<minutes>` - Add time to existing timer
- `:sleep -<minutes>` - Subtract time from timer
- `:sleep` - Show remaining sleep timer
- `:mark <a-z>` - Set bookmark at current position
- `:marks` - Show all bookmarks
- `:delmark <a-z>` - Delete a bookmark
- `:<line>d` - Delete track at line number (e.g., `:5d`)
- `:<start>,<end>d` - Delete range of tracks (e.g., `:10,20d`)
- `:set <option>` - Enable a setting (e.g., `:set relativenumber`)
- `:set no<option>` - Disable a setting (e.g., `:set norelativenumber`)
- `:set <option>!` - Toggle a setting
- `:set <option>?` - Query a setting value
- `:sort <field>` - Sort playlist (fields: `name`, `duration`, `path`)
- `:sort <field>!` - Sort in reverse order (e.g., `:sort name!`)
- `:set` - Show all current settings
- `:help` or `:h` - Show help
- `:quit` or `:q` - Quit application

### Settings

| Setting | Alias | Default | Description |
|---------|-------|---------|-------------|
| `relativenumber` | `rnu` | `false` | Show relative line numbers |
| `number` | `nu` | `true` | Show line numbers |
| `seektime` | `st` | `5` | Seek step in seconds (`l`/`h`) |
| `seektimelarge` | `stl` | `30` | Large seek step in seconds (`L`/`H`) |
| `speedstep` | `ss` | `0.25` | Speed change step (`]`/`[`) |
| `volumestep` | `vs` | `0.05` | Volume change step (`+`/`-`) |

Numeric settings are changed with `:set <setting>=<value>`, e.g., `:set seektime=10`.

Settings are persisted in `~/.config/vi-music/settings.json`.

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
