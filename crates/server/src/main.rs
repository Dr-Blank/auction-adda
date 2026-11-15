use std::io::IsTerminal as _;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Context as _;
use axum::http::HeaderName;
use axum::serve::ListenerExt as _;
use clap::Parser;
use jiff::Timestamp;
use jiff::tz::TimeZone;
use server::http::{App, lock, router};
use server::rooms::{CreateLimit, Options, Rooms};
use tokio::net::TcpListener;
use tokio::signal::unix::{SignalKind, signal};
use tokio_util::sync::CancellationToken;
use tracing::level_filters::LevelFilter;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::time::FormatTime;

const PORT: u16 = 8787;
const CREATE_LIMIT: u32 = 10;
const SKIP_AFTER_MS: u64 = 30_000;
const CREATE_WINDOW_MS: u64 = 10 * 60 * 1000;
const SWEEP_EVERY: Duration = Duration::from_secs(3600);
/// How long shutdown waits for open requests before giving up on them.
const SHUTDOWN_WAIT: Duration = Duration::from_secs(5);

/// Auction Adda game server: serves the built app and the game over a WebSocket at /ws.
/// Every setting can also come from the environment variable named in brackets.
#[derive(Parser)]
#[command(version, about)]
struct Settings {
    /// HTTP and WebSocket port. 0 picks a free one
    #[arg(long, env = "PORT", default_value_t = PORT, value_parser = blank_is::<u16>)]
    port: u16,
    /// Address to listen on; `::` for IPv6
    #[arg(long, env = "HOST", default_value = "0.0.0.0")]
    host: String,
    /// Where room files are kept; empty keeps rooms in memory only
    #[arg(long, env = "DATA_DIR", default_value = "./data")]
    data_dir: String,
    /// Built frontend
    #[arg(long, env = "STATIC_DIR", default_value = "./dist")]
    static_dir: PathBuf,
    /// Comma-separated origins allowed to open the WebSocket, e.g. `https://adda.example.com`; empty allows any
    #[arg(long, env = "ALLOWED_ORIGINS", value_delimiter = ',')]
    allowed_origins: Vec<String>,
    /// Header holding the visitor's address behind a proxy, e.g. `cf-connecting-ip`. Set it only
    /// when the port is reachable through that proxy alone; otherwise anyone can forge it and get
    /// around `CREATE_LIMIT`. Empty uses the socket address
    #[arg(long, env = "CLIENT_IP_HEADER", default_value = "")]
    client_ip_header: String,
    /// Rooms one address may create per 10 minutes
    #[arg(long, env = "CREATE_LIMIT", default_value_t = CREATE_LIMIT, value_parser = blank_is::<u32>)]
    create_limit: u32,
    /// How long a seat must be disconnected before others can skip it, free it or take admin
    #[arg(long, env = "SKIP_AFTER_MS", default_value_t = SKIP_AFTER_MS, value_parser = blank_is::<u64>)]
    skip_after_ms: u64,
}

/// A number, or empty for the default (an empty variable in a compose file means "not set").
/// The default itself arrives here as text from `default_value_t`.
fn blank_is<T: FromStr>(raw: &str) -> Result<T, String>
where
    T::Err: std::fmt::Display,
{
    raw.trim().parse().map_err(|e| format!("{e}"))
}

/// Log timestamps in local time with the UTC offset, e.g. `2026-11-15T22:46:56.754+05:30`. The
/// zone comes from `TZ` (e.g. `Asia/Kolkata`) or `/etc/localtime`, else UTC.
struct LocalTime(TimeZone);

impl FormatTime for LocalTime {
    fn format_time(&self, w: &mut Writer<'_>) -> std::fmt::Result {
        let now = Timestamp::now().to_zoned(self.0.clone());
        write!(w, "{}", now.strftime("%Y-%m-%dT%H:%M:%S%.3f%:z"))
    }
}

