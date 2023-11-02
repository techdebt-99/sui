// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use crate::benchmark_context::BenchmarkContext;
use crate::mock_account::Account;
use crate::tx_generator::TxGenerator;
use move_core_types::identifier::Identifier;
use std::collections::HashMap;
use std::path::PathBuf;
use sui_test_transaction_builder::TestTransactionBuilder;
use sui_types::base_types::{ObjectID, ObjectRef, SuiAddress};
use sui_types::programmable_transaction_builder::ProgrammableTransactionBuilder;
use sui_types::transaction::{
    Argument, CallArg, ObjectArg, Transaction, DEFAULT_VALIDATOR_GAS_PRICE,
};

pub struct MoveTxGenerator {
    move_package: ObjectID,
    num_input_objects: u8,
    computation: u8,
    root_objects: HashMap<SuiAddress, ObjectRef>,
}

impl MoveTxGenerator {
    pub async fn new(
        ctx: &mut BenchmarkContext,
        num_input_objects: u8,
        computation: u8,
        num_dynamic_fields: u64,
    ) -> Self {
        assert!(
            num_input_objects >= 2,
            "Move transaction requires at least 2 input objects"
        );
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.extend(["move_package"]);
        let move_package = ctx.publish_package(path, vec![]).await;
        let root_objects = ctx
            .preparing_dynamic_fields(move_package.0, num_dynamic_fields)
            .await;
        Self {
            move_package: move_package.0,
            num_input_objects,
            computation,
            root_objects,
        }
    }
}

impl TxGenerator for MoveTxGenerator {
    fn generate_tx(&self, account: Account) -> Transaction {
        let pt = {
            let mut builder = ProgrammableTransactionBuilder::new();
            // First transfer all input objects to the sender.
            // Except the gas coin which can only be transferred directly, all other objects
            // are transferred through Move.
            builder.transfer_arg(account.sender, Argument::GasCoin);
            for i in 1..self.num_input_objects {
                builder
                    .move_call(
                        self.move_package,
                        Identifier::new("benchmark").unwrap(),
                        Identifier::new("transfer_coin").unwrap(),
                        vec![],
                        vec![CallArg::Object(ObjectArg::ImmOrOwnedObject(
                            account.gas_objects[i as usize],
                        ))],
                    )
                    .unwrap();
            }

            if !self.root_objects.is_empty() {
                // PT command 3: Read all dynamic fields from the root object.
                let root_object = self.root_objects.get(&account.sender).unwrap();
                let root_object_arg = builder
                    .obj(ObjectArg::ImmOrOwnedObject(*root_object))
                    .unwrap();
                builder.programmable_move_call(
                    self.move_package,
                    Identifier::new("benchmark").unwrap(),
                    Identifier::new("read_dynamic_fields").unwrap(),
                    vec![],
                    vec![root_object_arg],
                );
            }

            // PT command 4: Run some computation.
            if self.computation > 0 {
                let computation_arg = builder.pure(self.computation as u64 * 100).unwrap();
                builder.programmable_move_call(
                    self.move_package,
                    Identifier::new("benchmark").unwrap(),
                    Identifier::new("run_computation").unwrap(),
                    vec![],
                    vec![computation_arg],
                );
            }
            builder.finish()
        };
        TestTransactionBuilder::new(
            account.sender,
            account.gas_objects[0],
            DEFAULT_VALIDATOR_GAS_PRICE,
        )
        .programmable(pt)
        .build_and_sign(account.keypair.as_ref())
    }

    fn name(&self) -> &'static str {
        "Programmable Move Transaction Generator"
    }
}
