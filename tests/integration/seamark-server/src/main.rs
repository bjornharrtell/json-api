use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::{Router, routing::get};
use sea_orm::{Database, DatabaseConnection, DatabaseTransaction};
use seamark::atomic::{
    AtomicOperationHandler, AtomicOperationOutcome, AtomicResourceChangeset, AtomicResult,
    AtomicTarget, LocalIdMap, PlannedAtomicOperation, PlannedOperation,
};
use seamark::authorization::{AuthorizationPolicy, SharedAuthorization};
use seamark::document::{Relationship, RelationshipData, ResourceIdentifier};
use seamark::http::{
    AdapterIncludedResource, AdapterResource, ApiBuilder, MutationAction, MutationAdapterError,
    MutationCommand, MutationOutcome, MutationResourceAdapter, QueryAdapterError,
    QueryCollectionResult, QueryResourceAdapter, QueryResourceResult, RelationshipMutation,
    ResourceMutationChangeset,
};
use seamark::limits::ExecutionLimits;
use seamark::projection::project_resource;
use seamark::query::{IncludeNode, PaginationConfig, ReadPlan};
use seamark::registry::{
    AttributeMapping, AttributePermission, RelationshipCardinality, RelationshipMapping,
    RelationshipPermission, ResourceDefinition, ResourcePermission, ResourceRegistry,
};
use serde_json::{Value, json};

#[derive(Default)]
struct Store {
    resources: BTreeMap<String, BTreeMap<String, AdapterResource>>,
    next_ids: BTreeMap<String, u64>,
}

impl Store {
    fn seeded() -> Self {
        let mut store = Self::default();
        store.next_ids.insert("articles".to_owned(), 3);
        store.next_ids.insert("people".to_owned(), 3);
        store.next_ids.insert("comments".to_owned(), 3);
        for resource in [
            article("1", "JSON:API paints my bikeshed!", "1", &["1", "2"]),
            article("2", "Other article", "2", &[]),
        ] {
            store.insert("articles", resource);
        }
        for resource in [
            person("1", "Dan", "Gebhardt", "dgeb"),
            person("2", "Jane", "Doe", "jdoe"),
        ] {
            store.insert("people", resource);
        }
        for resource in [
            comment("1", "First!", "1", "1"),
            comment("2", "I like XML better", "2", "1"),
        ] {
            store.insert("comments", resource);
        }
        store
    }

    fn insert(&mut self, resource_type: &str, resource: AdapterResource) {
        self.resources
            .entry(resource_type.to_owned())
            .or_default()
            .insert(resource.id.clone(), resource);
    }

    fn collection(&self, resource_type: &str) -> Vec<AdapterResource> {
        self.resources
            .get(resource_type)
            .map(|records| records.values().cloned().collect())
            .unwrap_or_default()
    }

    fn resource(&self, resource_type: &str, id: &str) -> Option<AdapterResource> {
        self.resources
            .get(resource_type)
            .and_then(|records| records.get(id))
            .cloned()
    }

    fn create(
        &mut self,
        resource_type: &str,
        changeset: ResourceMutationChangeset,
    ) -> AdapterResource {
        let next_id = self.next_ids.entry(resource_type.to_owned()).or_insert(1);
        let id = next_id.to_string();
        *next_id += 1;
        let resource = AdapterResource {
            id,
            attributes: changeset.attributes,
            relationships: changeset
                .relationships
                .into_iter()
                .map(|(name, data)| {
                    (
                        name,
                        Relationship {
                            data: Some(data),
                            ..Relationship::default()
                        },
                    )
                })
                .collect(),
        };
        self.insert(resource_type, resource.clone());
        resource
    }

    fn update(
        &mut self,
        resource_type: &str,
        id: &str,
        changeset: ResourceMutationChangeset,
    ) -> Result<AdapterResource, MutationAdapterError> {
        let Some(resource) = self
            .resources
            .get_mut(resource_type)
            .and_then(|records| records.get_mut(id))
        else {
            return Err(MutationAdapterError::NotFound);
        };
        resource.attributes.extend(changeset.attributes);
        for (name, data) in changeset.relationships {
            resource.relationships.insert(
                name,
                Relationship {
                    data: Some(data),
                    ..Relationship::default()
                },
            );
        }
        Ok(resource.clone())
    }

    fn next_id(&mut self, resource_type: &str) -> String {
        let next_id = self.next_ids.entry(resource_type.to_owned()).or_insert(1);
        let id = next_id.to_string();
        *next_id += 1;
        id
    }
}

