using JsonApiDotNetCore.Resources;
using JsonApiDotNetCore.Resources.Annotations;

namespace JsonApiServer.Models;

[Resource(PublicName = "comments")]
public class Comment : Identifiable<int>
{
    [Attr]
    public string? Body { get; set; }

    [HasOne]
    public Person? Author { get; set; }

    public int? AuthorId { get; set; }

    [HasOne]
    public Article? Article { get; set; }

    public int? ArticleId { get; set; }
}
