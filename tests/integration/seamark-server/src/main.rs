use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use axum::{Router, routing::get};
use seamark::document::{Relationship, RelationshipData, ResourceIdentifier};
use seamark::http::{self, AdapterError, AdapterResource, AllowAllAuthorizer, ResourceAdapter};
use seamark::registry::{ResourceDefinition, ResourceRegistry};
use serde_json::json;

struct SeedAdapter;

#[async_trait]
impl ResourceAdapter for SeedAdapter {
    async fn collection(
        &self,
        resource: &ResourceDefinition,
    ) -> Result<Vec<AdapterResource>, AdapterError> {
        Ok(match resource.type_name() {
            "articles" => vec![
                article("1", "JSON:API paints my bikeshed!", "1", &["1", "2"]),
                article("2", "Other article", "2", &[]),
            ],
            "people" => vec![
                person("1", "Dan", "Gebhardt", "dgeb"),
                person("2", "Jane", "Doe", "jdoe"),
            ],
            "comments" => vec![
                comment("1", "First!", "1", "1"),
                comment("2", "I like XML better", "2", "1"),
            ],
            _ => Vec::new(),
        })
    }

    async fn resource(
        &self,
        resource: &ResourceDefinition,
        id: &str,
    ) -> Result<Option<AdapterResource>, AdapterError> {
        Ok(self
            .collection(resource)
            .await?
            .into_iter()
            .find(|record| record.id == id))
    }
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

#[tokio::main]
async fn main() {
    let registry = Arc::new(
        ResourceRegistry::new([
            ResourceDefinition::new("articles", "id")
                .attribute("title", "title", false, false)
                .relationship("author", "author_id", "people")
                .relationship("comments", "comment_ids", "comments"),
            ResourceDefinition::new("people", "id")
                .attribute("firstName", "first_name", false, false)
                .attribute("lastName", "last_name", false, false)
                .attribute("twitter", "twitter", false, false),
            ResourceDefinition::new("comments", "id")
                .attribute("body", "body", false, false)
                .relationship("author", "author_id", "people")
                .relationship("article", "article_id", "articles"),
        ])
        .expect("resource definitions are valid"),
    );
    let api = http::router(
        registry,
        Arc::new(SeedAdapter),
        Arc::new(AllowAllAuthorizer),
    );
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