#[derive(Clone)]
struct StoreAdapter(Arc<Mutex<Store>>);

#[async_trait]
impl QueryResourceAdapter for StoreAdapter {
    async fn collection(
        &self,
        resource: &ResourceDefinition,
        plan: &ReadPlan,
    ) -> Result<QueryCollectionResult, QueryAdapterError> {
        let store = self.0.lock().unwrap();
        let resources = store.collection(resource.type_name());
        let included = resources
            .iter()
            .flat_map(|record| {
                collect_included(&store, resource.type_name(), record, &plan.includes)
            })
            .collect::<BTreeMap<_, _>>()
            .into_values()
            .collect();
        Ok(QueryCollectionResult {
            resources,
            included,
        })
    }

    async fn resource(
        &self,
        resource: &ResourceDefinition,
        id: &str,
        plan: &ReadPlan,
    ) -> Result<Option<QueryResourceResult>, QueryAdapterError> {
        let store = self.0.lock().unwrap();
        let Some(record) = store.resource(resource.type_name(), id) else {
            return Ok(None);
        };
        let included = collect_included(&store, resource.type_name(), &record, &plan.includes)
            .into_values()
            .collect();
        Ok(Some(QueryResourceResult {
            resource: record,
            included,
        }))
    }
}

fn collect_included(
    store: &Store,
    resource_type: &str,
    resource: &AdapterResource,
    includes: &[IncludeNode],
) -> BTreeMap<(String, String), AdapterIncludedResource> {
    let mut included = BTreeMap::new();
    let mut visited = BTreeSet::new();
    collect_include_nodes(
        store,
        resource_type,
        resource,
        includes,
        &mut included,
        &mut visited,
    );
    included
}

fn collect_include_nodes(
    store: &Store,
    _resource_type: &str,
    resource: &AdapterResource,
    includes: &[IncludeNode],
    included: &mut BTreeMap<(String, String), AdapterIncludedResource>,
    visited: &mut BTreeSet<(String, String)>,
) {
    for node in includes {
        let Some(data) = resource
            .relationships
            .get(&node.model_field)
            .and_then(|relationship| relationship.data.as_ref())
        else {
            continue;
        };
        let identifiers = match data {
            RelationshipData::Null => Vec::new(),
            RelationshipData::One(identifier) => vec![identifier],
            RelationshipData::Many(identifiers) => identifiers.iter().collect(),
        };
        for identifier in identifiers {
            let Some(id) = identifier.id.as_deref() else {
                continue;
            };
            let key = (node.target_type.clone(), id.to_owned());
            let Some(related) = store.resource(&node.target_type, id) else {
                continue;
            };
            if visited.insert(key.clone()) {
                included.insert(
                    key,
                    AdapterIncludedResource {
                        resource_type: node.target_type.clone(),
                        resource: related.clone(),
                    },
                );
                collect_include_nodes(
                    store,
                    &node.target_type,
                    &related,
                    &node.children,
                    included,
                    visited,
                );
            }
        }
    }
}

#[derive(Clone)]
struct StoreMutationAdapter(Arc<Mutex<Store>>);

