//! HTTP routes and the WebSocket connection loop.
//!
//! ```text
//! GET /healthz   {"ok":true,"rooms":N}
//! GET /ws        origin check, then upgrade
//!     /assets/*  built assets, no fallback (a stale tab must not get HTML as a script)
//!     anything   built files, unknown paths get index.html with status 200
//! ```

use std::net::SocketAddr;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::header::{CACHE_CONTROL, ORIGIN, REFERRER_POLICY, X_CONTENT_TYPE_OPTIONS};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::get;
use tokio::sync::mpsc;
use tokio::time::{Instant, MissedTickBehavior, interval_at};
use tokio_util::sync::CancellationToken;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::{SetResponseHeader, SetResponseHeaderLayer};
use tracing::{debug, error, warn};

use crate::rooms::{ClientId, Rooms};

const MAX_MESSAGE_BYTES: usize = 4096;
const MAX_MESSAGES: u32 = 200;
const MESSAGE_WINDOW: Duration = Duration::from_secs(10);
const PING_EVERY: Duration = Duration::from_secs(25);
/// Messages waiting for one slow connection; a client that falls this far behind is dropped.
const QUEUE: usize = 256;
/// Close code for a policy violation (binary frames, too many messages).
const POLICY: u16 = 1008;
/// Close code for "going away", sent on shutdown.
const GOING_AWAY: u16 = 1001;

pub type SharedRooms = Arc<Mutex<Rooms>>;

/// Takes the lock even after a panic elsewhere: one failed message must not stop every later one.
pub fn lock(rooms: &Mutex<Rooms>) -> MutexGuard<'_, Rooms> {
    rooms.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone)]
pub struct App {
    pub rooms: SharedRooms,
    /// If not empty, WebSocket upgrades must come from one of these origins.
    pub allowed_origins: Arc<[String]>,
    /// Request header that carries the visitor's address when a proxy sits in front.
    pub client_ip_header: Option<HeaderName>,
    /// Cancelled on shutdown; every connection closes its socket.
    pub shutdown: CancellationToken,
}

