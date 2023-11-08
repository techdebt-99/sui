// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use crate::benchmark_context::BenchmarkContext;
use crate::mock_account::Account;
use crate::tx_generator::TxGenerator;
use move_package::source_package::layout::SourcePackageLayout;
use move_package::source_package::manifest_parser::{
    parse_move_manifest_string, parse_source_manifest,
};
use move_package::source_package::parsed_manifest::{Dependency, DependencyKind};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use sui_move_build::{BuildConfig, CompiledPackage};
use sui_test_transaction_builder::TestTransactionBuilder;
use sui_types::base_types::ObjectID;
use sui_types::is_system_package;
use sui_types::transaction::{Transaction, DEFAULT_VALIDATOR_GAS_PRICE};
use tracing::info;

pub struct PackagePublishTxGenerator {
    compiled_package: CompiledPackage,
}

impl PackagePublishTxGenerator {
    pub async fn new(ctx: &mut BenchmarkContext, path: PathBuf) -> Self {
        let (unpublished_deps, root_name) = Self::get_all_unpublished_dependencies(&path);
        info!(
            "Number of unpublished dependencies: {:?}",
            unpublished_deps.len()
        );
        let mut published = HashMap::new();
        for (name, dep_path) in unpublished_deps {
            if published.contains_key(&name) {
                continue;
            }
            info!("Publishing dependency package {} at {:?}", name, dep_path);
            let mut deps: Vec<_> = published.clone().into_iter().collect();
            deps.push((name.clone(), ObjectID::ZERO));
            let package = ctx.publish_package(dep_path, deps).await;
            published.insert(name, package.0);
        }
        published.insert(root_name, ObjectID::ZERO);
        let mut build_config =
            BuildConfig::new_with_named_addresses(published.into_iter().collect());
        let compiled_package = build_config.build(path).unwrap();
        Self { compiled_package }
    }

    /// Given a path that points to a package root, return the full list of dependent packages paths.
    /// Each entry in the result is a tuple of package name and package path.
    /// This function is recursive and is_root is only set at the top level. This makes sure
    /// we don't add the top level package to the result.
    fn get_all_unpublished_dependencies(path: &Path) -> (Vec<(String, PathBuf)>, String) {
        let manifest_string =
            std::fs::read_to_string(path.join(SourcePackageLayout::Manifest.path())).unwrap();
        let toml_manifest = parse_move_manifest_string(manifest_string.clone()).unwrap();
        let root_manifest = parse_source_manifest(toml_manifest).unwrap();
        if let Some(addresses) = root_manifest.addresses {
            assert!(
                addresses
                    .into_values()
                    .all(|a| a.is_some_and(is_system_package)),
                "Addresses section must be empty. Manifest file: {:?}",
                path,
            );
        }
        // We make the assumption that package name and named address is always uppercase vs lowercase.
        let self_name = root_manifest.package.name.as_str().to_lowercase();
        let mut dependencies = vec![];
        for (_, dep) in root_manifest.dependencies {
            match dep {
                Dependency::External(_) => unimplemented!("External dependencies not supported"),
                Dependency::Internal(dep) => match dep.kind {
                    DependencyKind::Local(local) => {
                        let dep_path = path.join(local);
                        let (sub_dependencies, sub_name) =
                            Self::get_all_unpublished_dependencies(&dep_path);
                        dependencies.extend(sub_dependencies);
                        dependencies.push((sub_name, dep_path));
                    }
                    _ => unimplemented!("Only local dependencies supported"),
                },
            }
        }
        (dependencies, self_name)
    }
}

impl TxGenerator for PackagePublishTxGenerator {
    fn generate_tx(&self, account: Account) -> Transaction {
        let all_module_bytes = self.compiled_package.get_package_bytes(false);
        let dependencies = self.compiled_package.get_dependency_original_package_ids();
        TestTransactionBuilder::new(
            account.sender,
            account.gas_objects[0],
            DEFAULT_VALIDATOR_GAS_PRICE,
        )
        .publish_with_compiled_bytecode(all_module_bytes, dependencies)
        .build_and_sign(account.keypair.as_ref())
    }

    fn name(&self) -> &'static str {
        "Package Publish Transaction Generator"
    }
}
