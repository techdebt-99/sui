// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use crate::authority::AuthorityStore;
use async_trait::async_trait;
use dashmap::DashMap;
use itertools::izip;
use once_cell::unsync::OnceCell;
use std::collections::HashMap;
use std::sync::Arc;
use sui_storage::execution_cache::ExecutionCache;
use sui_types::{
    base_types::{
        EpochId, ObjectID, ObjectRef, SequenceNumber, TransactionDigest, TransactionEffectsDigest,
    },
    effects::TransactionEffects,
    error::{SuiError, SuiResult},
    inner_temporary_store::InnerTemporaryStore,
    object::Object,
    storage::{GetSharedLocks, ObjectKey, ObjectStore},
    transaction::{
        InputObjectKind, InputObjects, ObjectReadResult, ObjectReadResultKind,
        VerifiedSignedTransaction, VerifiedTransaction,
    },
};

#[allow(dead_code)]
pub struct InMemoryCache {
    objects: DashMap<ObjectID, Vec<Arc<Object>>>,

    // TODO: use concurrent LRU?
    transaction_objects: DashMap<TransactionDigest, Vec<Arc<Object>>>,

    //transactions: DashMap<TransactionDigest, Arc<VerifiedTransaction>>,
    //signed_transactions: DashMap<TransactionDigest, Arc<SignedTransaction>>,
    transaction_effects: DashMap<TransactionEffectsDigest, TransactionEffects>,

    executed_effects_digests: DashMap<TransactionDigest, TransactionEffectsDigest>,

    store: Arc<AuthorityStore>,
}

impl InMemoryCache {
    pub fn new(store: Arc<AuthorityStore>) -> Self {
        Self {
            objects: DashMap::new(),
            transaction_objects: DashMap::new(),
            transaction_effects: DashMap::new(),
            executed_effects_digests: DashMap::new(),
            store,
        }
    }
}

#[allow(unused_variables)]
#[async_trait]
impl ExecutionCache for InMemoryCache {
    async fn notify_read_objects_for_signing(
        &self,
        tx_digest: &TransactionDigest,
        input_object_kinds: &[InputObjectKind],
        epoch_id: EpochId,
    ) -> SuiResult<InputObjects> {
        let mut object_keys = Vec::with_capacity(input_object_kinds.len());
        let mut fetch_indices = Vec::with_capacity(input_object_kinds.len());
        let mut missing_shared_objects = Vec::new();

        for (i, kind) in input_object_kinds.iter().enumerate() {
            let obj_ref = match kind {
                InputObjectKind::MovePackage(id) => self.store.get_latest_object_ref(*id)?,
                InputObjectKind::SharedMoveObject { id, .. } => {
                    let objref = self.store.get_latest_object_ref(*id)?;
                    if objref.is_none() {
                        missing_shared_objects.push((i, *id));
                        continue;
                    }
                    objref
                }
                InputObjectKind::ImmOrOwnedMoveObject(objref) => Some(*objref),
            }
            .ok_or_else(|| SuiError::from(kind.object_not_found_error()))?;

            object_keys.push(ObjectKey::from(obj_ref));
            fetch_indices.push(i);
        }

        let mut results = vec![None; input_object_kinds.len()];

        let objects = self.store.multi_get_object_by_key(&object_keys)?;
        for (index, object) in fetch_indices.into_iter().zip(objects.into_iter()) {
            let object = object.ok_or_else(|| {
                SuiError::from(input_object_kinds[index].object_not_found_error())
            })?;

            results[index] = Some(ObjectReadResult {
                input_object_kind: input_object_kinds[index],
                object: ObjectReadResultKind::Object(Arc::new(object)),
            });
        }

        for (i, id) in missing_shared_objects {
            if let Some((version, digest)) = self
                .store
                .get_last_shared_object_deletion_info(&id, epoch_id)?
            {
                results[i] = Some(ObjectReadResult {
                    input_object_kind: input_object_kinds[i],
                    object: ObjectReadResultKind::DeletedSharedObject(version, digest),
                });
            } else {
                return Err(SuiError::from(
                    input_object_kinds[i].object_not_found_error(),
                ));
            }
        }

        Ok(results.into_iter().map(Option::unwrap).collect().into())
    }

