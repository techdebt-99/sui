// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use async_trait::async_trait;
use move_binary_format::CompiledModule;
use move_bytecode_utils::module_cache::GetModule;
use move_core_types::language_storage::ModuleId;
use prometheus::core::{Atomic, AtomicU64};
use std::collections::HashMap;
use std::sync::Arc;
use sui_storage::execution_cache::ExecutionCache;
use sui_types::base_types::{
    EpochId, ObjectID, ObjectRef, SequenceNumber, TransactionDigest, TransactionEffectsDigest,
    VersionNumber,
};
use sui_types::effects::TransactionEffects;
use sui_types::error::{SuiError, SuiResult};
use sui_types::inner_temporary_store::InnerTemporaryStore;
use sui_types::object::{Object, Owner};
use sui_types::storage::{
    get_module_by_id, BackingPackageStore, ChildObjectResolver, GetSharedLocks, MarkerTableQuery,
    ObjectStore, ParentSync,
};
use sui_types::transaction::{
    InputObjectKind, InputObjects, ObjectReadResult, VerifiedSignedTransaction, VerifiedTransaction,
};

// TODO: We won't need a special purpose InMemoryObjectStore once the InMemoryCache is ready.
#[derive(Clone)]
pub(crate) struct InMemoryObjectStore {
    objects: Arc<HashMap<ObjectID, Object>>,
    num_object_reads: Arc<AtomicU64>,
}

impl InMemoryObjectStore {
    pub(crate) fn new(objects: HashMap<ObjectID, Object>) -> Self {
        Self {
            objects: Arc::new(objects),
            num_object_reads: Arc::new(AtomicU64::new(0)),
        }
    }

    pub(crate) fn get_num_object_reads(&self) -> u64 {
        self.num_object_reads.get()
    }
}

#[allow(unused_variables)]
#[async_trait]
impl ExecutionCache for InMemoryObjectStore {
    async fn notify_read_objects_for_signing(
        &self,
        tx_digest: &TransactionDigest,
        objects: &[InputObjectKind],
        epoch_id: EpochId,
    ) -> SuiResult<InputObjects> {
        todo!()
    }

    async fn read_objects_for_synchronous_execution(
        &self,
        tx_digest: &TransactionDigest,
        objects: &[InputObjectKind],
    ) -> SuiResult<InputObjects> {
        todo!()
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
        shared_locks: &dyn GetSharedLocks,
        tx_digest: &TransactionDigest,
        objects: &[InputObjectKind],
        epoch_id: EpochId,
    ) -> SuiResult<InputObjects> {
        Ok(objects
            .iter()
            .map(|kind| {
                let object = match kind {
                    InputObjectKind::MovePackage(id) => self.get_package_object(id),
                    InputObjectKind::ImmOrOwnedMoveObject(objref) => {
                        self.get_object_by_key(&objref.0, objref.1)
                    }
                    InputObjectKind::SharedMoveObject { id, .. } => self.get_object(id),
                }
                .expect("must succeed")
                .expect("object must be present");
                ObjectReadResult::new(*kind, object.into())
            })
            .collect::<Vec<_>>()
            .into())
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
        todo!()
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

impl ObjectStore for InMemoryObjectStore {
    fn get_object(&self, object_id: &ObjectID) -> Result<Option<Object>, SuiError> {
        self.num_object_reads.inc_by(1);
        Ok(self.objects.get(object_id).cloned())
    }

    fn get_object_by_key(
        &self,
        object_id: &ObjectID,
        version: VersionNumber,
    ) -> Result<Option<Object>, SuiError> {
        Ok(self.get_object(object_id).unwrap().and_then(|o| {
            if o.version() == version {
                Some(o.clone())
            } else {
                None
            }
        }))
    }
}

impl BackingPackageStore for InMemoryObjectStore {
    fn get_package_object(&self, package_id: &ObjectID) -> SuiResult<Option<Object>> {
        Ok(self.get_object(package_id).unwrap().and_then(|o| {
            if o.is_package() {
                Some(o.clone())
            } else {
                None
            }
        }))
    }
}

impl ChildObjectResolver for InMemoryObjectStore {
    fn read_child_object(
        &self,
        parent: &ObjectID,
        child: &ObjectID,
        child_version_upper_bound: SequenceNumber,
    ) -> SuiResult<Option<Object>> {
        Ok(self.get_object(child).unwrap().and_then(|o| {
            if o.version() <= child_version_upper_bound
                && o.owner == Owner::ObjectOwner((*parent).into())
            {
                Some(o.clone())
            } else {
                None
            }
        }))
    }

    fn get_object_received_at_version(
        &self,
        _owner: &ObjectID,
        _receiving_object_id: &ObjectID,
        _receive_object_at_version: SequenceNumber,
        _epoch_id: EpochId,
    ) -> SuiResult<Option<Object>> {
        unimplemented!()
    }
}

impl GetModule for InMemoryObjectStore {
    type Error = SuiError;
    type Item = CompiledModule;

    fn get_module_by_id(&self, id: &ModuleId) -> Result<Option<Self::Item>, Self::Error> {
        get_module_by_id(self, id)
    }
}

impl MarkerTableQuery for InMemoryObjectStore {
    fn have_received_object_at_version(
        &self,
        _object_id: &ObjectID,
        _version: VersionNumber,
        _epoch_id: EpochId,
    ) -> Result<bool, SuiError> {
        // Currently the workload doesn't yet support receiving objects.
        unimplemented!()
    }
    fn get_deleted_shared_object_previous_tx_digest(
        &self,
        _object_id: &ObjectID,
        _version: &SequenceNumber,
        _epoch_id: EpochId,
    ) -> Result<Option<TransactionDigest>, SuiError> {
        // Currently the workload doesn't yet support deleted shared objects
        unimplemented!()
    }
    fn is_shared_object_deleted(
        &self,
        _object_id: &ObjectID,
        _epoch_id: EpochId,
    ) -> Result<bool, SuiError> {
        unimplemented!()
    }
}

impl ParentSync for InMemoryObjectStore {
    fn get_latest_parent_entry_ref_deprecated(
        &self,
        _object_id: ObjectID,
    ) -> SuiResult<Option<ObjectRef>> {
        unreachable!()
    }
}

impl GetSharedLocks for InMemoryObjectStore {
    fn get_shared_locks(
        &self,
        _transaction_digest: &TransactionDigest,
    ) -> Result<Vec<(ObjectID, SequenceNumber)>, SuiError> {
        unreachable!()
    }
}
