using JsonApiDotNetCore.Configuration;
using JsonApiDotNetCore.Resources;
using JsonApiServer.Models;

namespace JsonApiServer.ResourceDefinitions;

public sealed class ArticleResourceDefinition : JsonApiResourceDefinition<Article, int>
{
    public ArticleResourceDefinition(IResourceGraph resourceGraph) : base(resourceGraph) { }

    public override IDictionary<string, object?>? GetMeta(Article resource)
    {
        return new Dictionary<string, object?>
        {
            ["copyright"] = "MIT License"
        };
    }
}
