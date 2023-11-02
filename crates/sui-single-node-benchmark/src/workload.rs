// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use crate::benchmark_context::BenchmarkContext;
use crate::command::WorkloadKind;
use crate::tx_generator::{
    MoveTxGenerator, NonMoveTxGenerator, PackagePublishTxGenerator, TxGenerator,
};
use std::sync::Arc;

#[derive(Clone)]
pub struct Workload {
    pub tx_count: u64,
    pub workload_kind: WorkloadKind,
    pub num_input_objects: u8,
}

impl Workload {
    pub fn new(tx_count: u64, workload_kind: WorkloadKind, num_input_objects: u8) -> Self {
        Self {
            tx_count,
            workload_kind,
            num_input_objects,
        }
    }

    pub(crate) fn num_accounts(&self) -> u64 {
        self.tx_count
    }

    pub(crate) fn gas_object_num_per_account(&self) -> u64 {
        self.num_input_objects as u64
    }

    pub(crate) async fn create_tx_generator(
        &self,
        ctx: &mut BenchmarkContext,
    ) -> Arc<dyn TxGenerator> {
        assert!(
            self.num_input_objects >= 1,
            "Each transaction requires at least 1 input object"
        );
        match self.workload_kind.clone() {
            WorkloadKind::NoMove => Arc::new(NonMoveTxGenerator::new(self.num_input_objects)),
            WorkloadKind::Move {
                num_dynamic_fields,
                computation,
            } => Arc::new(
                MoveTxGenerator::new(ctx, self.num_input_objects, computation, num_dynamic_fields)
                    .await,
            ),
            WorkloadKind::Publish { path } => {
                Arc::new(PackagePublishTxGenerator::new(ctx, path).await)
            }
        }
    }
}
