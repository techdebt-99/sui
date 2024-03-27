// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use std::{
    env,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

// Build script to generate anemo RPC stubs.
fn main() -> Result<()> {
    let out_dir = PathBuf::from(env::var("OUT_DIR")?);
    build_tonic_services(&out_dir);
    build_anemo_services(&out_dir);

    println!("cargo:rerun-if-changed=build.rs");

    Ok(())
}

fn build_tonic_services(out_dir: &Path) {
    let codec_path = "tonic::codec::ProstCodec";

    let service = tonic_build::manual::Service::builder()
        .name("ConsensusService")
        .package("consensus")
        .comment("Consensus authority interface")
        .method(
            tonic_build::manual::Method::builder()
                .name("send_block")
                .route_name("SendBlock")
                .input_type("crate::network::SendBlockRequest")
                .output_type("crate::network::SendBlockResponse")
                .codec_path(codec_path)
                .build(),
        )
        .method(
            tonic_build::manual::Method::builder()
                .name("fetch_blocks")
                .route_name("FetchBlocks")
                .input_type("crate::network::FetchBlocksRequest")
                .output_type("crate::network::FetchBlocksResponse")
                .codec_path(codec_path)
                .build(),
        )
        .build();

    tonic_build::manual::Builder::new()
        .out_dir(out_dir)
        .compile(&[service]);
}

fn build_anemo_services(out_dir: &Path) {
    let mut automock_attribute = anemo_build::Attributes::default();
    automock_attribute.push_trait(".", r#"#[mockall::automock]"#);

    let codec_path = "mysten_network::codec::anemo::BcsSnappyCodec";

    let service = anemo_build::manual::Service::builder()
        .name("ConsensusRpc")
        .package("consensus")
        .attributes(automock_attribute.clone())
        .method(
            anemo_build::manual::Method::builder()
                .name("send_block")
                .route_name("SendBlock")
                .request_type("crate::network::SendBlockRequest")
                .response_type("crate::network::SendBlockResponse")
                .codec_path(codec_path)
                .build(),
        )
        .method(
            anemo_build::manual::Method::builder()
                .name("fetch_blocks")
                .route_name("FetchBlocks")
                .request_type("crate::network::FetchBlocksRequest")
                .response_type("crate::network::FetchBlocksResponse")
                .codec_path(codec_path)
                .build(),
        )
        .build();

    anemo_build::manual::Builder::new()
        .out_dir(out_dir)
        .compile(&[service]);
}
