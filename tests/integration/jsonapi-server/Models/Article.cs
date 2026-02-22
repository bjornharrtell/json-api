using JsonApiDotNetCore.Resources;
using JsonApiDotNetCore.Resources.Annotations;

namespace JsonApiServer.Models;

[Resource(PublicName = "articles")]
public class Article : Identifiable<int>
{
    [Attr]
    public string? Title { get; set; }

    [HasOne]
    public Person? Author { get; set; }

    public int? AuthorId { get; set; }

    [HasMany]
    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
}