pub fn router(app: App, static_dir: &Path) -> Router {
    let assets = SetResponseHeader::overriding(
        ServeDir::new(static_dir.join("assets")),
        CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    // `fallback`, not `not_found_service`: the latter would answer 404 while serving the app.
    let pages = SetResponseHeader::overriding(
        ServeDir::new(static_dir).fallback(ServeFile::new(static_dir.join("index.html"))),
        CACHE_CONTROL,
        HeaderValue::from_static("no-cache"),
    );
    Router::new()
        .route("/healthz", get(healthz))
        .route("/ws", get(upgrade))
        .nest_service("/assets", assets)
        .fallback_service(pages)
        .layer(SetResponseHeaderLayer::overriding(
            X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .with_state(app)
}

async fn healthz(State(app): State<App>) -> Json<serde_json::Value> {
    let rooms = lock(&app.rooms).len();
    Json(serde_json::json!({ "ok": true, "rooms": rooms }))
}

async fn upgrade(
    State(app): State<App>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !app.allowed_origins.is_empty() {
        let origin = headers.get(ORIGIN).and_then(|v| v.to_str().ok());
        if !origin.is_some_and(|o| app.allowed_origins.iter().any(|a| a == o)) {
            warn!(
                origin = origin.unwrap_or("(none)"),
                "Refused a WebSocket from an origin not in ALLOWED_ORIGINS"
            );
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    // Behind a proxy the socket address is the proxy; the visitor's address is in the configured header.
    let ip = app
        .client_ip_header
        .as_ref()
        .and_then(|h| headers.get(h))
        .and_then(|v| v.to_str().ok())
        .map_or_else(|| addr.ip().to_string(), str::to_owned);
    ws.max_message_size(MAX_MESSAGE_BYTES)
        .max_frame_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| connection(socket, ip, app))
}

/// Disconnects the client from the rooms when the connection ends, however it ends.
struct Leave {
    rooms: SharedRooms,
    id: ClientId,
}

impl Drop for Leave {
    fn drop(&mut self) {
        let mut rooms = lock(&self.rooms);
        if catch_unwind(AssertUnwindSafe(|| rooms.disconnect(self.id))).is_err() {
            error!(client = self.id, "Unexpected error disconnecting a client");
        }
    }
}

fn handle(rooms: &Mutex<Rooms>, id: ClientId, text: &str) {
    let mut rooms = lock(rooms);
    if catch_unwind(AssertUnwindSafe(|| rooms.handle_text(id, text))).is_err() {
        // The panic message and location are already on stderr, from the default panic hook.
        error!(client = id, "Unexpected error handling message ({} bytes)", text.len());
        rooms.reply_error(id, "Something went wrong on the server");
    }
}

async fn close(socket: &mut WebSocket, code: u16, reason: &'static str) {
    let frame = CloseFrame {
        code,
        reason: reason.into(),
    };
    let _ = socket.send(Message::Close(Some(frame))).await;
}

async fn connection(mut socket: WebSocket, ip: String, app: App) {
    let (tx, mut outbox) = mpsc::channel::<String>(QUEUE);
    let sink = Box::new(move |msg: &_| serde_json::to_string(msg).is_ok_and(|text| tx.try_send(text).is_ok()));
    let id = lock(&app.rooms).connect(ip.clone(), sink);
    debug!(client = id, ip, "Connected");
    let _leave = Leave {
        rooms: Arc::clone(&app.rooms),
        id,
    };

    // Keeps connections open through proxies and drops sockets that stopped answering.
    let mut ping = interval_at(Instant::now() + PING_EVERY, PING_EVERY);
    ping.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut heard = true;
    let mut window_start = Instant::now();
    let mut count = 0;

    let reason = loop {
        tokio::select! {
            () = app.shutdown.cancelled() => {
                close(&mut socket, GOING_AWAY, "Server restarting").await;
                break "server stopping";
            }
            out = outbox.recv() => {
                // None: the rooms dropped this client because it fell behind.
                let Some(text) = out else { break "fell behind" };
                if let Err(e) = socket.send(Message::Text(text.into())).await {
                    debug!(client = id, "Send failed: {e}");
                    break "send failed";
                }
            }
            _ = ping.tick() => {
                if !heard {
                    break "no answer to ping";
                }
                heard = false;
                if let Err(e) = socket.send(Message::Ping(Bytes::new())).await {
                    debug!(client = id, "Ping failed: {e}");
                    break "send failed";
                }
            }
            frame = socket.recv() => {
                let frame = match frame {
                    Some(Ok(frame)) => frame,
                    Some(Err(e)) => {
                        debug!(client = id, "Receive failed: {e}");
                        break "receive failed";
                    }
                    None => break "connection ended",
                };
                heard = true;
                match frame {
                    Message::Text(text) => {
                        if window_start.elapsed() > MESSAGE_WINDOW {
                            window_start = Instant::now();
                            count = 0;
                        }
                        count += 1;
                        if count > MAX_MESSAGES {
                            warn!(client = id, ip, "Closing: over {MAX_MESSAGES} messages in {MESSAGE_WINDOW:?}");
                            close(&mut socket, POLICY, "Too many messages").await;
                            break "too many messages";
                        }
                        handle(&app.rooms, id, text.as_str());
                    }
                    Message::Binary(_) => {
                        warn!(client = id, ip, "Closing: sent a binary frame");
                        close(&mut socket, POLICY, "Too many messages").await;
                        break "binary frame";
                    }
                    Message::Close(_) => break "closed by the browser",
                    Message::Ping(_) | Message::Pong(_) => {}
                }
            }
        }
    };
    debug!(client = id, ip, "Disconnected: {reason}");
}
