// Application State
export const state = {
    playlist: [],
    filteredPlaylist: [],
    filterText: '',
    selectedIndex: 0,
    playingIndex: -1,
    isPlaying: false,
    isPaused: false,
    volume: 1.0,
    previousVolume: 1.0,
    speed: 1.0,
    mode: 'normal', // 'normal' | 'command' | 'filter' | 'visual'
    pendingKey: null, // for multi-key commands like 'gg'
    countPrefix: '', // for count prefixes like '3j', '5k'
    visualStart: -1, // Start index for visual selection
    elapsed: 0,
    duration: null,
    progressInterval: null,
    repeatMode: 'off', // 'off' | 'one' | 'all'
    shuffleMode: false,
    shuffleHistory: [],
    shuffleIndex: -1,
    queue: [], // Array of playlist indices to play next
    queueViewOpen: false,
    queueSelectedIndex: 0,
    // Folder browsing
    viewMode: 'list', // 'list' | 'folder' | 'artist'
    rootFolder: null,
    currentFolder: null,
    previousRootFolder: null, // For going back after loading playlist
    folderContents: [],
    folderSelectedIndex: 0,
    folderParent: null,
    filteredFolderContents: [],
    // Artist view
    artistList: [], // Array of { name, track_count }
    artistSelectedIndex: 0,
    artistViewMode: 'list', // 'list' (artist list) | 'tracks' (artist's tracks)
    currentArtist: null, // Currently selected artist name
    artistTracks: [], // Tracks for the selected artist
    filteredArtistItems: [], // Filtered results for artist view (both modes)
    // Playlist manager
    playlistManagerOpen: false,
    playlistManagerIndex: 0,
    savedPlaylists: [],
    // Add to playlist picker
    addToPlaylistOpen: false,
    addToPlaylistIndex: 0,
    addToPlaylistTracks: [], // Track paths to add
    // Sleep timer
    sleepTimerEnd: null, // Timestamp when playback should stop
    sleepTimerInterval: null,
    // Bookmarks: { 'a': { track: 'path', position: seconds }, ... }
    bookmarks: {},
    // A-B Loop
    loopA: null, // Start position in seconds
    loopB: null, // End position in seconds
    loopInterval: null,
    // Settings
    settings: {
        relativenumber: false, // Show relative line numbers
        number: true, // Show line numbers
        // Add more settings as needed
    },
};

// DOM Elements
export const elements = {
    modeIndicator: document.getElementById('modeIndicator'),
    trackName: document.getElementById('trackName'),
    trackStatus: document.getElementById('trackStatus'),
    trackArt: document.querySelector('.track-art'),
    playBtn: document.getElementById('playBtn'),
    playIcon: document.getElementById('playIcon'),
    pauseIcon: document.getElementById('pauseIcon'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    stopBtn: document.getElementById('stopBtn'),
    volumeFill: document.getElementById('volumeFill'),
    volumeValue: document.getElementById('volumeValue'),
    playlist: document.getElementById('playlist'),
    playlistCount: document.getElementById('playlistCount'),
    helpBar: document.getElementById('helpBar'),
    commandLine: document.getElementById('commandLine'),
    commandInput: document.getElementById('commandInput'),
    filterLine: document.getElementById('filterLine'),
    filterInput: document.getElementById('filterInput'),
    helpModal: document.getElementById('helpModal'),
    progressBar: document.getElementById('progressBar'),
    progressFill: document.getElementById('progressFill'),
    timeElapsed: document.getElementById('timeElapsed'),
    timeTotal: document.getElementById('timeTotal'),
    queueModal: document.getElementById('queueModal'),
    queueList: document.getElementById('queueList'),
    speedIndicator: document.getElementById('speedIndicator'),
    sleepTimerIndicator: document.getElementById('sleepTimerIndicator'),
    loopIndicator: document.getElementById('loopIndicator'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
};