/// Resolves on SIGINT or SIGTERM. Needed in the container, where the server is PID 1 and gets no
/// default signal handling.
async fn stop_signal() -> anyhow::Result<()> {
    let mut term = signal(SignalKind::terminate())?;
    let mut int = signal(SignalKind::interrupt())?;
    tokio::select! {
        _ = term.recv() => {}
        _ = int.recv() => {}
    }
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // RUST_LOG picks the detail, e.g. `debug` for every connection and refused message; default info.
    let zone = TimeZone::system();
    let zone_name = zone.iana_name().unwrap_or("fixed offset").to_owned();
    tracing_subscriber::fmt()
        .with_timer(LocalTime(zone))
        .with_env_filter(
            EnvFilter::builder()
                .with_default_directive(LevelFilter::INFO.into())
                .from_env_lossy(),
        )
        .with_ansi(std::io::stderr().is_terminal())
        .with_writer(std::io::stderr)
        .init();
    let s = Settings::parse();
    info!(
        version = env!("CARGO_PKG_VERSION"),
        time_zone = zone_name,
        static_dir = %s.static_dir.display(),
        allowed_origins = %if s.allowed_origins.is_empty() { "any".to_owned() } else { s.allowed_origins.join(",") },
        client_ip_header = if s.client_ip_header.is_empty() { "(socket address)" } else { s.client_ip_header.as_str() },
        create_limit = s.create_limit,
        skip_after_ms = s.skip_after_ms,
        "Starting"
    );

    let rooms = Rooms::new(Options {
        data_dir: (!s.data_dir.is_empty()).then(|| s.data_dir.into()),
        skip_after_ms: s.skip_after_ms,
        create_limit: CreateLimit {
            count: s.create_limit,
            window_ms: CREATE_WINDOW_MS,
        },
        ..Options::default()
    })
    .context("opening the data directory")?;
    let saved = rooms.len();
    let rooms = Arc::new(Mutex::new(rooms));

    let header = s.client_ip_header.trim();
    let client_ip_header = if header.is_empty() {
        None
    } else {
        Some(HeaderName::from_str(&header.to_lowercase()).context("CLIENT_IP_HEADER is not a header name")?)
    };
    let allowed_origins: Arc<[String]> = s
        .allowed_origins
        .iter()
        .map(|o| o.trim().to_owned())
        .filter(|o| !o.is_empty())
        .collect();

    let shutdown = CancellationToken::new();
    let app = App {
        rooms: Arc::clone(&rooms),
        allowed_origins,
        client_ip_header,
        shutdown: shutdown.clone(),
    };

    let listener = TcpListener::bind((s.host.as_str(), s.port))
        .await
        .with_context(|| format!("listening on {}:{}", s.host, s.port))?;
    let port = listener.local_addr()?.port();
    // Read by the test harness and the VS Code tasks; keep the wording.
    println!("Auction Adda listening on port {port} ({saved} saved rooms)");

    let stop = shutdown.clone();
    tokio::spawn(async move {
        if let Err(e) = stop_signal().await {
            warn!("Cannot listen for stop signals: {e}");
            return;
        }
        info!("Stopping: closing connections");
        stop.cancel();
    });

    let sweeper = Arc::clone(&rooms);
    let stop = shutdown.clone();
    tokio::spawn(async move {
        let mut every = tokio::time::interval_at(tokio::time::Instant::now() + SWEEP_EVERY, SWEEP_EVERY);
        loop {
            tokio::select! {
                () = stop.cancelled() => break,
                _ = every.tick() => lock(&sweeper).sweep(),
            }
        }
    });

    // Without TCP_NODELAY small WebSocket messages wait for the previous one's ACK.
    let listener = listener.tap_io(|tcp| {
        if let Err(e) = tcp.set_nodelay(true) {
            warn!("Cannot set TCP_NODELAY: {e}");
        }
    });
    let serve = axum::serve(
        listener,
        router(app, &s.static_dir).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown.clone().cancelled_owned());
    tokio::select! {
        result = serve => result?,
        () = async {
            shutdown.cancelled().await;
            tokio::time::sleep(SHUTDOWN_WAIT).await;
        } => warn!("Stopped waiting for open connections"),
    }
    lock(&rooms).flush();
    info!("Stopped");
    Ok(())
}