#[async_trait]
impl MutationResourceAdapter for StoreMutationAdapter {
    async fn execute(
        &self,
        resource: &ResourceDefinition,
        command: MutationCommand,
    ) -> Result<MutationOutcome, MutationAdapterError> {
        let mut store = self.0.lock().unwrap();
        match command {
            MutationCommand::Create { changeset } => Ok(MutationOutcome::Resource(
                store.create(resource.type_name(), changeset),
            )),
            MutationCommand::Update { id, changeset } => store
                .update(resource.type_name(), &id, changeset)
                .map(MutationOutcome::Resource),
            MutationCommand::Delete { id } => store
                .resources
                .get_mut(resource.type_name())
                .and_then(|records| records.remove(&id))
                .map(|_| MutationOutcome::Deleted)
                .ok_or(MutationAdapterError::NotFound),
            MutationCommand::ReadRelationship { id, relationship } => {
                let record = store
                    .resource(resource.type_name(), &id)
                    .ok_or(MutationAdapterError::NotFound)?;
                let data = record
                    .relationships
                    .get(relationship.model_field())
                    .and_then(|relationship| relationship.data.clone())
                    .unwrap_or_else(|| match relationship.cardinality() {
                        Some(seamark::registry::RelationshipCardinality::ToMany) => {
                            RelationshipData::Many(Vec::new())
                        }
                        _ => RelationshipData::Null,
                    });
                Ok(MutationOutcome::Relationship(data))
            }
            MutationCommand::ModifyRelationship {
                id,
                relationship,
                mutation,
            } => {
                let record = store
                    .resources
                    .get_mut(resource.type_name())
                    .and_then(|records| records.get_mut(&id))
                    .ok_or(MutationAdapterError::NotFound)?;
                let current = record
                    .relationships
                    .get(relationship.model_field())
                    .and_then(|relationship| relationship.data.clone())
                    .unwrap_or_else(|| match relationship.cardinality() {
                        Some(seamark::registry::RelationshipCardinality::ToMany) => {
                            RelationshipData::Many(Vec::new())
                        }
                        _ => RelationshipData::Null,
                    });
                let data = match mutation {
                    RelationshipMutation::Replace(data) => data,
                    RelationshipMutation::Add(additions) => {
                        let RelationshipData::Many(mut current) = current else {
                            return Err(MutationAdapterError::Conflict);
                        };
                        for addition in additions {
                            if !current.iter().any(|item| same_identity(item, &addition)) {
                                current.push(addition);
                            }
                        }
                        RelationshipData::Many(current)
                    }
                    RelationshipMutation::Remove(removals) => {
                        let RelationshipData::Many(mut current) = current else {
                            return Err(MutationAdapterError::Conflict);
                        };
                        current.retain(|item| {
                            !removals.iter().any(|removal| same_identity(item, removal))
                        });
                        RelationshipData::Many(current)
                    }
                };
                record.relationships.insert(
                    relationship.model_field().to_owned(),
                    Relationship {
                        data: Some(data.clone()),
                        ..Relationship::default()
                    },
                );
                Ok(MutationOutcome::Relationship(data))
            }
        }
    }
}

fn same_identity(left: &ResourceIdentifier, right: &ResourceIdentifier) -> bool {
    left.type_name == right.type_name && left.id == right.id
}

struct FixtureAuthorizationPolicy;

#[async_trait]
impl AuthorizationPolicy for FixtureAuthorizationPolicy {
    async fn authorize_read(
        &self,
        _resource_type: &str,
        _resource_id: Option<&str>,
        _headers: &axum::http::HeaderMap,
    ) -> bool {
        true
    }

    async fn authorize_mutation(
        &self,
        _action: MutationAction,
        _resource: &ResourceDefinition,
        _resource_id: Option<&str>,
        _command: &MutationCommand,
        _headers: &axum::http::HeaderMap,
    ) -> bool {
        true
    }

    async fn authorize_atomic(
        &self,
        _headers: &axum::http::HeaderMap,
        _operations: &[PlannedAtomicOperation],
    ) -> bool {
        true
    }
}

struct FixtureAtomicHandler {
    store: Arc<Mutex<Store>>,
    registry: Arc<ResourceRegistry>,
}

