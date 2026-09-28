mod entities {
    pub mod article {
        use sea_orm::entity::prelude::*;

        #[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
        #[sea_orm(table_name = "articles")]
        pub struct Model {
            #[sea_orm(primary_key)]
            pub id: i32,
            pub title: String,
            pub author_id: Option<i32>,
        }

        #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
        pub enum Relation {}

        impl ActiveModelBehavior for ActiveModel {}
    }

    pub mod comment {
        use sea_orm::entity::prelude::*;

        #[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
        #[sea_orm(table_name = "comments")]
        pub struct Model {
            #[sea_orm(primary_key)]
            pub id: i32,
            pub body: String,
            pub author_id: Option<i32>,
            pub article_id: Option<i32>,
        }

        #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
        pub enum Relation {}

        impl ActiveModelBehavior for ActiveModel {}
    }

    pub mod person {
        use sea_orm::entity::prelude::*;

        #[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
        #[sea_orm(table_name = "people")]
        pub struct Model {
            #[sea_orm(primary_key)]
            pub id: i32,
            pub first_name: String,
            pub last_name: String,
            pub twitter: String,
        }

        #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
        pub enum Relation {}

        impl ActiveModelBehavior for ActiveModel {}
    }
}

use std::sync::Arc;

use async_trait::async_trait;
use axum::{Router, http::HeaderMap, routing::get};
use sea_orm::{
    ActiveModelTrait, ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend,
    Schema, Set,
};
use seamark::atomic::PlannedAtomicOperation;
use seamark::authorization::{AuthorizationPolicy, SharedAuthorization};
use seamark::http::{ApiBuilder, MutationAction, MutationCommand};
use seamark::limits::ExecutionLimits;
use seamark::query::PaginationConfig;
use seamark::registry::{
    AttributePermission, RelationshipPermission, RelationshipReassignment, ResourceDefinition,
    ResourcePermission, ResourceRegistry,
};
use seamark::seaorm::{
    AllowAllSeaOrmReadGuard, SeaOrmColumnValueCodec, SeaOrmQueryAdapter, SeaOrmQueryExecutor,
    attribute_mapping, relationship_mapping, to_many_foreign_key_mapping,
};
use seamark::seaorm_mutation::{
    SeaOrmAtomicOperationDispatcher, SeaOrmBaseMutationAdapter, SeaOrmResourceMutationHandler,
    SeaOrmToManyForeignKeyMutationHandler,
};

struct FixtureAuthorizationPolicy;

#[async_trait]
impl AuthorizationPolicy for FixtureAuthorizationPolicy {
    async fn authorize_read(
        &self,
        _resource_type: &str,
        _resource_id: Option<&str>,
        _headers: &HeaderMap,
    ) -> bool {
        true
    }

    async fn authorize_mutation(
        &self,
        _action: MutationAction,
        _resource: &ResourceDefinition,
        _resource_id: Option<&str>,
        _command: &MutationCommand,
        _headers: &HeaderMap,
    ) -> bool {
        true
    }

    async fn authorize_atomic(
        &self,
        _headers: &HeaderMap,
        _operations: &[PlannedAtomicOperation],
    ) -> bool {
        true
    }
}

fn build_registry() -> ResourceRegistry {
    ResourceRegistry::new([
        ResourceDefinition::new("articles", "id")
            .allow(ResourcePermission::Create)
            .allow(ResourcePermission::Update)
            .allow(ResourcePermission::AtomicCreate)
            .allow(ResourcePermission::AtomicUpdate)
            .mapped_attribute(
                attribute_mapping::<entities::article::Entity>(
                    "title",
                    entities::article::Column::Title,
                )
                .allow(AttributePermission::Create)
                .allow(AttributePermission::Update)
                .allow(AttributePermission::AtomicCreate)
                .allow(AttributePermission::AtomicUpdate),
            )
            .mapped_relationship(
                relationship_mapping::<entities::article::Entity>(
                    "author",
                    entities::article::Column::AuthorId,
                    "people",
                    true,
                )
                .allow(RelationshipPermission::Include)
                .allow(RelationshipPermission::ResourceCreate)
                .allow(RelationshipPermission::AtomicResourceCreate)
                .allow(RelationshipPermission::AtomicResourceUpdate),
            )
            .mapped_relationship(
                to_many_foreign_key_mapping::<entities::comment::Entity>(
                    "comments",
                    "comments",
                    "comments",
                    entities::comment::Column::ArticleId,
                    true,
                    RelationshipReassignment::Deny,
                )
                .allow(RelationshipPermission::Include)
                .allow(RelationshipPermission::AtomicAdd)
                .allow(RelationshipPermission::AtomicReplace)
                .allow(RelationshipPermission::AtomicRemove),
            ),
        ResourceDefinition::new("people", "id")
            .allow(ResourcePermission::AtomicCreate)
            .mapped_attribute(
                attribute_mapping::<entities::person::Entity>(
                    "firstName",
                    entities::person::Column::FirstName,
                )
                .allow(AttributePermission::AtomicCreate),
            )
            .mapped_attribute(
                attribute_mapping::<entities::person::Entity>(
                    "lastName",
                    entities::person::Column::LastName,
                )
                .allow(AttributePermission::AtomicCreate),
            )
            .mapped_attribute(
                attribute_mapping::<entities::person::Entity>(
                    "twitter",
                    entities::person::Column::Twitter,
                )
                .allow(AttributePermission::AtomicCreate),
            )
            .mapped_relationship(
                to_many_foreign_key_mapping::<entities::comment::Entity>(
                    "comments",
                    "comments",
                    "comments",
                    entities::comment::Column::AuthorId,
                    true,
                    RelationshipReassignment::Deny,
                )
                .allow(RelationshipPermission::Include),
            ),
        ResourceDefinition::new("comments", "id")
            .allow(ResourcePermission::Create)
            .mapped_attribute(
                attribute_mapping::<entities::comment::Entity>(
                    "body",
                    entities::comment::Column::Body,
                )
                .allow(AttributePermission::Create),
            )
            .mapped_relationship(
                relationship_mapping::<entities::comment::Entity>(
                    "author",
                    entities::comment::Column::AuthorId,
                    "people",
                    true,
                )
                .allow(RelationshipPermission::Include),
            )
            .mapped_relationship(
                relationship_mapping::<entities::comment::Entity>(
                    "article",
                    entities::comment::Column::ArticleId,
                    "articles",
                    true,
                )
                .allow(RelationshipPermission::Include),
            ),
    ])
    .expect("resource definitions are valid")
}

