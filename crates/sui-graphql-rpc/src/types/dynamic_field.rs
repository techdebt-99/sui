// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use async_graphql::*;
use move_core_types::language_storage::StructTag;
use move_core_types::value::{self, MoveStruct, MoveTypeLayout};
use sui_indexer::models_v2::objects::StoredObject;
use sui_package_resolver::Resolver;
use sui_types::dynamic_field::DynamicFieldInfo;
use sui_types::{dynamic_field::DynamicFieldType, TypeTag};

use super::{
    base64::Base64, move_object::MoveObject, move_value::MoveValue, sui_address::SuiAddress,
};
use crate::context_data::package_cache::PackageCache;
use crate::error::{code, Error};
use crate::{context_data::db_data_provider::PgManager, error::graphql_error};
use sui_types::object::Object as NativeSuiObject;

pub(crate) struct DynamicField {
    pub stored_object: StoredObject,
    pub df_object_id: SuiAddress,
    pub df_kind: DynamicFieldType,
}

#[derive(Union)]
pub(crate) enum DynamicFieldValue {
    MoveObject(MoveObject), // DynamicObject
    MoveValue(MoveValue),   // DynamicField
}

#[derive(InputObject)] // used as input object
pub(crate) struct DynamicFieldName {
    /// The string type of the DynamicField's 'name' field.
    /// A string representation of a Move primitive like 'u64', or a struct type like '0x2::kiosk::Listing'
    pub type_: String,
    /// The base64 encoded bcs serialization of the DynamicField's 'name' field.
    pub bcs: Base64,
}

#[Object]
impl DynamicField {
    /// The string type, data, and serialized value of the DynamicField's 'name' field.
    /// This field is used to uniquely identify a child of the parent object.
    async fn name(&self, ctx: &Context<'_>) -> Result<Option<MoveValue>> {
        let resolver: &Resolver<PackageCache> = ctx.data().map_err(|_| {
            graphql_error(
                code::INTERNAL_SERVER_ERROR,
                "Unable to fetch Package Cache.",
            )
        })?;
        let (struct_tag, move_struct) =
            deserialize_move_struct(&self.stored_object.serialized_object, resolver)
                .await
                .extend()?;

        // Get TypeTag of the DynamicField name from StructTag of the MoveStruct
        let type_tag = DynamicFieldInfo::try_extract_field_name(&struct_tag, &self.df_kind)
            .map_err(|e| Error::Internal(e.to_string()).extend())?;
        let undecorated: Option<value::MoveValue>;

        let name_move_value = extract_field_from_move_struct(move_struct, "name")?;
        println!("Before inner or undecorate: {:?}", name_move_value);

        if self.df_kind == DynamicFieldType::DynamicObject {
            let inner_name_move_value = match name_move_value {
                value::MoveValue::Struct(inner_struct) => {
                    extract_field_from_move_struct(inner_struct, "name")
                }
                _ => Err(Error::Internal("Expected a wrapper struct".to_string()).extend()),
            }?;
            println!("type tag: {}", type_tag.to_canonical_string(true));
            println!("Should be undecorated");
            undecorated = Some(inner_name_move_value.undecorate());
        } else {
            undecorated = Some(name_move_value.undecorate());
        }

        println!("Undecorated: {:?}", undecorated);

        let bcs = if let Some(ref undec) = undecorated {
            bcs::to_bytes(undec)
                .map_err(|e| Error::Internal(format!("Failed to serialize object: {e}")).extend())
        } else {
            Err(Error::Internal("No value to serialize".to_string()).extend())
        }?;

        let parent_object_id =
            SuiAddress::from_bytes(self.stored_object.owner_id.clone().unwrap().as_slice())?;

        let derived_id =
            sui_types::dynamic_field::derive_dynamic_field_id(parent_object_id, &type_tag, &bcs)
                .expect("oops");

        let dynamic_object_field_struct =
            sui_types::dynamic_field::DynamicFieldInfo::dynamic_object_field_wrapper(
                type_tag.clone(),
            );
        let dynamic_object_field_type = TypeTag::Struct(Box::new(dynamic_object_field_struct));
        let dynamic_object_field_id = sui_types::dynamic_field::derive_dynamic_field_id(
            parent_object_id,
            &dynamic_object_field_type,
            &bcs,
        )
        .expect("deriving dynamic field id can't fail");

        println!("self.df_object_id: {}", self.df_object_id);
        println!("type_tag: {}", type_tag.to_canonical_string(true));
        println!("derived df_obj_id: {}", derived_id);
        println!(
            "type_tag: {}",
            dynamic_object_field_type.to_canonical_string(true)
        );
        println!("derive wrapped_id: {}", dynamic_object_field_id);

        Ok(Some(MoveValue::new(
            type_tag.to_canonical_string(true),
            Base64::from(bcs),
        )))
    }

