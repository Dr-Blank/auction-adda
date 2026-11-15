# syntax=docker/dockerfile:1

# Every build stage runs on the builder's own platform: the frontend is the same on every
# architecture, and the server is cross-compiled for the target with the xx helpers. The final
# stage has no RUN step, so an arm64 image builds without emulation.
#
# Needs BuildKit (docker buildx), which sets BUILDPLATFORM and TARGETPLATFORM. The classic
# builder does not: pass them yourself, e.g. --build-arg BUILDPLATFORM=linux/amd64.
ARG BUILDPLATFORM

FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY crates/engine/config.json ./crates/engine/
COPY src ./src
RUN npm run build

FROM --platform=$BUILDPLATFORM tonistiigi/xx:1.10.0 AS xx

FROM --platform=$BUILDPLATFORM lukemathwalker/cargo-chef:0.1.78-rust-alpine AS chef
COPY --from=xx / /
RUN apk add --no-cache clang lld
WORKDIR /app
# The toolchain version comes from this file, as in local builds and CI.
COPY rust-toolchain.toml ./
RUN rustup toolchain install

FROM chef AS plan
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS rust
ARG TARGETPLATFORM
RUN xx-apk add --no-cache musl-dev gcc
# Dependencies only: this layer stays cached until Cargo.lock changes.
COPY --from=plan /app/recipe.json ./
RUN xx-cargo chef cook --release --locked --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN xx-cargo build --release --locked -p server \
 && cp "target/$(xx-cargo --print-target-triple)/release/auction-adda" /auction-adda \
 && xx-verify --static /auction-adda \
 && mkdir /data

FROM alpine:3.24
WORKDIR /app
ENV PORT=8787 DATA_DIR=/data STATIC_DIR=/app/dist
COPY LICENSE ./
COPY --from=rust /auction-adda /usr/local/bin/auction-adda
COPY --from=web /app/dist ./dist
# Numeric, so no passwd entry is needed; 1000 is also the owner of volumes made by earlier images.
COPY --from=rust --chown=1000:1000 /data /data
USER 1000:1000
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["auction-adda"]