#[async_trait]
impl AtomicOperationHandler for FixtureAtomicHandler {
    async fn execute_operation(
        &self,
        _transaction: &DatabaseTransaction,
        operation: &PlannedOperation,
        local_ids: &LocalIdMap,
    ) -> Result<AtomicOperationOutcome, String> {
        let mut store = self.store.lock().unwrap();
        let (result, created_resource) = match operation {
            PlannedOperation::AddResource {
                data, changeset, ..
            } => {
                let id = data
                    .id
                    .clone()
                    .unwrap_or_else(|| store.next_id(&data.type_name));
                let resource = atomic_resource(changeset, &id, local_ids)?;
                store.insert(&data.type_name, resource.clone());
                let result = resource_value(&self.registry, &data.type_name, &resource)?;
                (
                    AtomicResult {
                        data: Some(result),
                        ..AtomicResult::default()
                    },
                    data.lid.as_ref().map(|_| identifier(&data.type_name, &id)),
                )
            }
            PlannedOperation::UpdateResource {
                target, changeset, ..
            } => {
                let (resource_type, id) = atomic_target(target, local_ids)?;
                let records = store
                    .resources
                    .get_mut(&resource_type)
                    .ok_or_else(|| format!("unknown resource type `{resource_type}`"))?;
                let resource = records
                    .get_mut(&id)
                    .ok_or_else(|| format!("resource `{resource_type}/{id}` was not found"))?;
                apply_atomic_changeset(resource, changeset, local_ids)?;
                let result = resource_value(&self.registry, &resource_type, resource)?;
                (
                    AtomicResult {
                        data: Some(result),
                        ..AtomicResult::default()
                    },
                    None,
                )
            }
            PlannedOperation::AddRelationshipMembers {
                reference,
                model_field,
                data,
            } => {
                let reference = local_ids.resolve_reference(reference)?;
                let resource_type = reference.type_name;
                let id = required_id(reference.id)?;
                let resource = store
                    .resources
                    .get_mut(&resource_type)
                    .and_then(|records| records.get_mut(&id))
                    .ok_or_else(|| format!("resource `{resource_type}/{id}` was not found"))?;
                let current = resource
                    .relationships
                    .get(model_field)
                    .and_then(|relationship| relationship.data.clone())
                    .unwrap_or_else(|| RelationshipData::Many(Vec::new()));
                let RelationshipData::Many(mut current) = current else {
                    return Err(format!("relationship `{model_field}` is not to-many"));
                };
                for member in data {
                    let member = local_ids.resolve(member)?;
                    if !current
                        .iter()
                        .any(|existing| same_identity(existing, &member))
                    {
                        current.push(member);
                    }
                }
                resource.relationships.insert(
                    model_field.clone(),
                    Relationship {
                        data: Some(RelationshipData::Many(current)),
                        ..Relationship::default()
                    },
                );
                (AtomicResult::default(), None)
            }
            PlannedOperation::UpdateRelationship {
                reference,
                model_field,
                data,
            } => {
                let reference = local_ids.resolve_reference(reference)?;
                let resource_type = reference.type_name;
                let id = required_id(reference.id)?;
                let resource = store
                    .resources
                    .get_mut(&resource_type)
                    .and_then(|records| records.get_mut(&id))
                    .ok_or_else(|| format!("resource `{resource_type}/{id}` was not found"))?;
                let data = resolve_relationship_data(data, local_ids)?;
                resource.relationships.insert(
                    model_field.clone(),
                    Relationship {
                        data: Some(data),
                        ..Relationship::default()
                    },
                );
                (AtomicResult::default(), None)
            }
            PlannedOperation::RemoveRelationshipMembers {
                reference,
                model_field,
                data,
            } => {
                let reference = local_ids.resolve_reference(reference)?;
                let resource_type = reference.type_name;
                let id = required_id(reference.id)?;
                let resource = store
                    .resources
                    .get_mut(&resource_type)
                    .and_then(|records| records.get_mut(&id))
                    .ok_or_else(|| format!("resource `{resource_type}/{id}` was not found"))?;
                let current = resource
                    .relationships
                    .get(model_field)
                    .and_then(|relationship| relationship.data.clone())
                    .unwrap_or_else(|| RelationshipData::Many(Vec::new()));
                let RelationshipData::Many(mut current) = current else {
                    return Err(format!("relationship `{model_field}` is not to-many"));
                };
                let removals = data
                    .iter()
                    .map(|member| local_ids.resolve(member))
                    .collect::<Result<Vec<_>, _>>()?;
                current.retain(|member| {
                    !removals
                        .iter()
                        .any(|removal| same_identity(member, removal))
                });
                resource.relationships.insert(
                    model_field.clone(),
                    Relationship {
                        data: Some(RelationshipData::Many(current)),
                        ..Relationship::default()
                    },
                );
                (AtomicResult::default(), None)
            }
            PlannedOperation::RemoveResource { target } => {
                let (resource_type, id) = atomic_target(target, local_ids)?;
                store
                    .resources
                    .get_mut(&resource_type)
                    .and_then(|records| records.remove(&id))
                    .ok_or_else(|| format!("resource `{resource_type}/{id}` was not found"))?;
                (AtomicResult::default(), None)
            }
        };
        Ok(AtomicOperationOutcome {
            result,
            created_resource,
        })
    }
}

fn atomic_resource(
    changeset: &AtomicResourceChangeset,
    id: &str,
    local_ids: &LocalIdMap,
) -> Result<AdapterResource, String> {
    let mut resource = AdapterResource {
        id: id.to_owned(),
        attributes: changeset.attributes.clone().unwrap_or_default(),
        ..AdapterResource::default()
    };
    apply_atomic_relationships(&mut resource, changeset, local_ids)?;
    Ok(resource)
}

fn apply_atomic_changeset(
    resource: &mut AdapterResource,
    changeset: &AtomicResourceChangeset,
    local_ids: &LocalIdMap,
) -> Result<(), String> {
    if let Some(attributes) = &changeset.attributes {
        resource.attributes.extend(attributes.clone());
    }
    apply_atomic_relationships(resource, changeset, local_ids)
}