    /// The actual data stored in the dynamic field.
    async fn value(&self, ctx: &Context<'_>) -> Result<Option<DynamicFieldValue>> {
        if self.df_kind == DynamicFieldType::DynamicObject {
            let obj = ctx
                .data_unchecked::<PgManager>()
                .fetch_move_obj(self.df_object_id, None)
                .await
                .extend()?;
            Ok(obj.map(DynamicFieldValue::MoveObject))
        } else {
            let resolver: &Resolver<PackageCache> = ctx.data().map_err(|_| {
                graphql_error(
                    code::INTERNAL_SERVER_ERROR,
                    "Unable to fetch Package Cache.",
                )
            })?;
            let (struct_tag, move_struct) =
                deserialize_move_struct(&self.stored_object.serialized_object, resolver)
                    .await
                    .extend()?;

            // Get TypeTag of the DynamicField value from StructTag of the MoveStruct
            let type_tag = DynamicFieldInfo::try_extract_field_value(&struct_tag)
                .map_err(|e| Error::Internal(e.to_string()).extend())?;
            let value_move_value = extract_field_from_move_struct(move_struct, "value")?;
            let undecorated = value_move_value.undecorate();
            let bcs = bcs::to_bytes(&undecorated).map_err(|e| {
                Error::Internal(format!("Failed to serialize object: {e}")).extend()
            })?;
            Ok(Some(DynamicFieldValue::MoveValue(MoveValue::new(
                type_tag.to_canonical_string(true),
                Base64::from(bcs),
            ))))
        }
    }
}

pub(crate) async fn deserialize_move_struct(
    serialized_object: &[u8],
    resolver: &Resolver<PackageCache>,
) -> Result<(StructTag, MoveStruct)> {
    let native_object: NativeSuiObject = bcs::from_bytes(serialized_object)
        .map_err(|e| Error::Internal(format!("Failed to deserialize object: {e}")).extend())?;
    let move_object = native_object.data.try_as_move().ok_or_else(|| {
        Error::Internal("Failed to convert object into MoveObject".to_string()).extend()
    })?;
    let struct_tag = native_object
        .data
        .struct_tag()
        .ok_or_else(|| Error::Internal("StructTag missing on object".to_string()).extend())?;
    let contents = move_object.contents();
    let type_tag = TypeTag::Struct(Box::new(struct_tag.clone()));
    let move_type_layout = resolver.type_layout(type_tag.clone()).await?;
    let move_struct = match move_type_layout {
        MoveTypeLayout::Struct(move_struct_layout) => {
            MoveStruct::simple_deserialize(contents, &move_struct_layout)
        }
        _ => Err(Error::Internal("Object is not a move struct".to_string()).extend())?,
    }?;
    Ok((struct_tag, move_struct))
}

pub fn extract_field_from_move_struct(
    move_struct: MoveStruct,
    field_name: &str,
) -> Result<value::MoveValue> {
    match move_struct {
        MoveStruct::WithTypes { fields, .. } => {
            fields.into_iter().find_map(|(id, value)| {
                if id.to_string() == field_name {
                    Some(value)
                } else {
                    None
                }
            })
        }
        .ok_or_else(|| Error::Internal(format!("Field '{}' not found", field_name)).extend()),
        _ => Err(Error::Internal("Unexpected Move struct type".to_string()).extend()),
    }
}
