package app

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"yap/internal/app/backups"
	"yap/internal/app/bulktext"
	"yap/internal/app/imports"
	"yap/internal/app/profiles"
	"yap/internal/app/shortcuts"
	"yap/internal/app/updating"
	"yap/internal/audio"
	"yap/internal/indicator"
	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/startup"
	"yap/internal/storage"
	"yap/internal/tray"
	"yap/internal/vocabulary"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// App is the Wails API and coordinates shared desktop resources. Feature
// services own their workflows; mutable application state and service calls are
// serialized by mu unless a field or method documents a separate boundary.
type App struct {
	mu sync.Mutex

	// Lifetime: register workers under mu before releasing it. Shutdown cancels
	// work under mu, then releases it before draining wg and closing resources.
	ctx              context.Context
	lifecycleCancel  context.CancelFunc
	wg               sync.WaitGroup
	closing          bool
	shutdownOnce     sync.Once
	shutdownComplete atomic.Bool
	quitOnce         sync.Once

	// Release inputs are fixed before the desktop event loop starts.
	icon             []byte
	version          string
	updateRepository string

	// Feature services are serialized by mu, including queue reservations.
	profiles  profiles.Service
	imports   imports.Service
	bulkText  bulktext.Service
	shortcuts shortcuts.Service
	backups   backups.Service
	updating  updating.Service

	// Saved configuration and retention.
	store               *storage.Store
	settings            storage.Settings
	textConfig          textmodel.Config
	vocabulary          []vocabulary.Entry
	historyCleanupTimer *time.Timer

	// Shared capture and inference resources. Recording choices are frozen at
	// capture start so later preference edits cannot change in-flight work.
	recorder          audio.Capture
	microphones       func() ([]audio.Device, error)
	engine            speech.Engine
	speechMaintenance bool
	textEngine        textmodel.Engine
	id, path, target  string
	recordSettings    storage.Settings
	recordTextConfig  textmodel.Config
	recordVocabulary  []vocabulary.Entry
	timer             *time.Timer
	cancel            context.CancelFunc
	chatVoice         *chatVoiceCapture

	// Text jobs and discovery share cancellation identities with chat/voice.
	textJobID             string
	textCancel            context.CancelFunc
	cancelledTextRequests map[string]time.Time
	modelDiscoveryCancels map[string]context.CancelFunc

	// Published results and cached history while a feature owns the database.
	status               Status
	latestResult         *TemporaryResult
	homeResult           *HomeResult
	homeResultHidden     bool
	homeResultOperation  bool
	homeHistory          []storage.Session // Nil until a full legacy snapshot succeeds; empty snapshots are non-nil.
	homeHistoryWait      chan struct{}     // Closed on Home release if a history reader is waiting.
	legacyHistoryInUse   bool
	backupHistory        []storage.Session
	homeResultReadMu     sync.Mutex // Serializes result reads that release mu.
	audioLinks           map[string]audioLink
	audioServer          *http.Server
	audioOrigin          string
	historyPresenceKnown bool
	historyPresent       bool
	lastTrayState        *tray.State

	// Setup tests share the recorder. Audio callbacks update micSignal without mu.
	diagnostic                       DiagnosticResult
	diagnosticSettings               storage.Settings
	microphoneTested, shortcutTested bool
	micSignal                        atomic.Bool

	// Native shortcut adapters and foreground-application lookup.
	registerKey        func(string, func(), func()) (shortcutRegistration, error)
	registerKeyContext func(context.Context, string, func(), func()) (shortcutRegistration, error)
	activeApplication  func() string

	// Desktop handles and adapters are installed before callbacks start. Audio
	// level callbacks may publish through event without holding mu.
	desktop              *application.App
	window               *application.WebviewWindow
	notify               func(string, ...interface{})
	copyText             func(string) error
	copyTextContext      func(context.Context, string) error
	indicator            indicator.Controller
	indicatorActive      bool
	tray                 tray.Controller
	loginStart           startup.Controller
	showWindow           func()
	hideWindow           func()
	quitApplication      func()
	closeToTray          bool
	quitRequested        bool
	development          bool
	startupComplete      bool
	domReady             bool
	initialWindowApplied bool
	windowRequested      bool
}

func newApp(options Options) *App {
	return &App{
		icon:             options.Icon,
		version:          options.Version,
		updateRepository: options.UpdateRepository,
		textConfig:       textmodel.Defaults(),
		textEngine:       textmodel.Local{},
		settings:         storage.Defaults(),
		status:           Status{Phase: "idle", Message: "Ready when you are"},
		recorder:         audio.New(),
		microphones:      audio.Devices,
		engine:           speech.Local{},
	}
}