    async fn read_objects_for_synchronous_execution(
        &self,
        tx_digest: &TransactionDigest,
        objects: &[InputObjectKind],
    ) -> SuiResult<InputObjects> {
        let mut results = Vec::with_capacity(objects.len());
        for kind in objects {
            let obj = match kind {
                InputObjectKind::MovePackage(id) | InputObjectKind::SharedMoveObject { id, .. } => {
                    self.store.get_object(id)?
                }
                InputObjectKind::ImmOrOwnedMoveObject(objref) => {
                    self.store.get_object_by_key(&objref.0, objref.1)?
                }
            }
            .ok_or_else(|| SuiError::from(kind.object_not_found_error()))?;
            results.push(ObjectReadResult::new(*kind, obj.into()));
        }
        Ok(results.into())
    }

    async fn lock_transaction(
        &self,
        signed_transaction: VerifiedSignedTransaction,
        mutable_input_objects: &[ObjectRef],
    ) -> SuiResult {
        todo!()
    }

    async fn notify_read_objects_for_execution(
        &self,
        shared_lock_store: &dyn GetSharedLocks,
        tx_digest: &TransactionDigest,
        input_object_kinds: &[InputObjectKind],
        epoch_id: EpochId,
    ) -> SuiResult<InputObjects> {
        let shared_locks_cell: OnceCell<HashMap<_, _>> = OnceCell::new();

        let mut object_keys = Vec::with_capacity(input_object_kinds.len());
        for input in input_object_kinds {
            match input {
                InputObjectKind::MovePackage(id) => {
                    let pkg_ref = self
                        .store
                        .get_latest_object_ref_or_tombstone(*id)?
                        .unwrap_or_else(|| {
                            panic!(
                                "Executable transaction {:?} depends on non-existent package {:?}",
                                tx_digest, id
                            )
                        });
                    object_keys.push(pkg_ref.into());
                }
                InputObjectKind::ImmOrOwnedMoveObject(objref) => object_keys.push(objref.into()),
                InputObjectKind::SharedMoveObject { id, .. } => {
                    let shared_locks = shared_locks_cell.get_or_try_init(|| {
                        Ok::<HashMap<ObjectID, SequenceNumber>, SuiError>(
                            shared_lock_store
                                .get_shared_locks(tx_digest)?
                                .into_iter()
                                .collect(),
                        )
                    })?;
                    // If we can't find the locked version, it means
                    // 1. either we have a bug that skips shared object version assignment
                    // 2. or we have some DB corruption
                    let version = shared_locks.get(id).unwrap_or_else(|| {
                        panic!(
                            "Shared object locks should have been set. tx_digest: {:?}, obj id: {:?}",
                            tx_digest, id
                        )
                    });
                    object_keys.push(ObjectKey(*id, *version));
                }
            }
        }

        let objects = self.store.multi_get_object_by_key(&object_keys)?;

        let mut result = Vec::with_capacity(objects.len());

        for (object, input, key) in izip!(
            objects.into_iter(),
            input_object_kinds,
            object_keys.into_iter()
        ) {
            result.push(match (object, input) {
                (Some(obj), input_object_kind) => ObjectReadResult {
                    input_object_kind: *input_object_kind,
                    object: obj.into(),
                },
                (None, InputObjectKind::SharedMoveObject { id, initial_shared_version, mutable }) => {
                    // If the object was deleted by a concurrently certified tx then return this separately
                    let version = key.1;
                    if let Some(dependency) = self.store.get_deleted_shared_object_previous_tx_digest(&id, &version, epoch_id)? {
                        ObjectReadResult {
                            input_object_kind: *input,
                            object: ObjectReadResultKind::DeletedSharedObject(version, dependency),
                        }
                    } else {
                        panic!("All dependencies of tx {:?} should have been executed now, but Shared Object id: {}, version: {} is absent in epoch {}", tx_digest, *id, version, epoch_id);
                    }
                },
                _ => panic!("All dependencies of tx {:?} should have been executed now, but obj {:?} is absent", tx_digest, key),
            });
        }

        Ok(result.into())
    }

    fn read_child_object(
        &self,
        tx_digest: &TransactionDigest,
        object: &ObjectID,
        version_bound: SequenceNumber,
    ) -> SuiResult<Arc<Object>> {
        todo!()
    }

    async fn write_transaction_outputs(
        &self,
        inner_temporary_store: InnerTemporaryStore,
        effects: &TransactionEffects,
        transaction: &VerifiedTransaction,
        epoch_id: EpochId,
    ) -> SuiResult {
        self.store
            .update_state(inner_temporary_store, transaction, effects, epoch_id)
            .await
    }

    async fn notify_read_effects_digest(
        &self,
        tx_digest: &TransactionDigest,
    ) -> SuiResult<TransactionEffectsDigest> {
        todo!()
    }

    async fn read_effects(
        &self,
        tx_digest: &TransactionDigest,
    ) -> SuiResult<Option<TransactionEffects>> {
        todo!()
    }
}