fn apply_atomic_relationships(
    resource: &mut AdapterResource,
    changeset: &AtomicResourceChangeset,
    local_ids: &LocalIdMap,
) -> Result<(), String> {
    for (field, change) in changeset.relationships.iter().flatten() {
        if let Some(data) = &change.data {
            resource.relationships.insert(
                field.clone(),
                Relationship {
                    data: Some(resolve_relationship_data(data, local_ids)?),
                    ..Relationship::default()
                },
            );
        }
    }
    Ok(())
}

fn resolve_relationship_data(
    data: &RelationshipData,
    local_ids: &LocalIdMap,
) -> Result<RelationshipData, String> {
    match data {
        RelationshipData::Null => Ok(RelationshipData::Null),
        RelationshipData::One(identifier) => {
            Ok(RelationshipData::One(local_ids.resolve(identifier)?))
        }
        RelationshipData::Many(identifiers) => Ok(RelationshipData::Many(
            identifiers
                .iter()
                .map(|identifier| local_ids.resolve(identifier))
                .collect::<Result<Vec<_>, _>>()?,
        )),
    }
}

fn atomic_target(
    target: &AtomicTarget,
    local_ids: &LocalIdMap,
) -> Result<(String, String), String> {
    match target {
        AtomicTarget::Reference(reference) => {
            let reference = local_ids.resolve_reference(reference)?;
            Ok((reference.type_name, required_id(reference.id)?))
        }
        AtomicTarget::Href(href) => Err(format!("href target `{href}` is not configured")),
    }
}

fn required_id(id: Option<String>) -> Result<String, String> {
    id.ok_or_else(|| "the resource target has no persistent ID".to_owned())
}

fn resource_value(
    registry: &ResourceRegistry,
    resource_type: &str,
    resource: &AdapterResource,
) -> Result<Value, String> {
    let definition = registry
        .resource(resource_type)
        .map_err(|error| error.to_string())?;
    let projected = project_resource(definition, resource)
        .map_err(|error| format!("could not project `{resource_type}` resource: {error:?}"))?;
    serde_json::to_value(projected).map_err(|error| error.to_string())
}

fn article(id: &str, title: &str, author_id: &str, comment_ids: &[&str]) -> AdapterResource {
    AdapterResource {
        id: id.to_owned(),
        attributes: BTreeMap::from([("title".to_owned(), json!(title))]),
        relationships: BTreeMap::from([
            ("author_id".to_owned(), to_one("people", author_id)),
            (
                "comment_ids".to_owned(),
                Relationship {
                    data: Some(RelationshipData::Many(
                        comment_ids
                            .iter()
                            .map(|id| identifier("comments", id))
                            .collect(),
                    )),
                    ..Relationship::default()
                },
            ),
        ]),
    }
}

fn person(id: &str, first_name: &str, last_name: &str, twitter: &str) -> AdapterResource {
    AdapterResource {
        id: id.to_owned(),
        attributes: BTreeMap::from([
            ("first_name".to_owned(), json!(first_name)),
            ("last_name".to_owned(), json!(last_name)),
            ("twitter".to_owned(), json!(twitter)),
        ]),
        ..AdapterResource::default()
    }
}

fn comment(id: &str, body: &str, author_id: &str, article_id: &str) -> AdapterResource {
    AdapterResource {
        id: id.to_owned(),
        attributes: BTreeMap::from([("body".to_owned(), json!(body))]),
        relationships: BTreeMap::from([
            ("author_id".to_owned(), to_one("people", author_id)),
            ("article_id".to_owned(), to_one("articles", article_id)),
        ]),
    }
}

fn to_one(resource_type: &str, id: &str) -> Relationship {
    Relationship {
        data: Some(RelationshipData::One(identifier(resource_type, id))),
        ..Relationship::default()
    }
}

fn identifier(resource_type: &str, id: &str) -> ResourceIdentifier {
    ResourceIdentifier {
        type_name: resource_type.to_owned(),
        id: Some(id.to_owned()),
        ..ResourceIdentifier::default()
    }
}

fn attribute_mapping(
    public_name: &str,
    model_field: &str,
    permissions: &[AttributePermission],
) -> AttributeMapping {
    permissions.iter().fold(
        AttributeMapping::new(public_name, model_field),
        |mapping, permission| mapping.allow(*permission),
    )
}