async fn setup_database() -> DatabaseConnection {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1);
    options.sqlx_logging(false);
    let database = Database::connect(options)
        .await
        .expect("connect in-memory SQLite database");

    let schema = Schema::new(DbBackend::Sqlite);
    for statement in [
        schema.create_table_from_entity(entities::person::Entity),
        schema.create_table_from_entity(entities::article::Entity),
        schema.create_table_from_entity(entities::comment::Entity),
    ] {
        database
            .execute(&statement)
            .await
            .expect("create integration fixture table");
    }

    seed_database(&database).await;
    database
}

async fn seed_database(database: &DatabaseConnection) {
    for (first_name, last_name, twitter) in [("Dan", "Gebhardt", "dgeb"), ("Jane", "Doe", "jdoe")] {
        entities::person::ActiveModel {
            first_name: Set(first_name.to_owned()),
            last_name: Set(last_name.to_owned()),
            twitter: Set(twitter.to_owned()),
            ..Default::default()
        }
        .insert(database)
        .await
        .expect("seed person");
    }

    for (title, author_id) in [("JSON:API paints my bikeshed!", 1), ("Other article", 2)] {
        entities::article::ActiveModel {
            title: Set(title.to_owned()),
            author_id: Set(Some(author_id)),
            ..Default::default()
        }
        .insert(database)
        .await
        .expect("seed article");
    }

    for (body, author_id) in [("First!", 1), ("I like XML better", 2)] {
        entities::comment::ActiveModel {
            body: Set(body.to_owned()),
            author_id: Set(Some(author_id)),
            article_id: Set(Some(1)),
            ..Default::default()
        }
        .insert(database)
        .await
        .expect("seed comment");
    }
}

#[tokio::main]
async fn main() {
    let registry = Arc::new(build_registry());
    let database = setup_database().await;
    let read_guard = Arc::new(AllowAllSeaOrmReadGuard);
    let mut queries = SeaOrmQueryAdapter::new();

    queries
        .register(
            database.clone(),
            SeaOrmQueryExecutor::<entities::article::Entity, _, _>::mapped(
                registry.as_ref().clone(),
                "articles",
            )
            .expect("article query mapping is valid"),
            read_guard.clone(),
            None,
        )
        .expect("register article query executor");
    queries
        .register(
            database.clone(),
            SeaOrmQueryExecutor::<entities::person::Entity, _, _>::mapped(
                registry.as_ref().clone(),
                "people",
            )
            .expect("person query mapping is valid"),
            read_guard.clone(),
            None,
        )
        .expect("register person query executor");
    queries
        .register(
            database.clone(),
            SeaOrmQueryExecutor::<entities::comment::Entity, _, _>::mapped(
                registry.as_ref().clone(),
                "comments",
            )
            .expect("comment query mapping is valid"),
            read_guard,
            None,
        )
        .expect("register comment query executor");

    let article_handler = Arc::new(
        SeaOrmResourceMutationHandler::<entities::article::Entity, _>::new(
            registry.as_ref(),
            "articles",
            SeaOrmColumnValueCodec::<entities::article::Entity>::default(),
        )
        .expect("article mutation mapping is valid"),
    );
    let person_handler = Arc::new(
        SeaOrmResourceMutationHandler::<entities::person::Entity, _>::new(
            registry.as_ref(),
            "people",
            SeaOrmColumnValueCodec::<entities::person::Entity>::default(),
        )
        .expect("person mutation mapping is valid"),
    );
    let comment_handler = Arc::new(
        SeaOrmResourceMutationHandler::<entities::comment::Entity, _>::new(
            registry.as_ref(),
            "comments",
            SeaOrmColumnValueCodec::<entities::comment::Entity>::default(),
        )
        .expect("comment mutation mapping is valid"),
    );
    let article_comments = Arc::new(
        SeaOrmToManyForeignKeyMutationHandler::<entities::comment::Entity, _>::new(
            registry.as_ref(),
            "articles",
            "comments",
            SeaOrmColumnValueCodec::<entities::comment::Entity>::default(),
        )
        .expect("article comments mutation mapping is valid"),
    );
    let mutations = Arc::new(SeaOrmBaseMutationAdapter::new(
        database.clone(),
        vec![
            article_handler.clone(),
            comment_handler,
            article_comments.clone(),
        ],
    ));
    let atomic = Arc::new(SeaOrmAtomicOperationDispatcher::new(vec![
        article_handler,
        person_handler,
        article_comments,
    ]));
    let authorization = Arc::new(SharedAuthorization::new(FixtureAuthorizationPolicy));
    let api = ApiBuilder::new(Arc::clone(&registry), authorization.clone())
        .queries(
            Arc::new(queries),
            PaginationConfig::new(1, 100, Some(100), Some(100))
                .expect("pagination settings are valid"),
        )
        .mutations(mutations)
        .atomic_operations(database, authorization, atomic)
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