fn relationship_mapping(
    public_name: &str,
    model_field: &str,
    target_type: &str,
    cardinality: RelationshipCardinality,
    permissions: &[RelationshipPermission],
) -> RelationshipMapping {
    let mapping = RelationshipMapping::new(public_name, model_field, target_type);
    let mapping = match cardinality {
        RelationshipCardinality::ToOne => mapping.to_one(),
        RelationshipCardinality::ToMany => mapping.to_many(),
    };
    permissions
        .iter()
        .fold(mapping, |mapping, permission| mapping.allow(*permission))
}

#[tokio::main]
async fn main() {
    let registry = Arc::new(
        ResourceRegistry::new([
            ResourceDefinition::new("articles", "id")
                .allow(ResourcePermission::Create)
                .allow(ResourcePermission::Update)
                .allow(ResourcePermission::AtomicCreate)
                .allow(ResourcePermission::AtomicUpdate)
                .mapped_attribute(attribute_mapping(
                    "title",
                    "title",
                    &[
                        AttributePermission::Create,
                        AttributePermission::Update,
                        AttributePermission::AtomicCreate,
                        AttributePermission::AtomicUpdate,
                    ],
                ))
                .mapped_relationship(relationship_mapping(
                    "author",
                    "author_id",
                    "people",
                    RelationshipCardinality::ToOne,
                    &[
                        RelationshipPermission::Include,
                        RelationshipPermission::ResourceCreate,
                        RelationshipPermission::AtomicResourceCreate,
                        RelationshipPermission::AtomicResourceUpdate,
                    ],
                ))
                .mapped_relationship(relationship_mapping(
                    "comments",
                    "comment_ids",
                    "comments",
                    RelationshipCardinality::ToMany,
                    &[
                        RelationshipPermission::Include,
                        RelationshipPermission::AtomicAdd,
                        RelationshipPermission::AtomicReplace,
                        RelationshipPermission::AtomicRemove,
                    ],
                )),
            ResourceDefinition::new("people", "id")
                .allow(ResourcePermission::AtomicCreate)
                .mapped_attribute(attribute_mapping(
                    "firstName",
                    "first_name",
                    &[AttributePermission::AtomicCreate],
                ))
                .mapped_attribute(attribute_mapping(
                    "lastName",
                    "last_name",
                    &[AttributePermission::AtomicCreate],
                ))
                .mapped_attribute(attribute_mapping(
                    "twitter",
                    "twitter",
                    &[AttributePermission::AtomicCreate],
                ))
                .mapped_relationship(relationship_mapping(
                    "comments",
                    "comment_ids",
                    "comments",
                    RelationshipCardinality::ToMany,
                    &[RelationshipPermission::Include],
                )),
            ResourceDefinition::new("comments", "id")
                .allow(ResourcePermission::Create)
                .mapped_attribute(attribute_mapping(
                    "body",
                    "body",
                    &[AttributePermission::Create],
                ))
                .mapped_relationship(relationship_mapping(
                    "author",
                    "author_id",
                    "people",
                    RelationshipCardinality::ToOne,
                    &[RelationshipPermission::Include],
                ))
                .mapped_relationship(relationship_mapping(
                    "article",
                    "article_id",
                    "articles",
                    RelationshipCardinality::ToOne,
                    &[RelationshipPermission::Include],
                )),
        ])
        .expect("resource definitions are valid"),
    );
    let store = Arc::new(Mutex::new(Store::seeded()));
    let adapter = Arc::new(StoreAdapter(Arc::clone(&store)));
    let authorization = Arc::new(SharedAuthorization::new(FixtureAuthorizationPolicy));
    let database: DatabaseConnection = Database::connect("sqlite::memory:")
        .await
        .expect("connect in-memory SQLite for Atomic transaction boundaries");
    let api = ApiBuilder::new(Arc::clone(&registry), authorization.clone())
        .queries(
            adapter,
            PaginationConfig::new(1, 100, Some(100), Some(100))
                .expect("pagination settings are valid"),
        )
        .mutations(Arc::new(StoreMutationAdapter(Arc::clone(&store))))
        .atomic_operations(
            database,
            authorization,
            Arc::new(FixtureAtomicHandler { store, registry }),
        )
        .limits(ExecutionLimits::new().max_atomic_operations(100))
        .try_build()
        .expect("Seamark API configuration is valid");
    let app = Router::new()
        .nest("/api", api)
        .route("/", get(|| async { "ok" }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:5556")
        .await
        .expect("bind integration-test port");
    axum::serve(listener, app)
        .await
        .expect("serve Seamark integration fixture");
}
